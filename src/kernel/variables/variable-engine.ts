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

/** The ui-template update protocol (M3-r): `<ui_template_updates …>…</…>`,
 *  case-insensitive, attribute-tolerant. */
const TEMPLATE_UPDATE_BLOCK_PATTERN = /<ui_template_updates(?:\s[^>]*)?>([\s\S]*?)<\/ui_template_updates>/gi

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

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

/**
 * Display projection: the stored floor keeps its tag blocks verbatim; only
 * the render path strips them (review Q1 落库纪律). M3-r: the ui-template
 * protocol block strips alongside the flat tags.
 */
export function stripVariableBlocks(text: string): string {
  if (!text) return text
  let result = text
  for (const tag of VARIABLE_TAG_NAMES) {
    result = result.replace(blockPattern(tag), '')
  }
  return result.replace(TEMPLATE_UPDATE_BLOCK_PATTERN, '').trim()
}

/**
 * Delta semantics (review Q1): `+120`/`-50` resolve relative to the current
 * value — numeric-string current values coerce, a missing one starts from 0;
 * anything else is absolute. `null` deletes. Since M3-r, non-string updates
 * (booleans / trees / arrays from the template protocol) pass through
 * absolute.
 */
export function resolveUpdateValue(raw: VariableValue | null, before: VariableValue | null): VariableValue | null {
  if (raw === null) return null
  if (typeof raw === 'number') return raw
  if (typeof raw === 'string') {
    if (isNumericLiteral(raw) && (raw.startsWith('+') || raw.startsWith('-'))) {
      const delta = Number(raw)
      const base = before === null ? 0 : Number(before)
      return Number.isFinite(base) ? base + delta : raw
    }
    return clampValue(raw)
  }
  return raw
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
    state[entry.name] = { value: cloneJson(entry.value), updatedAt: 0, sourceEventId: 'seed' }
  }
  for (const event of events) {
    if (event.after === null) {
      delete state[event.name]
    } else {
      state[event.name] = { value: cloneJson(event.after), updatedAt: event.ts, sourceEventId: event.id }
    }
  }
  return state
}

// ── ui-template protocol (M3-r) ─────────────────────────────────────────────
// The card-embedded panel's state tree + update protocol, per the RP
// ui-template organ's behavior (behavior source, not a code port). Three
// AI-side protocols now coexist: <setvars>/<StatData> (flat) and
// <ui_template_updates> (nested, template-bound).

/** One template-bound update entry (whitelisted shape). */
export interface ParsedTemplateUpdate {
  id?: string
  name?: string
  /** path → value; dotted paths and nested objects both supported. */
  variables: Record<string, unknown>
  reason?: string
}

/** Raw `<ui_template_updates>` block bodies, in order of appearance. */
export function parseTemplateUpdateBlocks(text: string): string[] {
  if (!text) return []
  return [...text.matchAll(TEMPLATE_UPDATE_BLOCK_PATTERN)].map((match) => match[1]!.trim())
}

/** Tolerant JSON: strips a ``` fence, then slices from the first `{`/`[` to
 *  the last matching bracket before parsing (RP parseUiTemplateUpdateJson
 *  behavior). Throws on irrecoverable bodies. */
function parseTolerantJson(body: string): unknown {
  let text = body.trim()
  const fence = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/.exec(text)
  if (fence) text = fence[1]!.trim()
  try {
    return JSON.parse(text)
  } catch {
    const startObject = text.indexOf('{')
    const startArray = text.indexOf('[')
    const start = startObject === -1 ? startArray : startArray === -1 ? startObject : Math.min(startObject, startArray)
    const endObject = text.lastIndexOf('}')
    const endArray = text.lastIndexOf(']')
    const end = Math.max(endObject, endArray)
    if (start === -1 || end <= start) throw new Error('no JSON payload found')
    return JSON.parse(text.slice(start, end + 1))
  }
}

/** Normalizes one block body into update entries (RP
 *  normalizeUiTemplateUpdateList behavior): accepts `{"updates":[…]}`,
 *  a single `{"variables":{…}, "id"?, "name"?, "reason"?}`, a bare
 *  variables object, or a top-level array. Extra entry keys are dropped;
 *  array-valued `variables` become a `$root` whole-tree replacement. */
export function parseTemplateUpdatePayload(body: string): ParsedTemplateUpdate[] {
  const parsed = parseTolerantJson(body)
  const entries: unknown[] = Array.isArray(parsed)
    ? parsed
    : isPlainObject(parsed) && Array.isArray(parsed.updates)
      ? parsed.updates
      : [parsed]
  const updates: ParsedTemplateUpdate[] = []
  for (const entry of entries) {
    if (!isPlainObject(entry)) continue
    const rawVariables: Record<string, unknown> | unknown[] | undefined = isPlainObject(entry.variables)
      ? entry.variables
      : Array.isArray(entry.variables)
        ? entry.variables
        : undefined
    let bareVariables: Record<string, unknown> | undefined
    if (rawVariables === undefined && !Array.isArray(parsed) && !(isPlainObject(parsed) && 'updates' in parsed)) {
      // Bare variables object: {"hp": 95, "location": "…"} — everything the
      // entry carries that is not metadata is the variable map itself.
      const { id, name, reason, ...rest } = entry
      void id
      void name
      void reason
      if (Object.keys(rest).length === 0) continue
      bareVariables = rest
    }
    const variables = rawVariables ?? bareVariables
    if (variables === undefined) continue
    updates.push({
      ...(typeof entry.id === 'string' && entry.id ? { id: entry.id } : {}),
      ...(typeof entry.name === 'string' && entry.name ? { name: entry.name } : {}),
      variables: Array.isArray(variables) ? { $root: cloneJson(variables) } : cloneJson(variables),
      ...(typeof entry.reason === 'string' && entry.reason ? { reason: entry.reason } : {}),
    })
  }
  return updates
}

const splitPath = (expression: string): string[] =>
  expression
    .replace(/\[(\d+)\]/g, '.$1')
    .replace(/\['([^']+)'\]/g, '.$1')
    .split('.')
    .filter((part) => part.length > 0)

/** Merge discipline (M3-r, per the card contract「没写的字段保持原值」/
 *  updateMode merge — stricter than RP's subtree replace): plain objects
 *  deep-merge field-by-field; arrays and scalars replace wholesale. */
function mergeValue(existing: unknown, patch: unknown): unknown {
  if (isPlainObject(existing) && isPlainObject(patch)) {
    const result: Record<string, unknown> = cloneJson(existing)
    for (const [key, value] of Object.entries(patch)) {
      result[key] = key in result ? mergeValue(result[key], value) : cloneJson(value)
    }
    return result
  }
  return cloneJson(patch)
}

/** Key allow-list (RP parity): the top-level segment of each path must be
 *  known from the current state, the initial state, or an object-form
 *  schema; a string schema contributes no keys. No known keys at all →
 *  everything allowed; `$root` always allowed. */
function isAllowedKey(
  key: string,
  state: Record<string, unknown>,
  initial: Record<string, unknown>,
  schema: string | Record<string, unknown>,
): boolean {
  if (key === '$root') return true
  const known = new Set([...Object.keys(state), ...Object.keys(initial), ...(isPlainObject(schema) ? Object.keys(schema) : [])])
  if (known.size === 0) return true
  return known.has(splitPath(key)[0] ?? key)
}

export interface TemplateApplyResult {
  nextState: Record<string, unknown>
  changedKeys: string[]
  rejectedKeys: string[]
}

/**
 * Applies template-bound updates to one template's state tree. Entries
 * matching is the caller's job (id/name/single-active); this applies every
 * given entry. Set-only: values merge in, nothing deletes (clear = set
 * `""`/`[]`/`{}`).
 */
export function applyTemplateUpdates(
  state: Record<string, unknown>,
  updates: ParsedTemplateUpdate[],
  context: { initial?: Record<string, unknown>; schema?: string | Record<string, unknown> } = {},
): TemplateApplyResult {
  const initial = context.initial ?? {}
  const schema = context.schema ?? ''
  let nextState = cloneJson(state)
  const changedKeys: string[] = []
  const rejectedKeys: string[] = []

  for (const update of updates) {
    const entries = Object.entries(update.variables)
    for (const [key, value] of entries) {
      if (!isAllowedKey(key, state, initial, schema)) {
        rejectedKeys.push(key)
        continue
      }
      if (key === '$root') {
        const replaced = isPlainObject(value) || Array.isArray(value) ? cloneJson(value) : nextState
        if (JSON.stringify(nextState) !== JSON.stringify(replaced)) {
          nextState = isPlainObject(replaced) ? replaced : { $root: replaced }
          changedKeys.push('$root')
        }
        continue
      }
      const parts = splitPath(key)
      if (parts.length === 0) continue
      let target: Record<string, unknown> = nextState
      for (let index = 0; index < parts.length - 1; index += 1) {
        const part = parts[index]!
        const nextPart = parts[index + 1]!
        const current = target[part]
        if (!isPlainObject(current) && !Array.isArray(current)) {
          target[part] = /^\d+$/.test(nextPart) ? [] : {}
        }
        target = target[part] as Record<string, unknown>
      }
      const leaf = parts[parts.length - 1]!
      const before = target[leaf]
      const after = mergeValue(before, value)
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        target[leaf] = after
        changedKeys.push(key)
      }
    }
  }
  return { nextState, changedKeys, rejectedKeys }
}

/** A card template's identity slice used for matching and rendering. */
export interface TemplateRef {
  id: string
  name: string
}

/** Routes parsed updates to templates: `id` wins, then `name`, and a sole
 *  active template inherits everything (RP main-model matching). Updates
 *  matching nothing are dropped. */
export function matchTemplateUpdates<T extends TemplateRef>(
  updates: ParsedTemplateUpdate[],
  templates: readonly T[],
): Array<{ template: T; updates: ParsedTemplateUpdate[] }> {
  const matched: Array<{ template: T; updates: ParsedTemplateUpdate[] }> = []
  const single = templates.length === 1
  for (const update of updates) {
    const template = (update.id && templates.find((entry) => entry.id === update.id))
      ?? (update.name && templates.find((entry) => entry.name === update.name))
      ?? (single ? templates[0] : undefined)
    if (!template) continue
    const bucket = matched.find((entry) => entry.template === template)
    if (bucket) bucket.updates.push(update)
    else matched.push({ template, updates: [update] })
  }
  return matched
}

/** Instruction + payload section appended to the system prompt (main-model
 *  mode, RP-equivalent semantics; text rewritten for MP). The card's own
 *  variableSchema rides inside the payload — it carries the author's field
 *  spec and often a stricter protocol description. */
export function renderTemplateUpdateSection(
  templates: ReadonlyArray<{ id: string; name: string; currentVariables: unknown; variableSchema: string }>,
): string {
  if (templates.length === 0) return ''
  const payload = templates
    .map((entry) => JSON.stringify({ id: entry.id, name: entry.name, currentVariables: entry.currentVariables, variableSchema: entry.variableSchema }, null, 2))
    .join('\n')
  return [
    '[UI模板变量更新]',
    '正文结束后，在整条回复的最末尾追加一个隐藏变量更新块：它只供前端读取，不属于正文，不要在正文中提到它，不要写进思考过程，不要用 Markdown 围栏包裹。格式：',
    '<ui_template_updates>',
    '{"updates":[{"id":"模板id","variables":{"字段":"新值"},"reason":"简短原因"}]}',
    '</ui_template_updates>',
    '只有一个模板时也可直接输出变量对象：{"字段":"新值"}。只更新下方模板定义的变量，没写的字段保持原值；对象字段用嵌套写法，数组字段整条重写；没有变化输出 {}。不要修改模板 HTML。',
    '<模板变量表>',
    payload,
    '</模板变量表>',
  ].join('\n')
}
