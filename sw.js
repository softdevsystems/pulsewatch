const CACHE='pulsewatch-github-pages-light-v5-cleanheader';
const SHELL=['./','./index.html','./offline.html','./assets/css/app.css','./assets/js/db.js','./assets/js/app.js','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png'];

self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)));self.skipWaiting()});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));self.clients.claim()});
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(u.origin!==self.location.origin || e.request.method!=='GET') return;
  e.respondWith(fetch(e.request).then(r=>{const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));return r}).catch(()=>caches.match(e.request).then(r=>r||caches.match('./offline.html'))));
});
self.addEventListener('notificationclick',e=>{e.notification.close();const url=e.notification.data?.url||'./';e.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(list=>{for(const c of list){if('focus'in c){c.navigate(url).catch(()=>{});return c.focus()}}return clients.openWindow(url)}))});

function openDB(){return new Promise((resolve,reject)=>{const r=indexedDB.open('pulsewatch-db',1);r.onupgradeneeded=()=>{const db=r.result;if(!db.objectStoreNames.contains('monitors'))db.createObjectStore('monitors',{keyPath:'id'});if(!db.objectStoreNames.contains('settings'))db.createObjectStore('settings',{keyPath:'key'})};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})}
async function getAll(storeName){const db=await openDB();return new Promise((resolve,reject)=>{const r=db.transaction(storeName,'readonly').objectStore(storeName).getAll();r.onsuccess=()=>resolve(r.result||[]);r.onerror=()=>reject(r.error)})}
async function putMonitor(m){const db=await openDB();return new Promise((resolve,reject)=>{const tx=db.transaction('monitors','readwrite');tx.objectStore('monitors').put(m);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error)})}
async function getSetting(key,fallback){const db=await openDB();return new Promise((resolve,reject)=>{const r=db.transaction('settings','readonly').objectStore('settings').get(key);r.onsuccess=()=>resolve(r.result?r.result.value:fallback);r.onerror=()=>reject(r.error)})}
function expected(code,range){const [a,b]=String(range||'200-399').split('-').map(Number);return code>=a&&code<=b}
async function timedFetch(url,options,timeoutSeconds){const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),Math.max(1,Number(timeoutSeconds||10))*1000);try{return await fetch(url,{...options,signal:controller.signal})}finally{clearTimeout(timer)}}
async function probeUrl(url,timeoutSeconds){const target=new URL(url);if(self.location.protocol==='https:'&&target.protocol==='http:')throw new Error('HTTP target blocked by secure-page mixed-content rules. Use HTTPS.');try{const started=Date.now();const r=await timedFetch(url,{method:'GET',mode:'cors',cache:'no-store',redirect:'follow',credentials:'omit'},timeoutSeconds);return{reachable:true,httpCode:r.status||null,responseTime:Math.max(1,Date.now()-started),mode:'http'}}catch(first){try{const started=Date.now();await timedFetch(url,{method:'GET',mode:'no-cors',cache:'no-store',redirect:'follow',credentials:'omit'},timeoutSeconds);return{reachable:true,httpCode:null,responseTime:Math.max(1,Date.now()-started),mode:'reachability'}}catch(second){throw new Error(second?.name==='AbortError'?`Timed out after ${timeoutSeconds}s`:(second?.message||first?.message||'Network request failed'))}}}

async function backgroundCheck(){
  const monitors=await getAll('monitors');const notify=await getSetting('notifications',false);const limit=Number(await getSetting('historyLimit',60));const now=Date.now();
  for(const m of monitors.filter(x=>x.enabled&&(!x.nextCheck||x.nextCheck<=now)).slice(0,5)){
    const prev=m.status||'unknown';
    try{const r=await probeUrl(m.url,Number(m.timeout||10));m.httpCode=r.httpCode;m.responseTime=r.responseTime;m.checkMode=r.mode;m.error=null;m.status=r.httpCode===null?'online':(expected(r.httpCode,m.expected)?'online':'down');m.note=r.httpCode===null?'Reachability only — HTTP status hidden by cross-origin browser rules.':null}catch(err){m.status='down';m.httpCode=null;m.responseTime=null;m.checkMode='failed';m.note=null;m.error=String(err.message||err)}
    m.lastChecked=Date.now();m.nextCheck=m.lastChecked+Number(m.interval||5)*60000;m.history=Array.isArray(m.history)?m.history:[];m.history.push({checkedAt:m.lastChecked,status:m.status,httpCode:m.httpCode,responseTime:m.responseTime,error:m.error||null,checkMode:m.checkMode||null});if(m.history.length>limit)m.history=m.history.slice(-limit);await putMonitor(m);
    if(notify&&Notification.permission==='granted'&&prev!=='unknown'&&prev!==m.status){const title=m.status==='down'?`🔴 ${m.name} appears down`:`🟢 ${m.name} is reachable again`;const body=m.status==='down'?`${m.url} did not answer the browser probe${m.error?': '+m.error:'.'}`:`${m.url} responded${m.responseTime?` in ${m.responseTime} ms`:''}${m.httpCode?` (HTTP ${m.httpCode})`:''}.`;await self.registration.showNotification(title,{body,icon:'./icons/icon-192.png',badge:'./icons/icon-192.png',tag:`pulsewatch-${m.id}`,renotify:true,data:{url:m.url}})}
  }
}
self.addEventListener('periodicsync',e=>{if(e.tag==='pulsewatch-background')e.waitUntil(backgroundCheck())});
