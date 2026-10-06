import { describe, expect, it } from 'vitest'
import { createPresetStore } from '@/kernel/presets/preset-store'
import { createStorageRepository } from '@/kernel/store/storage-repository'
import { createMemoryEngine } from '@/kernel/store/kv-store'
import { syncCotPresetEntries } from '@/kernel/cot/cot-preset-sync'

const makeStore = () => createPresetStore(createStorageRepository(createMemoryEngine()))

describe('kernel/cot · COT preset sync (M4-f)', () => {
  it('creates the managed COT entry in the default group, enabled', async () => {
    const store = makeStore()
    await syncCotPresetEntries(store, { model: 'qwen3.5', memoryEnabled: false, variablesAnalysisEnabled: false })
    const snapshot = await store.get()
    const cot = snapshot.entries.find((entry) => entry.name === 'COT')
    expect(cot).toMatchObject({ group: 'default', role: 'system', enabled: true })
    expect(cot!.content).toContain('<thinking_protocol>')
  })

  it('is idempotent and rewrites only on content change', async () => {
    const store = makeStore()
    await syncCotPresetEntries(store, { model: 'qwen3.5', memoryEnabled: false, variablesAnalysisEnabled: false })
    const first = await store.get()
    await syncCotPresetEntries(store, { model: 'qwen3.5', memoryEnabled: false, variablesAnalysisEnabled: false })
    const second = await store.get()
    expect(second.entries.map((entry) => entry.content)).toEqual(first.entries.map((entry) => entry.content))
    await syncCotPresetEntries(store, { model: 'qwen3.5', memoryEnabled: true, variablesAnalysisEnabled: false })
    const third = await store.get()
    expect(third.entries.find((entry) => entry.name === 'COT')!.content).toContain('[记忆整理]')
  })

  it('rewrites the 破限预注入 AI prefills with pre-opened thinking blocks', async () => {
    const store = makeStore()
    await syncCotPresetEntries(store, { model: 'qwen3.5', memoryEnabled: false, variablesAnalysisEnabled: false })
    const snapshot = await store.get()
    const prefill1 = snapshot.entries.find((entry) => entry.name === '破限预注入 · AI 1')
    expect(prefill1!.content.startsWith('<cot>')).toBe(true)
    // The user toggle on the COT entry survives the sync (only content syncs).
    const cotEntry = snapshot.entries.find((entry) => entry.name === 'COT')!
    await store.setEntryEnabled(cotEntry.id, false)
  })

  it('a disabled COT entry reverts the prefills to their seed content', async () => {
    const store = makeStore()
    await syncCotPresetEntries(store, { model: 'qwen3.5', memoryEnabled: false, variablesAnalysisEnabled: false })
    const snapshot = await store.get()
    const cotEntry = snapshot.entries.find((entry) => entry.name === 'COT')!
    await store.setEntryEnabled(cotEntry.id, false)
    await syncCotPresetEntries(store, { model: 'qwen3.5', memoryEnabled: false, variablesAnalysisEnabled: false })
    const after = await store.get()
    const prefill1 = after.entries.find((entry) => entry.name === '破限预注入 · AI 1')!
    expect(prefill1.content.startsWith('<cot>')).toBe(false)
    expect(prefill1.content).toContain('我会克服这些困难')
  })

  it('user-deleted prefill entries stay deleted; the COT entry is re-created', async () => {
    const store = makeStore()
    await syncCotPresetEntries(store, { model: 'qwen3.5', memoryEnabled: false, variablesAnalysisEnabled: false })
    let snapshot = await store.get()
    const prefill1 = snapshot.entries.find((entry) => entry.name === '破限预注入 · AI 1')!
    await store.removeEntry(prefill1.id)
    snapshot = await store.get()
    const cotEntry = snapshot.entries.find((entry) => entry.name === 'COT')!
    await store.removeEntry(cotEntry.id)
    await syncCotPresetEntries(store, { model: 'qwen3.5', memoryEnabled: false, variablesAnalysisEnabled: false })
    const after = await store.get()
    expect(after.entries.find((entry) => entry.name === '破限预注入 · AI 1')).toBeUndefined()
    expect(after.entries.find((entry) => entry.name === 'COT')).toBeDefined()
  })

  it('the model name picks the tag through the sync', async () => {
    const store = makeStore()
    await syncCotPresetEntries(store, { model: 'deepseek-r1', memoryEnabled: false, variablesAnalysisEnabled: false })
    const snapshot = await store.get()
    expect(snapshot.entries.find((entry) => entry.name === 'COT')!.content).toContain('在<thinking>标签中使用中文')
  })
})
