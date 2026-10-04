import { describe, expect, it } from 'vitest'
import type { VariableSetEvent } from '@contracts'
import { createStorageRepository } from '@/kernel/store/storage-repository'
import { createMemoryEngine } from '@/kernel/store/kv-store'
import { replayVariableState } from '@/kernel/variables/variable-engine'
import { createVariableStore, replayTemplateStateAtFloor, filterCandidateEvents, eventsBeforeFloor, type VariableSnapshot } from '@/kernel/variables/variable-store'

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

describe('replayTemplateStateAtFloor · M3-s 逐楼快照 floor attribution', () => {
  const INITIAL = { hp: 10, location: '青茅山' }
  const floors = new Map([
    ['greet', 0],
    ['m-1', 2],
    ['m-3', 4],
  ])
  const floorOf = (id: string): number => floors.get(id) ?? Number.POSITIVE_INFINITY

  const eventsOf = (snapshot: VariableSnapshot) => snapshot.events

  it('floors before an AI event show the seed, the event floor and later show the update', async () => {
    const store = createVariableStore(createStorageRepository(createMemoryEngine()))
    await store.ensure('cc-1', [{ name: 'tpl-1', value: INITIAL }])
    const after = await store.apply('cc-1', [{ name: 'tpl-1', raw: { hp: 95, location: '中洲' } }], {
      source: 'ai',
      messageId: 'm-1',
    })
    const events = eventsOf(after)

    expect(replayTemplateStateAtFloor(events, 'tpl-1', INITIAL, floorOf, 0)).toEqual(INITIAL)
    expect(replayTemplateStateAtFloor(events, 'tpl-1', INITIAL, floorOf, 1)).toEqual(INITIAL)
    expect(replayTemplateStateAtFloor(events, 'tpl-1', INITIAL, floorOf, 2)).toEqual({ hp: 95, location: '中洲' })
    expect(replayTemplateStateAtFloor(events, 'tpl-1', INITIAL, floorOf, 99)).toEqual({ hp: 95, location: '中洲' })
  })

  it('manual events inherit the floor of the nearest preceding AI event', async () => {
    const store = createVariableStore(createStorageRepository(createMemoryEngine()))
    await store.ensure('cc-1', [{ name: 'tpl-1', value: INITIAL }])
    await store.apply('cc-1', [{ name: 'tpl-1', raw: { hp: 95, location: '中洲' } }], { source: 'ai', messageId: 'm-1' })
    await store.apply('cc-1', [{ name: 'tpl-1', raw: { hp: 50, location: '中洲' } }], { source: 'manual' })
    const afterThird = await store.apply('cc-1', [{ name: 'tpl-1', raw: { hp: 80, location: '白凡山' } }], { source: 'ai', messageId: 'm-3' })
    const events = eventsOf(afterThird)

    // The manual edit inherits floor 2 (m-1): visible from floor 2 onward
    // until the m-3 floor's own event supersedes it.
    expect(replayTemplateStateAtFloor(events, 'tpl-1', INITIAL, floorOf, 1)).toEqual(INITIAL)
    expect(replayTemplateStateAtFloor(events, 'tpl-1', INITIAL, floorOf, 2)).toEqual({ hp: 50, location: '中洲' })
    expect(replayTemplateStateAtFloor(events, 'tpl-1', INITIAL, floorOf, 3)).toEqual({ hp: 50, location: '中洲' })
    expect(replayTemplateStateAtFloor(events, 'tpl-1', INITIAL, floorOf, 4)).toEqual({ hp: 80, location: '白凡山' })
  })

  it('manual edits before any AI event sit at the greeting floor', async () => {
    const store = createVariableStore(createStorageRepository(createMemoryEngine()))
    await store.ensure('cc-1', [{ name: 'tpl-1', value: INITIAL }])
    const after = await store.apply('cc-1', [{ name: 'tpl-1', raw: { hp: 1, location: '荒原' } }], { source: 'manual' })

    expect(replayTemplateStateAtFloor(eventsOf(after), 'tpl-1', INITIAL, floorOf, 0)).toEqual({ hp: 1, location: '荒原' })
  })

  it('events with unknown message ids affect no historical floor', async () => {
    const store = createVariableStore(createStorageRepository(createMemoryEngine()))
    await store.ensure('cc-1', [{ name: 'tpl-1', value: INITIAL }])
    const after = await store.apply('cc-1', [{ name: 'tpl-1', raw: { hp: 95, location: '中洲' } }], {
      source: 'ai',
      messageId: 'm-gone',
    })

    expect(replayTemplateStateAtFloor(eventsOf(after), 'tpl-1', INITIAL, floorOf, 99)).toEqual(INITIAL)
  })

  it('input trees are not mutated by the fold', async () => {
    const store = createVariableStore(createStorageRepository(createMemoryEngine()))
    await store.ensure('cc-1', [{ name: 'tpl-1', value: INITIAL }])
    const after = await store.apply('cc-1', [{ name: 'tpl-1', raw: { hp: 95, location: '中洲' } }], { source: 'ai', messageId: 'm-1' })

    const result = replayTemplateStateAtFloor(eventsOf(after), 'tpl-1', INITIAL, floorOf, 2) as Record<string, unknown>
    result.hp = 0
    expect(INITIAL.hp).toBe(10)
  })
})

describe('M4-c · candidate tagging, rollback and filtered replay', () => {
  const seed = [{ name: '好感度', value: 10 }]

  it('retagUntaggedEvents re-tags only the target floor; tagged rows stay put', async () => {
    const store = createVariableStore(createStorageRepository(createMemoryEngine()))
    await store.ensure('cc-9', seed)
    await store.apply('cc-9', [{ name: '好感度', raw: '+1' }], { source: 'ai', messageId: 'm-1' })
    await store.apply('cc-9', [{ name: '好感度', raw: '+2' }], { source: 'ai', messageId: 'm-1', candidateIndex: 1 })

    const snapshot = await store.retagUntaggedEvents('cc-9', 'm-1', 0)
    expect(snapshot.events.map((event) => event.candidateIndex)).toEqual([0, 1])
    // Idempotent: a second retag of the same floor changes nothing.
    const again = await store.retagUntaggedEvents('cc-9', 'm-1', 3)
    expect(again.events.map((event) => event.candidateIndex)).toEqual([0, 1])
  })

  it('rollbackFloors drops every event of the removed floors and keeps the rest', async () => {
    const store = createVariableStore(createStorageRepository(createMemoryEngine()))
    await store.ensure('cc-9', seed)
    await store.apply('cc-9', [{ name: '好感度', raw: '+1' }], { source: 'ai', messageId: 'm-1' })
    await store.apply('cc-9', [{ name: '好感度', raw: '+5' }], { source: 'ai', messageId: 'm-2' })

    const snapshot = await store.rollbackFloors('cc-9', ['m-user', 'm-2'])
    expect(snapshot.events).toHaveLength(1)
    expect(snapshot.state['好感度']).toMatchObject({ value: 11 })
    // Idempotent.
    expect((await store.rollbackFloors('cc-9', ['m-2'])).events).toHaveLength(1)
  })

  it('filterCandidateEvents keeps untagged rows and active-candidate rows only', () => {
    // Pure-function shape probes: partial stubs cast to the contract event.
    const event = (candidateIndex?: number) => ({ candidateIndex }) as unknown as VariableSetEvent
    const events = [event(undefined), event(0), event(1), event(0)]
    expect(filterCandidateEvents(events, () => 0)).toEqual([events[0], events[1], events[3]])
    // Floors without candidates never filter (resolver returns undefined).
    expect(filterCandidateEvents(events, () => undefined)).toEqual(events)
  })

  it('eventsBeforeFloor cuts at the first event of the target floor', () => {
    const events = [
      { messageId: 'm-1' },
      { messageId: 'm-2' },
      { messageId: 'm-2' },
    ] as unknown as VariableSetEvent[]
    expect(eventsBeforeFloor(events, 'm-2')).toEqual([{ messageId: 'm-1' }])
    expect(eventsBeforeFloor(events, 'm-x')).toEqual(events)
  })
})
