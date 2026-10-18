import { describe, expect, it } from 'vitest'
import {
  createBaseline,
  advanceBaseline,
  createChanges,
  recoverInterruptedDraft,
} from '@/kernel/store/chat-persistence'
import type { StoredMessage } from '@/kernel/store/chat-persistence'

// Ported from RP tests/chat-persistence.test.mjs (baseline 4fedffd); the vm
// sandbox loader becomes a direct import of the typed module.
type TestMessage = { id: string; content: string; storageStatus?: string }
const serialize = (message: TestMessage): TestMessage => JSON.parse(JSON.stringify(message))

describe('mp-chat-persistence · baseline and change computation (ported)', () => {
  it('advances submitted signatures and deletions without reading later live edits', () => {
    const messages = [{ id: 'a', content: 'A' }, { id: 'b', content: 'B' }]
    const baseline = createBaseline(messages, serialize)
    const next = [{ id: 'b', content: 'edited' }, { id: 'c', content: 'new' }]
    const changes = createChanges(next, baseline, serialize)
    const expected = createBaseline(next, serialize)
    next[0]!.content = 'not saved yet'
    const advanced = advanceBaseline(baseline, changes)
    expect(advanced).toEqual(expected)
    expect(baseline).toEqual(createBaseline(messages, serialize))
    expect(createChanges(next, advanced, serialize).upserts.map(row => row.message.id)).toEqual(['b'])
    const unchanged = advanceBaseline(advanced, { upserts: [], deletes: [] })
    expect(unchanged).toEqual(advanced)
    expect(unchanged).not.toBe(advanced)
  })
  it('deleting a middle message updates shifted row positions', () => {
    const original = [
      { id: 'a', content: 'A' },
      { id: 'b', content: 'B' },
      { id: 'c', content: 'C' },
    ]
    const baseline = createBaseline(original, serialize)
    const next = [original[0]!, original[2]!, { id: 'd', content: 'D' }]
    const changes = createChanges(next, baseline, serialize)

    expect([...changes.deletes]).toEqual(['b'])
    expect(changes.upserts.map((item) => [item.message.id, item.position])).toEqual([
      ['c', 1],
      ['d', 2],
    ])
  })

  it('editing one message updates only that row', () => {
    const original = [{ id: 'a', content: 'A' }, { id: 'b', content: 'B' }]
    const baseline = createBaseline(original, serialize)
    const changes = createChanges(
      [{ id: 'a', content: 'A' }, { id: 'b', content: 'edited' }],
      baseline,
      serialize,
    )

    expect([...changes.deletes]).toEqual([])
    expect(changes.upserts).toHaveLength(1)
    expect(changes.upserts[0]!.message.id).toBe('b')
  })

  it('unchanged chats generate no writes', () => {
    const messages = [{ id: 'a', content: 'A', storageStatus: 'final' }]
    const baseline = createBaseline(messages, serialize)
    const changes = createChanges(messages, baseline, serialize)
    expect(changes.upserts).toHaveLength(0)
    expect(changes.deletes).toHaveLength(0)
  })
})

describe('mp-chat-persistence · interrupted draft recovery (ported)', () => {
  it('marks the draft final and appends the marker exactly once', () => {
    const marker = '*-- App interrupted generation --*'
    const draft: StoredMessage = { id: 'draft', content: 'partial output  ', storageStatus: 'draft' }

    expect(recoverInterruptedDraft(draft, marker)).toBe(true)
    expect(draft.storageStatus).toBe('final')
    expect(draft.content).toBe(`partial output\n\n${marker}`)
    // Second run is a no-op: the marker must never duplicate.
    expect(recoverInterruptedDraft(draft, marker)).toBe(false)
    expect((draft.content as string).match(/App interrupted/g)).toHaveLength(1)
  })

  it('leaves non-string content untouched (no [object Object] coercion)', () => {
    const draft: StoredMessage = { id: 'structured', content: { parts: ['a'] }, storageStatus: 'draft' }
    expect(recoverInterruptedDraft(draft, 'marker')).toBe(false)
    expect(draft.storageStatus).toBe('draft')
    expect(draft.content).toEqual({ parts: ['a'] })
  })

  it('ignores messages that are not drafts', () => {
    const final: StoredMessage = { id: 'final', content: 'done', storageStatus: 'final' }
    expect(recoverInterruptedDraft(final, 'marker')).toBe(false)
    expect(recoverInterruptedDraft(null, 'marker')).toBe(false)
  })
})
