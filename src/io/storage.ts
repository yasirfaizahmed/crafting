/**
 * Small async key/value persistence used by autosave and recent projects.
 * IndexedDB when available (large quota), falling back to localStorage, then memory.
 */

export interface KVStore {
  readonly kind: 'indexeddb' | 'localstorage' | 'memory';
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export class MemoryStore implements KVStore {
  readonly kind = 'memory' as const;
  readonly data = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.data.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.data.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.data.delete(key);
  }
}

export class LocalStorageStore implements KVStore {
  readonly kind = 'localstorage' as const;

  constructor(
    private readonly ls: Storage,
    private readonly prefix = 'crafting:',
  ) {}

  async get(key: string): Promise<string | null> {
    return this.ls.getItem(this.prefix + key);
  }

  async set(key: string, value: string): Promise<void> {
    this.ls.setItem(this.prefix + key, value);
  }

  async delete(key: string): Promise<void> {
    this.ls.removeItem(this.prefix + key);
  }
}

const DB_NAME = 'crafting';
const STORE = 'kv';

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export class IndexedDBStore implements KVStore {
  readonly kind = 'indexeddb' as const;
  private db: Promise<IDBDatabase>;

  constructor(factory: IDBFactory) {
    this.db = new Promise((resolve, reject) => {
      const req = factory.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB unavailable'));
      req.onblocked = () => reject(new Error('IndexedDB blocked'));
    });
  }

  /** Resolves when the database opened (rejects when IndexedDB is unusable, e.g. some private modes). */
  ready(): Promise<unknown> {
    return this.db;
  }

  private async tx(mode: IDBTransactionMode): Promise<IDBObjectStore> {
    return (await this.db).transaction(STORE, mode).objectStore(STORE);
  }

  async get(key: string): Promise<string | null> {
    const v = await request((await this.tx('readonly')).get(key));
    return typeof v === 'string' ? v : null;
  }

  async set(key: string, value: string): Promise<void> {
    const store = await this.tx('readwrite');
    const tx = store.transaction;
    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB write aborted'));
    });
    store.put(value, key);
    await done;
  }

  async delete(key: string): Promise<void> {
    await request((await this.tx('readwrite')).delete(key));
  }
}

/**
 * Store that uses IndexedDB and transparently falls back to localStorage (then memory) when
 * IndexedDB cannot be opened or a write fails (quota, private browsing).
 */
export class FallbackStore implements KVStore {
  private primary: KVStore | null;
  private fallback: KVStore;
  private checked: Promise<void>;

  constructor(primary: IndexedDBStore | null, fallback: KVStore) {
    this.primary = primary;
    this.fallback = fallback;
    this.checked = primary
      ? primary.ready().then(
          () => undefined,
          () => {
            this.primary = null;
          },
        )
      : Promise.resolve();
  }

  get kind(): KVStore['kind'] {
    return this.primary?.kind ?? this.fallback.kind;
  }

  async get(key: string): Promise<string | null> {
    await this.checked;
    if (this.primary) {
      try {
        const v = await this.primary.get(key);
        if (v !== null) return v;
      } catch {
        /* fall through */
      }
    }
    try {
      return await this.fallback.get(key);
    } catch {
      return null;
    }
  }

  async set(key: string, value: string): Promise<void> {
    await this.checked;
    if (this.primary) {
      try {
        await this.primary.set(key, value);
        // Drop a stale fallback copy so reads never prefer an older value.
        await this.fallback.delete(key).catch(() => undefined);
        return;
      } catch {
        /* fall back */
      }
    }
    await this.fallback.set(key, value);
  }

  async delete(key: string): Promise<void> {
    await this.checked;
    await Promise.allSettled([this.primary?.delete(key), this.fallback.delete(key)]);
  }
}

/** Default browser storage (IndexedDB → localStorage → memory). */
export function createDefaultStore(): KVStore {
  const g = globalThis as { indexedDB?: IDBFactory; localStorage?: Storage };
  let ls: KVStore = new MemoryStore();
  try {
    if (g.localStorage) {
      const probe = '__crafting_probe__';
      g.localStorage.setItem(probe, '1');
      g.localStorage.removeItem(probe);
      ls = new LocalStorageStore(g.localStorage);
    }
  } catch {
    /* storage disabled */
  }
  let idb: IndexedDBStore | null = null;
  try {
    if (g.indexedDB) idb = new IndexedDBStore(g.indexedDB);
  } catch {
    idb = null;
  }
  return new FallbackStore(idb, ls);
}
