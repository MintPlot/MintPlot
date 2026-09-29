/**
 * Extension point catalogs (ADR-001 §04, R-06..R-09) — the three domains plus
 * the transient runtime bus. These arrays are the single source of truth for
 * every point / event / seam id a manifest or a register* call may name; the
 * permission validator (permissions.ts) resolves pattern permissions against
 * them, and the build-time assembly scan (M2) cross-checks them.
 *
 * Variable system reservations (review v1.0): `variable.set` event,
 * `variable-expand` pipeline point and the card panel section registration
 * surface are pre-allocated here, marked reserved — implementation lands with
 * the variables plugin (M4 batch, native new-write). They must be finalized
 * before contract v1 freezes (R-15).
 */

import type { VariableSetEventPayload } from './variables'
import type { SessionKind } from './session-kind'

// ── Domain B · realtime pipeline hooks (R-08, waterfall semantics) ──────────
// Waterfall: a listener receives (payload, next); it may transform and call
// next(), or short-circuit by not calling next(). Short-circuits are recorded
// in the request log.

/**
 * Fixed segment order of prompt assembly — kernel-defined product semantics
 * (world info → memory → preset → CoT → regex). Plugins insert *within* a
 * segment (by priority, then registration order); reordering segments is an
 * ADR revision, not a plugin concern.
 */
export const PROMPT_SEGMENT_ORDER = [
  'prompt.worldinfo',
  'prompt.memory',
  'prompt.preset',
  'prompt.cot',
  'prompt.regex',
] as const

export type PromptSegmentPoint = (typeof PROMPT_SEGMENT_ORDER)[number]

/**
 * Every pipeline point a hook may subscribe to, in canonical execution order.
 *
 * `variable-expand` (reserved, variables plugin) runs before all prompt
 * segments — macro expansion over every text artifact must precede world-info
 * scanning for conditional keys to see expanded values.
 */
export const PIPELINE_POINTS = [
  'variable-expand',
  'input.transform',
  ...PROMPT_SEGMENT_ORDER,
  'response.transform',
  'chat.render',
] as const

export type PipelinePoint = (typeof PIPELINE_POINTS)[number]

// ── Domain A · persistent session events (R-07, append-only ledger) ─────────
// Persisted facts: reload-stable, replayable. Anything that "changes story
// history that already happened" must go through this domain — in-place
// rewriting of stored messages is forbidden. Current message content = raw
// ledger + deterministic replay of the projection chain.

export interface SessionEventBase {
  /** Ledger-assigned event id (monotonic within a session). */
  id: string
  /** Wall-clock timestamp at append time. */
  ts: number
  /** Emitting plugin id — every persisted fact is attributable (audit). */
  pluginId: string
  /** Session the fact belongs to — domain A ledgers are per-session (M2 envelope). */
  sessionId: string
  /** Domain of the session — kind-scoped subscription first-class (spec v1.2 §03). */
  sessionKind: SessionKind
}

export interface MessageAppendedEvent extends SessionEventBase {
  kind: 'message.appended'
  /** Floor number the message occupies after append. */
  floor: number
  role: 'user' | 'assistant' | 'system'
  content: string
}

/** A deletion fact — physical purge is a compression policy, never inline. */
export interface MessageDeletedEvent extends SessionEventBase {
  kind: 'message.deleted'
  messageId: string
}

/** Manual edit: the ledger stores original + revised; the original is never lost. */
export interface MessageEditedEvent extends SessionEventBase {
  kind: 'message.edited'
  messageId: string
  original: string
  revised: string
}

export interface SwipeSelectedEvent extends SessionEventBase {
  kind: 'swipe.selected'
  messageId: string
  swipeIndex: number
}

export interface BranchCreatedEvent extends SessionEventBase {
  kind: 'branch.created'
  branchId: string
  /** Ledger position the branch forks from. */
  fromEventId: string
}

/** Bookkeeping for projection definition changes (e.g. regex rules toggled). */
export interface ProjectionRegisteredEvent extends SessionEventBase {
  kind: 'projection.registered'
  projectionId: string
  operation: 'enabled' | 'modified' | 'disabled'
}

/** Reserved (variables plugin, review v1.0): variable state transition fact. */
export interface VariableSetEvent extends SessionEventBase, VariableSetEventPayload {
  kind: 'variable.set'
  /** Message the AI-side update was parsed from (manual updates omit it). */
  messageId?: string
  branchId?: string
}

export type SessionEvent =
  | MessageAppendedEvent
  | MessageDeletedEvent
  | MessageEditedEvent
  | SwipeSelectedEvent
  | BranchCreatedEvent
  | ProjectionRegisteredEvent
  | VariableSetEvent

export const SESSION_EVENT_TYPES = [
  'message.appended',
  'message.deleted',
  'message.edited',
  'swipe.selected',
  'branch.created',
  'projection.registered',
  'variable.set',
] as const

export type SessionEventType = (typeof SESSION_EVENT_TYPES)[number]

// ── Domain C · capability seams (R-09) ──────────────────────────────────────
// Three roles: Definition (kernel owns interface + default implementation),
// Provider (plugin registers an implementation), Consumer (resolves via the
// registry). Removing a provider falls consumers back to the default.
//
// Internal seams (`turn.driver`, `embedder`) are deliberately NOT part of the
// public contract v1 — kernel-internal replaceable points are not public
// promises (R-01/R-09).

export const PUBLIC_SEAM_IDS = ['llm.provider', 'tts.engine', 'image.gen'] as const

export type PublicSeamId = (typeof PUBLIC_SEAM_IDS)[number]

// ── Transient runtime events (§4.4) ─────────────────────────────────────────
// Not persisted, not replayable — lifecycle and UI awareness only. Ruling of
// thumb: still true after reload → domain A; only meaningful "right now" →
// transient. Typed subscriptions, auto-unsubscribed on deactivate.

export interface TransientEventMap {
  'chat.started': { sessionId: string; kind: 'chatbox' | 'card' }
  'chat.switched': { sessionId: string; kind: 'chatbox' | 'card' }
  'seam.provider.changed': { seamId: string; providerPluginId: string | null }
  'plugin.state.changed': { pluginId: string; state: 'registered' | 'active' | 'degraded' }
  'app.resume': Record<string, never>
  'app.pause': Record<string, never>
}

export type TransientEventType = keyof TransientEventMap

export const TRANSIENT_EVENT_TYPES = [
  'chat.started',
  'chat.switched',
  'seam.provider.changed',
  'plugin.state.changed',
  'app.resume',
  'app.pause',
] as const satisfies readonly TransientEventType[]
