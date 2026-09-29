import { describe, expect, it } from 'vitest'
import { getChatWindow, LruCache, limits, resolveRequestTimeouts } from '@/kernel/runtime/runtime-policy'

// Ported from RP tests/runtime-policy.test.mjs (baseline 4fedffd); the vm
// sandbox loader becomes a direct import of the typed module.
describe('mp-runtime-policy · chat window (ported)', () => {
  it('never mounts more than 40 of 1000 messages', () => {
    const start = getChatWindow(1000, 0, 1000)
    const middle = getChatWindow(1000, 475, 1000)
    const tail = getChatWindow(1000, 999, 1000)

    for (const range of [start, middle, tail]) {
      expect(range.end - range.start).toBeLessThanOrEqual(40)
      expect(range.start).toBeGreaterThanOrEqual(0)
      expect(range.end).toBeLessThanOrEqual(1000)
    }
  })
})

describe('mp-runtime-policy · render LRU (ported)', () => {
  it('is a true LRU capped at 100 entries', () => {
    const cache = new LruCache<number, string>(100)

    for (let index = 0; index < 100; index += 1) cache.set(index, `value-${index}`)
    expect(cache.get(0)).toBe('value-0')
    cache.set(100, 'value-100')

    expect(cache.size).toBe(100)
    expect(cache.has(0)).toBe(true)
    expect(cache.has(1)).toBe(false)
  })
})

describe('mp-runtime-policy · limits (ported)', () => {
  it('match the APK performance contract', () => {
    expect(limits).toEqual({
      chatInitial: 20,
      chatBatch: 10,
      chatMaximum: 40,
      renderCache: 100,
      activeIframes: 3,
      streamFlushMs: 50,
      draftSaveMs: 2000,
      frameMaxHeight: 4000,
      frameSlashMaxLength: 2000,
      parseCotCache: 100,
      swipeMaxCandidates: 5,
      requestTimeout: {
        firstByteMs: 60000,
        firstTokenMs: 60000,
        streamIdleMs: 120000,
        totalMs: 600000,
      },
      requestTimeoutMinSeconds: 10,
      requestTimeoutMaxSeconds: 1800,
    })
  })
})

describe('mp-runtime-policy · request timeouts (ported)', () => {
  it('defaults, clamping and legal passthrough', () => {
    // No config → all defaults in milliseconds.
    expect(resolveRequestTimeouts({})).toEqual({
      firstByteMs: 60000,
      firstTokenMs: 60000,
      streamIdleMs: 120000,
      totalMs: 600000,
    })
    expect(resolveRequestTimeouts()).toEqual(resolveRequestTimeouts({}))

    // Legal values (seconds) → millisecond passthrough.
    expect(resolveRequestTimeouts({
      requestFirstByteTimeout: 90,
      requestFirstTokenTimeout: 300,
      requestStreamIdleTimeout: 150,
      requestTotalTimeout: 900,
    })).toEqual({
      firstByteMs: 90000,
      firstTokenMs: 300000,
      streamIdleMs: 150000,
      totalMs: 900000,
    })

    // Out-of-range clamps to [10, 1800] seconds; non-numbers fall back.
    const clamped = resolveRequestTimeouts({
      requestFirstByteTimeout: 1,
      requestFirstTokenTimeout: 99999,
      requestStreamIdleTimeout: 'abc',
      requestTotalTimeout: -5,
    })
    expect(clamped.firstByteMs).toBe(10000) // 1s → clamped to the 10s floor
    expect(clamped.firstTokenMs).toBe(1800000) // 99999s → clamped to the 1800s ceiling
    expect(clamped.streamIdleMs).toBe(120000) // invalid → default 120s
    expect(clamped.totalMs).toBe(10000) // -5s → clamped to the 10s floor
  })
})
