import { describe, expect, it } from 'vitest'
import { extractNativeReasoning, parseCot } from '@/kernel/cot/cot-parser'

describe('kernel/cot · parseCot (M4-f)', () => {
  it('extracts a closed block and leaves the prose behind', () => {
    const result = parseCot('<cot>先分析剧情</cot>正文开始。')
    expect(result.cot).toBe('先分析剧情')
    expect(result.main).toBe('正文开始。')
    expect(result.isFinished).toBe(true)
  })

  it('accepts both tag spellings and concatenates multiple blocks', () => {
    const result = parseCot('<think>第一步</think>中段<think>第二步</think>结尾')
    expect(result.cot).toBe('第一步第二步')
    expect(result.main).toBe('中段结尾')
    expect(result.isFinished).toBe(true)
  })

  it('tolerates an unterminated block (thinking still streaming)', () => {
    const result = parseCot('<cot>想到一半')
    expect(result.cot).toBe('想到一半')
    expect(result.main).toBe('')
    expect(result.isFinished).toBe(false)
  })

  it('tolerates a repeated opening tag where the closer should be', () => {
    // The second <cot> acts as the closer (RP semantics): thinking ends there,
    // and the text after it stays in the prose — the model "forgot the slash"
    // but kept writing the reply.
    const result = parseCot('<cot>模型忘了斜杠<cot>后面的正文')
    expect(result.cot).toBe('模型忘了斜杠')
    expect(result.main).toBe('后面的正文')
    expect(result.isFinished).toBe(true)
  })

  it('tolerates spaces inside the closing tag', () => {
    const result = parseCot('<think>思考</think >正文')
    expect(result.cot).toBe('思考')
    expect(result.main).toBe('正文')
  })

  it('escapes < in thinking text so sanitizers cannot eat prose tags', () => {
    // Only `<` is escaped (RP semantics) — `>` stays literal so markdown
    // blockquote syntax inside thinking survives.
    const result = parseCot('<cot>她的表情 <动作> 很轻</cot>正文')
    expect(result.cot).toContain('&lt;动作>')
    expect(result.cot).not.toContain('<动作>')
  })

  it('keeps code spans literal inside thinking text', () => {
    const result = parseCot('<cot>用 `<div>` 标签</cot>正文')
    expect(result.cot).toContain('`<div>`')
  })

  it('returns empty parts for empty input', () => {
    expect(parseCot('')).toEqual({ cot: '', main: '', isFinished: false })
  })

  it('a reply without thinking tags passes through untouched', () => {
    const result = parseCot('纯正文，没有思考。')
    expect(result).toEqual({ cot: '', main: '纯正文，没有思考。', isFinished: false })
  })

  it('completed texts hit the cache; streaming prefixes ride the volatile slot', () => {
    const first = parseCot('<cot>a</cot>b')
    const second = parseCot('<cot>a</cot>b')
    expect(second).toBe(first)
    // cacheable=false keeps the completed layer clean but still dedupes the
    // current streaming prefix.
    const stream1 = parseCot('<cot>流式前缀', false)
    const stream2 = parseCot('<cot>流式前缀', false)
    expect(stream2).toBe(stream1)
    expect(stream1.cot).toBe('流式前缀')
  })
})

describe('kernel/cot · extractNativeReasoning (M4-f)', () => {
  it('reads the reasoning_content family off a delta', () => {
    expect(extractNativeReasoning({ reasoning_content: '深度思考' })).toBe('深度思考')
    expect(extractNativeReasoning({ reasoning: 'openrouter 形状' })).toBe('openrouter 形状')
    expect(extractNativeReasoning({ thinking: 'thinking 形状' })).toBe('thinking 形状')
  })

  it('reads reasoning_details arrays and reasoning-typed content parts', () => {
    expect(extractNativeReasoning({ reasoning_details: [{ text: 'A' }, { text: 'B' }] })).toBe('AB')
    expect(
      extractNativeReasoning({ content: [{ type: 'reasoning', reasoning: 'parts 形状' }, { type: 'text', text: '正文' }] }),
    ).toBe('parts 形状')
  })

  it('returns empty for plain deltas and non-objects', () => {
    expect(extractNativeReasoning({ content: '普通增量' })).toBe('')
    expect(extractNativeReasoning(null)).toBe('')
    expect(extractNativeReasoning('字符串')).toBe('')
  })
})
