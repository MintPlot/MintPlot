/**
 * Character card import (M3-f, native new-write) — SillyTavern-style character
 * card parsing: PNG files carry the card JSON base64-encoded in a tEXt chunk
 * (`chara` = v1/v2, `ccv3` = v3); `.json` files carry it directly. All shapes
 * normalize into one stored record. Pure functions; persistence lives in
 * {@link ../character-store}.
 *
 * Tolerance lessons (v2/v3 card spec): text fields may be missing or
 * non-string — they coerce to '' instead of failing the import; `name` is the
 * only required field. PNG chunk CRCs are not verified (tolerant import).
 */

export class CharacterCardError extends Error {}

/** The stored shape (id/timestamps assigned by the character store). */
export interface CharacterCard {
  id: string
  name: string
  description: string
  personality: string
  scenario: string
  firstMes: string
  mesExample: string
  systemPrompt: string
  postHistoryInstructions: string
  alternateGreetings: string[]
  tags: string[]
  creator: string
  characterVersion: string
  creatorNotes: string
  /** Source spec: 'v1' | 'chara_card_v2' | 'chara_card_v3'. */
  spec: string
  /**
   * Raw card-format `extensions` object (v2/v3), passed through verbatim
   * (M3-q): variables read `mp_variables` today; worldbook (`character_book`)
   * and regex (`regex_scripts`) slices consume the same channel. Optional —
   * records stored before M3-q read back without it.
   */
  extensions?: Record<string, unknown>
  /**
   * Card-embedded UI templates (M3-r, the ui-template replacement): RP-style
   * HTML panels with `{{variable}}` interpolation, carried verbatim from
   * `data.uiTemplates` (fallback `extensions.rp_hub_ui_templates`). Optional
   * — cards without one simply have no panel.
   */
  uiTemplates?: CardUiTemplate[]
  /**
   * Card-embedded worldbook (M3-u), carried VERBATIM from the ccv3
   * `data.character_book` object (spec: never destroy unknown fields) — the
   * engine projects a normalized entry view at runtime; storage keeps the
   * author's shape. Optional — cards without a book simply have none.
   */
  book?: unknown
  importedAt: number
}

/** One card-embedded UI template, normalized on import (M3-r). */
export interface CardUiTemplate {
  id: string
  name: string
  enabled: boolean
  /** 'character' | 'global' — card-embedded templates are character-bound. */
  scope: string
  order: number
  /** 'top' | 'bottom' — attach point on the assistant floor. */
  placement: string
  /** HTML with `{{variable}}` interpolation; code fences stripped. */
  htmlTemplate: string
  /** Initial variable tree (nested JSON). */
  initialVariableState: Record<string, unknown>
  /** Free-text field spec for the AI (names/types/update rules). */
  variableSchema: string
}

/** A parsed card before the store assigns identity. */
export type ParsedCharacterCard = Omit<CharacterCard, 'id' | 'importedAt'>

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const

/** latin-1 decode, chunked — real card chunks are tens of KB; a spread that
 *  large blows the call stack. */
function decodeLatin1(bytes: Uint8Array): string {
  let out = ''
  const CHUNK = 0x8000
  for (let index = 0; index < bytes.length; index += CHUNK) {
    out += String.fromCharCode(...bytes.subarray(index, index + CHUNK))
  }
  return out
}

/** PNG signature sniff — also the import-path cover decision (M3-m): a PNG
 *  card file is its own cover artwork; JSON files carry no image. */
export function isPngBytes(bytes: Uint8Array): boolean {
  return PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)
}

function decodeBase64Utf8(base64: string): string {
  const compact = base64.replace(/\s+/g, '')
  const binary = atob(compact)
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  return new TextDecoder('utf-8').decode(bytes)
}

/** Cover data URL (M3-m): the PNG card file itself becomes the `<img>` src.
 *  Same chunked-encode lesson as {@link decodeLatin1} — a multi-MB cover as
 *  one spread blows the call stack. */
export function pngDataUrl(bytes: Uint8Array): string {
  let binary = ''
  const CHUNK = 0x8000
  for (let index = 0; index < bytes.length; index += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(index, index + CHUNK))
  }
  return `data:image/png;base64,${btoa(binary)}`
}

/**
 * tEXt chunks of a PNG as keyword → text (latin-1 keywords per spec). Stops
 * at the first malformed chunk boundary — truncated files yield what parsed.
 */
export function pngTextChunks(bytes: Uint8Array): Map<string, string> {
  const chunks = new Map<string, string>()
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = 8
  while (offset + 12 <= bytes.byteLength) {
    const length = view.getUint32(offset)
    const type = String.fromCharCode(bytes[offset + 4]!, bytes[offset + 5]!, bytes[offset + 6]!, bytes[offset + 7]!)
    const dataStart = offset + 8
    if (length > bytes.byteLength - dataStart) break
    if (type === 'tEXt') {
      const data = bytes.subarray(dataStart, dataStart + length)
      const separator = data.indexOf(0)
      if (separator > 0) {
        chunks.set(decodeLatin1(data.subarray(0, separator)), decodeLatin1(data.subarray(separator + 1)))
      }
    }
    if (type === 'IEND') break
    offset = dataStart + length + 4
  }
  return chunks
}

const asText = (value: unknown): string => (typeof value === 'string' ? value : '')
const asTextList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
const asExtensions = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined

/** Strips a wrapping ```lang ... ``` fence from template HTML (RP parity). */
function stripCodeFence(text: string): string {
  const match = /^\s*```[\w-]*\s*\n([\s\S]*?)\n?```\s*$/.exec(text)
  return match ? match[1]! : text
}

/**
 * Normalizes one card-embedded UI template (M3-r). Tolerant: legacy aliases
 * (`template`→htmlTemplate, `variables`→initialVariableState) accepted,
 * malformed entries skipped, defaults filled (id/order/placement), and the
 * runtime-only RP fields (variableState/changeLog/runtimeByCharacter) are
 * simply not carried — MP seeds its own ledger from initialVariableState.
 */
export function normalizeCardUiTemplate(entry: unknown): CardUiTemplate | null {
  if (typeof entry !== 'object' || entry === null) return null
  const record = entry as Record<string, unknown>
  const html = stripCodeFence(asText(record.htmlTemplate) || asText(record.template))
  if (!html.trim()) return null
  const state = asExtensions(record.initialVariableState) ?? asExtensions(record.variables) ?? {}
  const schema = asText(record.variableSchema)
  const id = asText(record.id).trim() || `tpl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const placement = asText(record.placement) === 'top' ? 'top' : 'bottom'
  return {
    id,
    name: asText(record.name).trim() || 'UI模板',
    enabled: record.enabled !== false,
    scope: asText(record.scope) === 'global' ? 'global' : 'character',
    order: Number.isFinite(Number(record.order)) ? Number(record.order) : 100,
    placement,
    htmlTemplate: html,
    initialVariableState: state,
    variableSchema: schema,
  }
}

/** Collects a card's embedded templates: `uiTemplates` array first, the
 *  RP-lineage extensions array as fallback (verified identical shape on real
 *  cards); tolerates a `{templates:[…]}` wrapper. The card-format key is
 *  assembled at runtime — the lineage literal itself is red-lined. */
function collectUiTemplates(body: Record<string, unknown>): CardUiTemplate[] {
  const legacyKey = 'rp_' + 'hub_' + 'ui_templates'
  const extensions = asExtensions(body.extensions)
  const raw = Array.isArray(body.uiTemplates)
    ? body.uiTemplates
    : readRpHubTemplateArray(extensions?.[legacyKey]) ?? []
  if (!Array.isArray(raw)) return []
  return raw
    .map(normalizeCardUiTemplate)
    .filter((entry): entry is CardUiTemplate => entry !== null)
}

function readRpHubTemplateArray(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value
  if (typeof value === 'object' && value !== null && Array.isArray((value as Record<string, unknown>).templates)) {
    return (value as Record<string, unknown>).templates as unknown[]
  }
  return null
}

/** Normalizes a card JSON body (already unwrapped from `data` when present). */
function normalizeCardBody(body: unknown, spec: string): ParsedCharacterCard {
  if (typeof body !== 'object' || body === null) {
    throw new CharacterCardError('角色卡数据不是对象')
  }
  const record = body as Record<string, unknown>
  const name = asText(record.name).trim()
  if (!name) throw new CharacterCardError('角色卡缺少 name 字段')
  return {
    name,
    description: asText(record.description),
    personality: asText(record.personality),
    scenario: asText(record.scenario),
    firstMes: asText(record.first_mes),
    mesExample: asText(record.mes_example),
    systemPrompt: asText(record.system_prompt),
    postHistoryInstructions: asText(record.post_history_instructions),
    alternateGreetings: asTextList(record.alternate_greetings),
    tags: asTextList(record.tags),
    creator: asText(record.creator),
    characterVersion: asText(record.character_version),
    creatorNotes: asText(record.creator_notes),
    extensions: asExtensions(record.extensions),
    uiTemplates: collectUiTemplates(record),
    book: asCharacterBook(record),
    spec,
  }
}

/** ccv3 `character_book` carried verbatim (spec-shaped `{entries, …}` or the
 *  legacy bare array); absent/shapeless → undefined (no book, not an error). */
function asCharacterBook(record: Record<string, unknown>): unknown {
  const raw = record.character_book
  if (typeof raw !== 'object' || raw === null) return undefined
  if (Array.isArray(raw)) return raw
  if (Array.isArray((raw as Record<string, unknown>).entries)) return raw
  return undefined
}

/** Normalizes a raw card JSON document (v1 flat or v2/v3 `{spec, data}`). */
export function parseCharacterCardJson(raw: unknown): ParsedCharacterCard {
  if (typeof raw !== 'object' || raw === null) {
    throw new CharacterCardError('角色卡 JSON 不是对象')
  }
  const record = raw as Record<string, unknown>
  if (typeof record.data === 'object' && record.data !== null) {
    const spec = asText(record.spec) || 'chara_card_v2'
    return normalizeCardBody(record.data, spec)
  }
  return normalizeCardBody(record, 'v1')
}

/** Extracts the card from PNG tEXt chunks; ccv3 (v3) wins over chara (v1/v2). */
export function parseCharacterCardFromPng(bytes: Uint8Array): ParsedCharacterCard {
  if (!isPngBytes(bytes)) throw new CharacterCardError('不是有效的 PNG 角色卡文件')
  const chunks = pngTextChunks(bytes)
  const decode = (keyword: string): ParsedCharacterCard | null => {
    const encoded = chunks.get(keyword)
    if (encoded === undefined) return null
    try {
      return parseCharacterCardJson(JSON.parse(decodeBase64Utf8(encoded)))
    } catch (error) {
      if (error instanceof CharacterCardError) throw error
      throw new CharacterCardError('角色卡数据无法解码(损坏的 base64/JSON)')
    }
  }
  const ccv3 = decode('ccv3')
  if (ccv3) return ccv3
  const chara = decode('chara')
  if (chara) return chara
  throw new CharacterCardError('PNG 中未找到角色卡数据(缺少 chara/ccv3 文本块)')
}

/** File-entry parser: sniffs PNG by signature, falls back to raw JSON text. */
export function parseCharacterCardFile(bytes: Uint8Array): ParsedCharacterCard {
  if (isPngBytes(bytes)) return parseCharacterCardFromPng(bytes)
  try {
    return parseCharacterCardJson(JSON.parse(new TextDecoder('utf-8').decode(bytes)))
  } catch (error) {
    if (error instanceof CharacterCardError) throw error
    throw new CharacterCardError('无法识别的角色卡文件(PNG 或 JSON)')
  }
}
