/**
 * Plugin lifecycle (ADR-001 §03, R-04) — the semantics half of the contract
 * trio.
 *
 *  load        module import + manifest validation + static permission check;
 *              no business logic, no kernel state touched.
 *  activate    the only registration window: hooks, views, settings, seam
 *              providers, event subscriptions — everything through the
 *              PluginContext. Idempotent, fail-safe: a throw means activation
 *              failed and every registration already performed is rolled back.
 *  deactivate  all disposers accumulated in the ctx run last-in-first-out:
 *              unhook, revoke views, disconnect listeners, stop timers, close
 *              engine side effects. Full revocation despite individual errors.
 *  unload      no runtime loader before external-plugin support (R6): code is
 *              resident in the bundle, so unload ≡ deactivate. Real unloading
 *              (module reference release) is defined when external loading
 *              arrives.
 *
 * Error isolation: exceptions thrown by a plugin are intercepted by the
 * runtime and never take down the kernel or other plugins; repeated errors or
 * quota exhaustion mark the plugin degraded and strip its registrations
 * (broadcast via `plugin.state.changed`).
 */

import type { PluginManifest } from './manifest'
import type { PluginContext } from './plugin-context'

/** Sequential phases; load/activate/deactivate are ordered by the runtime. */
export type LifecyclePhase = 'load' | 'activate' | 'deactivate' | 'unload'

/** Runtime states broadcast on the transient bus (`plugin.state.changed`). */
export type PluginRuntimeState = 'registered' | 'active' | 'degraded'

export type MaybePromise<T> = T | Promise<T>

/**
 * What a plugin entry module exports: its manifest plus lifecycle hooks.
 * `activate` is the single registration window; `deactivate` is optional only
 * in the sense that a plugin with no registrations has nothing to revoke.
 */
export interface PluginDefinition {
  readonly manifest: PluginManifest
  activate(ctx: PluginContext): MaybePromise<void>
  deactivate?(): MaybePromise<void>
}

/**
 * LIFO disposer accumulator handed to every plugin context (R-04: "all
 * registrations are reversible"). The runtime drains it on deactivate, last
 * registered first, running every disposer even when some throw.
 */
export type Disposer = () => MaybePromise<void>
