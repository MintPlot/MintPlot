// @vitest-environment node
//
// The node environment is required regardless of the skip below: the jsdom
// (client) environment makes vite-resolve refuse the node:sqlite builtin at
// import-analysis time ("Cannot bundle Node.js built-in"), which fails the
// whole suite on machines where this file would merely be skipped. Pure
// data mapping — no DOM needed.
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { buildRpImportPlan, type RpChatRow, type RpKvRow } from '@/kernel/import/rp-import'
import { createImportService } from '@/kernel/import/import-service'
import { DEFAULT_PRESET_DEFINITIONS } from '@/kernel/presets/default-presets'
import { createCharacterStore } from '@/kernel/characters/character-store'
import { createPresetStore } from '@/kernel/presets/preset-store'
import { createStorageRepository } from '@/kernel/store/storage-repository'
import { createMemoryEngine } from '@/kernel/store/kv-store'
import type { ImportBridge } from '@/kernel/import/import-bridge'

/**
 * Real-backup data regression (M4-g2, LOCAL ONLY — the archive never enters
 * git). Reads build/rp-real.db (extracted from a genuine RP-Hub backup,
 * ~100 MB zip / 32 MB database / 1377 chat rows) through node:sqlite and
 * drives the exact production mapping + landing path over it. Skips when
 * the file is absent (CI, other machines).
 */

const DB_PATH = 'build/rp-real.db'
const hasRealBackup = existsSync(DB_PATH)

describe.skipIf(!hasRealBackup)('kernel/import · REAL RP backup regression (local file)', () => {
  const db = new DatabaseSync(DB_PATH)
  const kvRows: RpKvRow[] = db.prepare('SELECT key, json FROM kv_store ORDER BY key').all().map((row) => ({ key: row.key as string, json: row.json as string | null }))
  const chatRows: RpChatRow[] = db.prepare('SELECT character_id, message_id, position, status, message_json FROM chat_messages ORDER BY character_id, position').all().map((row) => ({
    characterId: row.character_id as string,
    messageId: row.message_id as string,
    position: row.position as number,
    status: row.status as string | null,
    messageJson: row.message_json as string | null,
  }))

  it('kv carries the prefixed key family and giant card values', () => {
    // The prefix itself is red-lined from source; assert the family by suffix.
    const charactersRow = kvRows.find((row) => row.key.endsWith('_characters'))
    expect(charactersRow).toBeDefined()
    const characters = JSON.parse(charactersRow!.json!)
    expect(characters.length).toBe(2)
    // The 130k-char greeting survives storage (the CursorWindow killer).
    const longest = Math.max(...characters.map((character: Record<string, unknown>) => String(character.first_mes ?? '').length))
    expect(longest).toBeGreaterThan(10000)
    expect(chatRows.length).toBe(1377)
  })

  it('builds the full plan over real data', () => {
    const plan = buildRpImportPlan(kvRows, chatRows, [], { includeGlobals: true, includePresets: true, listAll: true })
    expect(plan.cards).toHaveLength(2)
    for (const card of plan.cards) {
      expect(card.card.name.length).toBeGreaterThan(0)
      expect(card.floors.length).toBeGreaterThan(0)
      // First greeting floor preserved byte-for-byte.
      expect(card.floors[0]!.content.length).toBeGreaterThan(0)
    }
    expect(plan.presets.length).toBeGreaterThan(0)
    expect(plan.globalRegex.length).toBeGreaterThan(0)
    // classic_memories-era keys don't map to rolling summaries — no crash, no memory.
    for (const card of plan.cards) {
      expect(card.memory).toBeNull()
    }
  })

  it('lands the real plan into storage end-to-end', async () => {
    const repository = createStorageRepository(createMemoryEngine())
    const characters = createCharacterStore(repository)
    const presets = createPresetStore(repository)
    const dummyBridge = {} as ImportBridge
    const service = createImportService({ bridge: dummyBridge, repository, characters, presets })
    const plan = buildRpImportPlan(kvRows, chatRows, [], { includeGlobals: true, includePresets: true, listAll: true })
    const result = await service.landRp(plan, new Map())
    expect(result.importedCardIds).toHaveLength(2)
    // MP's defaults ARE RP's presets — most collide by name and are skipped.
    const seededNames = new Set(DEFAULT_PRESET_DEFINITIONS.map((definition) => definition.name))
    const expectedLanded = plan.presets.filter((preset) => !seededNames.has(preset.name)).length
    expect(result.presetCount).toBe(expectedLanded)
    expect(result.warnings.some((warning) => warning.includes('同名，已跳过'))).toBe(true)

    // Every floor of every card landed; the giant greeting lives in the CARD
    // (first_mes), not the chat rows (MP re-injects it via 开场白保险).
    for (const [index, cardId] of result.importedCardIds.entries()) {
      const floors = await repository.loadChat<{ content: string }>({ kind: 'card', id: cardId })
      expect(floors.length).toBe(plan.cards[index]!.floors.length)
      const meta = await repository.get<{ cardId: string; preview: string }>(`chatmeta:card:${cardId}`)
      expect(meta?.cardId).toBe(cardId)
      const stored = await repository.get<{ firstMes: string }>(`character:${cardId}`)
      expect(stored?.firstMes).toBe(plan.cards[index]!.card.firstMes)
    }
    const snapshot = await presets.get()
    // Non-colliding presets land DISABLED; colliding names keep the seeded
    // entry (whose enabled state is the seed's default, not the import's).
    for (const preset of plan.presets) {
      if (seededNames.has(preset.name)) continue
      const landed = snapshot.entries.find((entry) => entry.name === preset.name)
      expect(landed, `preset ${preset.name}`).toBeDefined()
      expect(landed!.enabled).toBe(false)
    }
  })
})

// Keep vitest from failing on an empty suite when the file is absent.
if (!hasRealBackup) {
  it('real backup file absent — regression skipped', () => {
    expect(true).toBe(true)
  })
}

// Silence unused-import lint when the suite is skipped.
void readFileSync
