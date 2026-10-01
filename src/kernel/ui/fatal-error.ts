/**
 * Fatal error dialog state (M3-err1, D11 graded-popups) — the kernel-side
 * presenter the error hub calls for fatal-severity records (data-endangering
 * failures, e.g. storage degrade). One in-app modal, session-once per error
 * code: a flapping backend must not trap the user in a dialog loop.
 */

import { ref } from 'vue'
import type { DiagnosticRecord } from '@/kernel/diagnostics/error-hub'

const current = ref<DiagnosticRecord | null>(null)
const shownCodes = new Set<string>()

/** Hub-side fatal hook; dedupes per code, latest record wins while visible. */
export function showFatalError(record: DiagnosticRecord): void {
  if (record.code) {
    if (shownCodes.has(record.code)) return
    shownCodes.add(record.code)
  }
  current.value = record
}

export function dismissFatalError(): void {
  current.value = null
}

/** Projection for the host component (App.vue). */
export function useFatalError() {
  return current
}
