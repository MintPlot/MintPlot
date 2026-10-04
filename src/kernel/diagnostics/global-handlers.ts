/**
 * Global capture nets (M3-err1) — the three platform nets every missed error
 * falls into, installed at the composition root before anything else can
 * throw: Vue's app-level handler, the capture-phase window error listener
 * (reaches resource failures too) and unhandledrejection. Plus the pre-boot
 * buffer replay: index.html collects errors before this module loads, and
 * the earliest failures still reach the journal (plan §7.1).
 */

import type { App } from 'vue'
import type { ErrorHub } from '@/kernel/diagnostics/error-hub'
import { errorHub } from '@/kernel/diagnostics/error-hub'

declare global {
  interface Window {
    /** index.html pre-boot buffer — replayed then cleared (≤10 clamped entries). */
    __mpEarlyErrors?: string[]
  }
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message || error.name
  return String(error ?? 'unknown')
}

/** Installs all nets on the hub singleton; idempotent per app instance. */
export function installGlobalErrorHandlers(app: App, hub: ErrorHub = errorHub): void {
  // Vue net: render/lifecycle errors from any component.
  app.config.errorHandler = (error, instance, info) => {
    console.error('[global-handlers] vue error:', error, info)
    hub.record({
      severity: 'error',
      category: 'runtime',
      action: 'vue_error',
      code: 'MP-RUN-001',
      message: messageOf(error),
      context: {
        component: instance?.$options?.name ?? instance?.$options?.__name ?? 'unknown',
        info: String(info ?? ''),
      },
    })
  }

  // Window net (capture phase): script errors carry event.error; resource
  // failures (img/script/link) carry only a target element.
  window.addEventListener(
    'error',
    (event) => {
      const target = event.target as (Partial<HTMLImageElement> & Partial<HTMLScriptElement>) | null
      const isResourceFailure = !event.error && event.target !== window && target !== null && typeof target.tagName === 'string'
      if (isResourceFailure) {
        hub.record({
          severity: 'warn',
          category: 'runtime',
          action: 'resource_error',
          code: 'MP-RUN-003',
          message: `资源加载失败: ${target?.tagName?.toLowerCase() ?? 'unknown'}`,
          context: { tag: String(target?.tagName ?? '').toLowerCase() },
        })
        return
      }
      console.error('[global-handlers] window error:', event.error ?? event.message)
      hub.record({
        severity: 'error',
        category: 'runtime',
        action: 'window_error',
        code: 'MP-RUN-002',
        message: messageOf(event.error) || String(event.message ?? 'window error'),
      })
    },
    true,
  )

  // Promise net: rejections nothing handled.
  window.addEventListener('unhandledrejection', (event) => {
    console.error('[global-handlers] unhandled rejection:', event.reason)
    hub.record({
      severity: 'error',
      category: 'runtime',
      action: 'unhandled_rejection',
      code: 'MP-RUN-004',
      message: messageOf(event.reason),
    })
  })
}

/** Replays the index.html pre-boot buffer into the journal, then clears it. */
export function replayEarlyErrors(hub: ErrorHub = errorHub): void {
  const buffered = window.__mpEarlyErrors
  if (!Array.isArray(buffered) || buffered.length === 0) return
  for (const message of buffered.slice(0, 10)) {
    hub.record({
      severity: 'error',
      category: 'runtime',
      action: 'boot_early_error',
      code: 'MP-RUN-005',
      message: String(message ?? 'early error'),
    })
  }
  delete window.__mpEarlyErrors
}
