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
const suspendedDocument = '<!doctype html><html><body></body></html>'
// Frames force-suspended while STILL intersecting (slot pressure): suspension
// freezes their height, so the IntersectionObserver never re-fires for them
// and they would stay blank forever. They queue here and re-activate as soon
// as any slot frees.
const pendingVisible = new Set<HTMLIFrameElement>()
let reactivating = false
let activating = false
let observer: IntersectionObserver | null = null

const retryPendingActivation = (): void => {
  // `activating`: a suspend can run mid-activation (via freeSlot) — the slot
  // it frees is about to be claimed by that very activation, so retrying
  // here would overfill the budget. Wait until the activation has settled.
  if (reactivating || activating || activeFrames.size >= limits.activeIframes) return
  reactivating = true
  try {
    for (const frame of pendingVisible) {
      if (!frame.isConnected || !visible.get(frame)) {
        pendingVisible.delete(frame)
        continue
      }
      pendingVisible.delete(frame)
      activate(frame)
      return
    }
  } finally {
    reactivating = false
  }
}

const suspend = (frame: HTMLIFrameElement | undefined, forced = false): void => {
  if (!frame || !activeFrames.has(frame)) return
  const height = Math.max(80, Math.round(frame.getBoundingClientRect().height || 0))
  frame.style.height = `${height}px`
  frame.classList.add('html-frame-suspended')
  frame.srcdoc = suspendedDocument
  activeFrames.delete(frame)
  if (forced) pendingVisible.add(frame)
  else pendingVisible.delete(frame)
  retryPendingActivation()
}

const freeSlot = (preferredFrame: HTMLIFrameElement): void => {
  // Evict only AT capacity — activating under budget must never touch a live
  // frame (an inverted guard here would blank visible frames on every scroll).
  if (activeFrames.size < limits.activeIframes) return
  const all = [...activeFrames]
  const victim = all.find((frame) => frame !== preferredFrame && !visible.get(frame))
    ?? all.find((frame) => frame !== preferredFrame)
  // forced = the victim was still intersecting: it must re-activate when a
  // slot frees, otherwise it stays a blank frozen frame while on screen.
  suspend(victim, victim !== undefined && visible.get(victim) === true)
}

const activate = (frame: HTMLIFrameElement): void => {
  if (activeFrames.has(frame)) return
  activating = true
  try {
    freeSlot(frame)
    const source = sources.get(frame)
    if (!source) return
    frame.classList.remove('html-frame-suspended')
    frame.srcdoc = source
    activeFrames.add(frame)
  } finally {
    activating = false
  }
  // A frame queued by this activation's eviction may now fit — retried after
  // the activation has settled, never mid-flight (see retryPendingActivation).
  retryPendingActivation()
}

const observeFrame = (frame: Element): void => {
  if (!(frame instanceof HTMLIFrameElement) || sources.has(frame)) return
  const source = frame.srcdoc || frame.getAttribute('srcdoc') || ''
  if (!source) return
  sources.set(frame, source)
  frame.setAttribute('loading', 'lazy')
  // Newly mounted documents must also enter through activate(). Otherwise
  // initially offscreen frames run their source without joining activeFrames,
  // and suspend() cannot stop them because they never claimed a budget slot.
  frame.classList.add('html-frame-suspended')
  frame.srcdoc = suspendedDocument
  observer?.observe(frame)
}

const scan = (root: Node): void => {
  if (root instanceof HTMLIFrameElement && root.classList.contains('executable-html-frame')) observeFrame(root)
  if (root instanceof Element) root.querySelectorAll('iframe.executable-html-frame').forEach(observeFrame)
  for (const frame of [...activeFrames]) {
    if (!frame.isConnected) activeFrames.delete(frame)
  }
  // Queued frames are held by a strong Set — prune detached ones here too,
  // not only inside the retry drain.
  for (const frame of [...pendingVisible]) {
    if (!frame.isConnected) pendingVisible.delete(frame)
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
