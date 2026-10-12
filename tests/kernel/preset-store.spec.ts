import { describe, expect, it } from 'vitest'
import { createPresetStore, type PresetEntry } from '@/kernel/presets/preset-store'

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
  it('seeds the full default group on first ensure: 36 entries, dimensions tagged, jailbreak class enabled since v3/v4', async () => {
    const store = createPresetStore(makeRepo())
    const snapshot = await store.ensure()
    expect(snapshot.groups).toEqual([{ id: 'default', name: '默认预设', builtin: true, enabled: true }])
    expect(snapshot.entries).toHaveLength(36)
    const byName = new Map(snapshot.entries.map((entry) => [entry.name, entry]))
    // v3 (planning D5): 破限 ships enabled; v4: the four 破限预注入 entries
    // ride along; 色情内容增强 stays disabled.
    expect(byName.get('破限')!.enabled).toBe(true)
    expect(byName.get('NSFW增强')!.enabled).toBe(false)
    expect(byName.get('破限预注入 · User 1')!.enabled).toBe(true)
    expect(byName.get('破限预注入 · AI 1')!.enabled).toBe(true)
    expect(byName.get('破限预注入 · User 2')!.enabled).toBe(true)
    expect(byName.get('破限预注入 · AI 2')!.enabled).toBe(true)
    expect(byName.get('破限预注入 · AI 1')).toMatchObject({ role: 'assistant', group: 'default' })
    expect(byName.get('防重复')!.enabled).toBe(true)
    // v2 person mutex: fresh seed = third person only; dimension tags on.
    expect(byName.get('第三人称')!.enabled).toBe(true)
    expect(byName.get('第二人称')!.enabled).toBe(false)
    expect(byName.get('第三人称')).toMatchObject({ role: 'system', dimension: 'person' })
    expect(byName.get('第二人称')).toMatchObject({ dimension: 'person' })
    // New dimension seeds all ship disabled — an empty dimension means "no
    // constraint" (planning D3).
    expect(byName.get('第一人称')).toMatchObject({ dimension: 'person', enabled: false })
    expect(byName.get('以对话为主')).toMatchObject({ dimension: 'writing', enabled: false })
    expect(byName.get('细腻篇幅')).toMatchObject({ dimension: 'length', enabled: false })
    expect(byName.get('轻小说')).toMatchObject({ dimension: 'style', enabled: false })
    expect(byName.get('温馨治愈')).toMatchObject({ dimension: 'mood', enabled: false })
    expect(byName.get('NSFW·直白')).toMatchObject({ dimension: 'nsfw', enabled: false })
    // Ordinary entries carry no dimension tag.
    expect(byName.get('时间戳')!.dimension).toBeUndefined()
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

  it('v1→v2 迁移:双人称都开的存量仓归位为仅第三人称', async () => {
    const repo = makeRepo()
    const store = createPresetStore(repo)
    await store.ensure()
    // Simulate a v1 store: both perspectives on (the shipped-flaw state),
    // then stamp the old version so the migration re-runs.
    const v1 = await store.get()
    const bothOn = v1.entries.map((entry) =>
      entry.name === '第二人称' ? { ...entry, enabled: true } : entry)
    await repo.set('presets', bothOn)
    await repo.set('preset_definitions_version', 1)

    const migrated = await store.ensure()
    const byName = new Map(migrated.entries.map((entry) => [entry.name, entry]))
    expect(byName.get('第二人称')!.enabled).toBe(false)
    expect(byName.get('第三人称')!.enabled).toBe(true)
  })

  it('v2 之后有意开的双人称不再被后续迁移动(用户选择为准)', async () => {
    const repo = makeRepo()
    const store = createPresetStore(repo)
    await store.ensure()
    // Version already 2: enable the second person via the store mutex path —
    // wait, the mutex forbids both-on; force the raw record instead.
    const snapshot = await store.get()
    const bothOn = snapshot.entries.map((entry) =>
      entry.name === '第二人称' ? { ...entry, enabled: true } : entry)
    await repo.set('presets', bothOn)
    await repo.set('preset_definitions_version', 2)

    const untouched = await store.ensure()
    const byName = new Map(untouched.entries.map((entry) => [entry.name, entry]))
    expect(byName.get('第二人称')!.enabled).toBe(true)
    expect(byName.get('第三人称')!.enabled).toBe(true)
  })

  it('仓层互斥:点亮一个人称自动熄灭另一个(面板入口同样生效)', async () => {
    const store = createPresetStore(makeRepo())
    await store.ensure()
    const third = (await store.get()).entries.find((entry) => entry.name === '第三人称')!
    const second = (await store.get()).entries.find((entry) => entry.name === '第二人称')!

    const afterSecond = await store.setEntryEnabled(second.id, true)
    expect(afterSecond.entries.find((entry) => entry.name === '第二人称')!.enabled).toBe(true)
    expect(afterSecond.entries.find((entry) => entry.name === '第三人称')!.enabled).toBe(false)

    // Unrelated entries pass through untouched.
    const afterOff = await store.setEntryEnabled(third.id, false)
    expect(afterOff.entries.find((entry) => entry.name === '第二人称')!.enabled).toBe(true)
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

describe('preset store style dimensions (v3, planning style-dimension-presets-plan S1)', () => {
  it('单选维度互斥泛化:同维同组熄灭,多选维度共存,跨组不牵连', async () => {
    const store = createPresetStore(makeRepo())
    await store.ensure()
    const byName = async () => new Map((await store.get()).entries.map((entry) => [entry.name, entry]))

    // Multi-select mood: two entries coexist.
    await store.setEntryEnabled((await byName()).get('温馨治愈')!.id, true)
    const bothMood = await store.setEntryEnabled((await byName()).get('紧张悬疑')!.id, true)
    expect(bothMood.entries.find((entry) => entry.name === '温馨治愈')!.enabled).toBe(true)
    expect(bothMood.entries.find((entry) => entry.name === '紧张悬疑')!.enabled).toBe(true)

    // Single-select nsfw: lighting one dims the enabled sibling.
    await store.setEntryEnabled((await byName()).get('NSFW·含蓄')!.id, true)
    const afterExplicit = await store.setEntryEnabled((await byName()).get('NSFW·直白')!.id, true)
    expect(afterExplicit.entries.find((entry) => entry.name === 'NSFW·直白')!.enabled).toBe(true)
    expect(afterExplicit.entries.find((entry) => entry.name === 'NSFW·含蓄')!.enabled).toBe(false)

    // Cross-group: the mutex is per scheme — a same-dimension sibling in
    // another group keeps its own state.
    const bundle = JSON.stringify({
      type: 'rp-hub-preset-groups',
      groups: [{ id: 'g2', name: '另一方案', builtin: false, enabled: false }],
      presets: [{ name: '方案B·含蓄', role: 'system', content: '方案B含蓄文案', enabled: false, group: 'g2', dimension: 'nsfw' }],
    })
    await store.importGroups(bundle)
    await store.setActiveGroup('g2')
    const afterG2 = await store.setEntryEnabled((await byName()).get('方案B·含蓄')!.id, true)
    expect(afterG2.entries.find((entry) => entry.name === '方案B·含蓄')!.enabled).toBe(true)
    expect(afterG2.entries.find((entry) => entry.name === 'NSFW·直白')!.enabled).toBe(true)
  })

  it('v2→v3 迁移:旧默认态(停用)的破限自动翻启用,维度标签回填默认组,自定义组条目原样', async () => {
    const repo = makeRepo()
    const store = createPresetStore(repo)
    await store.ensure()
    const bundle = JSON.stringify({
      type: 'rp-hub-preset-groups',
      groups: [{ id: 'g2', name: '自建', builtin: false, enabled: false }],
      presets: [{ name: '自建风格', role: 'system', content: 'x', enabled: true, group: 'g2', dimension: 'style' }],
    })
    await store.importGroups(bundle)
    // Simulate a v2-era record set: default-group entries lack dimension
    // tags and 破限 sits at its old default (off). Custom groups untouched.
    const stripDimension = (entry: PresetEntry): PresetEntry => {
      const next = { ...entry }
      delete next.dimension
      return next
    }
    const v2Records = (await store.get()).entries.map((entry) => {
      if (entry.group !== 'default') return entry
      const stripped = stripDimension(entry)
      return entry.name === '破限' ? { ...stripped, enabled: false } : stripped
    })
    await repo.set('presets', v2Records)
    await repo.set('preset_definitions_version', 2)

    const migrated = await store.ensure()
    const byName = new Map(migrated.entries.map((entry) => [entry.name, entry]))
    expect(byName.get('破限')!.enabled).toBe(true) // untouched → flips (D9)
    // v4 rides the same resync: untouched prefills flip on too.
    expect(byName.get('破限预注入 · User 1')!.enabled).toBe(true)
    expect(byName.get('破限预注入 · AI 2')!.enabled).toBe(true)
    expect(byName.get('第三人称')!.dimension).toBe('person') // tags backfilled
    expect(byName.get('自建风格')).toMatchObject({ dimension: 'style', enabled: true })
    expect(byName.get('时间戳')!.dimension).toBeUndefined()
  })

  it('v3 存量升 v4:未动过的预注入翻转启用,NSFW增强保持停用', async () => {
    const repo = makeRepo()
    const store = createPresetStore(repo)
    await store.ensure()
    // Simulate a v3 store: prefills at their old default (off), everything
    // else as v3 shipped.
    const v3Records = (await store.get()).entries.map((entry) =>
      entry.name.startsWith('破限预注入') ? { ...entry, enabled: false } : entry)
    await repo.set('presets', v3Records)
    await repo.set('preset_definitions_version', 3)

    const migrated = await store.ensure()
    const byName = new Map(migrated.entries.map((entry) => [entry.name, entry]))
    expect(byName.get('破限预注入 · User 1')!.enabled).toBe(true)
    expect(byName.get('破限预注入 · AI 1')!.enabled).toBe(true)
    expect(byName.get('破限预注入 · User 2')!.enabled).toBe(true)
    expect(byName.get('破限预注入 · AI 2')!.enabled).toBe(true)
    expect(byName.get('NSFW增强')!.enabled).toBe(false)
    expect(byName.get('破限')!.enabled).toBe(true) // v3 flip not re-applied
  })

  it('v4 存量升 v5:色情内容增强改名 NSFW增强且用户开关随迁,旧名不残留', async () => {
    const repo = makeRepo()
    const store = createPresetStore(repo)
    await store.ensure()
    // Simulate a v4 store where the user had ENABLED 色情内容增强 (its old
    // name); the v5 rename must carry it — not drop + re-seed disabled.
    const v4Records = (await store.get()).entries.map((entry) =>
      entry.name === 'NSFW增强' ? { ...entry, name: '色情内容增强', enabled: true } : entry)
    await repo.set('presets', v4Records)
    await repo.set('preset_definitions_version', 4)

    const migrated = await store.ensure()
    const byName = new Map(migrated.entries.map((entry) => [entry.name, entry]))
    expect(byName.has('色情内容增强')).toBe(false) // old name gone
    expect(byName.get('NSFW增强')).toMatchObject({ enabled: true }) // toggle carried
  })

  it('addEntry 同样守单选互斥:新增启用的 person 条目熄灭种子,多选维度不牵连', async () => {
    const store = createPresetStore(makeRepo())
    await store.ensure()
    const afterPerson = await store.addEntry({ name: '自建人称', content: 'x', role: 'system', dimension: 'person' })
    const byName = new Map(afterPerson.entries.map((entry) => [entry.name, entry]))
    expect(byName.get('自建人称')!.enabled).toBe(true)
    expect(byName.get('第三人称')!.enabled).toBe(false)

    const afterMood = await store.addEntry({ name: '自建氛围', content: 'y', role: 'system', dimension: 'mood' })
    const mood = new Map(afterMood.entries.map((entry) => [entry.name, entry]))
    expect(mood.get('自建氛围')!.enabled).toBe(true)
    expect(mood.get('自建人称')!.enabled).toBe(true) // different dimension untouched
  })

  it('维度编辑:updateEntry 设置与清除 dimension(null),addEntry 携带维度', async () => {
    const store = createPresetStore(makeRepo())
    await store.ensure()
    const target = (await store.get()).entries.find((entry) => entry.name === '时间戳')!
    const patch = { name: '时间戳', content: target.content, role: 'system' as const }
    const tagged = await store.updateEntry(target.id, { ...patch, dimension: 'writing' })
    expect(tagged.entries.find((entry) => entry.id === target.id)!.dimension).toBe('writing')
    // Absent field leaves the tag alone.
    const kept = await store.updateEntry(target.id, patch)
    expect(kept.entries.find((entry) => entry.id === target.id)!.dimension).toBe('writing')
    const cleared = await store.updateEntry(target.id, { ...patch, dimension: null })
    expect(cleared.entries.find((entry) => entry.id === target.id)!.dimension).toBeUndefined()
    const added = await store.addEntry({ name: '自建氛围', content: 'y', role: 'system', dimension: 'mood' })
    expect(added.entries.at(-1)).toMatchObject({ name: '自建氛围', dimension: 'mood' })
  })

  it('导入透传合法 dimension、丢弃非法值;导出携带维度标签', async () => {
    const store = createPresetStore(makeRepo())
    await store.ensure()
    const exported = JSON.parse(await store.exportGroups()) as { presets: Array<{ name: string; dimension?: string }> }
    expect(exported.presets.find((entry) => entry.name === '第三人称')!.dimension).toBe('person')

    const bundle = JSON.stringify({
      type: 'rp-hub-preset-groups',
      groups: [],
      presets: [
        { name: '导入维度条目', role: 'system', content: '带维度', group: 'default', dimension: 'mood', enabled: false },
        { name: '导入坏维度', role: 'system', content: '坏维度', group: 'default', dimension: 'not-a-dimension', enabled: false },
      ],
    })
    const after = await store.importGroups(bundle)
    expect(after.entries.find((entry) => entry.name === '导入维度条目')!.dimension).toBe('mood')
    expect(after.entries.find((entry) => entry.name === '导入坏维度')!.dimension).toBeUndefined()
  })
})
