/**
 * Disposer bag (R-04) — the executable form of "all registrations are
 * reversible, last-in-first-out, full revocation". The M2 runtime drains one
 * bag per plugin context on deactivate; contracts ship the implementation so
 * the runtime and the contract tests exercise the exact same semantics.
 *
 * Semantics:
 *  - run order is LIFO (most recently registered disposer first);
 *  - every disposer runs even if earlier ones throw — errors are collected
 *    and rethrown together after the full pass (full revocation);
 *  - async disposers are awaited before the next one starts.
 */

import type { Disposer } from './lifecycle'

export interface DisposerBag {
  add(fn: Disposer): void
  /** Drain LIFO; rethrows an AggregateError after every disposer has run. */
  run(): Promise<void>
  /** Pending disposer count. */
  readonly size: number
}

export function createDisposerBag(): DisposerBag {
  const stack: Disposer[] = []

  return {
    add(fn: Disposer): void {
      stack.push(fn)
    },

    async run(): Promise<void> {
      const errors: unknown[] = []
      while (stack.length > 0) {
        const disposer = stack.pop()
        if (!disposer) continue
        try {
          await disposer()
        } catch (error) {
          errors.push(error)
        }
      }
      if (errors.length > 0) {
        throw new AggregateError(errors, `disposer bag: ${errors.length} disposer(s) failed during revocation`)
      }
    },

    get size(): number {
      return stack.length
    },
  }
}
