/**
 * Memory store (M4-e, native) — per-session memory ledger over the RESERVED
 * storage key `memory:<kind>:<id>` (storage-repository's memoryStorageKey;
 * the fragment-store slot promised since M2). One key holds the whole state
 * {short, long, profile, batches, anchor} — summaries are prose snapshots,
 * not per-floor rows, so there is nothing to increment here. reset() rides
 * the repository's deleteMemoryFragments (清空重开 / 清空重建), keeping the
 * deletion contract that predates this slice.
 */

import type { SessionScope, StorageRepository } from '@/kernel/store/storage-repository'
import { memoryStorageKey } from '@/kernel/store/storage-repository'
import { createEmptyMemoryState, sanitizeMemoryState } from './memory-engine'
import type { MemoryState } from './memory-engine'

export interface MemoryStore {
  get(scope: SessionScope): Promise<MemoryState | null>
  /** Read-or-fresh: first touch returns the empty state without writing. */
  ensure(scope: SessionScope): Promise<MemoryState>
  save(scope: SessionScope, state: MemoryState): Promise<void>
  reset(scope: SessionScope): Promise<void>
}

export function createMemoryStore(repository: StorageRepository): MemoryStore {
  return {
    async get(scope) {
      const raw = await repository.get<unknown>(memoryStorageKey(scope))
      return raw === undefined ? null : sanitizeMemoryState(raw)
    },

    async ensure(scope) {
      return (await this.get(scope)) ?? createEmptyMemoryState()
    },

    async save(scope, state) {
      // Clone through JSON: pipeline state may carry caller-side references.
      await repository.set(memoryStorageKey(scope), JSON.parse(JSON.stringify(state)))
    },

    async reset(scope) {
      await repository.deleteMemoryFragments(scope)
    },
  }
}
