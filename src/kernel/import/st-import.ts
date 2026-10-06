/**
 * SillyTavern asset mapping (M4-g2, native) — pure functions classifying and
 * mapping ST export files into MP shapes. ST assets arrive either loose
 * (community-shared single JSONs) or inside a Download-Backup zip whose
 * entries mirror ST's data directory (worlds/, presets/openai/, regex/,
 * characters/, chats/).
 *
 * Fidelity contract (plan v1.2, user-approved): worldbook and regex entries
 * map losslessly-ish (M3-u/M3-v engines already project ST shapes); presets
 * map LOSSILY — ST's position/depth injection semantics degrade to MP's
 * array-order model and the panel says so; chats and personas are not
 * imported at 1.0.0.
 */

export type StAssetKind = 'worldbook' | 'regex' | 'preset' | 'character' | 'unknown'

export interface StAsset {
  kind: StAssetKind
  /** Display name (file stem or in-file name). */
  name: string
  /** Archive entry name (zip source) or the loose file's name. */
  entryName: string
  /** Decoded JSON content (characters may be PNG bytes instead → rawEntry). */
  content?: unknown
  rawEntry?: Uint8Array
}

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}

/** Content-sniffs one decoded ST JSON file. The type keys are distinctive
 *  enough that misclassification is practically impossible. */
export const classifyStJson = (raw: unknown): StAssetKind => {
  const record = asRecord(raw)
  if (typeof record.entries === 'object' && record.entries !== null) return 'worldbook'
  if (Array.isArray(record.prompts)) return 'preset'
  if (typeof (record.scriptName ?? record.findRegex ?? record.regex) === 'string') return 'regex'
  if (typeof record.spec === 'string' && record.spec.startsWith('chara_card')) return 'character'
  if (typeof record.name === 'string' && (typeof record.first_mes === 'string' || typeof record.description === 'string')) {
    return 'character'
  }
  return 'unknown'
}

/** Maps a ST worldbook JSON (entries keyed by uid) into the ccv3-shaped
 *  `{entries: [...]}` book MP's parser/engine project natively. Entry fields
 *  pass through VERBATIM (M3-u discipline: never destroy unknown fields) —
 *  only the container converts. */
export const mapStWorldbook = (raw: unknown): { entries: unknown[] } => {
  const record = asRecord(raw)
  const entries = asRecord(record.entries)
  return { entries: Object.values(entries) }
}

/** ST regex script(s) → the export-shaped list MP's regex channel consumes.
 *  A file may hold one script or a list. */
export const mapStRegex = (raw: unknown): Record<string, unknown>[] => {
  const list = Array.isArray(raw) ? raw : [raw]
  return list
    .map(asRecord)
    .filter((record) => typeof (record.scriptName ?? record.findRegex ?? record.regex) === 'string')
    .map((record) => record)
}

export interface StPresetMapping {
  /** MP preset entries (array-order model). */
  entries: Array<{ name: string; content: string; role: 'system' | 'user' | 'assistant'; enabled: boolean }>
  /** Human-readable fidelity notes for the panel (lossy mapping disclosed). */
  notes: string[]
}

/** ST OpenAI preset → MP preset entries. prompt_order's enabled flags drive
 *  the defaults; position/depth/injection_* degrade to array order (lossy,
 *  disclosed). */
export const mapStPreset = (raw: unknown): StPresetMapping => {
  const record = asRecord(raw)
  const prompts = Array.isArray(record.prompts) ? record.prompts.map(asRecord) : []
  const order = asRecord(record.prompt_order)
  // prompt_order: { character_id: [{identifier, enabled}] } — the 100000/
  // dummy character bucket is the preset-level one ST uses.
  const orderList = Array.isArray((order as Record<string, unknown>)['100000'])
    ? ((order as Record<string, unknown>)['100000'] as unknown[])
    : Object.values(order).find((value) => Array.isArray(value)) ?? []
  const enabledById = new Map<string, boolean>()
  for (const item of orderList) {
    const record2 = asRecord(item)
    if (typeof record2.identifier === 'string') enabledById.set(record2.identifier, record2.enabled !== false)
  }
  const notes: string[] = []
  const entries: StPresetMapping['entries'] = []
  let positional = 0
  for (const prompt of prompts) {
    const identifier = typeof prompt.identifier === 'string' ? prompt.identifier : ''
    const name = String(prompt.name ?? identifier ?? `条目 ${positional + 1}`)
    const content = String(prompt.content ?? '')
    const role = prompt.role === 'user' || prompt.role === 'assistant' ? prompt.role : 'system'
    const marker = String(prompt.marker ?? '') === 'true'
    positional += 1
    if (marker && !content) {
      notes.push(`「${name}」是酒馆占位标记（如聊天历史），无正文，跳过`)
      continue
    }
    entries.push({ name, content, role, enabled: enabledById.get(identifier) !== false })
  }
  if (prompts.some((prompt) => prompt.position !== undefined || prompt.injection_position !== undefined || prompt.injection_depth !== undefined)) {
    notes.push('酒馆的注入位次（position/depth）映射为 MP 的排列顺序，注入语义有损')
  }
  return { entries, notes }
}

/** Directory shape of a Download-Backup zip → asset kind; loose files fall
 *  back to content sniffing. */
export const classifyStEntryName = (entryName: string): StAssetKind => {
  const lowered = entryName.toLowerCase()
  if (lowered.includes('worlds/') || lowered.includes('world info')) return 'worldbook'
  if (lowered.includes('regex')) return 'regex'
  if (lowered.includes('presets') || lowered.includes('preset')) return 'preset'
  if (lowered.includes('characters/')) return 'character'
  if (lowered.includes('chats/')) return 'unknown' // chats not imported at 1.0.0
  return 'unknown'
}
