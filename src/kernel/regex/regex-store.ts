/**
 * Regex per-script toggle overrides (M3-v, D8) — device-local session
 * conveniences over the card's verbatim regex data: flipping a switch never
 * rewrites the card record, the override rides its own KV key
 * `regex:card:<cardId>:disabled`.
 */

import type { StorageRepository } from '@/kernel/store/storage-repository'

const keyOf = (cardId: string): string => `regex:card:${cardId}:disabled`

export interface RegexStore {
  getDisabled(cardId: string): Promise<ReadonlySet<number>>
  setDisabled(cardId: string, uids: ReadonlySet<number>): Promise<void>
}

export function createRegexStore(repository: StorageRepository): RegexStore {
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
