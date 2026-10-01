/**
 * MPRequestDiagnostics producer (M3-err1) — the long-reserved global seam
 * finally gets its backing store: the error hub. Existing consumers
 * (update-checker, tts) coded against `window.MPRequestDiagnostics.begin()`
 * with a no-op fallback; installing this module activates them unchanged
 * (plan §7.2). Entries arrive as small scalar objects (lengths only, never
 * payloads — consumers self-police; the seam clamps anyway, defense in
 * depth). The RP legacy `start()` compat path is deliberately not ported.
 */

import type { DiagnosticRecord, DiagSeverity, ErrorHub } from '@/kernel/diagnostics/error-hub'
import { errorHub } from '@/kernel/diagnostics/error-hub'

export interface JournalEntrySpec {
  category: string
  action: string
  scope?: string
  severity?: DiagSeverity
  pluginId?: string
}

export interface JournalRecord {
  input: (entry: Record<string, unknown>) => void
  behavior: (entry: Record<string, unknown>) => void
  output: (entry: Record<string, unknown>) => void
  complete: () => void
  fail: (error: unknown, hints?: { code?: string }) => void
}

export interface MpRequestDiagnostics {
  begin(args: JournalEntrySpec): JournalRecord
  setRecordMeta(record: JournalRecord, meta: { pluginId?: string; context?: Record<string, unknown> }): void
  getAll(): readonly DiagnosticRecord[]
  getLatest(): DiagnosticRecord | undefined
  clear(): void
  /** ≤10-line paste-able summary (diagnostics page + manual reports). */
  buildShortSummary(): string
  /** Full machine-readable export (diagnostics page, manual file download). */
  buildExportPayload(): DiagnosticJournalExport
  /** Monotonic change counter — reactive bridge for UI surfaces. */
  getRevision(): number
}

/** Manual-export envelope (slice 2) — user-initiated only, nothing auto-leaves. */
export interface DiagnosticJournalExport {
  schema: 'mp-error-journal/1'
  exportedAt: number
  count: number
  summary: string
  records: DiagnosticRecord[]
}

const ENTRY_MAX_LENGTH = 200
const ENTRIES_MAX_COUNT = 8
const SUMMARY_MAX_LINES = 10

function formatEntry(entry: Record<string, unknown>): string {
  const parts: string[] = []
  for (const key of Object.keys(entry).slice(0, 6)) {
    const value = entry[key]
    if (value === undefined || value === null) continue
    parts.push(`${key}=${String(value).slice(0, 60)}`)
  }
  return parts.join(' ').slice(0, ENTRY_MAX_LENGTH)
}

function formatClock(ts: number): string {
  const date = new Date(ts)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

interface HandleTarget {
  record: DiagnosticRecord | null
  entries: string[]
}

/** Entries collected through the handle land on the record when the journal
 *  closes (complete/fail) — begin-time dedup may have dropped the record,
 *  in which case the entries are silently dropped with it. */
function attachEntries(target: HandleTarget): void {
  if (!target.record || target.entries.length === 0) return
  ;(target.record as { entries?: string[] }).entries = [...target.entries]
}

export function createRequestDiagnostics(hub: ErrorHub = errorHub): MpRequestDiagnostics {
  const targetByHandle = new WeakMap<JournalRecord, HandleTarget>()
  let revision = 0
  hub.onChange(() => {
    revision += 1
  })

  return {
    begin(args) {
      const target: HandleTarget = {
        record: hub.record({
          severity: args.severity ?? 'info',
          category: args.category,
          action: args.action,
          message: `${args.category}/${args.action}`,
          pluginId: args.pluginId,
          ...(args.scope ? { context: { scope: args.scope } } : {}),
        }),
        entries: [],
      }
      const append = (entry: Record<string, unknown>): void => {
        try {
          if (target.entries.length >= ENTRIES_MAX_COUNT) return
          target.entries.push(formatEntry(entry ?? {}))
        } catch {
          // Malformed entries never break the caller's flow.
        }
      }
      const handle: JournalRecord = {
        input: append,
        behavior: append,
        output: append,
        complete: () => {
          attachEntries(target)
        },
        fail: (error, hints) => {
          const record = target.record
          if (record) {
            const message = error instanceof Error ? error.message || error.name : String(error ?? 'unknown error')
            // Same object identity the ring holds — mutate in place.
            ;(record as { severity: DiagSeverity }).severity = 'error'
            ;(record as { message: string }).message = message.slice(0, 200)
            if (hints?.code) (record as { code?: string }).code = hints.code
            else if (typeof (error as { code?: unknown })?.code === 'string') {
              ;(record as { code?: string }).code = (error as { code: string }).code
            }
          }
          attachEntries(target)
        },
      }
      targetByHandle.set(handle, target)
      return handle
    },
    setRecordMeta(record, meta) {
      const target = targetByHandle.get(record)
      if (!target?.record) return
      const mutable = target.record as { pluginId?: string; context?: Record<string, string | number | boolean> }
      if (meta.pluginId) mutable.pluginId = meta.pluginId.slice(0, 60)
      if (meta.context) {
        for (const key of Object.keys(meta.context).slice(0, 8)) {
          const value = meta.context[key]
          if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
            mutable.context = { ...(mutable.context ?? {}), [key]: value }
          }
        }
      }
    },
    getAll() {
      return hub.all().map((record) => ({ ...record }))
    },
    getLatest() {
      const all = hub.all()
      const latest = all[all.length - 1]
      return latest ? { ...latest } : undefined
    },
    clear() {
      hub.clear()
    },
    buildShortSummary() {
      const all = hub.all()
      const lines = [`MP 诊断摘要 · ${all.length} 条记录`]
      for (const record of all.slice(-(SUMMARY_MAX_LINES - 1)).reverse()) {
        lines.push(
          `${formatClock(record.ts)} [${record.severity}] ${record.code ?? '--'} ${record.category}/${record.action} — ${record.message}`,
        )
      }
      return lines.join('\n')
    },
    buildExportPayload(): DiagnosticJournalExport {
      const all = hub.all()
      return {
        schema: 'mp-error-journal/1',
        exportedAt: Date.now(),
        count: all.length,
        summary: this.buildShortSummary(),
        records: all.map((record) => ({ ...record })),
      }
    },
    getRevision() {
      return revision
    },
  }
}

declare global {
  interface Window {
    MPRequestDiagnostics?: MpRequestDiagnostics
  }
}

/** Installs the producer on window (idempotent — one seam, one store). */
export function installRequestDiagnostics(hub: ErrorHub = errorHub): MpRequestDiagnostics {
  if (!window.MPRequestDiagnostics) {
    window.MPRequestDiagnostics = createRequestDiagnostics(hub)
  }
  return window.MPRequestDiagnostics
}
