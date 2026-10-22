import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { errorHub } from '@/kernel/diagnostics/error-hub'
import { uiService, useToasts } from '@/kernel/ui/toasts'

beforeEach(() => { vi.useFakeTimers(); useToasts().value = [] })
afterEach(() => { vi.clearAllTimers(); useToasts().value = []; vi.useRealTimers(); vi.restoreAllMocks() })

describe('toast lifetime', () => {
  it('keeps errors readable for four seconds while ordinary notices expire after one', () => {
    uiService.toast('shell', 'Synthetic failure', { tone: 'error' })
    uiService.toast('shell', 'Synthetic information')
    uiService.toast('shell', 'Synthetic success', { tone: 'success' })
    vi.advanceTimersByTime(1000)
    expect(useToasts().value.map(toast => toast.tone)).toEqual(['error'])
    vi.advanceTimersByTime(2999)
    expect(useToasts().value).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(useToasts().value).toEqual([])
  })
  it('honors explicit short and sticky lifetimes and closes progress independently', () => {
    uiService.toast('shell', 'Explicit', { tone: 'error', durationMs: 125 })
    uiService.toast('shell', 'Sticky', { tone: 'error', durationMs: 0 })
    const progress = uiService.progress('shell')
    vi.advanceTimersByTime(125)
    expect(useToasts().value.map(toast => toast.message)).toEqual(['Sticky', '处理中…'])
    progress.close(); progress.close()
    vi.advanceTimersByTime(10000)
    expect(useToasts().value.map(toast => toast.message)).toEqual(['Sticky'])
    expect(vi.getTimerCount()).toBe(0)
  })
  it('continues mirroring error notices exactly once', () => {
    const record = vi.spyOn(errorHub, 'record')
    uiService.toast('shell', 'Synthetic error', { tone: 'error' })
    uiService.toast('shell', 'Synthetic info')
    expect(record).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ action: 'toast_error', message: 'Synthetic error' }))
  })
})
