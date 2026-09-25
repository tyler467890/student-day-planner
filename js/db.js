/**
 * IndexedDB storage. One database, versioned schema, no network.
 */

const DB_NAME = 'dayli';
const DB_VERSION = 1;
const STORES = ['tasks', 'overrides', 'completions', 'bonuses', 'settings', 'reminders', 'background'];

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let dbPromise = null;

export function getDB() {
  if (!dbPromise) dbPromise = openDB();
  return dbPromise;
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('aborted'));
  });
}

export async function getAll(storeName) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export async function put(storeName, value) {
  const db = await getDB();
  const tx = db.transaction(storeName, 'readwrite');
  tx.objectStore(storeName).put(value);
  await txDone(tx);
}

export async function putMany(storeName, values) {
  const db = await getDB();
  const tx = db.transaction(storeName, 'readwrite');
  const store = tx.objectStore(storeName);
  for (const value of values) store.put(value);
  await txDone(tx);
}

export async function remove(storeName, id) {
  const db = await getDB();
  const tx = db.transaction(storeName, 'readwrite');
  tx.objectStore(storeName).delete(id);
  await txDone(tx);
}

export async function clearStore(storeName) {
  const db = await getDB();
  const tx = db.transaction(storeName, 'readwrite');
  tx.objectStore(storeName).clear();
  await txDone(tx);
}

export async function replaceAll(data) {
  const db = await getDB();
  const tx = db.transaction(STORES, 'readwrite');
  for (const name of STORES) {
    const store = tx.objectStore(name);
    store.clear();
    const rows = data[name] || [];
    for (const row of rows) store.put(row);
  }
  await txDone(tx);
}

export async function loadAll() {
  const [tasks, overrides, completions, bonuses, settingsRows, reminders, backgrounds] = await Promise.all([
    getAll('tasks'),
    getAll('overrides'),
    getAll('completions'),
    getAll('bonuses'),
    getAll('settings'),
    getAll('reminders'),
    getAll('background'),
  ]);
  return {
    tasks,
    overrides,
    completions,
    bonuses,
    settings: settingsRows.find((row) => row.id === 'main') || null,
    reminders,
    background: backgrounds.find((row) => row.id === 'current') || null,
  };
}

export async function eraseDatabase() {
  if (dbPromise) {
    try {
      const db = await dbPromise;
      db.onversionchange = () => db.close();
      db.close();
    } catch { /* open already failed */ }
    dbPromise = null;
  }
  await new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error || new Error('Could not erase storage'));
  });
}
