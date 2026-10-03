/**
 * Worldbook engine (M3-u, native) — the ecosystem world-info semantics
 * internalized (behavior sources: SillyTavern world-info.js budget/activation
 * model via research, RP worldinfo organ inventory; not a code port).
 *
 * Two layers, per plan D1: the card's `character_book` is stored VERBATIM
 * (ccv3: never destroy unknown fields) and projected here into a normalized
 * runtime view. Activation = constant entries always, keyed entries by
 * case-insensitive substring (or `/regex/` keys) over the last `scanDepth`
 * floors. Budget = whole-entry greedy fill in activation order (card book →
 * `order` descending), constants INCLUDED (the ecosystem-correct rule — no
 * forced reservation), overflow dropped whole and counted, never trimmed.
 * Injection = seven position groups with `[name]\ncontent` wrappers.
 */

export interface WorldbookEntry {
  uid: number
  comment: string
  content: string
  enabled: boolean
  keys: string[]
  useRegex: boolean
  constant: boolean
  /** Insertion slot — see WORLDBOOK_POSITIONS. */
  position: WorldbookPosition
  order: number
  depth: number
  scanDepth: number | null
  probability: number
  useProbability: boolean
}

export type WorldbookPosition =
  | 'system_top'
  | 'global_note'
  | 'before_char'
  | 'after_char'
  | 'at_depth'
  | 'user_top'
  | 'assistant_top'

export const WORLDBOOK_POSITIONS: readonly WorldbookPosition[] = [
  'system_top',
  'global_note',
  'before_char',
  'after_char',
  'at_depth',
  'user_top',
  'assistant_top',
]

export interface WorldbookScanSettings {
  /** Global default floors scanned per entry (entry override wins; 0 disables the entry). */
  scanDepth: number
  /** Caps per-entry scanDepth via min (0 = no cap). */
  maxDepth: number
  /** Injection token budget; 0 = unlimited (ecosystem-correct: constants included). */
  tokenBudget: number
}

export const DEFAULT_SCAN_SETTINGS: WorldbookScanSettings = {
  scanDepth: 2,
  maxDepth: 0,
  tokenBudget: 4000,
}

export interface WorldbookInjection {
  position: WorldbookPosition
  /** Only meaningful for at_depth: 0 = bottom of prompt, default 4. */
  depth: number
  /** Rendered `[name]\ncontent` blocks joined with blank lines. */
  content: string
}

export interface WorldbookActivationReport {
  injections: WorldbookInjection[]
  /** Entries whose content made it into the request. */
  injected: Array<{ comment: string; position: WorldbookPosition; constant: boolean }>
  /** Entries dropped by the budget (whole-entry, activation order). */
  droppedByBudget: number
  /** Entries skipped: disabled, scan-off, or not triggered. */
  notTriggered: number
}

const toText = (value: unknown): string => (typeof value === 'string' ? value : '')

const toNumber = (value: unknown, fallback: number): number => {
  const parsed = typeof value === 'number' ? value : Number(String(value ?? '').trim())
  return Number.isFinite(parsed) ? parsed : fallback
}

const toBool = (value: unknown): boolean | null =>
  typeof value === 'boolean' ? value : value === 'true' ? true : value === 'false' ? false : null

const normalizeKeys = (raw: unknown): string[] => {
  if (Array.isArray(raw)) return raw.map((key) => toText(key).trim()).filter(Boolean)
  const text = toText(raw)
  if (!text) return []
  return text.split(/[,，]/).map((key) => key.trim()).filter(Boolean)
}

const POSITION_ALIASES: Record<string, WorldbookPosition> = {
  before_char: 'before_char',
  before_character: 'before_char',
  character_top: 'before_char',
  before_examples: 'before_char',
  example_top: 'before_char',
  after_char: 'after_char',
  after_character: 'after_char',
  character_bottom: 'after_char',
  after_examples: 'after_char',
  example_bottom: 'after_char',
  an_top: 'global_note',
  author_note: 'global_note',
  an_bottom: 'global_note',
  global_note: 'global_note',
  at_depth: 'at_depth',
  system_top: 'system_top',
  user_top: 'user_top',
  assistant_top: 'assistant_top',
}

/** Numeric ccv3/ST positions: 0 before-char, 1 after-char, 2/3 AN top/bottom
 *  (both fold to global_note), 4 at-depth; unknown → at_depth (never crash,
 *  never drop the book — ecosystem-degenerate values stay playable). */
const positionFromRaw = (raw: unknown): WorldbookPosition => {
  if (typeof raw === 'number') {
    if (raw === 0) return 'before_char'
    if (raw === 1) return 'after_char'
    if (raw === 2 || raw === 3) return 'global_note'
    if (raw === 4) return 'at_depth'
    return 'at_depth'
  }
  const aliased = POSITION_ALIASES[toText(raw).trim().toLowerCase()]
  return aliased ?? 'at_depth'
}

/** Projects one raw card entry (dual spellings merged, extensions overriding
 *  root) into the runtime view. Unknown fields stay in storage (D1) — only
 *  the projection is lossy, never the record. */
export function projectWorldbookEntry(raw: unknown, uid: number): WorldbookEntry | null {
  if (typeof raw !== 'object' || raw === null) return null
  const source = raw as Record<string, unknown>
  const extensions =
    typeof source.extensions === 'object' && source.extensions !== null
      ? (source.extensions as Record<string, unknown>)
      : {}
  const merged: Record<string, unknown> = { ...source, ...extensions }
  const read = (keys: string[], fallback: unknown): unknown => {
    for (const key of keys) {
      const value = merged[key]
      if (value !== undefined && value !== null) return value
    }
    return fallback
  }
  const content = toText(read(['content'], ''))
  const disabledFlag = toBool(read(['disable', 'disabled'], false)) === true
  const enabledFlag = toBool(read(['enabled'], true)) !== false
  const enabled = enabledFlag && !disabledFlag
  const comment = toText(read(['comment', 'name'], ''))
  return {
    uid,
    comment,
    content,
    enabled,
    keys: normalizeKeys(read(['keys', 'key'], [])),
    useRegex: toBool(read(['use_regex', 'useRegex'], false)) ?? false,
    constant: toBool(read(['constant'], false)) ?? false,
    position: positionFromRaw(read(['position'], 'at_depth')),
    order: toNumber(read(['insertion_order', 'order'], 0), 0),
    depth: toNumber(read(['depth'], 4), 4),
    scanDepth: read(['scan_depth', 'scanDepth'], null) === null ? null : Math.max(0, toNumber(read(['scan_depth', 'scanDepth'], 0), 0)),
    probability: Math.min(100, Math.max(0, toNumber(read(['probability'], 100), 100))),
    useProbability: toBool(read(['use_probability', 'useProbability'], true)) ?? true,
  }
}

/** Projects the card's verbatim book into the runtime entry list. */
export function projectWorldbook(book: unknown): WorldbookEntry[] {
  if (typeof book !== 'object' || book === null) return []
  const source = book as Record<string, unknown>
  const entries = Array.isArray(book) ? book : source.entries
  if (!Array.isArray(entries)) return []
  const projected: WorldbookEntry[] = []
  let uid = 0
  for (const raw of entries) {
    const entry = projectWorldbookEntry(raw, uid)
    uid += 1
    if (entry) projected.push(entry)
  }
  return projected
}

const parseRegexKey = (key: string): RegExp | null => {
  const match = key.match(/^\/(.*)\/([a-z]*)$/s)
  if (!match) return null
  try {
    let flags = match[2] || 'i'
    if (!flags.includes('i')) flags += 'i'
    flags = flags.replace(/g/g, '')
    return new RegExp(match[1]!, flags)
  } catch {
    return null
  }
}

const keyMatches = (key: string, scanText: string, useRegex: boolean): boolean => {
  if (useRegex) {
    const pattern = parseRegexKey(key)
    return pattern ? pattern.test(scanText) : false
  }
  return scanText.toLowerCase().includes(key.toLowerCase())
}

/** Deterministic per-turn probability roll: a hash of the entry uid + turn
 *  seed keeps one roll per entry per generation (no re-rolls across the
 *  multiple injection sites). */
const probabilityRoll = (uid: number, seed: number, probability: number): boolean => {
  if (probability >= 100) return true
  let hash = (uid * 2654435761) ^ (seed * 40503)
  hash = (hash ^ (hash >>> 13)) * 1274126177
  const roll = ((hash ^ (hash >>> 16)) >>> 0) % 100
  return roll < probability
}

export interface WorldbookActivation {
  activated: WorldbookEntry[]
  notTriggered: number
}

/** Scans recent floors and returns activated entries in BUDGET order: card
 *  book order (constants first is NOT special-cased — they activate anyway
 *  and compete by `order`, the ecosystem rule), `order` descending. */
export function activateWorldbookEntries(options: {
  entries: readonly WorldbookEntry[]
  scanText: string
  /** Turns since chat start — the probability-roll seed. */
  turnSeed: number
  settings: WorldbookScanSettings
  /** Per-entry enabled overrides (device-local, D7). */
  disabledUids?: ReadonlySet<number>
}): WorldbookActivation {
  const { entries, scanText, turnSeed, settings } = options
  const disabledUids = options.disabledUids ?? new Set<number>()
  const activated: WorldbookEntry[] = []
  let notTriggered = 0
  for (const entry of entries) {
    if (!entry.enabled || disabledUids.has(entry.uid)) {
      notTriggered += 1
      continue
    }
    const depth = entry.scanDepth ?? settings.scanDepth
    const capped = settings.maxDepth > 0 ? Math.min(depth, settings.maxDepth) : depth
    if (!entry.constant && capped === 0) {
      notTriggered += 1
      continue
    }
    if (entry.constant) {
      activated.push(entry)
      continue
    }
    if (entry.keys.length === 0) {
      notTriggered += 1
      continue
    }
    if (entry.useProbability && entry.probability < 100 && !probabilityRoll(entry.uid, turnSeed, entry.probability)) {
      notTriggered += 1
      continue
    }
    if (entry.keys.some((key) => keyMatches(key, scanText, entry.useRegex))) {
      activated.push(entry)
    } else {
      notTriggered += 1
    }
  }
  activated.sort((a, b) => b.order - a.order || a.uid - b.uid)
  return { activated, notTriggered }
}

/** Token estimate heuristic (CJK chars weigh heavier per token than ASCII
 *  words): enough fidelity for whole-entry budget decisions. */
export const estimateTokens = (text: string): number => {
  let cjk = 0
  let asciiWords = 0
  let other = 0
  for (const char of text) {
    if (/[\u3000-\u9fff\uf900-\ufaff]/.test(char)) cjk += 1
    else if (/[a-zA-Z0-9]/.test(char)) asciiWords += 1
    else other += 1
  }
  return Math.round(cjk * 0.8 + (asciiWords / 4) * 1.3 + other * 0.2)
}

/** Whole-entry greedy budget fill over the activation-ordered list: entries
 *  fit entirely or are dropped (counted), never trimmed mid-content. */
export function applyWorldbookBudget(
  activated: readonly WorldbookEntry[],
  budget: number,
): { kept: WorldbookEntry[]; droppedByBudget: number } {
  if (budget <= 0) return { kept: [...activated], droppedByBudget: 0 }
  const kept: WorldbookEntry[] = []
  let used = 0
  let dropped = 0
  for (const entry of activated) {
    const cost = estimateTokens(entry.content)
    if (used + cost <= budget) {
      kept.push(entry)
      used += cost
    } else {
      dropped += 1
    }
  }
  return { kept, droppedByBudget: dropped }
}

const wrapEntry = (entry: WorldbookEntry): string => `[${entry.comment || '条目'}]\n${entry.content}`

/** Renders the injection groups: kept entries partitioned by position, each
 *  group's members sorted by `order` ascending (higher order = later = more
 *  impact), joined with blank lines. `global_note` ignores `depth` (D5). */
export function renderWorldbookInjections(
  kept: readonly WorldbookEntry[],
): WorldbookInjection[] {
  const groups = new Map<WorldbookPosition, WorldbookEntry[]>()
  for (const entry of kept) {
    const bucket = groups.get(entry.position) ?? []
    bucket.push(entry)
    groups.set(entry.position, bucket)
  }
  const injections: WorldbookInjection[] = []
  for (const position of WORLDBOOK_POSITIONS) {
    const bucket = groups.get(position)
    if (!bucket || bucket.length === 0) continue
    bucket.sort((a, b) => a.order - b.order || a.uid - b.uid)
    injections.push({
      position,
      depth: position === 'at_depth' ? Math.max(0, bucket[0]!.depth) : 0,
      content: bucket.map(wrapEntry).join('\n\n'),
    })
  }
  return injections
}

/** Full pipeline: project → activate → budget → render. The scan text and
 *  floor assembly stay with the caller (the request builder owns floors). */
export function buildWorldbookInjections(options: {
  book: unknown
  scanText: string
  turnSeed: number
  settings?: Partial<WorldbookScanSettings>
  disabledUids?: ReadonlySet<number>
}): WorldbookActivationReport {
  const settings = { ...DEFAULT_SCAN_SETTINGS, ...options.settings }
  const entries = projectWorldbook(options.book)
  const { activated, notTriggered } = activateWorldbookEntries({
    entries,
    scanText: options.scanText,
    turnSeed: options.turnSeed,
    settings,
    disabledUids: options.disabledUids,
  })
  const { kept, droppedByBudget } = applyWorldbookBudget(activated, settings.tokenBudget)
  return {
    injections: renderWorldbookInjections(kept),
    injected: kept.map((entry) => ({ comment: entry.comment, position: entry.position, constant: entry.constant })),
    droppedByBudget,
    notTriggered,
  }
}
