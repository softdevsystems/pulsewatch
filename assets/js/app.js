(() => {
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  let monitors = [];
  let deferredInstallPrompt = null;
  let checking = new Set();
  let settings = { notifications: false, defaultInterval: 5, historyLimit: 60 };

  const els = {
    monitorList: $('#monitorList'), emptyState: $('#emptyState'), total: $('#totalCount'), enabled: $('#enabledCount'), online: $('#onlineCount'), down: $('#downCount'), onlinePercent: $('#onlinePercent'), incident: $('#incidentCount'), avgResponse: $('#avgResponse'), health: $('#healthStrip'), modal: $('#monitorModal'), form: $('#monitorForm'), url: $('#urlInput'), name: $('#nameInput'), interval: $('#intervalInput'), timeout: $('#timeoutInput'), expected: $('#expectedInput'), enabledInput: $('#enabledInput'), monitorId: $('#monitorId'), detailsModal: $('#detailsModal'), detailsTitle: $('#detailsTitle'), detailsBody: $('#detailsBody'), search: $('#searchInput'), filter: $('#statusFilter'), installBtn: $('#installBtn')
  };

  const now = () => Date.now();
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'm_' + Date.now() + '_' + Math.random().toString(36).slice(2));
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  const fmtTime = ts => ts ? new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit',second:'2-digit'}).format(new Date(ts)) : 'Never';
  const fmtAgo = ts => { if(!ts) return 'Never'; const s=Math.max(0,Math.floor((Date.now()-ts)/1000)); if(s<60)return `${s}s ago`; if(s<3600)return `${Math.floor(s/60)}m ago`; if(s<86400)return `${Math.floor(s/3600)}h ago`; return `${Math.floor(s/86400)}d ago`; };
  const fmtNext = ts => { if(!ts) return 'Due now'; const s=Math.ceil((ts-Date.now())/1000); if(s<=0)return 'Due now'; if(s<60)return `in ${s}s`; if(s<3600)return `in ${Math.ceil(s/60)}m`; return `in ${Math.ceil(s/3600)}h`; };

  function normalizeUrl(value) {
    let v = value.trim();
    if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
    const u = new URL(v);
    if (!['http:','https:'].includes(u.protocol)) throw new Error('Only HTTP and HTTPS URLs are supported.');
    u.hash = '';
    return u.toString();
  }

  function autoName(url) {
    try { const h = new URL(url).hostname.replace(/^www\./,''); return h.split('.')[0].replace(/[-_]/g,' ').replace(/\b\w/g,c=>c.toUpperCase()); } catch { return 'Website'; }
  }
  const hostname = url => { try{return new URL(url).hostname.replace(/^www\./,'')}catch{return url} };
  const initial = name => (name || '?').trim().charAt(0).toUpperCase();

  function statusFor(m) { if (!m.enabled) return 'paused'; return m.status || 'unknown'; }
  function uptime(m) { const h=m.history||[]; if(!h.length)return null; const valid=h.filter(x=>x.status==='online'||x.status==='down'); if(!valid.length)return null; return Math.round(valid.filter(x=>x.status==='online').length/valid.length*1000)/10; }

  function isInstalledDisplayMode() {
    return window.matchMedia('(display-mode: standalone)').matches ||
      window.matchMedia('(display-mode: fullscreen)').matches ||
      window.matchMedia('(display-mode: minimal-ui)').matches ||
      window.navigator.standalone === true;
  }

  function syncInstallButton() {
    if (!els.installBtn) return;
    if (isInstalledDisplayMode()) {
      deferredInstallPrompt = null;
      els.installBtn.hidden = true;
      return;
    }
    els.installBtn.hidden = !deferredInstallPrompt;
  }

  async function checkAllMonitors() {
    const enabled = monitors.filter(m=>m.enabled);
    if(!enabled.length){toast('Nothing to check','Add or enable a monitor first.');return}
    toast('Checks started',`Checking ${enabled.length} monitor(s)…`);
    for(const m of enabled) checkMonitor(m.id,false);
  }

  async function loadSettings() {
    settings.notifications = await PulseDB.getSetting('notifications', false);
    settings.defaultInterval = Number(await PulseDB.getSetting('defaultInterval', 5));
    settings.historyLimit = Number(await PulseDB.getSetting('historyLimit', 60));
    $('#notificationsToggle').checked = settings.notifications;
    $('#defaultInterval').value = String(settings.defaultInterval);
    $('#historyLimit').value = String(settings.historyLimit);
  }

  async function loadMonitors() { monitors = await PulseDB.getAllMonitors(); monitors.sort((a,b)=>(a.createdAt||0)-(b.createdAt||0)); render(); }

  function render() {
    renderStats(); renderHealth(); renderMonitors();
  }

  function renderStats() {
    const enabled = monitors.filter(m=>m.enabled);
    const online = enabled.filter(m=>m.status==='online');
    const down = enabled.filter(m=>m.status==='down');
    const latencies = enabled.filter(m=>m.status==='online' && Number.isFinite(m.responseTime)).map(m=>m.responseTime);
    els.total.textContent = monitors.length;
    els.enabled.textContent = `${enabled.length} enabled`;
    els.online.textContent = online.length;
    els.down.textContent = down.length;
    els.onlinePercent.textContent = `${enabled.length ? Math.round(online.length/enabled.length*100) : 0}% healthy`;
    els.incident.textContent = `${down.length} active incident${down.length===1?'':'s'}`;
    els.avgResponse.textContent = latencies.length ? `${Math.round(latencies.reduce((a,b)=>a+b,0)/latencies.length)} ms` : '—';
  }

  function renderHealth() {
    const points = monitors.flatMap(m => (m.history || []).map(x => ({...x, monitorId:m.id}))).sort((a,b)=>a.checkedAt-b.checkedAt).slice(-80);
    if (!points.length) { els.health.className='health-strip empty'; els.health.innerHTML='<span>Add a monitor to start collecting uptime history.</span>'; return; }
    els.health.className='health-strip';
    els.health.innerHTML = points.map(p=>`<div class="bar ${p.status==='online'?'online':p.status==='down'?'down':''}" title="${esc(fmtTime(p.checkedAt))} — ${esc(p.status)}"></div>`).join('');
  }

  function renderMonitors() {
    const q = els.search.value.trim().toLowerCase();
    const f = els.filter.value;
    const filtered = monitors.filter(m => (!q || `${m.name} ${m.url}`.toLowerCase().includes(q)) && (f==='all' || statusFor(m)===f));
    els.emptyState.hidden = monitors.length > 0;
    els.monitorList.hidden = monitors.length === 0;
    els.monitorList.innerHTML = filtered.map(m => {
      const s=statusFor(m), up=uptime(m), busy=checking.has(m.id);
      return `<article class="monitor-row" data-id="${m.id}">
        <div class="site-cell"><div class="site-icon">${esc(initial(m.name))}</div><div><strong>${esc(m.name)}</strong><a href="${esc(m.url)}" target="_blank" rel="noopener noreferrer">${esc(hostname(m.url))}</a></div></div>
        <div><span class="status-pill ${s}">${busy?'Checking…':s.charAt(0).toUpperCase()+s.slice(1)}</span></div>
        <div class="metric-cell latency-cell"><span>Response</span><strong>${Number.isFinite(m.responseTime)?m.responseTime+' ms':'—'}</strong></div>
        <div class="metric-cell code-cell"><span>HTTP</span><strong>${m.httpCode || '—'}</strong></div>
        <div class="metric-cell next-cell"><span>${m.enabled?'Next check':'Last check'}</span><strong>${m.enabled?fmtNext(m.nextCheck):fmtAgo(m.lastChecked)}</strong></div>
        <div class="metric-cell uptime-cell"><span>Uptime</span><strong>${up===null?'—':up+'%'}</strong></div>
        <div class="row-actions"><button class="mini-btn" data-action="check" title="Check now">↻</button><button class="mini-btn" data-action="details" title="Details">⌁</button><button class="mini-btn" data-action="edit" title="Edit">✎</button><button class="mini-btn" data-action="delete" title="Delete">×</button></div>
      </article>`;
    }).join('');
    if (monitors.length && !filtered.length) els.monitorList.innerHTML='<div class="empty-state"><h3>No matching monitors</h3><p>Try changing your search or status filter.</p></div>';
  }

  function toast(title, message, type='info') {
    const node=document.createElement('div'); node.className='toast';
    node.innerHTML=`<span class="dot ${type==='success'?'online':''}" style="background:${type==='error'?'var(--red)':type==='success'?'var(--green)':'var(--cyan)'}"></span><div><strong>${esc(title)}</strong><p>${esc(message)}</p></div>`;
    $('#toastStack').appendChild(node); setTimeout(()=>node.remove(),4500);
  }

  async function notifyStateChange(m, from, to) {
    if (!settings.notifications || Notification.permission !== 'granted' || from === 'unknown' || from === to) return;
    const title = to === 'down' ? `🔴 ${m.name} appears down` : `🟢 ${m.name} is reachable again`;
    const body = to === 'down'
      ? `${hostname(m.url)} did not answer the browser probe${m.error ? ': ' + m.error : '.'}`
      : `${hostname(m.url)} responded${m.responseTime ? ` in ${m.responseTime} ms` : ''}${m.httpCode ? ` (HTTP ${m.httpCode})` : ''}.`;
    try {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification(title,{body,icon:'icons/icon-192.png',badge:'icons/icon-192.png',tag:`pulsewatch-${m.id}`,renotify:true,data:{url:m.url}});
    } catch { new Notification(title,{body}); }
  }

  function isExpected(code, expected) {
    const [min,max]=String(expected||'200-399').split('-').map(Number); return code>=min && code<=max;
  }

  async function timedFetch(url, options, timeoutSeconds) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1, Number(timeoutSeconds||10)) * 1000);
    try { return await fetch(url,{...options,signal:controller.signal}); }
    finally { clearTimeout(timer); }
  }

  async function probeUrl(url, timeoutSeconds) {
    const target = new URL(url);
    if (location.protocol === 'https:' && target.protocol === 'http:') {
      throw new Error('HTTP targets can be blocked as mixed content. Use an HTTPS URL.');
    }
    const started = performance.now();
    try {
      const response = await timedFetch(url,{method:'GET',mode:'cors',cache:'no-store',redirect:'follow',credentials:'omit'},timeoutSeconds);
      return {reachable:true,httpCode:response.status || null,responseTime:Math.max(1,Math.round(performance.now()-started)),mode:'http',finalUrl:response.url || url};
    } catch (corsOrNetworkError) {
      const fallbackStarted = performance.now();
      try {
        await timedFetch(url,{method:'GET',mode:'no-cors',cache:'no-store',redirect:'follow',credentials:'omit'},timeoutSeconds);
        return {reachable:true,httpCode:null,responseTime:Math.max(1,Math.round(performance.now()-fallbackStarted)),mode:'reachability',finalUrl:url};
      } catch (fallbackError) {
        const message = fallbackError?.name === 'AbortError' ? `Timed out after ${timeoutSeconds}s` : (fallbackError?.message || corsOrNetworkError?.message || 'Network request failed');
        throw new Error(message);
      }
    }
  }

  async function checkMonitor(id, manual=false) {
    const idx=monitors.findIndex(m=>m.id===id); if(idx<0 || checking.has(id)) return;
    const m=monitors[idx]; checking.add(id); renderMonitors();
    const previous=m.status || 'unknown';
    try {
      const result=await probeUrl(m.url,Number(m.timeout||10));
      m.httpCode=result.httpCode;
      m.responseTime=result.responseTime;
      m.finalUrl=result.finalUrl || m.url;
      m.checkMode=result.mode;
      m.error=null;
      m.status=result.httpCode===null ? 'online' : (isExpected(result.httpCode,m.expected)?'online':'down');
      if(result.httpCode===null) m.note='Reachability only — HTTP status hidden by cross-origin browser rules.';
      else m.note=null;
    } catch(err) {
      m.status='down'; m.httpCode=null; m.responseTime=null; m.checkMode='failed'; m.note=null; m.error=err.message || 'Check failed';
    }
    m.lastChecked=now(); m.nextCheck=m.lastChecked + Number(m.interval||5)*60*1000;
    m.history=Array.isArray(m.history)?m.history:[];
    m.history.push({checkedAt:m.lastChecked,status:m.status,httpCode:m.httpCode,responseTime:m.responseTime,error:m.error||null,checkMode:m.checkMode||null});
    if(m.history.length>settings.historyLimit) m.history=m.history.slice(-settings.historyLimit);
    await PulseDB.putMonitor(m); monitors[idx]=m; checking.delete(id); render();
    await notifyStateChange(m,previous,m.status);
    if(manual) {
      const detail=m.httpCode ? `HTTP ${m.httpCode} • ${m.responseTime} ms` : (m.status==='online' ? `Reachable • HTTP status unavailable • ${m.responseTime} ms` : m.error || 'No response');
      toast(m.status==='online'?'Website is reachable':'Website appears down',`${m.name}: ${detail}`,m.status==='online'?'success':'error');
    }
  }

  async function checkDue() {
    const due=monitors.filter(m=>m.enabled && !checking.has(m.id) && (!m.nextCheck || m.nextCheck<=now()));
    for(const m of due.slice(0,3)) checkMonitor(m.id,false);
    renderMonitors();
  }

  async function saveMonitor(e) {
    e.preventDefault();
    let url;
    try{url=normalizeUrl(els.url.value)}catch(err){toast('Invalid URL',err.message,'error');return}
    const id=els.monitorId.value || uid();
    const old=monitors.find(m=>m.id===id);
    const monitor={
      id, name:els.name.value.trim()||autoName(url), url, interval:Number(els.interval.value), timeout:Number(els.timeout.value), expected:els.expected.value, enabled:els.enabledInput.checked,
      status:old?.status||'unknown', httpCode:old?.httpCode||null, responseTime:old?.responseTime??null, error:old?.error||null,
      lastChecked:old?.lastChecked||null, nextCheck:old?.nextCheck||now(), history:old?.history||[], createdAt:old?.createdAt||now(), updatedAt:now()
    };
    if(old && (old.url!==url || old.expected!==monitor.expected)) { monitor.status='unknown'; monitor.nextCheck=now(); }
    await PulseDB.putMonitor(monitor);
    const i=monitors.findIndex(m=>m.id===id); if(i>=0)monitors[i]=monitor; else monitors.push(monitor);
    closeModal('monitorModal'); render(); toast(old?'Monitor updated':'Monitor added',`${monitor.name} will check every ${monitor.interval} minute${monitor.interval===1?'':'s'}.`,'success');
    if(monitor.enabled) checkMonitor(monitor.id,false);
  }

  function openAdd() {
    els.form.reset(); els.monitorId.value=''; $('#monitorModalTitle').textContent='Add website monitor'; els.interval.value=String(settings.defaultInterval); els.timeout.value='10'; els.expected.value='200-399'; els.enabledInput.checked=true; openModal('monitorModal'); setTimeout(()=>els.url.focus(),50);
  }
  function openEdit(m) {
    els.monitorId.value=m.id; els.url.value=m.url; els.name.value=m.name; els.interval.value=String(m.interval||5); els.timeout.value=String(m.timeout||10); els.expected.value=m.expected||'200-399'; els.enabledInput.checked=!!m.enabled; $('#monitorModalTitle').textContent='Edit website monitor'; openModal('monitorModal');
  }
  function openDetails(m) {
    const up=uptime(m); els.detailsTitle.textContent=m.name;
    const history=[...(m.history||[])].reverse().slice(0,30);
    const modeLabel=m.checkMode==='http'?'Full HTTP status':m.checkMode==='reachability'?'Reachability only':m.checkMode==='failed'?'Failed probe':'Not checked yet';
    els.detailsBody.innerHTML=`<div class="detail-grid"><div class="detail-card"><span>Status</span><strong>${esc(statusFor(m))}</strong></div><div class="detail-card"><span>HTTP code</span><strong>${m.httpCode||'Hidden'}</strong></div><div class="detail-card"><span>Response</span><strong>${Number.isFinite(m.responseTime)?m.responseTime+' ms':'—'}</strong></div><div class="detail-card"><span>Recent uptime</span><strong>${up===null?'—':up+'%'}</strong></div></div><div class="info-box" style="margin-top:12px"><strong>${esc(m.url)}</strong><p>${esc(modeLabel)} • Checks every ${m.interval} minute${m.interval===1?'':'s'} • Last checked ${esc(fmtTime(m.lastChecked))}${m.error?` • Last error: ${esc(m.error)}`:''}${m.note?` • ${esc(m.note)}`:''}</p></div><div class="history-list">${history.length?history.map(h=>`<div class="history-row"><span>${esc(fmtTime(h.checkedAt))}</span><strong>${esc(h.status)}</strong><strong>${h.httpCode||'Hidden'}</strong><strong class="history-latency">${Number.isFinite(h.responseTime)?h.responseTime+' ms':'—'}</strong></div>`).join(''):'<div class="history-row"><span>No history yet.</span></div>'}</div>`;
    openModal('detailsModal');
  }
  const openModal=id=>{document.getElementById(id).hidden=false;document.body.style.overflow='hidden'};
  const closeModal=id=>{document.getElementById(id).hidden=true;document.body.style.overflow=''};

  async function deleteMonitor(m) {
    if(!confirm(`Delete “${m.name}” and its local history?`))return; await PulseDB.deleteMonitor(m.id); monitors=monitors.filter(x=>x.id!==m.id); render(); toast('Monitor deleted',m.name);
  }

  async function requestNotifications(enabled) {
    if(enabled){
      if(!('Notification' in window)){toast('Notifications unavailable','This browser does not support web notifications.','error');$('#notificationsToggle').checked=false;return}
      const permission=await Notification.requestPermission();
      if(permission!=='granted'){toast('Permission not granted','Enable notifications in your browser site settings.','error');$('#notificationsToggle').checked=false;enabled=false}
    }
    settings.notifications=enabled; await PulseDB.setSetting('notifications',enabled);
  }

  async function exportBackup() {
    const payload={app:'PulseWatch',version:1,exportedAt:new Date().toISOString(),settings,monitors};
    const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`pulsewatch-backup-${new Date().toISOString().slice(0,10)}.json`; a.click(); URL.revokeObjectURL(a.href); toast('Backup exported','Your monitor configuration and recent history were saved.','success');
  }

  async function importBackup(file) {
    try{const data=JSON.parse(await file.text()); if(!Array.isArray(data.monitors))throw new Error('Invalid PulseWatch backup.'); for(const m of data.monitors)await PulseDB.putMonitor(m); if(data.settings){for(const k of ['notifications','defaultInterval','historyLimit','noticeDismissed'])if(k in data.settings)await PulseDB.setSetting(k,data.settings[k]);} await loadSettings(); await loadMonitors(); toast('Backup imported',`${data.monitors.length} monitor(s) restored.`,'success');}catch(err){toast('Import failed',err.message,'error')}
  }

  async function clearAll() {
    if(!confirm('Clear every monitor, setting, and stored history from this browser?'))return; await PulseDB.clearMonitors(); await PulseDB.clearSettings(); settings={notifications:false,defaultInterval:5,historyLimit:60,noticeDismissed:false}; await loadSettings(); await loadMonitors(); closeModal('settingsModal'); toast('Local data cleared','PulseWatch has been reset.');
  }

  async function registerServiceWorker() {
    if(!('serviceWorker' in navigator))return;
    try{
      const reg=await navigator.serviceWorker.register('sw.js');
      if('periodicSync' in reg){
        try{await reg.periodicSync.register('pulsewatch-background',{minInterval:15*60*1000}); $('#schedulerLabel').textContent='Browser scheduler + background sync';}catch{}
      }
    }catch(err){console.warn('Service worker registration failed',err)}
  }

  function bind() {
    $('#emptyAddBtn').onclick=openAdd; els.form.onsubmit=saveMonitor;
    const panelAdd=$('#panelAddMonitorBtn'); if(panelAdd) panelAdd.onclick=openAdd;
    const panelCheck=$('#panelCheckAllBtn'); if(panelCheck) panelCheck.onclick=checkAllMonitors;
    $$('.close-modal').forEach(b=>b.onclick=()=>closeModal(b.dataset.close));
    $$('.modal-backdrop').forEach(m=>m.addEventListener('click',e=>{if(e.target===m)closeModal(m.id)}));
    els.url.addEventListener('blur',()=>{if(!els.name.value.trim()&&els.url.value.trim()){try{els.name.value=autoName(normalizeUrl(els.url.value))}catch{}}});
    els.search.oninput=renderMonitors; els.filter.onchange=renderMonitors;
    els.monitorList.addEventListener('click',e=>{const btn=e.target.closest('[data-action]'); if(!btn)return; const row=e.target.closest('.monitor-row'); const m=monitors.find(x=>x.id===row?.dataset.id); if(!m)return; const a=btn.dataset.action; if(a==='check')checkMonitor(m.id,true); if(a==='details')openDetails(m); if(a==='edit')openEdit(m); if(a==='delete')deleteMonitor(m);});
    $('#notificationsToggle').onchange=e=>requestNotifications(e.target.checked);
    $('#defaultInterval').onchange=async e=>{settings.defaultInterval=Number(e.target.value);await PulseDB.setSetting('defaultInterval',settings.defaultInterval)};
    $('#historyLimit').onchange=async e=>{settings.historyLimit=Number(e.target.value);await PulseDB.setSetting('historyLimit',settings.historyLimit)};
    $$('[data-action="settings"]').forEach(b=>b.onclick=()=>openModal('settingsModal'));
    $('#exportBtn').onclick=exportBackup; $('#importInput').onchange=e=>{if(e.target.files[0])importBackup(e.target.files[0]);e.target.value=''}; $('#clearBtn').onclick=clearAll;
    const navItems=$$('[data-view]');
    const setActiveView=view=>{navItems.forEach(n=>n.classList.toggle('active',n.dataset.view===view));};
    navItems.forEach(n=>n.addEventListener('click',()=>{const view=n.dataset.view;setActiveView(view);if(view==='monitors')$('#monitorsSection').scrollIntoView({behavior:'smooth',block:'start'});if(view==='dashboard')window.scrollTo({top:0,behavior:'smooth'});}));
    const mobileAdd=$('#mobileAddBtn'); if(mobileAdd) mobileAdd.onclick=openAdd;
    const mobileCheck=$('#mobileCheckAllBtn'); if(mobileCheck) mobileCheck.onclick=checkAllMonitors;

    syncInstallButton();
    window.addEventListener('beforeinstallprompt',e=>{
      e.preventDefault();
      if (isInstalledDisplayMode()) return;
      deferredInstallPrompt=e;
      syncInstallButton();
    });
    if (els.installBtn) els.installBtn.onclick=async()=>{
      if(!deferredInstallPrompt || isInstalledDisplayMode()){syncInstallButton();return}
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice;
      deferredInstallPrompt=null;
      syncInstallButton();
    };
    window.addEventListener('appinstalled',()=>{
      deferredInstallPrompt=null;
      syncInstallButton();
      toast('PulseWatch installed','You can now launch it like an app.','success');
    });
    const displayModeQuery=window.matchMedia('(display-mode: standalone)');
    if(displayModeQuery.addEventListener) displayModeQuery.addEventListener('change',syncInstallButton);
    else if(displayModeQuery.addListener) displayModeQuery.addListener(syncInstallButton);
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)checkDue()});
  }

  async function init() {
    bind(); await PulseDB.open(); await loadSettings(); await loadMonitors(); await registerServiceWorker(); checkDue(); setInterval(checkDue,5000); setInterval(renderMonitors,1000);
  }
  init().catch(err=>{console.error(err);toast('Startup error',err.message,'error')});
})();
