/**
 * Kernel KV store (M2 minimal) — the storage surface behind PluginContext's
 * namespaced storage and kernel-owned settings. The engine seam keeps every
 * consumer engine-agnostic: the storage engine ADR (M2, bare idb spike) slots
 * in behind {@link KvEngine} without touching call sites.
 *
 * Key discipline (porting pipeline §04): everything persisted through the
 * prefixed engine lives under MP's own data namespace `mp_`. Plugin contexts
 * additionally namespace under `plug:<id>:` (ADR-001 §06 storage.own), so a
 * plugin key reads `mp_plug:<id>:<key>` at rest.
 */

/** Storage-agnostic engine seam — ADR-003 (bare idb) implements this. */
export interface KvEngine {
  get(key: string): Promise<string | null>
  set(key: string, json: string): Promise<void>
  remove(key: string): Promise<void>
  keys(): Promise<string[]>
}

/** MP's global data prefix — RP 存量 `rp_hub_*` maps here via the M4 importer. */
export const MP_STORAGE_PREFIX = 'mp_'

/** Wraps an engine so every key is stored under `prefix` (composition). */
export function createPrefixedEngine(engine: KvEngine, prefix: string): KvEngine {
  const prefixed = (key: string): string => prefix + key
  const strip = (key: string): string => key.slice(prefix.length)
  return {
    async get(key) {
      return engine.get(prefixed(key))
    },
    async set(key, json) {
      await engine.set(prefixed(key), json)
    },
    async remove(key) {
      await engine.remove(prefixed(key))
    },
    async keys() {
      const all = await engine.keys()
      return all.filter((key) => key.startsWith(prefix)).map(strip)
    },
  }
}

/**
 * localStorage engine — web/dev fallback (RP storage-repository lesson: the
 * degraded backend must exist and be explicit). Throws on quota errors so
 * callers observe failures instead of silently losing writes.
 */
export function createLocalStorageEngine(): KvEngine {
  const available = (() => {
    try {
      return typeof localStorage !== 'undefined' && localStorage !== null
    } catch {
      return false
    }
  })()
  return {
    async get(key) {
      if (!available) return null
      try {
        return localStorage.getItem(key)
      } catch {
        return null
      }
    },
    async set(key, json) {
      if (!available) throw new Error('[kv-store] localStorage unavailable; write rejected')
      localStorage.setItem(key, json)
    },
    async remove(key) {
      if (!available) return
      try {
        localStorage.removeItem(key)
      } catch {
        // removal failures on a degraded backend are non-recoverable noise
      }
    },
    async keys() {
      if (!available) return []
      const result: string[] = []
      for (let index = 0; index < localStorage.length; index += 1) {
        const key = localStorage.key(index)
        if (key !== null) result.push(key)
      }
      return result
    },
  }
}

/** In-memory engine — tests and the engine-less fallback of last resort. */
export function createMemoryEngine(): KvEngine {
  const map = new Map<string, string>()
  return {
    async get(key) {
      return map.get(key) ?? null
    },
    async set(key, json) {
      map.set(key, json)
    },
    async remove(key) {
      map.delete(key)
    },
    async keys() {
      return [...map.keys()]
    },
  }
}

/** Corrupt-JSON reads surface as null + a keyed log line — never a silent wipe. */
function parseJsonGuarded(json: string | null, key: string): unknown {
  if (json === null) return null
  try {
    return JSON.parse(json) as unknown
  } catch (error) {
    console.error(`[kv-store] corrupt JSON for "${key}" (length=${json.length}), read degrades to null:`, error)
    return null
  }
}

export interface KvStore {
  get<T>(key: string): Promise<T | null>
  set(key: string, value: unknown): Promise<void>
  remove(key: string): Promise<void>
  keys(): Promise<string[]>
}

/** JSON KV over an engine; values are round-tripped as JSON text. */
export function createKvStore(engine: KvEngine): KvStore {
  return {
    async get<T>(key: string): Promise<T | null> {
      const json = await engine.get(key)
      const value = parseJsonGuarded(json, key)
      return (value as T | null) ?? null
    },
    async set(key, value) {
      await engine.set(key, JSON.stringify(value))
    },
    async remove(key) {
      await engine.remove(key)
    },
    async keys() {
      return engine.keys()
    },
  }
}
