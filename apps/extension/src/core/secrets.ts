/**
 * Device-token storage (security review): the token lives in the EXTENSION ORIGIN's IndexedDB.
 * Unlike chrome.storage.local, content scripts cannot read it (they only see the page origin's
 * IndexedDB). Only the worker and extension pages can.
 */
const DB = "suiem-secrets";
const STORE = "kv";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export const getSecret = <T>(key: string) =>
  tx<T | undefined>("readonly", (s) => s.get(key) as IDBRequest<T | undefined>);
export const setSecret = (key: string, value: unknown) =>
  tx("readwrite", (s) => s.put(value, key)).then(() => undefined);
export const deleteSecret = (key: string) =>
  tx("readwrite", (s) => s.delete(key)).then(() => undefined);
