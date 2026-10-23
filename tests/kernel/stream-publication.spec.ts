import { afterEach, describe, expect, it, vi } from 'vitest'
import { createStreamPublication } from '@/kernel/app/chat/stream-publication'

afterEach(() => vi.useRealTimers())

describe('stream publication', () => {
  it('publishes the first chunk immediately and coalesces a sustained stream without losing either field', () => {
    vi.useFakeTimers()
    const publish = vi.fn()
    const output = createStreamPublication(publish)
    output.append('reasoning', 'think')
    expect(publish).toHaveBeenCalledWith({ content: '', reasoning: 'think' })
    for (let i = 0; i < 10; i++) {
      output.append('content', String(i))
      vi.advanceTimersByTime(10)
    }
    expect(publish).toHaveBeenCalledTimes(3)
    expect(publish).toHaveBeenLastCalledWith({ content: '0123456789', reasoning: 'think' })
    output.finish()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('drains the last pending chunk synchronously on stop and ignores late callbacks', () => {
    vi.useFakeTimers()
    const publish = vi.fn()
    const output = createStreamPublication(publish)
    output.append('content', 'first')
    output.append('content', '-last')
    output.finish()
    output.append('content', '-late')
    output.finish({ content: 'late result', reasoning: '' })
    vi.runAllTimers()
    expect(publish).toHaveBeenCalledTimes(2)
    expect(publish).toHaveBeenLastCalledWith({ content: 'first-last', reasoning: '' })
  })

  it('reconciles a provider final result and supports providers without deltas', () => {
    const publish = vi.fn()
    createStreamPublication(publish).finish({ content: 'final answer', reasoning: 'final reasoning' })
    expect(publish).toHaveBeenCalledExactlyOnceWith({ content: 'final answer', reasoning: 'final reasoning' })
  })

  it('can drain on visibility change without closing the receiver', () => {
    vi.useFakeTimers()
    const publish = vi.fn()
    const output = createStreamPublication(publish)
    output.append('content', 'a')
    output.append('content', 'b')
    output.flush()
    output.append('content', 'c')
    output.finish()
    expect(publish).toHaveBeenLastCalledWith({ content: 'abc', reasoning: '' })
    expect(vi.getTimerCount()).toBe(0)
  })
})
