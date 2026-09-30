import { describe, expect, it } from 'vitest'
import { createStorageRepository } from '@/kernel/store/storage-repository'
import { createMemoryEngine } from '@/kernel/store/kv-store'
import { replayVariableState } from '@/kernel/variables/variable-engine'
import { createVariableStore } from '@/kernel/variables/variable-store'

const DEFAULTS = [
  { name: '好感度', value: 10, description: '当前好感' },
  { name: '时间', value: '清晨' },
]

describe('variable store · card-session variables ledger (M3-q, variables:card keys)', () => {
  it('ensure seeds card defaults on first touch and never reseeds afterwards', async () => {
    const engine = createMemoryEngine()
    const store = createVariableStore(createStorageRepository(engine))

    const first = await store.ensure('cc-1', DEFAULTS)
    expect(await engine.get('variables:card:cc-1')).not.toBeNull()
    expect(first.state['好感度']).toMatchObject({ value: 10, sourceEventId: 'seed' })
    expect(first.state['时间']).toMatchObject({ value: '清晨', sourceEventId: 'seed' })
    expect(first.events).toEqual([])

    await store.apply('cc-1', [{ name: '好感度', raw: 20 }], { source: 'manual' })
    const again = await store.ensure('cc-1', DEFAULTS)
    expect(again.state['好感度']).toMatchObject({ value: 20 })
  })

  it('apply appends contract-shaped events, resolves deltas, and persists', async () => {
    const store = createVariableStore(createStorageRepository(createMemoryEngine()))
    await store.ensure('cc-1', DEFAULTS)

    const after = await store.apply(
      'cc-1',
      [
        { name: '好感度', raw: '+90' },
        { name: '时间', raw: '黄昏' },
      ],
      { source: 'ai', messageId: 'm-1' },
    )
    expect(after.events).toHaveLength(2)
    const event = after.events[0]!
    expect(event).toMatchObject({
      kind: 'variable.set',
      pluginId: 'variables',
      sessionId: 'cc-1',
      sessionKind: 'card',
      name: '好感度',
      before: 10,
      after: 100,
      source: 'ai',
      messageId: 'm-1',
    })
    expect(after.state['好感度']).toMatchObject({ value: 100 })
    expect(after.state['时间']).toMatchObject({ value: '黄昏' })

    // Reload from the engine: the projection replays to the same table.
    const reloaded = (await store.get('cc-1'))!
    expect(reloaded.state).toEqual(after.state)
    expect(reloaded.events).toEqual(after.events)
    expect(reloaded.state).toEqual(replayVariableState(reloaded.seed, reloaded.events))
  })

  it('skips no-op updates: rewriting the same value or deleting an absent name', async () => {
    const store = createVariableStore(createStorageRepository(createMemoryEngine()))
    await store.ensure('cc-1', DEFAULTS)
    const same = await store.apply('cc-1', [{ name: '好感度', raw: 10 }], { source: 'manual' })
    expect(same.events).toHaveLength(0)
    const absent = await store.apply('cc-1', [{ name: '不存在', raw: null }], { source: 'manual' })
    expect(absent.events).toHaveLength(0)
  })

  it('manual edits and deletions produce manual events; deletions remove rows', async () => {
    const store = createVariableStore(createStorageRepository(createMemoryEngine()))
    await store.ensure('cc-1', DEFAULTS)

    const edited = await store.apply('cc-1', [{ name: '时间', raw: '黄昏' }], { source: 'manual' })
    expect(edited.events[0]).toMatchObject({ source: 'manual', before: '清晨', after: '黄昏' })

    const removed = await store.apply('cc-1', [{ name: '时间', raw: null }], { source: 'manual' })
    expect(removed.events[1]).toMatchObject({ before: '黄昏', after: null, source: 'manual' })
    expect(removed.state['时间']).toBeUndefined()
  })

  it('reset drops the event stream and reseeds from the card defaults (清空重开)', async () => {
    const store = createVariableStore(createStorageRepository(createMemoryEngine()))
    await store.ensure('cc-1', DEFAULTS)
    await store.apply('cc-1', [{ name: '好感度', raw: 99 }, { name: '额外', raw: 'x' }], { source: 'ai' })

    const restarted = await store.reset('cc-1', DEFAULTS)
    expect(restarted.events).toEqual([])
    expect(restarted.state['好感度']).toMatchObject({ value: 10, sourceEventId: 'seed' })
    expect(restarted.state['额外']).toBeUndefined()
  })

  it('unknown cards read back null', async () => {
    const store = createVariableStore(createStorageRepository(createMemoryEngine()))
    expect(await store.get('cc-404')).toBeNull()
  })

  it('template trees ride the same ledger under their template id (M3-r)', async () => {
    const store = createVariableStore(createStorageRepository(createMemoryEngine()))
    await store.ensure('cc-1', [{ name: 'tpl-1', value: { hp: 0, stats: { physique: { val: 0 } } } }])

    const after = await store.apply('cc-1', [{ name: 'tpl-1', raw: { hp: 95, stats: { physique: { val: 12 } } } }], {
      source: 'ai',
      messageId: 'm-1',
    })
    expect(after.state['tpl-1']).toMatchObject({ value: { hp: 95, stats: { physique: { val: 12 } } } })
    expect(after.events[0]).toMatchObject({ kind: 'variable.set', name: 'tpl-1', source: 'ai', messageId: 'm-1' })

    // Structural no-op: an identical tree does not produce a second event.
    const again = await store.apply('cc-1', [{ name: 'tpl-1', raw: { hp: 95, stats: { physique: { val: 12 } } } }], {
      source: 'ai',
    })
    expect(again.events).toHaveLength(1)

    // Reload replays to the same tree.
    const reloaded = (await store.get('cc-1'))!
    expect(reloaded.state['tpl-1']).toEqual(after.state['tpl-1'])
  })
})
