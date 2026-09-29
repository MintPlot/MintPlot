/**
 * Transient runtime bus (ADR-001 §4.4) — not persisted, not replayable;
 * lifecycle and UI awareness only. Typed subscriptions; handler errors are
 * isolated (a throwing listener never takes down the emitter).
 */

import type { Disposer, TransientEventMap, TransientEventType } from '@contracts'

export interface TransientBus {
  on<K extends TransientEventType>(type: K, handler: (event: TransientEventMap[K]) => void): Disposer
  emit<K extends TransientEventType>(type: K, event: TransientEventMap[K]): void
}

type AnyHandler = (event: never) => void

export function createTransientBus(): TransientBus {
  const handlers = new Map<TransientEventType, Set<AnyHandler>>()

  return {
    on(type, handler) {
      let set = handlers.get(type)
      if (!set) {
        set = new Set()
        handlers.set(type, set)
      }
      set.add(handler as AnyHandler)
      return () => {
        set.delete(handler as AnyHandler)
      }
    },
    emit(type, event) {
      const set = handlers.get(type)
      if (!set) return
      for (const handler of [...set]) {
        try {
          ;(handler as (e: unknown) => void)(event)
        } catch (error) {
          console.error(`[transient-bus] handler for "${type}" threw; isolated:`, error)
        }
      }
    },
  }
}
