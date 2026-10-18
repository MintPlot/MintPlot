/**
 * Runtime policy (ported from RP `src/modules/runtime-policy.mjs`,
 * baseline 4fedffd, direct port) — performance limits, the render LRU, chat
 * window arithmetic and request-timeout resolution. Comments translated to
 * English per the language discipline (existing Chinese notes touched by the
 * port are carried over in meaning).
 */

export interface MpRuntimeLimits {
  readonly chatInitial: number
  readonly chatBatch: number
  readonly chatMaximum: number
  readonly renderCache: number
  readonly activeIframes: number
  readonly streamFlushMs: number
  readonly draftSaveMs: number
  /** Cap on card-iframe self-reported height: untrusted input (cards post
   * their height cross-origin; uncapped, one card could stretch the chat
   * flow to tens of thousands of pixels). */
  readonly frameMaxHeight: number
  /** Cap on card-injected triggerSlash instruction length: untrusted input. */
  readonly frameSlashMaxLength: number
  /** LRU cap for parsed-CoT texts of messages in the render window. */
  readonly parseCotCache: number
  /** Swipe candidates per assistant message (FIFO beyond the cap); persisted
   * with history, so the cap bounds storage growth (design doc §D-5). */
  readonly swipeMaxCandidates: number
  readonly requestTimeout: Readonly<{
    firstByteMs: number
    firstTokenMs: number
    streamIdleMs: number
    totalMs: number
  }>
  readonly requestTimeoutMinSeconds: number
  readonly requestTimeoutMaxSeconds: number
}

/** Existing interpolation-cache capacity, shared by historical panel renders. */
export const PANEL_HTML_CACHE_SIZE = 32

/** Frozen limits = the APK performance contract (asserted by tests). */
export const limits: MpRuntimeLimits = Object.freeze({
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
  requestTimeout: Object.freeze({
    firstByteMs: 60000,
    firstTokenMs: 60000,
    streamIdleMs: 120000,
    totalMs: 600000,
  }),
  requestTimeoutMinSeconds: 10,
  requestTimeoutMaxSeconds: 1800,
})

export interface RequestTimeoutSettings {
  requestFirstByteTimeout?: number | string
  requestFirstTokenTimeout?: number | string
  requestStreamIdleTimeout?: number | string
  requestTotalTimeout?: number | string
}

export interface RequestTimeouts {
  firstByteMs: number
  firstTokenMs: number
  streamIdleMs: number
  totalMs: number
}

/** Settings hold seconds; the guard needs clamped milliseconds. */
function clampTimeoutSeconds(value: number | string | undefined, fallbackSeconds: number): number {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallbackSeconds
  return Math.min(
    limits.requestTimeoutMaxSeconds,
    Math.max(limits.requestTimeoutMinSeconds, Math.round(number)),
  )
}

/** Missing/invalid fields fall back to defaults; everything clamps to [min, max]. */
export function resolveRequestTimeouts(settings: RequestTimeoutSettings = {}): RequestTimeouts {
  const defaults = limits.requestTimeout
  const firstByteSeconds = clampTimeoutSeconds(settings.requestFirstByteTimeout, defaults.firstByteMs / 1000)
  const firstTokenSeconds = clampTimeoutSeconds(settings.requestFirstTokenTimeout, defaults.firstTokenMs / 1000)
  const streamIdleSeconds = clampTimeoutSeconds(settings.requestStreamIdleTimeout, defaults.streamIdleMs / 1000)
  const totalSeconds = clampTimeoutSeconds(settings.requestTotalTimeout, defaults.totalMs / 1000)
  return {
    firstByteMs: firstByteSeconds * 1000,
    firstTokenMs: firstTokenSeconds * 1000,
    streamIdleMs: streamIdleSeconds * 1000,
    totalMs: totalSeconds * 1000,
  }
}

export class LruCache<K, V> {
  private readonly maximumSize: number
  private readonly values = new Map<K, V>()

  constructor(maximumSize: number) {
    this.maximumSize = Math.max(1, Number(maximumSize) || 1)
  }

  get size(): number {
    return this.values.size
  }

  has(key: K): boolean {
    return this.values.has(key)
  }

  get(key: K): V | undefined {
    if (!this.values.has(key)) return undefined
    const value = this.values.get(key)!
    this.values.delete(key)
    this.values.set(key, value)
    return value
  }

  set(key: K, value: V): this {
    if (this.values.has(key)) this.values.delete(key)
    this.values.set(key, value)
    while (this.values.size > this.maximumSize) {
      this.values.delete(this.values.keys().next().value!)
    }
    return this
  }

  clear(): void {
    this.values.clear()
  }
}

export interface ChatWindow {
  start: number
  end: number
  limit: number
}

/** Never mounts more than chatMaximum messages of a history. */
export function getChatWindow(total: number, requestedStart: number, requestedLimit: number): ChatWindow {
  const safeTotal = Math.max(0, Math.trunc(Number(total) || 0))
  const safeLimit = Math.min(
    safeTotal,
    limits.chatMaximum,
    Math.max(0, Math.trunc(Number(requestedLimit) || 0)),
  )
  const maximumStart = Math.max(0, safeTotal - safeLimit)
  const start = Math.min(maximumStart, Math.max(0, Math.trunc(Number(requestedStart) || 0)))
  return { start, end: Math.min(safeTotal, start + safeLimit), limit: safeLimit }
}
