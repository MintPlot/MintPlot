import { describe, expect, it } from 'vitest'
import type { VariableSetEvent, VariableValue } from '@contracts'
import { createTemplateFloorIndex } from '@/kernel/variables/template-floor-index'
import { filterCandidateEvents, replayTemplateStateAtFloor } from '@/kernel/variables/variable-store'

const makeEvent = (name: string, after: VariableValue | null, messageId?: string, candidateIndex?: number): VariableSetEvent => ({
  id: 'synthetic', kind: 'variable.set', pluginId: 'variables', sessionKind: 'card', sessionId: 'card',
  name, before: null, after, ts: 0, source: messageId ? 'ai' : 'manual', messageId, candidateIndex,
})

describe('template floor index parity with canonical replay', () => {
  const position = (id: string) => id.startsWith('m-') ? Number(id.slice(2)) : -1
  const check = (events: VariableSetEvent[], names = ['a', 'b']) => {
    const index = createTemplateFloorIndex(events, position)
    for (const name of names) {
      for (const floor of [-1, 0, 1, 2, 3, 10, 100, Infinity]) {
        const initial = { initial: true }
        expect(index.at(name, floor) ?? initial).toEqual(replayTemplateStateAtFloor(events, name, initial, position, floor))
      }
    }
  }

  it('preserves out-of-floor-order updates, null attribution, manual inheritance and unknown ids', () => {
    check([
      makeEvent('a', { n: 1 }),
      makeEvent('b', { n: 2 }, 'm-10'),
      makeEvent('a', { n: 3 }, 'm-3'),
      makeEvent('a', { n: 4 }, 'missing'),
      makeEvent('a', { n: 5 }),
      makeEvent('a', null, 'm-1'),
      makeEvent('a', { n: 6 }),
      makeEvent('b', { n: 7 }),
      makeEvent('a', { n: 8 }, 'm-0'),
      makeEvent('a', [1, { nested: ['x', true] }], 'm-2'),
    ])
  })

  it('matches deterministic mixed ledgers after swipe, truncation, replacement and reset', () => {
    let random = 7
    const next = () => (random = (Math.imul(random, 1664525) + 1013904223) >>> 0)
    const events = Array.from({ length: 1000 }, (_, i) => makeEvent(
      i % 2 ? 'a' : 'b', i % 9 ? { n: i, nested: { flag: i % 2 === 0 } } : null,
      i % 7 === 0 ? undefined : i % 11 === 0 ? 'missing' : `m-${next() % 101}`,
      i % 5 === 0 ? next() % 2 : undefined,
    ))
    for (const active of [0, 1, undefined]) check(filterCandidateEvents(events, () => active))
    check(events.slice(0, 600))
    check(events.map((event, i) => i === 17 ? { ...event, after: { replaced: true } } : event))
    check([])
  })

  it('resolves event positions once and never scans the ledger during floor queries', () => {
    let lookups = 0
    const events = Array.from({ length: 5000 }, (_, i) => makeEvent(`t-${i % 3}`, { n: i }, `m-${i % 400}`))
    const index = createTemplateFloorIndex(events, id => { lookups++; return position(id) })
    expect(lookups).toBe(5000)
    for (let pass = 0; pass < 2; pass++) {
      for (let floor = 0; floor < 400; floor++) {
        for (let template = 0; template < 3; template++) index.at(`t-${template}`, floor)
      }
    }
    expect(lookups).toBe(5000)
  })
})
