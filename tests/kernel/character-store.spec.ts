import { describe, expect, it } from 'vitest'
import { createCharacterStore } from '@/kernel/characters/character-store'
import { pngDataUrl } from '@/kernel/characters/character-card'
import type { ParsedCharacterCard } from '@/kernel/characters/character-card'
import { createStorageRepository } from '@/kernel/store/storage-repository'
import { createMemoryEngine } from '@/kernel/store/kv-store'

const PNG_BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])

const cardOf = (name: string): ParsedCharacterCard => ({
  name,
  description: `${name} 的描述`,
  personality: '',
  scenario: '',
  firstMes: '你好',
  mesExample: '',
  systemPrompt: '',
  postHistoryInstructions: '',
  alternateGreetings: [],
  tags: ['test'],
  creator: '',
  characterVersion: '',
  creatorNotes: '',
  spec: 'chara_card_v2',
})

describe('kernel/characters · character store (M3-f)', () => {
  it('import assigns identity, persists under character:<id> and indexes newest first', async () => {
    const store = createCharacterStore(createStorageRepository(createMemoryEngine()))

    const first = await store.import(cardOf('甲'))
    expect(first.id).toMatch(/^cc-/)
    expect(first.importedAt).toBeGreaterThan(0)

    const second = await store.import(cardOf('乙'))
    const summaries = await store.list()
    expect(summaries.map((summary) => summary.id)).toEqual([second.id, first.id])
    expect(summaries[1]).toMatchObject({ name: '甲', spec: 'chara_card_v2' })
  })

  it('get returns the stored card; remove cleans card and index', async () => {
    const repository = createStorageRepository(createMemoryEngine())
    const store = createCharacterStore(repository)

    const stored = await store.import(cardOf('猫娘'))
    expect(await store.get(stored.id)).toMatchObject({ name: '猫娘', firstMes: '你好' })
    expect(await store.get('missing')).toBeNull()

    await store.remove(stored.id)
    expect(await store.get(stored.id)).toBeNull()
    expect(await store.list()).toEqual([])
    expect(await repository.get('character:index')).toEqual([])
  })

  it('a PNG cover rides the import into character:cover:<id>; JSON imports read null (M3-m)', async () => {
    const repository = createStorageRepository(createMemoryEngine())
    const store = createCharacterStore(repository)

    const withCover = await store.import(cardOf('有图'), PNG_BYTES)
    expect(await store.getCover(withCover.id)).toBe(pngDataUrl(PNG_BYTES))

    const withoutCover = await store.import(cardOf('无图'))
    expect(await store.getCover(withoutCover.id)).toBeNull()
    expect(await store.getCover('missing')).toBeNull()
  })

  it('remove cascades the cover so no orphan artwork survives (M3-m)', async () => {
    const repository = createStorageRepository(createMemoryEngine())
    const store = createCharacterStore(repository)

    const stored = await store.import(cardOf('猫娘'), PNG_BYTES)
    await store.remove(stored.id)
    expect(await repository.get(`character:cover:${stored.id}`)).toBeUndefined()
  })

  it('a non-string cover value degrades to null instead of a broken img src (M3-m)', async () => {
    const repository = createStorageRepository(createMemoryEngine())
    const store = createCharacterStore(repository)

    const stored = await store.import(cardOf('坏图'))
    await repository.set(`character:cover:${stored.id}`, 42)
    expect(await store.getCover(stored.id)).toBeNull()
  })
})
