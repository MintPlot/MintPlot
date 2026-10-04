/**
 * Variable system contract reservations (review v1.0, D1–D5 ratified
 * 2026-09-28) — the three pre-allocated slots the M1 contract package owes the
 * variables plugin (sixth core plugin, M4 batch, native new-write):
 *
 *  1. `variable.set` — persistent session event type (domain A ledger).
 *  2. `variable-expand` — earliest pipeline point; macro expansion
 *     (`{{getvar::name::default}}`) across every text artifact.
 *  3. `card.panel.section` — "card panel slot" registration surface; chat-page
 *     character panel accepts plugin-registered sections.
 *
 * Write path = event domain; read path = pipeline hook; injection = artifact
 * section (`variables` kind in prompt-artifact.ts). All three must be
 * finalized before contract v1 freezes (R-15).
 */

export const VARIABLE_SET_EVENT_TYPE = 'variable.set' as const

export const VARIABLE_EXPAND_POINT = 'variable-expand' as const

export const CARD_PANEL_SECTION_PERMISSION = 'card.panel.section' as const

/**
 * Variable values (M3-r revision): nested JSON trees join the flat scalars —
 * the ui-template replacement carries card state like `stats.physique.val`
 * and `equipment[]`, so plain objects and arrays are first-class. v1's
 * `string | number` remains the flat subset; booleans pass through unchanged
 * inside trees.
 */
export interface VariableTree {
  [key: string]: VariableValue
}

export type VariableValue = string | number | boolean | VariableTree | VariableValue[]

/** How a variable update entered the system (review v1.0 Q3). */
export type VariableSetSource = 'ai' | 'manual' | 'regex'

/**
 * Payload of a `variable.set` ledger event. `after = null` means deletion.
 * Relative increments (`+120`) are resolved by the parser before the event is
 * emitted — the ledger stores the resulting absolute value.
 */
export interface VariableSetEventPayload {
  name: string
  before: VariableValue | null
  after: VariableValue | null
  source: VariableSetSource
}

/** Per-name variable state: a projection cache over the event stream. */
export interface VariableState {
  value: VariableValue
  updatedAt: number
  /** Ledger event id this state derives from — replay anchor. */
  sourceEventId: string
}

/**
 * Card-default values (review v1.0 D4): stored in the card format extension
 * field `extensions.mp_variables`, seeded into session scope on session start.
 */
export const CARD_VARIABLES_EXTENSION_KEY = 'mp_variables' as const
