import { describe, expect, it } from 'vitest'
import { createImportService, type ArchiveInspection } from '@/kernel/import/import-service'
import type { ImportBridge } from '@/kernel/import/import-bridge'
import { createCharacterStore } from '@/kernel/characters/character-store'
import { createPresetStore } from '@/kernel/presets/preset-store'
import { createStorageRepository } from '@/kernel/store/storage-repository'
import { createMemoryEngine } from '@/kernel/store/kv-store'

const RP_KV = [
  { key: 'characters', json: JSON.stringify([{ uuid: 'rp-1', name: '星澜卡', description: 'd', personality: 'p', first_mes: '你好。', avatar: 'file:///data/0/files/media/star.jpg' }]) },
  { key: 'global_regex', json: JSON.stringify([{ scriptName: '全局', findRegex: '/a/g', replaceString: 'b' }]) },
  { key: 'presets', json: JSON.stringify([{ name: '时间戳', content: '【第1日】', enabled: true, role: 'system', group: 'default' }]) },
  { key: 'memory_summaries_rp-1', json: JSON.stringify({ long: '长摘要', short: '短摘要', updatedAt: 5 }) },
  { key: 'memory_profile_rp-1', json: JSON.stringify({ characters: [{ name: '星澜' }], relations: [], openPlots: [] }) },
]

const RP_CHAT = [
  { characterId: 'rp-1', messageId: 'm1', position: 0, status: 'final', messageJson: JSON.stringify({ role: 'assistant', content: '你好。', id: 'a1' }) },
  { characterId: 'rp-1', messageId: 'm2', position: 1, status: 'final', messageJson: JSON.stringify({ role: 'user', content: '嗨', id: 'u1' }) },
]

/** In-memory bridge: one RP archive (zip with media + sqlite semantics
 *  faked), driven without any Capacitor. */
const makeFakeBridge = (): ImportBridge => ({
  async zipOpen() {
    return {
      sessionId: 'sess-1',
      entries: [
        { name: 'manifest.json', size: 10 },
        { name: 'database/RoleplayDatabase', size: 10 },
        { name: 'media/star.jpg', size: 4 },
      ],
    }
  },
  async zipOpenBytes() {
    return { sessionId: 'sess-bytes', entries: [] }
  },
  async zipRead(_sessionId, entryName) {
    if (entryName === 'media/star.jpg') return new TextEncoder().encode('FAKE-JPEG-BYTES')
    return new Uint8Array()
  },
  async sqliteOpen() {
    return 'sqlite-1'
  },
  async kvAll() {
    return RP_KV
  },
  async chatMessages() {
    return RP_CHAT
  },
  async close() {},
})

const makeService = () => {
  const repository = createStorageRepository(createMemoryEngine())
  const characters = createCharacterStore(repository)
  const presets = createPresetStore(repository)
  const service = createImportService({ bridge: makeFakeBridge(), repository, characters, presets })
  return { service, repository, characters, presets }
}

describe('kernel/import · import service (M4-g2)', () => {
  it('builds the RP plan through the bridge, avatars resolved from media entries', async () => {
    const { service } = makeService()
    const inspection: ArchiveInspection = {
      source: 'rp',
      sessionId: 'sess-1',
      entries: [],
      databaseEntryName: 'database/RoleplayDatabase',
      rpInfo: { createdAt: 1, databaseVersion: 2 },
    }
    expect(inspection.source).toBe('rp')
    const { plan, avatarBytes } = await service.buildRpPlan('sess-1', 'database/RoleplayDatabase', ['rp-1'], { includeGlobals: true, includePresets: true })
    expect(plan.cards).toHaveLength(1)
    expect(plan.cards[0]!.card.name).toBe('星澜卡')
    expect(avatarBytes.get('rp-1')!.length).toBeGreaterThan(0)
    expect(plan.presets.map((preset) => preset.name)).toEqual(['时间戳'])
  })

  it('landRp persists cards, covers, floors, envelopes, memory, and presets', async () => {
    const { service, repository, presets } = makeService()
    const { plan, avatarBytes } = await service.buildRpPlan('sess-1', 'database/RoleplayDatabase', ['rp-1'], { includeGlobals: true, includePresets: true })
    const result = await service.landRp(plan, avatarBytes)
    expect(result.importedCardIds).toHaveLength(1)
    expect(result.presetCount).toBe(1)
    const cardId = result.importedCardIds[0]!

    // Card stored with the mounted global regex.
    const card = (await characters_get(repository, cardId))!
    expect(card.name).toBe('星澜卡')
    expect((card.extensions as Record<string, unknown>).rp_imported_global_regex).toHaveLength(1)
    // Cover key carries a data URL with the jpeg mime sniffed from the entry.
    const cover = await repository.get<string>(`character:cover:${cardId}`)
    expect(cover).toContain('data:image/jpeg;base64,')
    // Floors + envelope landed in the card-session shapes.
    const floors = await repository.loadChat<Record<string, unknown>>({ kind: 'card', id: cardId })
    expect(floors.map((floor) => floor.content)).toEqual(['你好。', '嗨'])
    const meta = await repository.get<Record<string, unknown>>(`chatmeta:card:${cardId}`)
    expect(meta).toMatchObject({ cardId, title: '星澜卡', preview: '嗨' })
    // Memory landed with the anchor pinned.
    const memory = await repository.get<Record<string, unknown>>(`memory:card:${cardId}`)
    expect(memory).toMatchObject({ long: '长摘要', short: '短摘要', anchor: 2 })
    // Preset merged into the store (as a disabled entry).
    const snapshot = await presets.get()
    expect(snapshot.entries.some((entry) => entry.name === '时间戳')).toBe(true)
  })

  it('landSt imports loose assets: presets to the store, worldbook/regex onto the target card', async () => {
    const { service, repository, presets, characters } = makeService()
    // Seed one target card (same store instance the service lands into).
    const stored = await characters.import({
      name: '目标卡', description: '', personality: '', scenario: '', firstMes: '', mesExample: '',
      systemPrompt: '', postHistoryInstructions: '', alternateGreetings: [], tags: [], creator: '',
      characterVersion: '', creatorNotes: '', spec: 'v1',
    })
    const plan = {
      assets: [
        { kind: 'worldbook' as const, name: '书', entryName: 'worlds/book.json', payload: { entries: [{ uid: 0, key: ['a'], content: '甲' }] } },
        { kind: 'regex' as const, name: '则', entryName: 'regex/r.json', payload: [{ scriptName: '美化', findRegex: '/x/g', replaceString: 'y' }] },
        { kind: 'preset' as const, name: '设', entryName: 'presets/p.json', payload: [{ name: '破限', content: '内容', role: 'system' as const, enabled: true }] },
      ],
      warnings: [],
    }
    const result = await service.landSt(plan, stored.id)
    expect(result.importedCardIds).toHaveLength(0)
    expect(result.presetCount).toBe(1)
    const card = (await characters_get(repository, stored.id))!
    const book = card.book as { entries: unknown[] }
    expect(book.entries).toHaveLength(1)
    expect((card.extensions as { regex_scripts: unknown[] }).regex_scripts).toHaveLength(1)
    const snapshot = await presets.get()
    expect(snapshot.entries.some((entry) => entry.name === '破限')).toBe(true)

    // Without a target card, worldbook/regex collect warnings instead.
    const result2 = await service.landSt({ assets: plan.assets.filter((asset) => asset.kind !== 'preset'), warnings: [] }, null)
    expect(result2.warnings).toHaveLength(2)
  })
})

async function characters_get(repository: ReturnType<typeof createStorageRepository>, id: string) {
  return repository.get<Parameters<ReturnType<typeof createCharacterStore>['updateExtensions']>[1] & { name?: string; book?: unknown; extensions?: Record<string, unknown> }>(`character:${id}`) as Promise<{ name?: string; book?: unknown; extensions?: Record<string, unknown> } | null>
}
