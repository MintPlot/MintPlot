/**
 * Bare IndexedDB engine (ADR-003 R-01) — the storage engine behind the KvEngine
 * seam: a hand-rolled thin wrapper over raw IndexedDB, no Dexie / idb library.
 * The access profile is KV-shaped (get/put by key, key enumeration, one JSON
 * column) and stays that way until vector search forces a real ADR revision.
 *
 * Layout: database `mintplot` v1, one object store `kv` keyed by the final
 * key name (mp_-prefixed data keys, `chat:<kind>:<id>` session records,
 * `plug:<id>:*` plugin namespaces). Future stores (sessions/messages/media)
 * arrive as DB version increments — never by overloading this store.
 *
 * `createDefaultEngine` composes the M2 degradation ladder: IndexedDB when
 * available, localStorage for the session when it is not (ported stance: the
 * degraded backend must be explicit, secrets never ride it).
 */

import type { KvEngine } from '@/kernel/store/kv-store'
import { createLocalStorageEngine } from '@/kernel/store/kv-store'

export const MP_IDB_NAME = 'mintplot'
export const MP_IDB_VERSION = 1
export const MP_IDB_STORE = 'kv'

function isIdbAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null
  } catch {
    return false
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(MP_IDB_NAME, MP_IDB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(MP_IDB_STORE)) {
        db.createObjectStore(MP_IDB_STORE)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('[idb-engine] open failed'))
    request.onblocked = () => reject(new Error('[idb-engine] open blocked by another connection'))
  })
}

export function createIdbEngine(): KvEngine {
  let dbPromise: Promise<IDBDatabase> | null = null
  const database = (): Promise<IDBDatabase> => {
    dbPromise ??= openDatabase()
    return dbPromise
  }

  async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest | void): Promise<T> {
    const db = await database()
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(MP_IDB_STORE, mode)
      const request = run(tx.objectStore(MP_IDB_STORE))
      tx.oncomplete = () => resolve((request ? request.result : undefined) as T)
      tx.onerror = () => reject(tx.error ?? new Error('[idb-engine] transaction failed'))
      tx.onabort = () => reject(tx.error ?? new Error('[idb-engine] transaction aborted'))
    })
  }

  return {
    async get(key) {
      const value = await withStore<string | null>('readonly', (store) => store.get(key))
      // IndexedDB signals a missing key with undefined; the seam promises null.
      return value ?? null
    },
    async set(key, json) {
      await withStore('readwrite', (store) => {
        store.put(json, key)
      })
    },
    async remove(key) {
      await withStore('readwrite', (store) => {
        store.delete(key)
      })
    },
    async keys() {
      const all = await withStore<IDBValidKey[]>('readonly', (store) => store.getAllKeys())
      return all.map(String)
    },
  }
}

/**
 * M2 default engine: IndexedDB, degrading to localStorage for the rest of the
 * session on first failure (data written before the degrade is not migrated —
 * real data migration is M3 work, once there is data to migrate).
 */
export function createDefaultEngine(): KvEngine {
  const fallback = createLocalStorageEngine()
  if (!isIdbAvailable()) return fallback
  let degraded = false
  const idb = createIdbEngine()
  const run = async <T>(operation: (engine: KvEngine) => Promise<T>): Promise<T> => {
    if (!degraded) {
      try {
        return await operation(idb)
      } catch (error) {
        degraded = true
        console.error('[idb-engine] IndexedDB unavailable; degrading to localStorage for this session:', error)
      }
    }
    return operation(fallback)
  }
  return {
    get: (key) => run((engine) => engine.get(key)),
    set: (key, json) => run((engine) => engine.set(key, json)),
    remove: (key) => run((engine) => engine.remove(key)),
    keys: () => run((engine) => engine.keys()),
  }
}
