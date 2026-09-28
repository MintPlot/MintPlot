/**
 * Prompt artifacts (ADR-001 §05, R-10; type draft appendix B) — the pipeline
 * currency. What flows between hooks is a structured artifact carrying
 * provenance and token accounting; the flattened string sent to the model is
 * only a projection of it. This is what makes "everything the model sees is
 * on record" enforceable.
 *
 * Five hard rules (R-10):
 *  1. sections carry kind + source + tokens — per-section provenance.
 *  2. flatten is a projection: pure function, same artifact → same request body.
 *  3. request logs store artifacts (source + tokens + flattened hash), not raw strings.
 *  4. budgets are accounted per section, one versioned estimator.
 *  5. "everything in the prompt can have its source rebuilt" — asserted by
 *     contract tests on flatten coverage once the pipeline lands (M2).
 *
 * Compatibility boundary (R-10): artifactization applies to the request side
 * and diagnostic logs; session message storage format does not change.
 */

import type { VariableState } from './variables'

export type SectionKind =
  | 'system'
  | 'worldinfo'
  | 'memory'
  | 'preset'
  | 'cot'
  | 'history'
  | 'input'
  | 'regex'
  /** Reserved (variables plugin): the variables artifact section, compact line rendering. */
  | 'variables'

/** Provenance of one section — answers "which world info entry / memory layer / preset segment". */
export interface SectionSource {
  /** Providing plugin id. */
  plugin: string
  /** Entry reference: world-info entry id / memory layer id / preset segment id. */
  ref: string
  /** Display label for the diagnostics token bill. */
  label: string
}

export interface PromptSection {
  /** Stable id within the artifact — replay anchor. */
  id: string
  kind: SectionKind
  source: SectionSource
  content: string
  /** Estimated value; the estimator version travels with the artifact. */
  tokens: number
  role?: 'system' | 'user' | 'assistant'
  /** Whether later points may rewrite this section (history sections: never). */
  mutable: boolean
}

export interface PromptArtifact {
  schema: 1
  requestId: string
  budget: {
    total: number
    estimatorVersion: string
  }
  sections: PromptSection[]
}

/** A flattened request message — the projection target. */
export interface PromptMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/**
 * Pure projection: same artifact in, same message list out (contract tests
 * assert coverage completeness — every character of the final request traces
 * to a section).
 *
 * Type only in the contract; the kernel pipeline provides the implementation.
 */
export type FlattenPromptArtifact = (artifact: PromptArtifact) => PromptMessage[]

/**
 * Session-scope variable table (variables plugin): name → state, derived by
 * replaying `variable.set` events up to a ledger position. Kept beside the
 * artifact types because the `variables` section renders from it.
 */
export type VariableTable = ReadonlyMap<string, VariableState>
