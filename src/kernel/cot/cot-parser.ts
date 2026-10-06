/**
 * CoT tag parser (M4-f, native) — RP parseCot behavior internalized
 * (behavior source: kernel/lib/shared-utils.mjs, not a code port). Extracts
 * <think>/<cot> thinking blocks from a reply, leaving the main prose behind.
 *
 * Streaming discipline: the cache is keyed on the FULL text. A streaming
 * reply produces dozens of ever-longer prefixes, each an independent key
 * holding a full copy — O(n²) memory on one message (RP's measured pitfall).
 * Two layers: an LRU for completed text, and a single volatile slot for the
 * message currently generating (MessageList-grade renderers call the parser
 * 3–5 times per render pass, so one slot absorbs those repeats without
 * accumulating). Cap = limits.parseCotCache (asserted by tests).
 */

import { LruCache, limits } from '@/kernel/runtime/runtime-policy'

export interface CotParseResult {
  /** Thinking-block text (concatenated when the reply has several), `<`
   *  escaped outside code spans so sanitizers cannot eat prose like `<动作>`. */
  cot: string
  /** The reply with thinking blocks removed — the display/request prose. */
  main: string
  /** True once a closing tag (or a repeated opening tag) was seen. */
  isFinished: boolean
}

const completedCache = new LruCache<string, CotParseResult>(limits.parseCotCache)
let volatileKey: string | null = null
let volatileValue: CotParseResult | null = null

/** Matches <think>/<cot> blocks, tolerating the ecosystem's malformed output:
 *  space inside the closing tag (</think >), a missing slash on the closer
 *  (<cot>…<cot>), and an unterminated block (runs to end of input). */
const COT_PATTERN = /<(think|cot)>([\s\S]*?)(?:<\/\s*\1\s*>|<\s*\1\s*>|$)/gi

/** Escapes `<` so the thinking text survives sanitization, while fenced and
 *  inline code spans keep their literal bytes (copy/display fidelity). */
const escapeOutsideCode = (text: string): string =>
  text
    .split(/(```[\s\S]*?```|`[^`]+`)/)
    .map((part, index) => (index % 2 === 1 ? part : part.replace(/</g, '&lt;')))
    .join('')

export const parseCot = (text: string, cacheable = true): CotParseResult => {
  if (!text) return { cot: '', main: '', isFinished: false }
  if (cacheable) {
    const cached = completedCache.get(text)
    if (cached) return cached
  } else if (volatileKey === text) {
    return volatileValue!
  }

  let cot = ''
  let isFinished = false
  const main = text.replace(COT_PATTERN, (match, tag: string, content: string) => {
    cot += escapeOutsideCode(content)
    // A closing tag, or a second opening tag of the same kind (models that
    // forget the slash), both mean the thinking phase has ended.
    if (match.includes('</') || (match.match(new RegExp(`<${tag}>`, 'gi')) ?? []).length > 1) {
      isFinished = true
    }
    return ''
  })

  const result: CotParseResult = { cot: cot.trim(), main: main.trim(), isFinished }
  if (cacheable) {
    completedCache.set(text, result)
  } else {
    // Single-slot overwrite: the previous frame's prefix loses its last
    // reference here, so nothing accumulates.
    volatileKey = text
    volatileValue = result
  }
  return result
}

/**
 * Native reasoning extraction (RP card-utils extractNativeReasoning behavior
 * internalized) — reasoning/thinking text that rides OpenAI-compatible wire
 * objects OUTSIDE `content`: `reasoning_content` (DeepSeek/LM Studio),
 * `reasoning` (OpenRouter), `thinking`/`thought` variants, `reasoning_details`
 * arrays, and content-parts typed reasoning. The whole family is accepted
 * because providers disagree on the key; a miss is simply no reasoning.
 */

const REASONING_DIRECT_KEYS = [
  'reasoning_content',
  'reasoning',
  'thinking',
  'thinking_content',
  'thought',
  'thoughts',
  'reasoning_text',
] as const

const REASONING_PART_TYPE_PATTERN = /reason|thinking|thought/i

const normalizeReasoningPart = (value: unknown): string => {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(normalizeReasoningPart).join('')
  if (typeof value === 'object') {
    for (const key of ['text', 'content', 'summary', 'reasoning', 'reasoning_content', 'thinking', 'thought', 'value']) {
      const text = normalizeReasoningPart((value as Record<string, unknown>)[key])
      if (text) return text
    }
    return ''
  }
  return String(value)
}

export const extractNativeReasoning = (source: unknown): string => {
  if (!source || typeof source !== 'object') return ''
  const record = source as Record<string, unknown>
  for (const key of REASONING_DIRECT_KEYS) {
    const text = normalizeReasoningPart(record[key])
    if (text) return text
  }
  if (Array.isArray(record.reasoning_details)) {
    return normalizeReasoningPart(record.reasoning_details)
  }
  if (Array.isArray(record.content)) {
    return (record.content as Array<{ type?: string }>)
      .map((part) => (part && REASONING_PART_TYPE_PATTERN.test(String(part.type ?? '')) ? normalizeReasoningPart(part) : ''))
      .join('')
  }
  return ''
}
