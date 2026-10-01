import { describe, expect, it } from 'vitest'
import {
  applyRegexPipeline,
  HTML_FLOOR_OMISSION_MARKER,
  isFullHtmlDocument,
  parseRegexLiteral,
  projectRegexScripts,
} from '@/kernel/regex/regex-engine'

describe('regex projection (M3-v, dual field families)', () => {
  it('projects the ST family: scriptName/findRegex/replaceString + /pattern/flags parsing', () => {
    const [script] = projectRegexScripts([
      { scriptName: '剥离', findRegex: '/<html[\\s\\S]*?<\\/html>/gi', replaceString: '', disabled: false },
    ])
    // The `\/` escapes inside the literal are kept — valid in JS regex.
    expect(script).toMatchObject({ name: '剥离', pattern: '<html[\\s\\S]*?<\\/html>', flags: 'gi', enabled: true })
  })

  it('projects the variant family the 蛊真人-class cards ship: name/regex/flags/replacement', () => {
    const [a, b, c] = projectRegexScripts([
      { name: '对话', regex: '『([^『』]*?)』', flags: 'gi', replacement: '<span>$1</span>', placement: [1, 2] },
      { name: '关掉的', regex: 'x', replacement: '', disabled: true },
      { name: '裸模式', regex: '/foo/i', replacement: 'bar' },
    ])
    expect(a).toMatchObject({ pattern: '『([^『』]*?)』', flags: 'gi', enabled: true, placement: [1, 2] })
    expect(b!.enabled).toBe(false)
    // /pattern/flags literal is unwrapped at projection.
    expect(c).toMatchObject({ pattern: 'foo', flags: 'i' })
  })

  it('defaults: flags g, placement [1,2], both flags false, malformed entries skipped', () => {
    const [script] = projectRegexScripts([{ name: '裸', regex: 'x', replacement: 'y' }])
    expect(script).toMatchObject({ flags: 'g', placement: [1, 2], markdownOnly: false, promptOnly: false, minDepth: null, maxDepth: null })
    expect(projectRegexScripts(['垃圾', null, { regex: '' }])).toHaveLength(0)
  })

  it('parses /pattern/flags literals with flag validation', () => {
    expect(parseRegexLiteral('/foo/gi')).toEqual({ pattern: 'foo', flags: 'gi' })
    expect(parseRegexLiteral('/foo/badflags')).toBeNull()
    expect(parseRegexLiteral('plain')).toBeNull()
  })
})

describe('flag matrix (RP semantics: all-false = display only; promptOnly = prompt only)', () => {
  const build = (markdownOnly: boolean, promptOnly: boolean) =>
    projectRegexScripts([{ name: 's', regex: '词', replacement: '<b>词</b>', markdownOnly, promptOnly }])[0]!

  it('all false: display applies, prompt never (beautification stays out of the request)', () => {
    const scripts = [build(false, false)]
    expect(applyRegexPipeline('一词', { scripts, surface: 'display', role: 'assistant', depth: 0 })).toBe('一<b>词</b>')
    expect(applyRegexPipeline('一词', { scripts, surface: 'prompt', role: 'assistant', depth: 0 })).toBe('一词')
  })

  it('promptOnly: prompt applies, display never', () => {
    const scripts = [build(false, true)]
    expect(applyRegexPipeline('一词', { scripts, surface: 'prompt', role: 'assistant', depth: 0 })).toBe('一<b>词</b>')
    expect(applyRegexPipeline('一词', { scripts, surface: 'display', role: 'assistant', depth: 0 })).toBe('一词')
  })

  it('markdownOnly: display only; both true → display only (normalized)', () => {
    expect(applyRegexPipeline('一词', { scripts: [build(true, false)], surface: 'display', role: 'assistant', depth: 0 })).toBe('一<b>词</b>')
    expect(applyRegexPipeline('一词', { scripts: [build(true, false)], surface: 'prompt', role: 'assistant', depth: 0 })).toBe('一词')
    expect(applyRegexPipeline('一词', { scripts: [build(true, true)], surface: 'display', role: 'assistant', depth: 0 })).toBe('一<b>词</b>')
    expect(applyRegexPipeline('一词', { scripts: [build(true, true)], surface: 'prompt', role: 'assistant', depth: 0 })).toBe('一词')
  })
})

describe('placement and depth gating', () => {
  const userOnly = projectRegexScripts([{ name: 'u', regex: '词', replacement: 'U', placement: [1], promptOnly: true }])[0]!
  const aiOnly = projectRegexScripts([{ name: 'a', regex: '词', replacement: 'A', placement: [2], promptOnly: true }])[0]!

  it('placement routes by message role', () => {
    expect(applyRegexPipeline('词', { scripts: [userOnly], surface: 'prompt', role: 'user', depth: 0 })).toBe('U')
    expect(applyRegexPipeline('词', { scripts: [userOnly], surface: 'prompt', role: 'assistant', depth: 0 })).toBe('词')
    expect(applyRegexPipeline('词', { scripts: [aiOnly], surface: 'prompt', role: 'user', depth: 0 })).toBe('词')
    expect(applyRegexPipeline('词', { scripts: [aiOnly], surface: 'prompt', role: 'assistant', depth: 0 })).toBe('A')
  })

  it('min/max depth are inclusive bounds against the end-anchored depth', () => {
    const gated = projectRegexScripts([{ name: 'g', regex: '词', replacement: 'R', promptOnly: true, minDepth: 1, maxDepth: 2 }])[0]!
    expect(applyRegexPipeline('词', { scripts: [gated], surface: 'prompt', role: 'assistant', depth: 0 })).toBe('词')
    expect(applyRegexPipeline('词', { scripts: [gated], surface: 'prompt', role: 'assistant', depth: 1 })).toBe('R')
    expect(applyRegexPipeline('词', { scripts: [gated], surface: 'prompt', role: 'assistant', depth: 2 })).toBe('R')
    expect(applyRegexPipeline('词', { scripts: [gated], surface: 'prompt', role: 'assistant', depth: 3 })).toBe('词')
  })

  it('disabled overrides remove scripts; a failing script is skipped and the rest still run', () => {
    const scripts = projectRegexScripts([
      { name: '炸', regex: '([unclosed', replacement: 'x' },
      { name: '好', regex: '词', replacement: 'R' },
    ])
    expect(applyRegexPipeline('一词', { scripts, surface: 'display', role: 'assistant', depth: 0 })).toBe('一R')
    expect(applyRegexPipeline('一词', { scripts, surface: 'display', role: 'assistant', depth: 0, disabledUids: new Set([1]) })).toBe('一词')
  })
})

describe('protection shield (patterns without </> never touch HTML/code)', () => {
  const beautify = projectRegexScripts([{ name: '美', regex: '（([^）]*?)）', flags: 'gi', replacement: '<span>$1</span>' }])[0]!

  it('shields full HTML documents from plain-prose patterns', () => {
    const doc = '<html><body><p>（心理）</p></body></html>'
    expect(applyRegexPipeline(doc, { scripts: [beautify], surface: 'display', role: 'assistant', depth: 0 })).toBe(doc)
  })

  it('rewrites plain prose around shielded ranges', () => {
    const mixed = '<style>.x{}</style>前（心理）后'
    expect(applyRegexPipeline(mixed, { scripts: [beautify], surface: 'display', role: 'assistant', depth: 0 })).toBe(
      '<style>.x{}</style>前<span>心理</span>后',
    )
  })

  it('patterns carrying angle brackets run raw (strippers opt in)', () => {
    const stripper = projectRegexScripts([
      { name: '剥离', regex: '<html[\\s\\S]*?</html>', replacement: '[省略]', promptOnly: true },
    ])[0]!
    const doc = '<html><body>（心理）</body></html>'
    expect(applyRegexPipeline(doc, { scripts: [stripper], surface: 'prompt', role: 'assistant', depth: 0 })).toBe('[省略]')
  })
})

describe('HTML floor omission detection (D7)', () => {
  it('detects complete documents only', () => {
    expect(isFullHtmlDocument('<!DOCTYPE html>\n<html><body>x</body></html>')).toBe(true)
    expect(isFullHtmlDocument('<html lang="zh"><body>x</body></html>')).toBe(true)
    expect(isFullHtmlDocument('<div>片段</div>')).toBe(false)
    expect(isFullHtmlDocument('纯文本')).toBe(false)
    expect(isFullHtmlDocument(HTML_FLOOR_OMISSION_MARKER)).toBe(false)
  })
})
