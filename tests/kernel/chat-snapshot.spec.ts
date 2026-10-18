import { afterEach, describe, expect, it, vi } from 'vitest'
import { advanceBaseline, captureChatRows, createBaseline, createCapturedChanges, readCapturedChatRow } from '@/kernel/store/chat-persistence'
import type { SerializedMessage } from '@/kernel/store/chat-persistence'

type Message = SerializedMessage & { content: string }
const normalize = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

// Keep the pre-optimization full-normalization algorithm as an independent
// oracle. Its eager JSON work is deliberately unsuitable for the hot path.
function referenceChanges(messages: Message[], baseline: Map<string, string>) {
  const ids = new Set<string>()
  const upserts: Array<{ position: number; message: Message; signature: string }> = []
  messages.forEach((value, position) => {
    const message = normalize(value)
    ids.add(message.id)
    const signature = `${position}\n${JSON.stringify(message)}`
    if (baseline.get(message.id) !== signature) upserts.push({ position, message, signature })
  })
  return { upserts, deletes: [...baseline.keys()].filter(id => !ids.has(id)) }
}

afterEach(() => vi.restoreAllMocks())

describe('queued chat JSON snapshots', () => {
  it.each([20, 100, 101, 400, 1000])('matches full normalization for %i rows across edits and reorder', (count) => {
    const messages: Message[] = Array.from({ length: count }, (_, i) => ({
      id: `m-${i}`, content: `Synthetic ${i}`, candidates: [`A ${i}`, `B ${i}`], activeIndex: 0,
      nested: { value: i, optional: undefined, number: i % 3 ? Number.NaN : i, date: new Date(i * 1000) },
    }))
    let baseline = createBaseline(messages, normalize)
    for (let step = 0; step < 12; step++) {
      const selected = messages[(step * 37) % messages.length]!
      selected.content = `Edited ${step}`
      selected.activeIndex = step % 2
      if (step % 3 === 0) messages.reverse()
      if (step % 4 === 0) messages.splice(Math.floor(messages.length / 2), 1)
      messages.push({ id: `new-${step}`, content: `Appended ${step}`, reasoning: `Reason ${step}` })
      const actual = createCapturedChanges<Message>(captureChatRows(messages, baseline), baseline)
      expect(actual).toEqual(referenceChanges(messages, baseline))
      baseline = advanceBaseline(baseline, actual)
      expect(baseline).toEqual(createBaseline(messages, normalize))
    }
    const empty = createCapturedChanges<Message>(captureChatRows([], baseline), baseline)
    expect(empty.upserts).toEqual([])
    expect(empty.deletes).toEqual([...baseline.keys()])
  })

  it('compares the captured value with the baseline at execution, without live references', () => {
    const messages: Message[] = [{ id: 'm', content: 'first', candidates: ['first'] }]
    const initial = createBaseline(messages, normalize)
    messages[0]!.content = 'queued'
    const rows = captureChatRows(messages, initial)
    messages[0]!.content = 'unsaved edit'
    ;(messages[0]!.candidates as string[]).push('unsaved')
    const executingBaseline = createBaseline([{ id: 'm', content: 'different committed value' }], normalize)
    expect(createCapturedChanges<Message>(rows, executingBaseline).upserts[0]!.message).toEqual({ id: 'm', content: 'queued', candidates: ['first'] })
    expect(readCapturedChatRow(rows[0]!)).toEqual({ id: 'm', content: 'queued', candidates: ['first'] })
  })

  it('resolves ids and preview values produced by toJSON', () => {
    const message: Message = { id: 'live', content: 'live', toJSON: () => ({ id: 'stored', content: 'normalized' }) }
    const rows = captureChatRows([message])
    const changes = createCapturedChanges<Message>(rows, new Map())
    expect(changes).toEqual(referenceChanges([message], new Map()))
    expect(readCapturedChatRow<Message>(rows[0]!).content).toBe('normalized')
    const baseline = advanceBaseline(new Map(), changes)
    expect(createCapturedChanges<Message>(captureChatRows([message], baseline), baseline)).toEqual({ upserts: [], deletes: [] })
  })

  it('does not deserialize unchanged history and parses only the changed row', () => {
    const messages: Message[] = Array.from({ length: 1000 }, (_, i) => ({ id: `m-${i}`, content: `Synthetic ${i}` }))
    const baseline = createBaseline(messages, normalize)
    const parse = vi.spyOn(JSON, 'parse')
    const unchanged = createCapturedChanges(captureChatRows(messages, baseline), baseline)
    expect(unchanged).toEqual({ upserts: [], deletes: [] })
    expect(parse).not.toHaveBeenCalled()
    messages[500]!.content = 'Changed'
    const changed = createCapturedChanges<Message>(captureChatRows(messages, baseline), baseline)
    expect(changed.upserts.map(row => row.message)).toEqual([{ id: 'm-500', content: 'Changed' }])
    expect(parse).toHaveBeenCalledTimes(1)
  })
})
