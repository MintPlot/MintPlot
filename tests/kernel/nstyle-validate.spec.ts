import { describe, expect, it } from 'vitest'
import { clampParams, parseNstyleConfig, parseProfile } from '../../src/kernel/nstyle/validate'
import { DEFAULT_STORY_PARAMS } from '../../src/kernel/nstyle/types'

describe('叙事风格校验(M4-nstyle)', () => {
  it('参数钳制到 0–100,非法值回落默认', () => {
    const params = clampParams({ dialogue: 250, psychology: -20, environment: 'NaN?', pacing: 33.7 })
    expect(params.dialogue).toBe(100)
    expect(params.psychology).toBe(0)
    expect(params.environment).toBe(DEFAULT_STORY_PARAMS.environment)
    expect(params.pacing).toBe(34)
    expect(params.subtext).toBe(DEFAULT_STORY_PARAMS.subtext)
  })

  it('配置解析:缺失字段回落默认,叙述方式非法值回落', () => {
    const config = parseNstyleConfig({})
    expect(config.params).toEqual(DEFAULT_STORY_PARAMS)
    expect(config.narration.viewpoint).toBe('auto')
    expect(config.tags).toEqual([])

    const bad = parseNstyleConfig({ tags: ['ok', 42, ''], narration: { viewpoint: '第四人称' } })
    expect(bad.narration.viewpoint).toBe('auto')
    expect(bad.tags).toEqual(['ok'])
  })

  it('导入校验:拒绝缺 ID/缺名称/内置保留 ID', () => {
    expect(parseProfile({ name: '无ID' }).ok).toBe(false)
    expect(parseProfile({ id: 'x' }).ok).toBe(false)
    expect(parseProfile({ id: 'preset-balanced', name: '冒充内置' }).ok).toBe(false)
    expect(parseProfile(null).ok).toBe(false)
  })

  it('导入校验:合法档案通过且字段被钳制/修剪', () => {
    const parsed = parseProfile({
      id: '  custom-1  ',
      name: '  我的风  ',
      description: '测试',
      config: { params: { dialogue: 999, environment: -5 }, tags: ['温柔', ' 温柔 ', 7] },
      version: 99,
      createdAt: 123,
      updatedAt: 456,
    })
    expect(parsed.ok).toBe(true)
    expect(parsed.profile?.id).toBe('custom-1')
    expect(parsed.profile?.name).toBe('我的风')
    expect(parsed.profile?.config.params.dialogue).toBe(100)
    expect(parsed.profile?.config.params.environment).toBe(0)
    expect(parsed.profile?.config.tags).toEqual(['温柔'])
    expect(parsed.profile?.version).toBe(1)
    expect(parsed.profile?.updatedAt).toBe(456)
  })
})
