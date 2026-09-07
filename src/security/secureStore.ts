export interface KvStore {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

const DB_NAME = 'finanzas-za-secure';
const STORE_NAME = 'kv';

export function createMemoryStore(initial: Record<string, string> = {}): KvStore {
  const map = new Map(Object.entries(initial));
  return {
    async get(key) {
      return map.get(key);
    },
    async set(key, value) {
      map.set(key, value);
    },
    async delete(key) {
      map.delete(key);
    },
  };
}

function createIndexedDbStore(): KvStore {
  const open = () =>
    new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('No se pudo abrir el almacén seguro'));
    });

  return {
    async get(key) {
      const db = await open();
      try {
        return await new Promise<string | undefined>((resolve, reject) => {
          const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(key);
          request.onsuccess = () => {
            const value = request.result;
            resolve(typeof value === 'string' ? value : undefined);
          };
          request.onerror = () => reject(request.error ?? new Error('No se pudo leer el almacén seguro'));
        });
      } finally {
        db.close();
      }
    },
    async set(key, value) {
      const db = await open();
      try {
        await new Promise<void>((resolve, reject) => {
          const request = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(value, key);
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error ?? new Error('No se pudo guardar en el almacén seguro'));
        });
      } finally {
        db.close();
      }
    },
    async delete(key) {
      const db = await open();
      try {
        await new Promise<void>((resolve, reject) => {
          const request = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).delete(key);
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error ?? new Error('No se pudo borrar del almacén seguro'));
        });
      } finally {
        db.close();
      }
    },
  };
}

let defaultStore: KvStore | null = null;

export function setSecureStore(store: KvStore | null) {
  defaultStore = store;
}

export function getSecureStore(): KvStore {
  if (defaultStore) return defaultStore;
  if (typeof indexedDB !== 'undefined') {
    defaultStore = createIndexedDbStore();
  } else {
    defaultStore = createMemoryStore();
  }
  return defaultStore;
}
