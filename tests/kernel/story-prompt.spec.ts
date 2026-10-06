import { describe, expect, it } from 'vitest'
import {
  buildStoryPromptBlock,
  parseStoryStages,
  DEFAULT_STORY_PRINCIPLES,
  DEFAULT_STORY_STAGES,
} from '../../src/kernel/app/story-prompt'

describe('故事引擎提示块(M4-e)', () => {
  it('默认文案可用:原则非空、阶段表四阶段且无危险段', () => {
    expect(DEFAULT_STORY_PRINCIPLES).toContain('以角色身份行动')
    expect(DEFAULT_STORY_PRINCIPLES).not.toContain('__proto__')
    expect(DEFAULT_STORY_STAGES.map((stage) => stage.name)).toEqual(['初识', '熟悉', '亲近', '交付'])
  })

  it('parseStoryStages:字符串 JSON / 数组 / 脏数据', () => {
    expect(parseStoryStages('[{"name":"初识","guide":"防备"}]')).toEqual([{ name: '初识', guide: '防备' }])
    expect(parseStoryStages([{ name: ' 熟悉 ', guide: '放松' }])).toEqual([{ name: '熟悉', guide: '放松' }])
    expect(parseStoryStages('{broken')).toEqual([])
    expect(parseStoryStages([{ guide: '无名条目' }])).toEqual([])
    expect(parseStoryStages(undefined)).toEqual([])
  })

  it('完整配置:三段齐出,当前阶段标注(当前),记账含顺序与 setvars 格式', () => {
    const block = buildStoryPromptBlock(
      {
        principles: '以角色身份行动,不当助手。',
        stages: [
          { name: '初识', guide: '防备' },
          { name: '熟悉', guide: '放松' },
        ],
        bookkeeping: true,
      },
      '熟悉',
    )
    expect(block).toContain('【叙事原则】')
    expect(block).toContain('【关系阶段】当前阶段：熟悉')
    expect(block).toContain('- 初识：防备')
    expect(block).toContain('- 熟悉（当前）：放松')
    expect(block).toContain('【阶段记账】')
    // 请求双剥纪律:提示块里不得出现变量标签字面量。
    expect(block).not.toContain('<setvars>')
    expect(block).toContain('初识 → 熟悉')
  })

  it('当前阶段不在表内时回落首个阶段', () => {
    const block = buildStoryPromptBlock(
      { principles: '', stages: DEFAULT_STORY_STAGES, bookkeeping: false },
      '不存在',
    )
    expect(block).toContain('当前阶段：初识')
    expect(block).not.toContain('【叙事原则】')
    expect(block).not.toContain('【阶段记账】')
  })

  it('全空配置返回空串(调用方跳过注入)', () => {
    expect(buildStoryPromptBlock({ principles: '', stages: [], bookkeeping: true }, '')).toBe('')
  })
})
