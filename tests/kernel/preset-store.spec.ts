import { describe, expect, it } from 'vitest'
import { createPresetStore } from '@/kernel/presets/preset-store'

/** In-memory repository mirroring the storage-repository get/set surface. */
function makeRepo() {
  const data = new Map<string, unknown>()
  return {
    async get<T>(key: string): Promise<T | undefined> {
      return data.get(key) as T | undefined
    },
    async set(key: string, value: unknown): Promise<void> {
      data.set(key, value)
    },
  }
}

describe('preset store (M3-w, groups + role-selector model)', () => {
  it('seeds the full default group on first ensure: 17 entries, sensitive class disabled', async () => {
    const store = createPresetStore(makeRepo())
    const snapshot = await store.ensure()
    expect(snapshot.groups).toEqual([{ id: 'default', name: '默认预设', builtin: true, enabled: true }])
    expect(snapshot.entries).toHaveLength(17)
    const byName = new Map(snapshot.entries.map((entry) => [entry.name, entry]))
    expect(byName.get('破限')!.enabled).toBe(false)
    expect(byName.get('色情内容增强')!.enabled).toBe(false)
    expect(byName.get('防重复')!.enabled).toBe(true)
    expect(byName.get('破限预注入 · AI 1')).toMatchObject({ role: 'assistant', group: 'default' })
    expect(byName.get('第三人称')).toMatchObject({ role: 'system' })
  })

  it('group mutex: picking one group switches the whole set off for others', async () => {
    const store = createPresetStore(makeRepo())
    await store.ensure()
    await store.addEntry({ name: '自定义', content: 'x', role: 'system' })
    // New entries land in the ACTIVE group (default here). Create a second
    // group via import of a minimal bundle, then switch.
    const bundle = JSON.stringify({
      type: 'rp-hub-preset-groups',
      groups: [{ id: 'g2', name: '文风组', builtin: false, enabled: false }],
      presets: [{ name: '简洁文风', role: 'system', content: '回答保持简短。', enabled: true, group: 'g2' }],
    })
    await store.importGroups(bundle)
    const switched = await store.setActiveGroup('g2')
    expect(switched.groups.find((group) => group.id === 'g2')!.enabled).toBe(true)
    expect(switched.groups.find((group) => group.id === 'default')!.enabled).toBe(false)
  })

  it('version bump keeps user toggles but rewrites content and re-adds retired names', async () => {
    const repo = makeRepo()
    const store = createPresetStore(repo)
    await store.ensure()
    // Simulate an old generation: enable 破限, delete 防重复, then claim the
    // stored version is outdated by resetting the version key only.
    const snapshot = await store.setEntryEnabled(
      (await store.get()).entries.find((entry) => entry.name === '破限')!.id,
      true,
    )
    await store.removeEntry(snapshot.entries.find((entry) => entry.name === '防重复')!.id)
    await repo.set('preset_definitions_version', 0)

    const resynced = await store.ensure()
    const byName = new Map(resynced.entries.map((entry) => [entry.name, entry]))
    // User toggle survives the content rewrite.
    expect(byName.get('破限')!.enabled).toBe(true)
    // Retired name re-seeds with its default toggle.
    expect(byName.get('防重复')!.enabled).toBe(true)
  })

  it('import dedupes by role+content fingerprint and remaps unknown groups to default', async () => {
    const store = createPresetStore(makeRepo())
    await store.ensure()
    const existing = (await store.get()).entries.find((entry) => entry.name === '防重复')!
    const before = (await store.get()).entries.length
    const bundle = JSON.stringify({
      type: 'rp-hub-preset-groups',
      groups: [],
      presets: [
        // Exact duplicate (same role+content) — skipped.
        { name: '防重复副本', role: 'system', content: existing.content, group: 'nowhere' },
        // New content lands in default (unknown group remapped).
        { name: '新条目', role: 'system', content: '全新内容', group: 'nowhere' },
      ],
    })
    const after = await store.importGroups(bundle)
    expect(after.entries).toHaveLength(before + 1)
    expect(after.entries.at(-1)).toMatchObject({ name: '新条目', group: 'default' })
  })

  it('moveEntry swaps neighbors; addEntry lands in the active group', async () => {
    const store = createPresetStore(makeRepo())
    await store.ensure()
    const before = await store.get()
    const first = before.entries[0]!
    const second = before.entries[1]!
    const after = await store.moveEntry(first.id, 1)
    expect(after.entries[0]!.id).toBe(second.id)
    expect(after.entries[1]!.id).toBe(first.id)
    const withNew = await store.addEntry({ name: '追加', content: 'z', role: 'user' })
    expect(withNew.entries.at(-1)).toMatchObject({ name: '追加', role: 'user', group: 'default', enabled: true })
  })
})
