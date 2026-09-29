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
  importedAt: number
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

function isPng(bytes: Uint8Array): boolean {
  return PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)
}

function decodeBase64Utf8(base64: string): string {
  const compact = base64.replace(/\s+/g, '')
  const binary = atob(compact)
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  return new TextDecoder('utf-8').decode(bytes)
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
    spec,
  }
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
  if (!isPng(bytes)) throw new CharacterCardError('不是有效的 PNG 角色卡文件')
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
  if (isPng(bytes)) return parseCharacterCardFromPng(bytes)
  try {
    return parseCharacterCardJson(JSON.parse(new TextDecoder('utf-8').decode(bytes)))
  } catch (error) {
    if (error instanceof CharacterCardError) throw error
    throw new CharacterCardError('无法识别的角色卡文件(PNG 或 JSON)')
  }
}
