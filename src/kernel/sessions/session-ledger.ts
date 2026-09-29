/**
 * Session-event ledger (M2 minimal skeleton) — domain A (R-07): append-only
 * facts, attributable, kind-scoped. The walking skeleton runs in memory;
 * persistence moves behind the storage engine with the M3 session work, and
 * the append-only + attribution semantics below are already contract-faithful.
 */

import type { Disposer, SessionEvent, SessionEventFilter } from '@contracts'

export interface SessionLedger {
  append(event: SessionEvent): void
  subscribe(filter: SessionEventFilter, handler: (event: SessionEvent) => void): Disposer
  /** Read projection for diagnostics — the ledger is never rewritten in place. */
  all(): readonly SessionEvent[]
}

function matches(event: SessionEvent, filter: SessionEventFilter): boolean {
  if (filter.types && !filter.types.includes(event.kind)) return false
  if (filter.sessions && !filter.sessions.includes(event.sessionKind)) return false
  if (filter.sessionIds && !filter.sessionIds.includes(event.sessionId)) return false
  return true
}

interface Subscription {
  filter: SessionEventFilter
  handler: (event: SessionEvent) => void
}

export function createSessionLedger(): SessionLedger {
  const events: SessionEvent[] = []
  const subscriptions = new Set<Subscription>()

  return {
    append(event) {
      // append-only: entries are never mutated or removed (R-07)
      events.push(event)
      for (const subscription of subscriptions) {
        if (!matches(event, subscription.filter)) continue
        try {
          subscription.handler(event)
        } catch (error) {
          console.error('[session-ledger] subscriber threw; isolation kept:', error)
        }
      }
    },
    subscribe(filter, handler) {
      const subscription: Subscription = { filter, handler }
      subscriptions.add(subscription)
      return () => {
        subscriptions.delete(subscription)
      }
    },
    all() {
      return [...events]
    },
  }
}
