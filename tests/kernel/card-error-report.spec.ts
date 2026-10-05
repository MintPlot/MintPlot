import { beforeEach, describe, expect, it } from 'vitest'
import { errorHub } from '@/kernel/diagnostics/error-hub'
import { EXECUTABLE_FRAME_CHANNEL, buildExecutableHtmlDocument, createExecutableHtmlIframe, setExecutableFrameSlashHandler, startExecutableFrameHost } from '@/kernel/render/html-frame'
import { limits } from '@/kernel/runtime/runtime-policy'

beforeEach(() => {
  errorHub.clear()
})

function postFromFrame(source: Window | null, data: unknown): void {
  window.dispatchEvent(new MessageEvent('message', { source, data }))
}

describe('kernel/render · card script error reporting (M3-err1, MP-CARD-001)', () => {
  it('the in-card shim wires error/unhandledrejection to the host channel', () => {
    const document = buildExecutableHtmlDocument('<p>hi</p>')
    expect(document).toContain("'card-error'")
    expect(document).toContain("addEventListener('error'")
    expect(document).toContain("addEventListener('unhandledrejection'")
  })

  it('trusted frame reports journal as card/script_error; untrusted sources drop', () => {
    startExecutableFrameHost()
    const iframe = createExecutableHtmlIframe('<p>hi</p>')
    document.body.appendChild(iframe)

    const before = errorHub.all().length
    // Not our channel: ignored.
    postFromFrame(iframe.contentWindow, { source: 'other', type: 'card-error', message: 'noise' })
    // Our channel, unknown window: dropped (contentWindow auth).
    postFromFrame(null, { source: EXECUTABLE_FRAME_CHANNEL, type: 'card-error', message: 'spoofed' })
    expect(errorHub.all().length).toBe(before)

    postFromFrame(iframe.contentWindow, { source: EXECUTABLE_FRAME_CHANNEL, type: 'card-error', message: 'card boom' })
    const record = errorHub.all().at(-1)!
    expect(record.code).toBe('MP-CARD-001')
    expect(record.category).toBe('card')
    expect(record.action).toBe('script_error')
    expect(record.severity).toBe('error')
    expect(record.message).toBe('card boom')

    // Height reporting still works alongside (regression guard).
    postFromFrame(iframe.contentWindow, { source: EXECUTABLE_FRAME_CHANNEL, type: 'height', value: 300 })
    expect(iframe.style.height).toBe('300px')
    iframe.remove()
  })

  it('enforces the documented slash length cap host-side; oversized posts journal and never dispatch', () => {
    startExecutableFrameHost()
    const iframe = createExecutableHtmlIframe('<p>hi</p>')
    document.body.appendChild(iframe)

    const received: string[] = []
    setExecutableFrameSlashHandler((command) => received.push(command))

    const oversized = 'x'.repeat(limits.frameSlashMaxLength + 1)
    postFromFrame(iframe.contentWindow, { source: EXECUTABLE_FRAME_CHANNEL, type: 'slash', command: oversized })
    expect(received).toEqual([])
    const record = errorHub.all().at(-1)!
    expect(record.code).toBe('MP-CARD-001')
    expect(record.message).toContain(String(limits.frameSlashMaxLength))

    // At the cap it still goes through.
    const atCap = 'y'.repeat(limits.frameSlashMaxLength)
    postFromFrame(iframe.contentWindow, { source: EXECUTABLE_FRAME_CHANNEL, type: 'slash', command: atCap })
    expect(received).toEqual([atCap])
    setExecutableFrameSlashHandler(null)
    iframe.remove()
  })
})
