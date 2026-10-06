import { describe, expect, it } from 'vitest'
import { buildCotPresetContent, usesThinkingCotTag } from '@/kernel/cot/cot-builder'

describe('kernel/cot · cot-builder (M4-f)', () => {
  it('the COT system preset carries the thinking protocol and closing instruction', () => {
    const content = buildCotPresetContent()
    expect(content).toContain('<thinking_protocol>')
    expect(content).toContain('</thinking_protocol>')
    expect(content).toContain('在<cot>标签中输出包含')
    expect(content).toContain('[情景意图分析]')
    expect(content).toContain('[设定分析]')
    expect(content).toContain('[信息边界]')
    expect(content).toContain('[剧情规划]')
    expect(content).toContain('[最终检查]')
    expect(content).toContain('最后输出</cot>闭合标签后再进行正式的输出')
  })

  it('model name picks the tag — deepseek/glm/kimi get <thinking> with Chinese instruction', () => {
    expect(usesThinkingCotTag('deepseek-r1')).toBe(true)
    expect(usesThinkingCotTag('glm-4')).toBe(true)
    expect(usesThinkingCotTag('kimi-k2')).toBe(true)
    expect(usesThinkingCotTag('qwen3.5')).toBe(false)
    const thinking = buildCotPresetContent({ useThinkingOpening: true })
    expect(thinking).toContain('在<thinking>标签中使用中文输出包含')
    expect(thinking).toContain('最后输出</thinking>闭合标签')
  })

  it('memory and variable-analysis states toggle their sections', () => {
    expect(buildCotPresetContent({ memoryEnabled: true })).toContain('[记忆整理]')
    expect(buildCotPresetContent()).not.toContain('[记忆整理]')
    expect(buildCotPresetContent({ variablesAnalysisEnabled: true })).toContain('[变量更新分析]')
    expect(buildCotPresetContent()).not.toContain('[变量更新分析]')
  })

  it('prefill phases pre-open the thinking block over the seed content', () => {
    const base = '破限原文正文'
    const phase1 = buildCotPresetContent({ prefillPhase: 1, prefillEnabled: true, prefillBaseContent: base })
    expect(phase1.startsWith('<cot>')).toBe(true)
    expect(phase1).toContain('先分析续写难点')
    expect(phase1.endsWith(base)).toBe(true)
    const phase2 = buildCotPresetContent({ prefillPhase: 2, prefillEnabled: true, prefillBaseContent: base })
    expect(phase2).toContain('从最后一个真实事件接着写')
  })

  it('a disabled COT entry reverts the prefill to the stripped seed content', () => {
    const base = '<cot>种子自带的思考</cot>破限原文正文'
    const reverted = buildCotPresetContent({ prefillPhase: 1, prefillEnabled: false, prefillBaseContent: base })
    expect(reverted).not.toContain('<cot>')
    expect(reverted).not.toContain('种子自带的思考')
    expect(reverted).toContain('破限原文正文')
  })
})
