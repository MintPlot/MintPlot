/**
 * Kernel settings state (ADR-004, native new-write) — the host settings store
 * behind ctx.settings.scope. One reactive object persisted at the storage
 * repository's `mp_settings` key; secret-shaped fields (apiKey/…) are
 * extracted to the secret channel by the repository layer on write and
 * restored on read — plugins only ever see values through their declared
 * whitelist, and the vault discipline stays kernel-side.
 *
 * scope() hands out a live record: reads track the store, writes mark the
 * state dirty and schedule a debounced persist. flush() persists immediately
 * and joins the same serialization chain, so the last write always wins.
 */

import { reactive } from 'vue'
import type { PluginSettingsScope } from '@contracts'
import type { StorageRepository } from '@/kernel/store/storage-repository'

export const SETTINGS_STORAGE_KEY = 'mp_settings'

export interface SettingsState extends PluginSettingsScope {
  /** Whole-store read for diagnostics; callers must not mutate the result. */
  snapshot(): Record<string, unknown>
  /** Persist now (joining the serialization chain) — tests and shutdown paths. */
  flush(): Promise<void>
}

export function createSettingsState(repository: StorageRepository): SettingsState {
  const store = reactive<Record<string, unknown>>({})

  const hydrated = repository
    .get<Record<string, unknown>>(SETTINGS_STORAGE_KEY)
    .then((saved) => {
      if (saved && typeof saved === 'object') {
        Object.assign(store, saved)
      }
    })
    .catch((error) => {
      console.error('[settings-state] hydrate failed; starting empty:', error)
    })

  const persistNow = async (): Promise<void> => {
    // Clone through JSON so the reactive proxy never reaches serialization.
    await repository.set(SETTINGS_STORAGE_KEY, JSON.parse(JSON.stringify(store)))
  }

  let persistTimer: ReturnType<typeof setTimeout> | undefined
  let dirty = false
  let pendingPersist: Promise<void> = Promise.resolve()

  const joinPersist = (): Promise<void> => {
    // A failed persist must not break the chain — the next write still runs.
    pendingPersist = pendingPersist.then(persistNow, persistNow)
    return pendingPersist
  }

  const schedulePersist = (): void => {
    dirty = true
    if (persistTimer !== undefined) return
    persistTimer = setTimeout(() => {
      persistTimer = undefined
      if (!dirty) return
      dirty = false
      joinPersist().catch((error) => console.error('[settings-state] persist failed:', error))
    }, 300)
  }

  return {
    scope(keys) {
      const projection: Record<string, unknown> = {}
      for (const key of keys) {
        Object.defineProperty(projection, key, {
          enumerable: true,
          get: () => store[key],
          set: (value: unknown) => {
            store[key] = value
            schedulePersist()
          },
        })
      }
      return projection
    },

    snapshot() {
      return JSON.parse(JSON.stringify(store)) as Record<string, unknown>
    },

    async flush() {
      await hydrated
      if (persistTimer !== undefined) {
        clearTimeout(persistTimer)
        persistTimer = undefined
      }
      dirty = false
      await joinPersist()
    },
  }
}
