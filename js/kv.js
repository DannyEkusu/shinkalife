// Tiny async key-value store for offline data. Uses IndexedDB; falls back to memory when the browser blocks it
// (some private-browsing modes, storage disabled). `mode` tells the UI which one is active.
export async function openStore(factory = globalThis.indexedDB) {
  const mem = new Map(), memory = { mode: 'memory', get: async k => mem.get(k), set: async (k, v) => { mem.set(k, JSON.parse(JSON.stringify(v))); }, del: async k => { mem.delete(k); }, keys: async () => [...mem.keys()] };
  if (!factory) return memory;
  try {
    const db = await new Promise((res, rej) => { const r = factory.open('shinkalife', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); r.onblocked = () => rej(new Error('blocked')); });
    const tx = (mode, fn) => new Promise((res, rej) => { const t = db.transaction('kv', mode), q = fn(t.objectStore('kv')); t.oncomplete = () => res(q?.result); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });
    await tx('readwrite', s => s.put(1, '__probe'));    // some browsers only fail on first write
    return { mode: 'indexeddb', get: k => tx('readonly', s => s.get(k)), set: (k, v) => tx('readwrite', s => s.put(JSON.parse(JSON.stringify(v)), k)), del: k => tx('readwrite', s => s.delete(k)), keys: () => tx('readonly', s => s.getAllKeys()) };
  } catch { return memory; }
}
