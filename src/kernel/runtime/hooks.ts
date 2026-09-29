/**
 * Pipeline hook registry (ADR-001 §4.2, R-08) — the registration half of the
 * realtime domain. Waterfall invocation lands with the M2/M3 pipeline; the
 * registry already fixes the within-segment order (priority descending, then
 * registration order) and keeps hooks revocable.
 */

import type { Disposer, HookHandler, HookOptions, PipelinePoint, SessionKind } from '@contracts'

export interface HookRecord<P = unknown, R = unknown> {
  readonly point: PipelinePoint
  readonly pluginId: string
  readonly handler: HookHandler<P, R>
  readonly priority: number
  readonly sessions: readonly SessionKind[] | undefined
  /** Registration sequence — the tie-breaker after priority (R-08). */
  readonly order: number
}

export interface HookRegistry {
  register<P, R>(
    pluginId: string,
    point: PipelinePoint,
    handler: HookHandler<P, R>,
    options?: HookOptions,
  ): Disposer
  hooksAt(point: PipelinePoint): readonly HookRecord[]
}

export function createHookRegistry(): HookRegistry {
  const byPoint = new Map<PipelinePoint, HookRecord[]>()
  let sequence = 0

  return {
    register(pluginId, point, handler, options) {
      const record: HookRecord = {
        point,
        pluginId,
        handler: handler as HookHandler<unknown, unknown>,
        priority: options?.priority ?? 0,
        sessions: options?.sessions,
        order: (sequence += 1),
      }
      let list = byPoint.get(point)
      if (!list) {
        list = []
        byPoint.set(point, list)
      }
      list.push(record)
      return () => {
        const remaining = byPoint.get(point)
        if (!remaining) return
        const index = remaining.indexOf(record)
        if (index >= 0) remaining.splice(index, 1)
      }
    },
    hooksAt(point) {
      const list = byPoint.get(point) ?? []
      return [...list].sort((a, b) => b.priority - a.priority || a.order - b.order)
    },
  }
}
