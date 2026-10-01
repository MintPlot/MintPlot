import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDefaultEngine } from '@/kernel/store/idb-engine'
import { createErrorHub, errorHub, fingerprint } from '@/kernel/diagnostics/error-hub'
import type { DiagnosticRecord, ErrorHubPersistence } from '@/kernel/diagnostics/error-hub'
import { uiService } from '@/kernel/ui/toasts'
import { dismissFatalError, useFatalError } from '@/kernel/ui/fatal-error'

beforeEach(() => {
  errorHub.clear()
  dismissFatalError()
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('kernel/diagnostics · error-hub (M3-err1)', () => {
  it('FNV-1a fingerprint matches the published 32-bit vector', () => {
    expect(fingerprint('a')).toBe('e40c292c')
    expect(fingerprint('hello')).toHaveLength(8)
  })

  it('clamps messages to 200 chars and keeps only scalar context keys', () => {
    const hub = createErrorHub({ onFatal: vi.fn() })
    hub.record({
      severity: 'error',
      category: 'chat',
      action: 'request_failed',
      message: 'x'.repeat(500),
      context: {
        okString: 'v',
        okNumber: 42,
        okBool: true,
        badObject: { nested: true },
        badArray: [1, 2],
        badUndefined: undefined,
      },
    })
    const record = hub.all()[0]!
    expect(record.message).toHaveLength(200)
    expect(record.context).toEqual({ okString: 'v', okNumber: 42, okBool: true })
  })

  it('red-line: non-Error throwables degrade to a length+fingerprint marker', () => {
    const hub = createErrorHub({ onFatal: vi.fn() })
    hub.record({
      severity: 'warn',
      category: 'runtime',
      action: 'window_error',
      message: { payload: 'secret-ish'.repeat(40) } as unknown as string,
    })
    const record = hub.all()[0]!
    expect(record.message).toMatch(/^<omitted:\d+;[0-9a-f]{8}>$/)
    expect(record.detail).toEqual({ length: expect.any(Number), hash: expect.any(String) })
    expect(record.message).not.toContain('secret-ish')
  })

  it('dedups identical records inside the 2s window, lets them through after', () => {
    vi.useFakeTimers()
    const hub = createErrorHub({ onFatal: vi.fn() })
    const entry = { severity: 'error' as const, category: 'chat', action: 'request_failed', message: 'HTTP 500' }
    expect(hub.record(entry)).not.toBeNull()
    expect(hub.record(entry)).toBeNull()
    vi.advanceTimersByTime(2001)
    expect(hub.record(entry)).not.toBeNull()
    expect(hub.all()).toHaveLength(2)
  })

  it('storm cap folds a key after 8 records: one collapse notice, then silence', () => {
    vi.useFakeTimers()
    const hub = createErrorHub({ onFatal: vi.fn() })
    for (let index = 0; index < 12; index += 1) {
      // Same message each round (dedup already expired) — one key, repeated.
      vi.advanceTimersByTime(3000)
      hub.record({ severity: 'error', category: 'runtime', action: 'loop', message: 'boom' })
    }
    // 8 real records + 1 fold notice; the rest are suppressed.
    expect(hub.all()).toHaveLength(9)
    expect(hub.all()[8]!.message).toContain('同类错误已折叠')
  })

  it('evicts the oldest records beyond the ring capacity', () => {
    const hub = createErrorHub({ onFatal: vi.fn(), capacity: 3 })
    for (let index = 0; index < 5; index += 1) {
      hub.record({ severity: 'info', category: 't', action: `a-${index}`, message: `m-${index}` })
    }
    expect(hub.all().map((record) => record.action)).toEqual(['a-2', 'a-3', 'a-4'])
  })

  it('fatal records fire the handler session-once per code', () => {
    const onFatal = vi.fn()
    const hub = createErrorHub({ onFatal })
    hub.record({ severity: 'fatal', category: 'storage', action: 'idb_degraded', code: 'MP-STORE-001', message: 'down' })
    hub.record({ severity: 'fatal', category: 'storage', action: 'idb_degraded', code: 'MP-STORE-001', message: 'down again' })
    hub.record({ severity: 'fatal', category: 'storage', action: 'other', code: 'MP-STORE-009', message: 'other' })
    hub.record({ severity: 'fatal', category: 'storage', action: 'nocode', message: 'no code' })
    expect(onFatal).toHaveBeenCalledTimes(3)
  })

  it('persists debounced, flushes on demand, hydrates and sanitizes the stored ring', async () => {
    vi.useFakeTimers()
    const stored: DiagnosticRecord[] = []
    const persistence: ErrorHubPersistence = {
      load: vi.fn().mockResolvedValue([
        { id: 'keep', ts: 1, severity: 'error', category: 'chat', action: 'request_failed', message: 'old', code: 'MP-NET-002' },
        { garbage: true },
        null,
      ]),
      save: vi.fn().mockImplementation(async (records: readonly DiagnosticRecord[]) => {
        stored.length = 0
        stored.push(...records)
      }),
    }
    const hub = createErrorHub({ onFatal: vi.fn(), persistence, capacity: 5 })
    await hub.hydrate()
    expect(hub.all()).toHaveLength(1)
    expect(hub.all()[0]!.code).toBe('MP-NET-002')

    hub.record({ severity: 'warn', category: 't', action: 'a', message: 'pending' })
    expect(stored).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(500)
    expect(stored).toHaveLength(2)

    hub.record({ severity: 'warn', category: 't', action: 'a2', message: 'flushed' })
    await hub.flush()
    expect(stored).toHaveLength(3)

    hub.clear()
    await vi.advanceTimersByTimeAsync(0)
    expect(stored).toHaveLength(0)
  })

  it('record() never throws, even on hostile input', () => {
    const hub = createErrorHub({ onFatal: vi.fn() })
    expect(hub.record({ category: '', action: '', message: '' })).not.toBeNull()
    expect(hub.record(undefined as never)).toBeNull()
    expect(hub.all().length).toBeGreaterThanOrEqual(1)
  })

  it('the idb degrade ladder journals MP-STORE-001 as fatal and raises the modal once', async () => {
    vi.stubGlobal('indexedDB', {
      open: () => {
        throw new Error('simulated idb outage')
      },
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const engine = createDefaultEngine()
    await engine.set('mp_x', '1')

    const record = errorHub.all().find((item) => item.code === 'MP-STORE-001')
    expect(record?.severity).toBe('fatal')
    expect(record?.category).toBe('storage')
    expect(record?.context?.reason).toContain('simulated idb outage')
    expect(useFatalError().value?.code).toBe('MP-STORE-001')

    // A second degrade (new engine, same session) must not re-raise the modal
    // (session-once per code); the ring may dedup the near-simultaneous record.
    dismissFatalError()
    const second = createDefaultEngine()
    await second.set('mp_y', '2')
    expect(useFatalError().value).toBeNull()

    errorSpy.mockRestore()
  })

  it('error toasts mirror into the journal (D6) — info toasts do not', () => {
    uiService.toast('tts', '朗读失败: engine down', { tone: 'error' })
    uiService.toast('shell', '全部搞定', { tone: 'success' })
    uiService.toast('shell', '仅提示', { tone: 'info' })

    const mirrors = errorHub.all().filter((record) => record.action === 'toast_error')
    expect(mirrors).toHaveLength(1)
    expect(mirrors[0]!.pluginId).toBe('tts')
    expect(mirrors[0]!.category).toBe('plugin')
    expect(mirrors[0]!.message).toContain('朗读失败')
  })
})
