/**
 * Character card store (M3-f, native) — card-domain library persistence over
 * the kind-scoped storage repository, mirroring the chatbox store's key
 * families: `character:<id>` holds the full card, `character:index` rides the
 * id list (newest first). Cards are small whole records; per-row chat
 * machinery does not apply. Sessions themselves stay `chat:card:<id>` (future
 * card gameplay) — a library card is never a session record.
 *
 * Covers (M3-m): the imported PNG card file is its own artwork, kept as a
 * data URL under `character:cover:<id>` — a separate key so `list()` never
 * drags multi-MB images through the summary projection; covers are fetched
 * per id on demand. A card without a cover key (JSON imports, pre-M3-m
 * records) reads back as null and the UI falls back to a placeholder.
 */

import { pngDataUrl } from '@/kernel/characters/character-card'
import type { CharacterCard, ParsedCharacterCard } from '@/kernel/characters/character-card'
import type { StorageRepository } from '@/kernel/store/storage-repository'

export const CHARACTER_INDEX_KEY = 'character:index'

export interface CharacterCardSummary {
  id: string
  name: string
  description: string
  spec: string
  importedAt: number
}

export interface CharacterStore {
  list(): Promise<CharacterCardSummary[]>
  get(id: string): Promise<CharacterCard | null>
  /** Persists a parsed card, assigning id + import timestamp. A PNG card's
   *  own bytes ride along as its cover data URL. */
  import(card: ParsedCharacterCard, cover?: Uint8Array): Promise<CharacterCard>
  remove(id: string): Promise<void>
  /** Cover data URL, or null when the card has no stored artwork. */
  getCover(id: string): Promise<string | null>
}

const cardKeyOf = (id: string): string => `character:${id}`
const coverKeyOf = (id: string): string => `character:cover:${id}`

export function createCharacterStore(repository: StorageRepository): CharacterStore {
  return {
    async list(): Promise<CharacterCardSummary[]> {
      const ids = (await repository.get<string[]>(CHARACTER_INDEX_KEY)) ?? []
      const summaries: CharacterCardSummary[] = []
      for (const id of ids) {
        const card = await repository.get<CharacterCard>(cardKeyOf(id))
        if (card) {
          summaries.push({ id: card.id, name: card.name, description: card.description, spec: card.spec, importedAt: card.importedAt })
        }
      }
      return summaries.sort((a, b) => b.importedAt - a.importedAt)
    },

    async get(id) {
      return (await repository.get<CharacterCard>(cardKeyOf(id))) ?? null
    },

    async import(card, cover) {
      const now = Date.now()
      const stored: CharacterCard = {
        ...card,
        id: `cc-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        importedAt: now,
      }
      await repository.set(cardKeyOf(stored.id), stored)
      if (cover) await repository.set(coverKeyOf(stored.id), pngDataUrl(cover))
      const ids = (await repository.get<string[]>(CHARACTER_INDEX_KEY)) ?? []
      ids.unshift(stored.id)
      await repository.set(CHARACTER_INDEX_KEY, ids)
      return stored
    },

    async remove(id) {
      await repository.remove(cardKeyOf(id))
      // Cascade: a dead card never leaves an orphan cover behind.
      await repository.remove(coverKeyOf(id))
      const ids = (await repository.get<string[]>(CHARACTER_INDEX_KEY)) ?? []
      await repository.set(CHARACTER_INDEX_KEY, ids.filter((entry) => entry !== id))
    },

    async getCover(id) {
      const value = await repository.get<string>(coverKeyOf(id))
      return typeof value === 'string' ? value : null
    },
  }
}
