/**
 * Variable engine (M3-q, native) — the pure half of the variables system
 * (review v1.0 D1–D5; positioning ruling 2026-09-30: variables replaces the
 * RP ui-template organ's session-state capability, display stays with the
 * M3-n rich render pipeline). Parse / resolve / expand / project / replay —
 * no I/O here; persistence lives in {@link ./variable-store}.
 *
 * Card-play compatibility (D4): AI updates arrive in `<setvars>` (MP default)
 * or `<StatData>` (community StatData school) blocks, case-insensitive with
 * optional attributes; references use the ST macro `{{getvar::name::default}}`.
 * There is deliberately no `{{setvar}}` macro — prompt-side assignment
 * re-executes on every regeneration (review Q1), the tag block does not.
 */

import type { VariableState, VariableValue } from '@contracts'

/** Accepted AI-output update tags (D4): the MP default plus the StatData school. */
export const VARIABLE_TAG_NAMES = ['setvars', 'StatData'] as const

/** Quota constants (review §04 配额): untrusted card/model output, so both
 *  the table width and the value size stay bounded. */
export const VARIABLE_NAME_MAX_LENGTH = 100
export const VARIABLE_VALUE_MAX_LENGTH = 4000

/** Card-format defaults (`extensions.mp_variables`, review D4). */
export interface CardVariableDefault {
  name: string
  value: VariableValue
  description?: string
}

/** One parsed AI-side update — raw as written; `+`/`-`-prefixed numeric
 *  strings resolve against the current value at apply time (delta semantics). */
export interface ParsedVariableUpdate {
  name: string
  raw: VariableValue | null
}

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const blockPattern = (tag: string): RegExp =>
  new RegExp(`<${escapeRegExp(tag)}(?:\\s[^>]*)?>([\\s\\S]*?)</${escapeRegExp(tag)}>`, 'gi')

const isNumericLiteral = (text: string): boolean => /^[+-]?\d+(?:\.\d+)?$/.test(text)

const clampValue = (value: VariableValue): VariableValue =>
  typeof value === 'string' && value.length > VARIABLE_VALUE_MAX_LENGTH
    ? value.slice(0, VARIABLE_VALUE_MAX_LENGTH)
    : value

/** Coerces one JSON entry value into a variable value; non-scalar shapes are
 *  dropped (tolerant parse — a hostile block never breaks the floor). */
function toVariableValue(value: unknown): VariableValue | null | undefined {
  if (value === null) return null
  if (typeof value === 'string') return clampValue(value)
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'boolean') return String(value)
  return undefined
}

/**
 * Extracts every accepted tag block and parses the JSON bodies. Malformed
 * JSON ignores that whole block and keeps the rest (review §07: 畸形输出不
 * 中断生成); blocks nest nothing — a plain non-greedy scan suffices.
 */
export function parseVariableUpdates(text: string): { updates: ParsedVariableUpdate[] } {
  if (!text) return { updates: [] }
  const updates: ParsedVariableUpdate[] = []
  const seen = new Set<string>()
  for (const tag of VARIABLE_TAG_NAMES) {
    for (const match of text.matchAll(blockPattern(tag))) {
      let parsed: unknown
      try {
        parsed = JSON.parse(match[1]!.trim())
      } catch {
        console.warn(`[variables] ignored malformed <${tag}> block (invalid JSON)`)
        continue
      }
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        console.warn(`[variables] ignored <${tag}> block (body is not a JSON object)`)
        continue
      }
      for (const [rawName, rawValue] of Object.entries(parsed as Record<string, unknown>)) {
        const name = rawName.trim()
        if (!name || name.length > VARIABLE_NAME_MAX_LENGTH || seen.has(name)) continue
        const value = toVariableValue(rawValue)
        if (value === undefined) continue
        seen.add(name)
        updates.push({ name, raw: value })
      }
    }
  }
  return { updates }
}

/** Display projection: the stored floor keeps its tag blocks verbatim; only
 *  the render path strips them (review Q1 落库纪律). */
export function stripVariableBlocks(text: string): string {
  if (!text) return text
  let result = text
  for (const tag of VARIABLE_TAG_NAMES) {
    result = result.replace(blockPattern(tag), '')
  }
  return result.trim()
}

/**
 * Delta semantics (review Q1): `+120`/`-50` resolve relative to the current
 * value — numeric-string current values coerce, a missing one starts from 0;
 * anything else is absolute. `null` deletes.
 */
export function resolveUpdateValue(raw: VariableValue | null, before: VariableValue | null): VariableValue | null {
  if (raw === null) return null
  if (typeof raw === 'number') return raw
  if (isNumericLiteral(raw) && (raw.startsWith('+') || raw.startsWith('-'))) {
    const delta = Number(raw)
    const base = before === null ? 0 : Number(before)
    return Number.isFinite(base) ? base + delta : raw
  }
  return clampValue(raw)
}

/** Manual-panel input follows the same contract: bare numbers become numbers
 *  (absolute), `+`/`-`-prefixed numbers stay strings (relative at apply). */
export function manualValueFromInput(text: string): VariableValue | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  if (isNumericLiteral(trimmed) && !trimmed.startsWith('+') && !trimmed.startsWith('-')) {
    return Number(trimmed)
  }
  return clampValue(trimmed)
}

/**
 * `{{getvar::name}}` / `{{getvar::name::default}}` — ST macro compatible
 * (review D5). A missing variable with no default expands to '' so ecosystem
 * cards degrade quietly instead of leaking macro literals to the model.
 */
export function expandGetvarMacros(text: string, getState: (name: string) => VariableValue | undefined): string {
  if (!text) return text
  return text.replace(/\{\{getvar::([^:}]+?)(?:::([^}]*))?\}\}/gi, (_match, rawName: string, fallback?: string) => {
    const value = getState(rawName.trim())
    if (value !== undefined) return String(value)
    return fallback ?? ''
  })
}

/** The variables artifact section (review Q5, compact line form) — '' when
 *  there is nothing to inject; the caller appends it to the system prompt. */
export function renderVariablesSection(state: Record<string, VariableState>): string {
  const entries = Object.entries(state)
  if (entries.length === 0) return ''
  const line = entries.map(([name, variable]) => `${name} ${String(variable.value)}`).join(' ｜ ')
  return `[Variables]\n当前状态: ${line}`
}

/** Validates the `extensions.mp_variables` card field (review D4) into seed
 *  defaults; anything malformed is skipped, never fatal to the import. */
export function readCardVariableDefaults(extensions?: Record<string, unknown>): CardVariableDefault[] {
  const raw = extensions?.mp_variables
  if (!Array.isArray(raw)) return []
  const defaults: CardVariableDefault[] = []
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) continue
    const record = entry as Record<string, unknown>
    const name = typeof record.name === 'string' ? record.name.trim() : ''
    if (!name || name.length > VARIABLE_NAME_MAX_LENGTH) continue
    const value = toVariableValue(record.value)
    if (value === undefined || value === null) continue
    const description = typeof record.description === 'string' ? record.description : undefined
    defaults.push(description ? { name, value, description } : { name, value })
  }
  return defaults
}

/**
 * Replay projection (review Q5): state = seed baseline ⊕ variable.set events.
 * Seed rows carry updatedAt 0 / sourceEventId 'seed' — the panel labels them
 * 卡默认; every event overwrites or deletes its name. Pure and deterministic:
 * the same facts always fold to the same table.
 */
export function replayVariableState(
  seed: readonly CardVariableDefault[],
  events: readonly { id: string; ts: number; name: string; after: VariableValue | null }[],
): Record<string, VariableState> {
  const state: Record<string, VariableState> = {}
  for (const entry of seed) {
    state[entry.name] = { value: entry.value, updatedAt: 0, sourceEventId: 'seed' }
  }
  for (const event of events) {
    if (event.after === null) {
      delete state[event.name]
    } else {
      state[event.name] = { value: event.after, updatedAt: event.ts, sourceEventId: event.id }
    }
  }
  return state
}
