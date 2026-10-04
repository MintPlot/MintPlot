/**
 * Executable frame lifecycle limiter (M3-n, native) — behavior port of RP's
 * html-frame-lifecycle.mjs (the documented performance red line): every
 * `.executable-html-frame` in the document is observed; frames scrolled out
 * of view are suspended (their srcdoc swapped for an empty document, height
 * frozen), and at most {@link limits.activeIframes} frames run at once. AI
 * replies can ship HTML cards too, so an unbounded long chat would otherwise
 * multiply live frames. Self-initializes on import, same as RP's
 * side-effect module; inert where IntersectionObserver is missing (tests).
 */

import { limits } from '@/kernel/runtime/runtime-policy'

const sources = new WeakMap<HTMLIFrameElement, string>()
const visible = new WeakMap<HTMLIFrameElement, boolean>()
const activeFrames = new Set<HTMLIFrameElement>()
let observer: IntersectionObserver | null = null

const suspend = (frame: HTMLIFrameElement | undefined): void => {
  if (!frame || !activeFrames.has(frame)) return
  const height = Math.max(80, Math.round(frame.getBoundingClientRect().height || 0))
  frame.style.height = `${height}px`
  frame.classList.add('html-frame-suspended')
  frame.srcdoc = '<!doctype html><html><body></body></html>'
  activeFrames.delete(frame)
}

const freeSlot = (preferredFrame: HTMLIFrameElement): void => {
  if (activeFrames.size < limits.activeIframes) return
  const all = [...activeFrames]
  const inactive = all.find((frame) => frame !== preferredFrame && !visible.get(frame))
  suspend(inactive ?? all.find((frame) => frame !== preferredFrame))
}

const activate = (frame: HTMLIFrameElement): void => {
  if (activeFrames.has(frame)) return
  freeSlot(frame)
  const source = sources.get(frame)
  if (!source) return
  frame.classList.remove('html-frame-suspended')
  frame.srcdoc = source
  activeFrames.add(frame)
}

const observeFrame = (frame: Element): void => {
  if (!(frame instanceof HTMLIFrameElement) || sources.has(frame)) return
  const source = frame.srcdoc || frame.getAttribute('srcdoc') || ''
  if (!source) return
  sources.set(frame, source)
  frame.setAttribute('loading', 'lazy')
  observer?.observe(frame)
}

const scan = (root: Node): void => {
  if (root instanceof HTMLIFrameElement && root.classList.contains('executable-html-frame')) observeFrame(root)
  if (root instanceof Element) root.querySelectorAll('iframe.executable-html-frame').forEach(observeFrame)
  for (const frame of [...activeFrames]) {
    if (!frame.isConnected) activeFrames.delete(frame)
  }
}

const init = (): void => {
  if (observer || typeof window === 'undefined' || !window.IntersectionObserver) return
  observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      const frame = entry.target as HTMLIFrameElement
      visible.set(frame, entry.isIntersecting)
      if (entry.isIntersecting) activate(frame)
      else suspend(frame)
    })
  }, { rootMargin: '160px 0px', threshold: 0 })

  // The observation registration itself keeps the MutationObserver alive
  // while document.body lives — no module-level reference required.
  new MutationObserver((records) => {
    records.forEach((record) => record.addedNodes.forEach((node) => {
      if (node instanceof Element) scan(node)
    }))
  }).observe(document.body, { childList: true, subtree: true })
  scan(document.body)
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true })
  } else {
    init()
  }
}

export const executableFrameLifecycle = {
  rescan: (): void => {
    if (typeof document !== 'undefined') scan(document.body)
  },
  getActiveCount: (): number => activeFrames.size,
  maxActiveFrames: limits.activeIframes,
}
