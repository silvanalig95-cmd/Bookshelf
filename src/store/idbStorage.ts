/**
 * Persistenz in IndexedDB statt localStorage: grosse Bibliotheken (mehrere
 * tausend Bücher mit Themen) sprengen sonst das 5-MB-Limit von localStorage.
 * Schreibvorgänge werden gebündelt, damit z. B. der Themen-Abgleich nicht bei
 * jedem einzelnen Buch die ganze Bibliothek neu schreibt.
 */
import type { StateStorage } from 'zustand/middleware';

const DB_NAME = 'lesekompass';
const STORE = 'kv';

let dbPromise: Promise<IDBDatabase> | undefined;

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = run(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

const pending = new Map<string, string>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function flush(name: string) {
  const value = pending.get(name);
  pending.delete(name);
  timers.delete(name);
  if (value === undefined) return;
  tx('readwrite', (s) => s.put(value, name)).catch(() => {
    try {
      localStorage.setItem(name, value);
    } catch {
      /* Speicher voll – nichts zu machen */
    }
  });
}

// Beim Schliessen des Tabs ausstehende Änderungen noch schreiben
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    for (const name of Array.from(pending.keys())) flush(name);
  });
}

export const idbStorage: StateStorage = {
  async getItem(name) {
    if (pending.has(name)) return pending.get(name)!;
    try {
      const value = await tx<string | undefined>('readonly', (s) => s.get(name) as IDBRequest<string | undefined>);
      if (value != null) return value;
    } catch {
      /* IndexedDB nicht verfügbar (z. B. privater Modus) */
    }
    return localStorage.getItem(name);
  },
  setItem(name, value) {
    pending.set(name, value);
    const t = timers.get(name);
    if (t) clearTimeout(t);
    timers.set(name, setTimeout(() => flush(name), 600));
  },
  async removeItem(name) {
    pending.delete(name);
    localStorage.removeItem(name);
    await tx('readwrite', (s) => s.delete(name)).catch(() => undefined);
  },
};
