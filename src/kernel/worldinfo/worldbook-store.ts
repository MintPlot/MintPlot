/**
 * Worldbook per-entry toggle overrides (M3-u, D7) — device-local session
 * conveniences over the card's verbatim book data: flipping a switch never
 * rewrites the card record (import-time data stays pristine), the override
 * rides its own KV key `worldinfo:card:<cardId>:disabled`.
 */

import type { StorageRepository } from '@/kernel/store/storage-repository'

const keyOf = (cardId: string): string => `worldinfo:card:${cardId}:disabled`

export interface WorldbookStore {
  /** Uids currently switched off for this card's book. */
  getDisabled(cardId: string): Promise<ReadonlySet<number>>
  setDisabled(cardId: string, uids: ReadonlySet<number>): Promise<void>
}

export function createWorldbookStore(repository: StorageRepository): WorldbookStore {
  return {
    async getDisabled(cardId) {
      const raw = await repository.get<number[]>(keyOf(cardId))
      return new Set(Array.isArray(raw) ? raw : [])
    },
    async setDisabled(cardId, uids) {
      await repository.set(keyOf(cardId), [...uids])
    },
  }
}
