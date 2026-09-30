import { describe, expect, it } from 'vitest'
import {
  CharacterCardError,
  isPngBytes,
  parseCharacterCardFile,
  parseCharacterCardFromPng,
  parseCharacterCardJson,
  pngDataUrl,
} from '@/kernel/characters/character-card'

/** Builds a minimal PNG (signature + IHDR + tEXt chunks + IEND); CRC bytes stay zero. */
function buildPng(textChunks: Array<{ keyword: string; text: string }>): Uint8Array {
  const chunk = (type: string, data: Uint8Array): Uint8Array => {
    const out = new Uint8Array(12 + data.length)
    new DataView(out.buffer).setUint32(0, data.length)
    for (let index = 0; index < 4; index += 1) out[4 + index] = type.charCodeAt(index)
    out.set(data, 8)
    return out
  }
  const parts: Uint8Array[] = [
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', new Uint8Array(13)),
  ]
  for (const { keyword, text } of textChunks) {
    const keywordBytes = new TextEncoder().encode(keyword)
    const textBytes = new TextEncoder().encode(text)
    const data = new Uint8Array(keywordBytes.length + 1 + textBytes.length)
    data.set(keywordBytes, 0)
    data.set(textBytes, keywordBytes.length + 1)
    parts.push(chunk('tEXt', data))
  }
  parts.push(chunk('IEND', new Uint8Array(0)))
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

function toBase64(text: string): string {
  let binary = ''
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte)
  return btoa(binary)
}

const v2Card = {
  spec: 'chara_card_v2',
  spec_version: '2.0',
  data: {
    name: 'Mint Cat',
    description: 'A mint-green cat',
    personality: 'curious',
    scenario: 'a quiet studio',
    first_mes: '喵?',
    mes_example: '<START>',
    system_prompt: '',
    tags: ['cat', 42, 'mint'],
    alternate_greetings: ['hello', null],
    creator: 'mintplot',
    character_version: '1.0',
  },
}

describe('kernel/characters · character card parsing (M3-f)', () => {
  it('parses a v2 card from the chara tEXt chunk, coercing hostile field types', () => {
    const card = parseCharacterCardFromPng(buildPng([{ keyword: 'chara', text: toBase64(JSON.stringify(v2Card)) }]))
    expect(card.spec).toBe('chara_card_v2')
    expect(card.name).toBe('Mint Cat')
    expect(card.description).toBe('A mint-green cat')
    expect(card.firstMes).toBe('喵?')
    expect(card.tags).toEqual(['cat', 'mint'])
    expect(card.alternateGreetings).toEqual(['hello'])
  })

  it('prefers ccv3 over chara when both chunks ride along', () => {
    const png = buildPng([
      { keyword: 'chara', text: toBase64(JSON.stringify(v2Card)) },
      { keyword: 'ccv3', text: toBase64(JSON.stringify({ spec: 'chara_card_v3', data: { name: 'V3 Cat' } })) },
    ])
    const card = parseCharacterCardFromPng(png)
    expect(card.spec).toBe('chara_card_v3')
    expect(card.name).toBe('V3 Cat')
  })

  it('normalizes a v1 flat card (no data wrapper)', () => {
    const card = parseCharacterCardJson({ name: 'Old Card', description: 'v1 shape', first_mes: 'hi' })
    expect(card.spec).toBe('v1')
    expect(card.name).toBe('Old Card')
    expect(card.firstMes).toBe('hi')
  })

  it('parses a bare JSON file by sniffing the signature', () => {
    const card = parseCharacterCardFile(new TextEncoder().encode(JSON.stringify(v2Card)))
    expect(card.name).toBe('Mint Cat')
  })

  it('rejects broken inputs with UI-facing errors', () => {
    expect(() => parseCharacterCardFromPng(new Uint8Array([1, 2, 3]))).toThrow(CharacterCardError)
    expect(() => parseCharacterCardFromPng(buildPng([]))).toThrow('未找到角色卡数据')
    expect(() => parseCharacterCardFromPng(buildPng([{ keyword: 'chara', text: 'not-base64!!' }]))).toThrow('无法解码')
    expect(() => parseCharacterCardJson({ description: 'no name' })).toThrow('缺少 name 字段')
    expect(() => parseCharacterCardFile(new TextEncoder().encode('just text'))).toThrow('无法识别的角色卡文件')
  })

  it('non-object bodies fail cleanly; a non-object data wrapper falls through to v1 rules', () => {
    expect(() => parseCharacterCardJson('nope')).toThrow('不是对象')
    expect(() => parseCharacterCardJson({ spec: 'chara_card_v2', data: 'flat string' })).toThrow('缺少 name 字段')
  })

  it('isPngBytes sniffs the signature for the import-path cover decision (M3-m)', () => {
    expect(isPngBytes(buildPng([]))).toBe(true)
    expect(isPngBytes(new TextEncoder().encode('{"name":"x"}'))).toBe(false)
    expect(isPngBytes(new Uint8Array(0))).toBe(false)
  })

  it('pngDataUrl round-trips bytes, chunked beyond the call-stack-safe spread size (M3-m)', () => {
    const bytes = new Uint8Array(100_000)
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = index % 251
    const url = pngDataUrl(bytes)
    expect(url.startsWith('data:image/png;base64,')).toBe(true)
    const decoded = atob(url.slice(url.indexOf(',') + 1))
    expect(decoded.length).toBe(bytes.length)
    for (let index = 0; index < bytes.length; index += 1) {
      expect(decoded.charCodeAt(index)).toBe(bytes[index]!)
    }
  })

  it('passes the card extensions object through verbatim (M3-q, D8)', () => {
    const extensions = {
      mp_variables: [{ name: '好感度', value: 10, description: '当前好感' }],
      character_book: { entries: [] },
    }
    const card = parseCharacterCardJson({ spec: 'chara_card_v2', data: { name: '星澜', extensions } })
    expect(card.extensions).toEqual(extensions)
  })

  it('leaves extensions undefined on cards without the field (pre-M3-q records)', () => {
    expect(parseCharacterCardJson({ name: '星澜' }).extensions).toBeUndefined()
    expect(parseCharacterCardJson({ name: '星澜', extensions: 'not-an-object' }).extensions).toBeUndefined()
  })
})
