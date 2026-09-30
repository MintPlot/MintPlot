import { describe, expect, it } from 'vitest'
import {
  analyzeTemplateScriptRisk,
  escapeTemplateValue,
  hasTemplateScripts,
  readTemplateValue,
  renderTemplateString,
  splitTemplatePath,
  stripTemplateCodeFence,
} from '@/kernel/render/template-interp'

describe('template interpolation engine · M3-s 逐楼快照 render surface', () => {
  it('interpolates scalar paths with HTML escaping (RP escape shape)', () => {
    const html = renderTemplateString('<b>{{name}}</b><i>{{hp}}/{{maxHp}}</i>', {
      name: '陆<a>',
      hp: 95,
      maxHp: 100,
    })
    expect(html).toBe('<b>陆&lt;a&gt;</b><i>95/100</i>')
  })

  it('escapes the five entities community templates un-escape (the {{this}} wire shape)', () => {
    expect(escapeTemplateValue('<a href="x" \'y\'>&')).toBe('&lt;a href=&quot;x&quot; &#39;y&#39;&gt;&amp;')
  })

  it('renders the gu-style whole-tree channel: {{this}} = pretty JSON of the state', () => {
    const state = { hp: 95, stats: { physique: { val: 12 } } }
    const html = renderTemplateString('<div style="display:none" id="rawData">{{this}}</div>', state)
    expect(html).toContain('id="rawData"')
    // The template's own script un-escapes entities before JSON.parse — the
    // escape must be exactly the five-entity shape it reverses (pretty JSON
    // keeps its newlines; the consumer trims and slice-extracts the object).
    expect(html).toContain('&quot;hp&quot;: 95,')
    expect(html).toContain('&quot;val&quot;: 12')
    expect(html).not.toContain('{{this}}')
  })

  it('unmatched each with no else body vanishes; markers and else stay literal (RP parity)', () => {
    // RP quirk kept deliberately: an empty each block renders its (empty)
    // else side — the block itself disappears, only foreign markers remain.
    const html = renderTemplateString('[{{missing}}]{{#each nope}}x{{/each}}{{ else }}{{#if a}}', {})
    expect(html).toBe('[]{{ else }}{{#if a}}')
  })

  it('each iterates arrays with @index/@number/this and an alias', () => {
    const html = renderTemplateString(
      '{{#each bag as item}}{{@number}}.{{item.name}}:{{item.count}} {{/each}}',
      { bag: [{ name: '短剑', count: 1 }, { name: '药剂', count: 3 }] },
    )
    expect(html).toBe('1.短剑:1 2.药剂:3 ')
  })

  it('each iterates objects with @key and renders the else body when empty', () => {
    const withEntries = renderTemplateString('{{#each stats}}{{@key}}={{this}};{{/each}}', { stats: { 力: 5, 敏: 6 } })
    expect(withEntries).toBe('力=5;敏=6;')
    const empty = renderTemplateString('{{#each bag}}x{{else}}空空如也{{/each}}', { bag: [] })
    expect(empty).toBe('空空如也')
    const missing = renderTemplateString('{{#each nope}}x{{else}}无{{/each}}', {})
    expect(missing).toBe('无')
  })

  it('context family: root., @index, @first/@last render true/false (flat each, RP parity)', () => {
    const html = renderTemplateString(
      '{{#each bag}}{{name}}({{root.charName}}){{@index}} {{/each}}',
      { charName: '蛊', bag: [{ name: 'a' }, { name: 'b' }] },
    )
    expect(html).toBe('a(蛊)0 b(蛊)1 ')
    const flags = renderTemplateString('{{#each bag}}{{@first}}/{{@last}} {{/each}}', { bag: [1, 2] })
    expect(flags).toBe('true/false false/true ')
    // Known RP-parity limitation: a each body containing another each block
    // is not grouped by the flat pattern (documented; nested each is not used
    // by the observed community cards — 蛊真人 ships zero {{}} references).
  })

  it('bracket paths normalize to dot reads', () => {
    expect(readTemplateValue({ a: { b: 7 } }, "a['b']", null)).toBe(7)
    expect(splitTemplatePath("stats['physique'][0].val")).toEqual(['stats', 'physique', '0', 'val'])
  })

  it('strips code fences around templates', () => {
    expect(stripTemplateCodeFence('```html\n<b>x</b>\n```')).toBe('<b>x</b>')
    expect(stripTemplateCodeFence('<b>y</b>')).toBe('<b>y</b>')
  })

  it('script risk detector flags the four vectors for the 含脚本 label', () => {
    expect(analyzeTemplateScriptRisk('<p>纯文本</p>')).toMatchObject({ risky: false })
    expect(hasTemplateScripts('<script>x()</script>')).toBe(true)
    expect(hasTemplateScripts('<div onclick="x()">')).toBe(true)
    expect(hasTemplateScripts('<iframe src="about:blank"></iframe>')).toBe(true)
    expect(hasTemplateScripts('<a href="javascript:void(0)">')).toBe(true)
    // data-* attributes and on-free words must not false-positive.
    expect(hasTemplateScripts('<div data-only="1">ongoing</div>')).toBe(false)
  })
})
