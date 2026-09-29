/**
 * PluginContext (ADR-001 §03, R-05) — the single entry point between a plugin
 * and the kernel. Every registration goes through ctx and is automatically
 * reversible (the ctx accumulates disposers, drained LIFO on deactivate).
 * Kernel state is exposed read-only: getters and readonly projections, never
 * bare reactive objects.
 *
 * Permission mapping (default deny-all, R-11): surfaces marked implicit need
 * no declaration; everything else requires the permission listed with it, and
 * the runtime rejects undeclared use with a thrown, diagnosed error.
 *
 * This file is types only — the issuing runtime lands with the M2 kernel.
 */

import type { Component } from 'vue'
import type { SessionKind } from './session-kind'
import type { PipelinePoint, SessionEvent, SessionEventType, TransientEventMap, TransientEventType } from './extension-points'
import type { Disposer, MaybePromise } from './lifecycle'

/** Registration specs — the plugin-facing shapes the M0-d shell registry converges to in M2. */

/** A view registered into the shell (tool-tab aggregate or home-level view). */
export interface ViewSpec {
  /** Unique within the plugin; namespaced by the runtime as `<pluginId>:<id>`. */
  id: string
  title: string
  /** Linear white-line icon language (stroke currentColor), MintCat family. */
  icon?: Component
  component: Component
}

/** A section registered into the kernel settings page. */
export interface SettingsSectionSpec {
  id: string
  title: string
  component: Component
}

/**
 * Reserved (variables plugin, review v1.0): a section registered into the
 * chat-page character panel — the "card panel slot" surface. Card-domain by
 * construction; no session-kind option.
 */
export interface CardPanelSectionSpec {
  id: string
  title: string
  component: Component
  /** Sort key within the panel, ascending; ties break by registration order. */
  order?: number
}

/**
 * An action registered into the input dock. The `[+]` action panel itself is
 * reserved in the v1 UI (spec v1.2 §02) — the contract surface exists now so
 * plugins can already declare and the M2 runtime can already gate it.
 */
export interface InputActionSpec {
  id: string
  title: string
  icon?: Component
  /** Restrict to session kinds; omitted = available in both domains. */
  sessions?: readonly SessionKind[]
  /** Draft shape — composer interaction context lands with the M2 runtime. */
  handler: () => MaybePromise<void>
}

/** Waterfall hook: transform `payload`, delegate via `next`, or short-circuit by not calling it. */
export type HookHandler<P, R> = (payload: P, next: (value: P) => R) => R

export interface HookOptions {
  /** Within a segment: higher first, then registration order (R-08). */
  priority?: number
  /** Restrict to session kinds; omitted = subscribes in both domains. */
  sessions?: readonly SessionKind[]
}

/**
 * Draft payload note: per-point payload typing arrives with the kernel
 * pipeline (M2). Until then the handler is generically typed; pre-freeze the
 * surface may still break (ADR-001 §12).
 */
export interface HookRegistration {
  registerHook<P, R>(
    point: PipelinePoint,
    handler: HookHandler<P, R>,
    options?: HookOptions,
  ): Disposer
}

export interface SessionEventFilter {
  types?: readonly SessionEventType[]
  sessions?: readonly SessionKind[]
  /** Narrow to specific sessions; omitted = all sessions of the given kinds. */
  sessionIds?: readonly string[]
}

export interface SessionEventApi {
  /** Emit a persisted fact. The runtime stamps id/ts/pluginId; no in-place history rewrites, ever. */
  emitSessionEvent(event: SessionEventInput): MaybePromise<void>
  /** Subscribe to the read-only ledger projection. Revoked on deactivate; persisted facts are not. */
  onSessionEvent(filter: SessionEventFilter, handler: (event: SessionEvent) => void): Disposer
}

/** What a plugin supplies; the runtime completes id/ts/pluginId attribution. */
export type SessionEventInput = DistributiveOmit<SessionEvent, 'id' | 'ts' | 'pluginId'>

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

/** Namespaced KV over the plugin's `plug:<id>:` prefix — enforced by the runtime. */
export interface PluginStorage {
  get<T>(key: string): Promise<T | null>
  set(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<void>
  keys(): Promise<string[]>
}

/**
 * Controlled secret loan (R-11 step one). The plaintext enters only the
 * callback scope: single-shot, transient, never persisted, masked in
 * diagnostics and error messages. Collapses into a kernel proxy
 * (`ctx.vault.fetch`) when external plugins arrive (R6) — no transition period.
 */
export interface PluginSecrets {
  use<T>(key: string, fn: (secret: string) => MaybePromise<T>): Promise<T>
}

/** Transient runtime bus — kernel-emitted lifecycle signals, auto-unsubscribed. */
export interface PluginTransientBus {
  on<K extends TransientEventType>(
    type: K,
    handler: (event: TransientEventMap[K]) => void,
  ): Disposer
}

export interface ToastOptions {
  durationMs?: number
  /** Visual tone; hosts map it to their toast styling (ADR-004: absorbed). */
  tone?: 'info' | 'success' | 'error'
}

export interface ConfirmOptions {
  title: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string
}

/** Global progress affordance; pending dialogs are force-closed on deactivate. */
export interface ProgressHandle {
  close(): void
}

/** Shared UI affordances (kernel base components, design tokens). */
export interface PluginUi {
  toast(message: string, options?: ToastOptions): void
  confirm(options: ConfirmOptions): Promise<boolean>
  progress(): ProgressHandle
}

/**
 * Read-only platform projection (M2): which runtime kind the app is on and
 * the app identity values (M0-b three parameters). Auto-granted — version
 * metadata is benign; no device capability gating before a real need lands.
 */
export interface AppPlatformInfo {
  platform: 'android' | 'ios' | 'web'
  versionName: string
  buildType: 'dev' | 'release'
}

export interface PluginPlatform {
  readonly kind: 'native' | 'web'
  getAppInfo(): Promise<AppPlatformInfo>
}

/**
 * Host settings projection (ADR-004, absorbed from the RP frozen surface):
 * a reactive, writable record limited to the keys the plugin declared in its
 * manifest (`extensionPoints.settingsScope`). Reading or writing an
 * undeclared key is rejected by the runtime (default deny-all discipline).
 * Values persist in the host settings store; secret-shaped fields are
 * extracted to the secret channel by the storage layer, never by plugins.
 */
export interface PluginSettingsScope {
  scope(keys: readonly string[]): Record<string, unknown>
}

/**
 * Read-only session projection (ADR-004, minimal absorption): what TTS-style
 * consumers need about the current session. Card-domain values ('' / null on
 * chatbox); the host's real card-domain implementation lands with the
 * card-workshop port — until then the host ships stubs.
 */
export interface SessionMessageRef {
  readonly id: string
  readonly content: string
}

export interface PluginSession {
  getCharacterName(): string
  getCharacterVoice(): string
  getMessageAt(index: number): SessionMessageRef | null
}

/** A resolved seam provider as consumers see it. */
export interface SeamResolveResult<T = unknown> {
  /** Registered provider id ('system' / 'cloud' / …; plugin-chosen). */
  readonly providerId: string
  /** Plugin id that registered this provider (attribution). */
  readonly pluginId: string
  readonly implementation: T
}

/**
 * Seam consumer surface (ADR-004, absorbed): resolve by provider id or get
 * the latest registered provider; list the registered provider ids. Implicit
 * (auto-granted) — providing is permission-gated, consuming is not.
 */
export interface PluginSeams {
  resolve<T = unknown>(seamId: string, providerId?: string): SeamResolveResult<T> | null
  listProviders(seamId: string): readonly string[]
}

/**
 * Read-only diagnostics projection for the owning plugin (request journal
 * excerpts, hook invocations, quota state). Shape is draft until the M2
 * runtime defines the journal surface; `pluginId` is the one stable anchor.
 */
export interface PluginDiagnostics {
  readonly pluginId: string
}

/**
 * The v1 PluginContext surface (ADR-001 §03 table). Registration surfaces:
 * view / settings section / input action / card panel section (reserved) /
 * seam provider / hook / session events; implicit: storage, secrets scope
 * check, transient bus, ui, diagnostics.
 */
export interface PluginContext extends HookRegistration, SessionEventApi {
  /** The activated plugin's manifest id (storage prefix, audit attribution). */
  readonly pluginId: string

  registerView(spec: ViewSpec): Disposer
  registerSettingsSection(spec: SettingsSectionSpec): Disposer
  /** Permission: input.action. */
  registerInputAction(spec: InputActionSpec): Disposer
  /** Reserved (variables plugin). Permission: card.panel.section. */
  registerCardPanelSection(spec: CardPanelSectionSpec): Disposer
  /** Permission: seam.provide.<seamId>. Optional provider id distinguishes
   *  multiple providers of one seam ('system' / 'cloud' / …). Removal falls
   *  consumers back to the default implementation. */
  registerSeamProvider(seamId: string, implementation: unknown, providerId?: string): Disposer

  /** Implicit (no declaration); data survives deactivation, user-clearable. */
  readonly storage: PluginStorage
  /** Whitelist projection over host settings (keys must be declared in the
   *  manifest's extensionPoints.settingsScope). */
  readonly settings: PluginSettingsScope
  /** Read-only session projection (card-domain values; stubs on chatbox). */
  readonly session: PluginSession
  /** Seam consumer surface (resolve / listProviders). */
  readonly seams: PluginSeams
  /** Permission: secrets.read.<key> per loan. */
  readonly secrets: PluginSecrets
  /** Auto-granted: app identity + runtime-kind projection (M2). */
  readonly platform: PluginPlatform
  readonly on: PluginTransientBus['on']
  readonly ui: PluginUi
  readonly diag: PluginDiagnostics

  /** Register a disposer to run on deactivate (LIFO with auto-collected ones). */
  onDeactivate(fn: Disposer): void
}
