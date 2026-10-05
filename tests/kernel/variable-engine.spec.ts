import { describe, expect, it, vi } from 'vitest'
import type { VariableState } from '@contracts'
import {
  applyTemplateUpdates,
  expandGetvarMacros,
  manualValueFromInput,
  matchTemplateUpdates,
  parseTemplateUpdateBlocks,
  parseTemplateUpdatePayload,
  parseVariableUpdates,
  readCardVariableDefaults,
  renderTemplateUpdateSection,
  renderVariablesSection,
  replayVariableState,
  resolveUpdateValue,
  stripVariableBlocks,
  VARIABLE_VALUE_MAX_LENGTH,
} from '@/kernel/variables/variable-engine'

describe('kernel/variables · tag-block parsing (M3-q, D4 双约定)', () => {
  it('parses scalar / ±delta / null entries out of a setvars block', () => {
    const { updates } = parseVariableUpdates(
      '正文 <setvars>{ "好感度": 45, "时间": "黄昏", "金钱": "+120", "任务": null }</setvars> 尾巴',
    )
    expect(updates).toEqual([
      { name: '好感度', raw: 45 },
      { name: '时间', raw: '黄昏' },
      { name: '金钱', raw: '+120' },
      { name: '任务', raw: null },
    ])
  })

  it('accepts the StatData school tag, attributes and case-insensitive names', () => {
    expect(parseVariableUpdates('<StatData>{"金币": 3}</StatData>').updates).toEqual([{ name: '金币', raw: 3 }])
    expect(parseVariableUpdates('<SETVARS data-x="1">{"a":1}</SETVARS>').updates).toEqual([{ name: 'a', raw: 1 }])
    expect(parseVariableUpdates('<statdata>{"b":2}</statdata>').updates).toEqual([{ name: 'b', raw: 2 }])
  })

  it('merges multiple blocks; the first block wins on duplicate names', () => {
    const { updates } = parseVariableUpdates(
      '<setvars>{"a":1,"b":2}</setvars>中段<StatData>{"a":9,"c":3}</StatData>',
    )
    expect(updates).toEqual([
      { name: 'a', raw: 1 },
      { name: 'b', raw: 2 },
      { name: 'c', raw: 3 },
    ])
  })

  it('ignores malformed blocks without losing the rest (review §07)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const { updates } = parseVariableUpdates('<setvars>{broken</setvars><setvars>{"b":2}</setvars>')
      expect(updates).toEqual([{ name: 'b', raw: 2 }])
      expect(warnSpy).toHaveBeenCalled()
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('drops non-object bodies and non-scalar values, trims names, coerces booleans', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const { updates } = parseVariableUpdates(
        '<setvars>[1,2]</setvars><setvars>{ " 名 ": "v", "": "x", "flag": true, "deep": {"a":1}, "list": [1], "n": null }</setvars>',
      )
      expect(updates).toEqual([
        { name: '名', raw: 'v' },
        { name: 'flag', raw: 'true' },
        { name: 'n', raw: null },
      ])
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('returns no updates for plain floors', () => {
    expect(parseVariableUpdates('普通楼层').updates).toEqual([])
    expect(parseVariableUpdates('').updates).toEqual([])
  })
})

describe('kernel/variables · display projection & delta semantics', () => {
  it('strips tag blocks for display only, keeping the surrounding text', () => {
    expect(stripVariableBlocks('前文<setvars>{"a":1}</setvars>后文')).toBe('前文后文')
    expect(stripVariableBlocks('<StatData>{"a":1}</StatData>开头')).toBe('开头')
    expect(stripVariableBlocks('<setvars>{"a":1}</setvars>\n中段\n<StatData>{"b":2}</StatData>')).toBe('中段')
  })

  it('resolves ±deltas against the current value, absolute otherwise', () => {
    expect(resolveUpdateValue(45, 10)).toBe(45)
    expect(resolveUpdateValue('黄昏', null)).toBe('黄昏')
    expect(resolveUpdateValue('+120', 45)).toBe(165)
    expect(resolveUpdateValue('-50', 45)).toBe(-5)
    expect(resolveUpdateValue('+120', null)).toBe(120)
    expect(resolveUpdateValue('+120', '30')).toBe(150)
    expect(resolveUpdateValue('+5', '黄昏')).toBe('+5')
    expect(resolveUpdateValue(null, '黄昏')).toBeNull()
  })

  it('keeps bare numeric strings as strings, numbers as numbers (manual input)', () => {
    expect(manualValueFromInput('5')).toBe(5)
    expect(manualValueFromInput(' 5.5 ')).toBe(5.5)
    expect(manualValueFromInput('黄昏')).toBe('黄昏')
    expect(manualValueFromInput('+5')).toBe('+5')
    expect(manualValueFromInput('-5')).toBe('-5')
    expect(manualValueFromInput('')).toBeNull()
  })
})

describe('kernel/variables · getvar expansion & artifact section', () => {
  const state: Record<string, VariableState> = {
    好感度: { value: 45, updatedAt: 1, sourceEventId: 'ev-1' },
    时间: { value: '黄昏', updatedAt: 2, sourceEventId: 'ev-2' },
    金币: { value: 120, updatedAt: 3, sourceEventId: 'ev-3' },
  }
  const getState = (name: string): VariableState['value'] | undefined => state[name]?.value

  it('expands known variables and honors the default third parameter', () => {
    expect(expandGetvarMacros('好感{{getvar::好感度}}，{{getvar::时间}}好', getState)).toBe('好感45，黄昏好')
    expect(expandGetvarMacros('{{getvar::缺失::未知}}', getState)).toBe('未知')
    expect(expandGetvarMacros('{{getvar::缺失}}', getState)).toBe('')
  })

  it('matches the tag case-insensitively and trims the variable name', () => {
    expect(expandGetvarMacros('{{GetVar:: 好感度 }}', getState)).toBe('45')
  })

  it('leaves text without macros untouched', () => {
    expect(expandGetvarMacros('普通文本', getState)).toBe('普通文本')
    expect(expandGetvarMacros('', getState)).toBe('')
  })

  it('renders the compact [Variables] section; empty state renders nothing', () => {
    expect(renderVariablesSection({})).toBe('')
    expect(renderVariablesSection(state)).toBe('[Variables]\n当前状态: 好感度 45 ｜ 时间 黄昏 ｜ 金币 120')
  })
})

describe('kernel/variables · card defaults & replay projection', () => {
  it('reads extensions.mp_variables into seed defaults, skipping malformed rows', () => {
    expect(readCardVariableDefaults(undefined)).toEqual([])
    expect(readCardVariableDefaults({})).toEqual([])
    expect(readCardVariableDefaults({ mp_variables: 'not-an-array' })).toEqual([])
    expect(
      readCardVariableDefaults({
        mp_variables: [
          { name: '好感度', value: 10, description: '当前好感' },
          { name: '时间', value: '黄昏' },
          { name: '', value: 1 },
          { name: '无值' },
          { name: '空值', value: null },
          { name: '深值', value: { nested: true } },
          'not-an-object',
        ],
      }),
    ).toEqual([
      { name: '好感度', value: 10, description: '当前好感' },
      { name: '时间', value: '黄昏' },
    ])
  })

  it('clamps overlong default values to the quota', () => {
    const long = 'x'.repeat(VARIABLE_VALUE_MAX_LENGTH + 10)
    expect(readCardVariableDefaults({ mp_variables: [{ name: '长值', value: long }] })).toEqual([
      { name: '长值', value: 'x'.repeat(VARIABLE_VALUE_MAX_LENGTH) },
    ])
  })

  it('replays seed ⊕ events deterministically; deletions remove rows', () => {
    const seed = [{ name: '好感度', value: 10 }, { name: '时间', value: '清晨' }]
    const events = [
      { id: 'ev-1', ts: 100, name: '好感度', after: 45 },
      { id: 'ev-2', ts: 200, name: '金钱', after: '+120' as const },
      { id: 'ev-3', ts: 300, name: '时间', after: null },
    ]
    const state = replayVariableState(seed, events)
    expect(state['好感度']).toEqual({ value: 45, updatedAt: 100, sourceEventId: 'ev-1' })
    expect(state['金钱']).toEqual({ value: '+120', updatedAt: 200, sourceEventId: 'ev-2' })
    expect(state['时间']).toBeUndefined()
    expect(replayVariableState(seed, events)).toEqual(state)
  })

  it('labels seed-only rows with the seed anchor', () => {
    const state = replayVariableState([{ name: '好感度', value: 10 }], [])
    expect(state['好感度']).toEqual({ value: 10, updatedAt: 0, sourceEventId: 'seed' })
  })

  it('replay clones tree values so mutations never leak into events', () => {
    const seed = [{ name: 'tpl', value: { hp: 10 } as const }]
    const state = replayVariableState(seed, [])
    ;(state['tpl']!.value as { hp: number }).hp = 99
    expect(seed[0]!.value).toMatchObject({ hp: 10 })
  })
})

describe('kernel/variables · ui_template_updates protocol (M3-r)', () => {
  it('extracts blocks case-insensitively; strip removes them for display', () => {
    const text = '正文<ui_template_updates>{"hp":95}</ui_template_updates>尾'
    expect(parseTemplateUpdateBlocks(text)).toEqual(['{"hp":95}'])
    expect(stripVariableBlocks(text)).toBe('正文尾')
    expect(stripVariableBlocks('<UI_TEMPLATE_UPDATES>x</UI_TEMPLATE_UPDATES>前')).toBe('前')
    expect(parseTemplateUpdateBlocks('普通楼层')).toEqual([])
  })

  it('parses the updates-wrapped, single-variables and bare-object forms', () => {
    expect(parseTemplateUpdatePayload('{"updates":[{"id":"t1","variables":{"hp":95},"reason":"战斗"}]}')).toEqual([
      { id: 't1', variables: { hp: 95 }, reason: '战斗' },
    ])
    expect(parseTemplateUpdatePayload('{"variables":{"hp":95}}')).toEqual([{ variables: { hp: 95 } }])
    expect(parseTemplateUpdatePayload('{"hp":95,"location":"青茅山"}')).toEqual([{ variables: { hp: 95, location: '青茅山' } }])
    expect(parseTemplateUpdatePayload('```json\n{"hp":1}\n```')).toEqual([{ variables: { hp: 1 } }])
  })

  it('tolerates junk around the JSON and array variables become $root', () => {
    expect(parseTemplateUpdatePayload('前缀 {"hp":1} 尾巴')).toEqual([{ variables: { hp: 1 } }])
    const [entry] = parseTemplateUpdatePayload('{"variables":[1,2]}')
    expect(entry!.variables).toEqual({ $root: [1, 2] })
    expect(() => parseTemplateUpdatePayload('完全没有JSON')).toThrow()
    // Metadata-only bare objects carry no variables and are dropped.
    expect(parseTemplateUpdatePayload('{"reason":"无变化"}')).toEqual([])
  })

  it('apply deep-merges nested objects (unwritten fields keep their values)', () => {
    const state = { stats: { physique: { val: 5, bonus: 0 }, strength: { val: 8, bonus: 1 } }, hp: 100 }
    const { nextState, changedKeys, rejectedKeys } = applyTemplateUpdates(state, [{ variables: { stats: { physique: { val: 12 } } } }])
    expect(rejectedKeys).toEqual([])
    expect(changedKeys).toContain('stats')
    expect(nextState).toEqual({
      hp: 100,
      stats: { physique: { val: 12, bonus: 0 }, strength: { val: 8, bonus: 1 } },
    })
    // The input state is never mutated.
    expect(state.stats.physique.val).toBe(5)
  })

  it('apply replaces arrays wholesale, writes dotted paths, skips no-ops', () => {
    const state = { equipment: [{ slot: '武器', name: '短剑' }], location: '山' }
    const { nextState, changedKeys } = applyTemplateUpdates(state, [
      { variables: { equipment: [{ slot: '武器', name: '铁剑' }], location: '山' } },
      { variables: { location: '青茅山' } },
    ])
    expect(nextState.equipment).toEqual([{ slot: '武器', name: '铁剑' }])
    expect(nextState.location).toBe('青茅山')
    expect(changedKeys).toEqual(['equipment', 'location'])
  })

  it('apply enforces the top-level key allow-list and supports $root', () => {
    const state = { hp: 10 }
    const rejected = applyTemplateUpdates(state, [{ variables: { unknownField: 1, hp: 20 } }], {
      initial: { hp: 0 },
      schema: 'hp: 数值',
    })
    expect(rejected.rejectedKeys).toEqual(['unknownField'])
    expect(rejected.nextState).toMatchObject({ hp: 20 })

    const open = applyTemplateUpdates({}, [{ variables: { anything: { goes: 1 } } }])
    expect(open.nextState).toMatchObject({ anything: { goes: 1 } })

    const rooted = applyTemplateUpdates({ a: 1 }, [{ variables: { $root: { b: 2 } } }])
    expect(rooted.nextState).toEqual({ b: 2 })
  })

  it('hard-rejects prototype-dangerous path segments (allow-lists degenerate to allow-all on empty state)', () => {
    const state: Record<string, unknown> = { hp: 10 }
    const { nextState, rejectedKeys } = applyTemplateUpdates(state, [
      { variables: { '__proto__.polluted': 'x', 'constructor.prototype.boom': 1, prototype: 2 } },
    ])

    expect(rejectedKeys).toEqual(['__proto__.polluted', 'constructor.prototype.boom', 'prototype'])
    expect(nextState).toMatchObject({ hp: 10 })
    // Object.prototype untouched — the write never escapes the state object.
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    expect(({} as Record<string, unknown>).boom).toBeUndefined()
  })

  it('routes updates by id, then name, then the sole active template', () => {
    const templates = [
      { id: 't1', name: '面板一' },
      { id: 't2', name: '面板二' },
    ]
    expect(matchTemplateUpdates([{ id: 't2', variables: { x: 1 } }], templates)[0]!.template).toBe(templates[1])
    expect(matchTemplateUpdates([{ name: '面板一', variables: { x: 1 } }], templates)[0]!.template).toBe(templates[0])
    const single = [{ id: 'only', name: '唯一' }]
    expect(matchTemplateUpdates([{ variables: { x: 1 } }], single)[0]!.template).toBe(single[0])
    expect(matchTemplateUpdates([{ variables: { x: 1 } }], templates)).toEqual([])
  })

  it('renders the template update section with instruction and payload', () => {
    expect(renderTemplateUpdateSection([])).toBe('')
    const section = renderTemplateUpdateSection([
      { id: 't1', name: '天书蛊匣', currentVariables: { hp: 95 }, variableSchema: 'hp: 数值' },
    ])
    expect(section).toContain('[UI模板变量更新]')
    expect(section).toContain('<ui_template_updates>')
    expect(section).toContain('"currentVariables"')
    expect(section).toContain('hp: 数值')
  })
})
