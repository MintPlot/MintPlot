import { describe, expect, it } from 'vitest'
import { createCharacterStore } from '@/kernel/characters/character-store'
import type { ParsedCharacterCard } from '@/kernel/characters/character-card'
import { createStorageRepository } from '@/kernel/store/storage-repository'
import { createMemoryEngine } from '@/kernel/store/kv-store'

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
})
