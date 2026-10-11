import { describe, expect, it } from 'vitest'
import { buildNarrativeStyleBlock, harmonizeConflicts } from '../../src/kernel/nstyle/prompt'
import { DEFAULT_STORY_CONFIG } from '../../src/kernel/nstyle/types'
import type { NstyleConfig, NstyleParamKey } from '../../src/kernel/nstyle/types'

const config = (overrides: { params?: Partial<Record<NstyleParamKey, number>>; narration?: Partial<NstyleConfig['narration']>; tags?: string[] }): NstyleConfig => ({
  params: { ...DEFAULT_STORY_CONFIG.params, ...(overrides.params ?? {}) },
  narration: { ...DEFAULT_STORY_CONFIG.narration, ...(overrides.narration ?? {}) },
  tags: overrides.tags ?? [],
})

describe('叙事风格提示词构建器(M4-nstyle)', () => {
  it('块以【叙事风格】开头并包含 12 项参数、叙述方式与人格护栏', () => {
    const block = buildNarrativeStyleBlock(config({}))
    expect(block.startsWith('【叙事风格】')).toBe(true)
    expect(block).toContain('对话密度')
    expect(block).toContain('留白程度')
    expect(block).toContain('叙述视角')
    expect(block).toContain('篇幅')
    expect(block).toContain('不得改写角色已确立的价值观、身份、关系与世界观事实')
  })

  it('不同参数组合产生不同的叙事指令', () => {
    const highDialogue = buildNarrativeStyleBlock(config({ params: { dialogue: 80 } }))
    const lowDialogue = buildNarrativeStyleBlock(config({ params: { dialogue: 20 } }))
    expect(highDialogue).toContain('优先以人物对话推进场景')
    expect(lowDialogue).toContain('对话从简')
    expect(highDialogue).not.toBe(lowDialogue)
  })

  it('参数处于默认值时也有明确措辞(默认不是空档)', () => {
    const block = buildNarrativeStyleBlock(config({}))
    expect(block).toContain('优先以人物对话推进场景')
    expect(block).toContain('节奏适中')
  })

  it('低值不等于禁止:仍给出有内容的方向性措辞', () => {
    const block = buildNarrativeStyleBlock(config({ params: { environment: 10 } }))
    expect(block).toContain('只保留理解剧情所必需的最低限度')
  })

  it('叙述方式选项翻译为对应指令', () => {
    const block = buildNarrativeStyleBlock(config({
      narration: { viewpoint: 'thirdLimited', length: 'concise', language: 'literary', monologue: 'off' },
    }))
    expect(block).toContain('第三人称有限视角')
    expect(block).toContain('只跟随视角人物的所知所感')
    expect(block).toContain('一到两段')
    expect(block).toContain('文学化')
    expect(block).toContain('不要插入成段的内心独白')
  })

  it('标签注入为整体基调,并处理已知冲突组合', () => {
    const block = buildNarrativeStyleBlock(config({ tags: ['黑暗', '幽默'] }))
    expect(block).toContain('整体基调标签：黑暗、幽默')
    expect(block).toContain('黑色幽默的反差')
  })

  it('参数冲突输出协调措辞', () => {
    const notes = harmonizeConflicts(config({ params: { dialogue: 90, narration: 90 } }))
    expect(notes.length).toBeGreaterThan(0)
    const block = buildNarrativeStyleBlock(config({ params: { dialogue: 90, narration: 90 } }))
    expect(block).toContain('对话推现场，旁白负责收束与转场')
  })

  it('请求纪律:块内不出现变量标签字面量', () => {
    const block = buildNarrativeStyleBlock(config({ tags: ['紧张'] }))
    expect(block).not.toContain('<setvars>')
  })
})
