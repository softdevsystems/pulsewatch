const PulseDB = (() => {
  const DB_NAME = 'pulsewatch-db';
  const DB_VERSION = 1;
  let dbPromise;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('monitors')) db.createObjectStore('monitors', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function tx(storeName, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, mode);
      const store = transaction.objectStore(storeName);
      const result = fn(store);
      transaction.oncomplete = () => resolve(result && result.result !== undefined ? result.result : result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }

  const getAllMonitors = async () => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const req = db.transaction('monitors', 'readonly').objectStore('monitors').getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  };

  const getMonitor = async id => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const req = db.transaction('monitors', 'readonly').objectStore('monitors').get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  };

  const putMonitor = monitor => tx('monitors', 'readwrite', store => store.put(monitor));
  const deleteMonitor = id => tx('monitors', 'readwrite', store => store.delete(id));
  const clearMonitors = () => tx('monitors', 'readwrite', store => store.clear());

  async function getSetting(key, fallback = null) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const req = db.transaction('settings', 'readonly').objectStore('settings').get(key);
      req.onsuccess = () => resolve(req.result ? req.result.value : fallback);
      req.onerror = () => reject(req.error);
    });
  }
  const setSetting = (key, value) => tx('settings', 'readwrite', store => store.put({ key, value }));
  const clearSettings = () => tx('settings', 'readwrite', store => store.clear());

  return { open, getAllMonitors, getMonitor, putMonitor, deleteMonitor, clearMonitors, getSetting, setSetting, clearSettings };
})();
