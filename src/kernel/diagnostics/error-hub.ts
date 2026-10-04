/**
 * Error hub (M3-err1) — the single diagnostic ring every failure flows into:
 * capture nets, kernel wiring points, the toast mirror and the
 * MPRequestDiagnostics seam all record here. One container, four severities,
 * dedup + storm caps, bounded persistence (plan §6-7).
 *
 * Privacy red line (D2): error messages are kept as ≤200-char plaintext
 * summaries; conversation content and request payloads never enter the
 * journal — red-line payloads may only carry length + fingerprint (detail).
 * Everything stays on-device; export is manual (slice 2).
 *
 * The module singleton keeps the hub reachable from deep kernel wiring
 * (engine degrade, bus isolation) without plumbing it through every
 * constructor; persistence is injected at the composition root so this
 * module never imports the store stack (and a store degrade can therefore
 * never re-enter the hub synchronously).
 */

import { showFatalError } from '@/kernel/ui/fatal-error'

export type DiagSeverity = 'info' | 'warn' | 'error' | 'fatal'

export interface DiagnosticRecord {
  readonly id: string
  readonly ts: number
  readonly severity: DiagSeverity
  readonly category: string
  readonly action: string
  /** ≤200-char plaintext summary — never conversation content. */
  readonly message: string
  /** Unified error code (`MP-<DOMAIN>-<NNN>`); unknown codes tolerated. */
  readonly code?: string
  readonly pluginId?: string
  /** Small scalars only (httpStatus, model, domain…). */
  readonly context?: Record<string, string | number | boolean>
  /** Journal handle entries (clamped, capped) from the request-diagnostics seam. */
  readonly entries?: string[]
  /** Red-line payload: length + fingerprint only, never content. */
  readonly detail?: { length: number; hash: string }
}

export interface ErrorHubEntry {
  readonly severity?: DiagSeverity
  readonly category: string
  readonly action: string
  readonly message: string
  readonly code?: string
  readonly pluginId?: string
  readonly context?: Record<string, unknown>
  readonly entries?: readonly string[]
  readonly detail?: { length: number; hash: string }
}

export type Unsubscribe = () => void

export interface ErrorHub {
  /** Records one entry; returns the record, or null when deduped/suppressed. */
  record(entry: ErrorHubEntry): DiagnosticRecord | null
  all(): readonly DiagnosticRecord[]
  clear(): void
  /** Change notification for UI projections (diagnostics page, slice 2). */
  onChange(handler: () => void): Unsubscribe
  /** Persist immediately (app.pause / tests). */
  flush(): Promise<void>
  /** Replays the persisted ring (composition root, once before mount). */
  hydrate(): Promise<void>
  /** (Re)binds persistence after engine assembly. */
  attachPersistence(persistence: ErrorHubPersistence): void
}

export interface ErrorHubPersistence {
  load(): Promise<unknown>
  save(records: readonly DiagnosticRecord[]): Promise<void>
}

export interface ErrorHubOptions {
  /** Bounded ring size (default 100). */
  readonly capacity?: number
  /** fatal-severity hook (D11 modal). Defaults to the kernel fatal dialog. */
  readonly onFatal?: (record: DiagnosticRecord) => void
  /** Injected at the composition root; absent → memory-only (tests). */
  readonly persistence?: ErrorHubPersistence
}

const MESSAGE_MAX_LENGTH = 200
const CONTEXT_MAX_KEYS = 8
const ENTRIES_MAX_COUNT = 8
const DEDUP_WINDOW_MS = 2000
const STORM_CAP_PER_KEY = 8
const PERSIST_DEBOUNCE_MS = 500
const DEFAULT_CAPACITY = 100

/** Sync 32-bit FNV-1a — correlation fingerprint, not cryptography (plan §6.2). */
export function fingerprint(text: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function clampText(value: unknown, maxLength = MESSAGE_MAX_LENGTH): string {
  return String(value ?? '').slice(0, maxLength)
}

/** Context accepts scalars only; everything else (objects/arrays/undefined) is dropped. */
function clampContext(context: Record<string, unknown> | undefined): Record<string, string | number | boolean> | undefined {
  if (!context) return undefined
  const result: Record<string, string | number | boolean> = {}
  for (const key of Object.keys(context).slice(0, CONTEXT_MAX_KEYS)) {
    const value = context[key]
    if (typeof value === 'string') result[key] = value.slice(0, MESSAGE_MAX_LENGTH)
    else if (typeof value === 'number' && Number.isFinite(value)) result[key] = value
    else if (typeof value === 'boolean') result[key] = value
  }
  return Object.keys(result).length > 0 ? result : undefined
}

function clampEntries(entries: readonly string[] | undefined): string[] | undefined {
  if (!entries || entries.length === 0) return undefined
  const clamped = entries.slice(0, ENTRIES_MAX_COUNT).map((entry) => clampText(entry))
  return clamped.length > 0 ? clamped : undefined
}

/** Non-Error throwables degrade to a length+fingerprint marker (RP lesson). */
function describeThrowable(error: unknown): { message: string; detail?: DiagnosticRecord['detail'] } {
  if (error instanceof Error) return { message: error.message || error.name }
  if (typeof error === 'string') return { message: error }
  if (error === undefined || error === null) return { message: String(error) }
  let serialized: string
  try {
    serialized = JSON.stringify(error) ?? ''
  } catch {
    serialized = ''
  }
  if (!serialized) return { message: `<omitted:${typeof error}>` }
  return { message: `<omitted:${serialized.length};${fingerprint(serialized)}>`, detail: { length: serialized.length, hash: fingerprint(serialized) } }
}

export function createErrorHub(options: ErrorHubOptions = {}): ErrorHub {
  const capacity = Math.max(1, options.capacity ?? DEFAULT_CAPACITY)
  const onFatal = options.onFatal ?? showFatalError
  const records: DiagnosticRecord[] = []
  const changeHandlers = new Set<() => void>()
  const dedupKeys = new Map<string, number>()
  const stormCounts = new Map<string, number>()
  const collapsedKeys = new Set<string>()
  const fatalShownCodes = new Set<string>()
  let sequence = 0
  let persistTimer: ReturnType<typeof setTimeout> | undefined
  let persistence = options.persistence

  const notify = (): void => {
    for (const handler of [...changeHandlers]) handler()
  }

  const persist = async (flush = false): Promise<void> => {
    if (!persistence) return
    if (!flush) {
      // Debounced write; the timer restarts on every record burst.
      if (persistTimer !== undefined) clearTimeout(persistTimer)
      persistTimer = setTimeout(() => void persist(true), PERSIST_DEBOUNCE_MS)
      return
    }
    if (persistTimer !== undefined) {
      clearTimeout(persistTimer)
      persistTimer = undefined
    }
    try {
      // Snapshot: the save path must never observe mid-mutation ring state.
      await persistence.save([...records])
    } catch (error) {
      // Never record persistence failures through the hub itself — the loop
      // guard is structural: this is the one failure that stays console-only.
      console.error('[error-hub] journal persistence failed:', error)
    }
  }

  /** Degrade-guarded records re-entering the hub (load-time sanitization). */
  const sanitize = (value: unknown): DiagnosticRecord | null => {
    if (!value || typeof value !== 'object') return null
    const raw = value as Partial<DiagnosticRecord>
    if (typeof raw.category !== 'string' || typeof raw.action !== 'string') return null
    return {
      id: typeof raw.id === 'string' ? raw.id : `r-${(++sequence).toString(36)}`,
      ts: typeof raw.ts === 'number' && Number.isFinite(raw.ts) ? raw.ts : Date.now(),
      severity: raw.severity === 'fatal' || raw.severity === 'error' || raw.severity === 'warn' ? raw.severity : 'info',
      category: clampText(raw.category, 40),
      action: clampText(raw.action, 60),
      message: clampText(raw.message),
      ...(typeof raw.code === 'string' ? { code: clampText(raw.code, 24) } : {}),
      ...(typeof raw.pluginId === 'string' ? { pluginId: clampText(raw.pluginId, 60) } : {}),
      ...(clampContext(raw.context) ? { context: clampContext(raw.context) } : {}),
      ...(clampEntries(raw.entries) ? { entries: clampEntries(raw.entries) } : {}),
      ...(raw.detail && typeof raw.detail === 'object' && typeof (raw.detail as DiagnosticRecord['detail'])?.hash === 'string'
        ? { detail: raw.detail as NonNullable<DiagnosticRecord['detail']> }
        : {}),
    }
  }

  const hub: ErrorHub = {
    record(entry) {
      try {
        const described = describeThrowable(entry.message)
        const code = typeof entry.code === 'string' && entry.code ? clampText(entry.code, 24) : undefined
        const key = `${entry.category}|${entry.action}|${code ?? ''}|${fingerprint(described.message)}`
        const now = Date.now()

        // Dedup: same key inside the window collapses into the first record.
        const lastSeen = dedupKeys.get(key)
        if (lastSeen !== undefined && now - lastSeen < DEDUP_WINDOW_MS) {
          dedupKeys.set(key, now)
          return null
        }
        dedupKeys.set(key, now)

        // Storm cap: after N records of one key, log the fold once, then hush.
        const stormCount = (stormCounts.get(key) ?? 0) + 1
        stormCounts.set(key, stormCount)
        if (stormCount > STORM_CAP_PER_KEY) {
          if (!collapsedKeys.has(key)) {
            collapsedKeys.add(key)
            const folded: DiagnosticRecord = {
              id: `r-${(++sequence).toString(36)}`,
              ts: now,
              severity: 'info',
              category: entry.category,
              action: entry.action,
              message: `…同类错误已折叠(后续静默): ${described.message.slice(0, 80)}`,
              ...(code ? { code } : {}),
            }
            records.push(folded)
            if (records.length > capacity) records.splice(0, records.length - capacity)
            notify()
          }
          return null
        }

        const record: DiagnosticRecord = {
          id: `r-${(++sequence).toString(36)}`,
          ts: now,
          severity: entry.severity ?? 'info',
          category: clampText(entry.category, 40),
          action: clampText(entry.action, 60),
          message: clampText(described.message),
          ...(code ? { code } : {}),
          ...(entry.pluginId ? { pluginId: clampText(entry.pluginId, 60) } : {}),
          ...(clampContext(entry.context) ? { context: clampContext(entry.context) } : {}),
          ...(clampEntries(entry.entries) ? { entries: clampEntries(entry.entries) } : {}),
          ...(entry.detail || described.detail ? { detail: entry.detail ?? described.detail } : {}),
        }
        records.push(record)
        if (records.length > capacity) records.splice(0, records.length - capacity)

        if (record.severity === 'fatal' && (!record.code || !fatalShownCodes.has(record.code))) {
          if (record.code) fatalShownCodes.add(record.code)
          try {
            onFatal(record)
          } catch (error) {
            console.error('[error-hub] fatal handler threw:', error)
          }
        }

        void persist(false)
        notify()
        return record
      } catch (error) {
        // The hub is the last thing allowed to die — record() never throws.
        console.error('[error-hub] record() swallowed an internal error:', error)
        return null
      }
    },
    all() {
      return [...records]
    },
    clear() {
      records.length = 0
      dedupKeys.clear()
      stormCounts.clear()
      collapsedKeys.clear()
      void persist(true)
      notify()
    },
    onChange(handler) {
      changeHandlers.add(handler)
      return () => {
        changeHandlers.delete(handler)
      }
    },
    async flush() {
      await persist(true)
    },
    /** Hydrates the ring from injected persistence; called once at boot. */
    async hydrate() {
    if (!persistence) return
    try {
      const stored = await persistence.load()
      if (Array.isArray(stored)) {
        for (const item of stored.slice(-capacity)) {
          const record = sanitize(item)
          if (record) records.push(record)
        }
        notify()
      }
    } catch (error) {
      console.error('[error-hub] journal hydration failed:', error)
    }
  },
    /** Composition-root hook to (re)bind persistence after engine assembly. */
    attachPersistence(next: ErrorHubPersistence) {
      persistence = next
    },
  }

  return hub
}

/** The app-wide hub singleton (kernel wiring records through this instance). */
export const errorHub = createErrorHub()

/** Boots journal persistence at the composition root (main.ts). */
export function attachErrorHubPersistence(persistence: ErrorHubPersistence): void {
  errorHub.attachPersistence(persistence)
}

/** Replays the persisted journal (call once before mount). */
export function hydrateErrorHub(): Promise<void> {
  return errorHub.hydrate()
}
