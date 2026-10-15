/**
 * The backup key is the one thing that must never be lost: without it a browser forgets it was ever
 * linked and shows empty lists. It is kept in three independent places (localStorage, a long-lived
 * cookie, IndexedDB) so a partial storage wipe cannot unlink the app, and the browser is asked to
 * mark this site's storage as persistent so it is not evicted.
 */

const COOKIE = 'lifehub_sync_key';
const IDB_NAME = 'lifehub-vault';
const IDB_STORE = 'kv';
const KEY_RE = /^[0-9a-f]{24,}$/i;

export function vaultCookieRead(): string | undefined {
  try {
    const m = document.cookie.match(new RegExp(`(?:^|; )${COOKIE}=([0-9a-f]+)`, 'i'));
    return m && KEY_RE.test(m[1]) ? m[1] : undefined;
  } catch {
    return undefined;
  }
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise(resolve => {
    try {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function vaultIdbRead(): Promise<string | undefined> {
  const db = await openDb();
  if (!db) return undefined;
  return new Promise(resolve => {
    try {
      const req = db.transaction(IDB_STORE).objectStore(IDB_STORE).get('key');
      req.onsuccess = () => resolve(typeof req.result === 'string' && KEY_RE.test(req.result) ? req.result : undefined);
      req.onerror = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
}

/** Mirror the key (or forget it) in the cookie and IndexedDB. localStorage is written by the caller. */
export function vaultWrite(key: string | undefined) {
  try {
    document.cookie = key
      ? `${COOKIE}=${key}; max-age=${60 * 60 * 24 * 730}; path=/; SameSite=Lax; Secure`
      : `${COOKIE}=; max-age=0; path=/; SameSite=Lax; Secure`;
  } catch {
    /* cookies blocked */
  }
  void openDb().then(db => {
    if (!db) return;
    try {
      const store = db.transaction(IDB_STORE, 'readwrite').objectStore(IDB_STORE);
      if (key) store.put(key, 'key');
      else store.delete('key');
    } catch {
      /* ignore */
    }
  });
}

/** Ask the browser not to evict this site's storage under pressure. */
export function requestPersistentStorage() {
  try {
    void navigator.storage?.persist?.();
  } catch {
    /* unsupported */
  }
}
