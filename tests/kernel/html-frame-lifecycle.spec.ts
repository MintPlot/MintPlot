import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * html-frame-lifecycle behavioral tests (M3-n red line). The module is a
 * side-effect singleton, inert without IntersectionObserver — a fake must be
 * installed BEFORE the dynamic import so init() wires the fake and tests can
 * drive the observer callback directly.
 */

const SUSPENDED_SRCDOC = '<!doctype html><html><body></body></html>'

class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = []
  readonly observed = new Set<Element>()
  private readonly callback: (entries: { target: Element; isIntersecting: boolean }[]) => void

  constructor(callback: (entries: { target: Element; isIntersecting: boolean }[]) => void) {
    this.callback = callback
    FakeIntersectionObserver.instances.push(this)
  }

  observe(target: Element): void {
    this.observed.add(target)
  }

  unobserve(): void {}
  disconnect(): void {}

  emit(target: Element, isIntersecting: boolean): void {
    this.callback([{ target, isIntersecting }])
  }
}

async function freshModule() {
  document.body.innerHTML = ''
  vi.resetModules()
  FakeIntersectionObserver.instances.length = 0
  const mod = await import('@/kernel/render/html-frame-lifecycle')
  const observer = FakeIntersectionObserver.instances.at(-1)
  if (!observer) throw new Error('lifecycle module did not install its observer (readyState issue?)')
  return { ...mod, observer }
}

function makeFrame(id: string): HTMLIFrameElement {
  const frame = document.createElement('iframe')
  frame.classList.add('executable-html-frame')
  frame.setAttribute('srcdoc', `<html><body>${id}</body></html>`)
  document.body.appendChild(frame)
  return frame
}

const srcdocOf = (frame: HTMLIFrameElement): string => frame.getAttribute('srcdoc') ?? ''

describe('kernel/render · html-frame-lifecycle (M3-n red line)', () => {
  beforeEach(() => {
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('activates a frame on intersection and suspends it on exit', async () => {
    const { observer, executableFrameLifecycle } = await freshModule()
    const frame = makeFrame('a')
    executableFrameLifecycle.rescan()

    observer.emit(frame, true)
    expect(executableFrameLifecycle.getActiveCount()).toBe(1)
    expect(frame.classList.contains('html-frame-suspended')).toBe(false)
    expect(srcdocOf(frame)).toContain('a')

    observer.emit(frame, false)
    expect(executableFrameLifecycle.getActiveCount()).toBe(0)
    expect(frame.classList.contains('html-frame-suspended')).toBe(true)
    expect(srcdocOf(frame)).toBe(SUSPENDED_SRCDOC)
  })

  it('holds the active-frames red line at capacity', async () => {
    const { observer, executableFrameLifecycle } = await freshModule()
    const frames = ['f1', 'f2', 'f3', 'f4', 'f5'].map(makeFrame)
    executableFrameLifecycle.rescan()

    for (const frame of frames) observer.emit(frame, true)

    expect(executableFrameLifecycle.getActiveCount()).toBe(executableFrameLifecycle.maxActiveFrames)
    expect(srcdocOf(frames[4]!)).toContain('f5')
    expect(srcdocOf(frames[0]!)).toBe(SUSPENDED_SRCDOC)
  })

  it('never evicts a live frame when activating under budget (guard inversion regression)', async () => {
    const { observer, executableFrameLifecycle } = await freshModule()
    const [f1, f2, f3] = ['f1', 'f2', 'f3'].map(makeFrame)
    executableFrameLifecycle.rescan()

    observer.emit(f1!, true)
    observer.emit(f2!, true)
    expect(executableFrameLifecycle.getActiveCount()).toBe(2)

    // Budget has room — the arriving frame must not touch the live ones.
    observer.emit(f3!, true)

    expect(executableFrameLifecycle.getActiveCount()).toBe(3)
    expect(srcdocOf(f1!)).toContain('f1')
    expect(srcdocOf(f2!)).toContain('f2')
    expect(f1!.classList.contains('html-frame-suspended')).toBe(false)
  })

  it('re-activates a force-suspended visible frame when a slot frees, without a new intersection event', async () => {
    const { observer, executableFrameLifecycle } = await freshModule()
    const frames = ['f1', 'f2', 'f3', 'f4'].map(makeFrame)
    executableFrameLifecycle.rescan()

    for (const frame of frames) observer.emit(frame, true)
    // At capacity: f1 (visible) was force-suspended to make room for f4 —
    // frozen AND blank, and the observer will never re-fire for it.
    expect(executableFrameLifecycle.getActiveCount()).toBe(3)
    expect(srcdocOf(frames[0]!)).toBe(SUSPENDED_SRCDOC)
    expect(frames[0]!.classList.contains('html-frame-suspended')).toBe(true)

    // f2 scrolls out, freeing a slot — the queued f1 must come back on its own.
    observer.emit(frames[1]!, false)

    expect(executableFrameLifecycle.getActiveCount()).toBe(3)
    expect(srcdocOf(frames[0]!)).toContain('f1')
    expect(frames[0]!.classList.contains('html-frame-suspended')).toBe(false)
  })

  it('keeps the count within budget when a queued frame re-activates', async () => {
    const { observer, executableFrameLifecycle } = await freshModule()
    const frames = ['f1', 'f2', 'f3', 'f4', 'f5'].map(makeFrame)
    executableFrameLifecycle.rescan()
    for (const frame of frames) observer.emit(frame, true)
    // Queued: f1, f2 (both visible when evicted).
    expect(executableFrameLifecycle.getActiveCount()).toBe(3)

    observer.emit(frames[4]!, false)
    expect(executableFrameLifecycle.getActiveCount()).toBe(3)

    observer.emit(frames[3]!, false)
    // Two slots freed — exactly one queued frame drains per event, never over.
    expect(executableFrameLifecycle.getActiveCount()).toBe(executableFrameLifecycle.maxActiveFrames)
  })

  it('drops queued frames that left the document', async () => {
    const { observer, executableFrameLifecycle } = await freshModule()
    const frames = ['f1', 'f2', 'f3', 'f4'].map(makeFrame)
    executableFrameLifecycle.rescan()
    for (const frame of frames) observer.emit(frame, true)
    expect(srcdocOf(frames[0]!)).toBe(SUSPENDED_SRCDOC)

    frames[0]!.remove()
    executableFrameLifecycle.rescan()
    observer.emit(frames[3]!, false)

    expect(executableFrameLifecycle.getActiveCount()).toBe(2)
    expect(srcdocOf(frames[1]!)).toContain('f2')
  })
})
