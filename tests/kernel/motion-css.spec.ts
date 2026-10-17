// @vitest-environment node
// Motion-batch red-line guard (2026-10-17, documents/planning/motion-batch-plan.md
// §1): animated properties restricted to transform/opacity (nothing from the
// backdrop-sampling family anywhere in the file — vivo compositor leak
// history), prefers-reduced-motion zeroes the whole sheet through one
// variable, everything under the mp-mo- namespace. Also pins the mount
// points so a refactor cannot silently drop an animation. Node env: source
// scan, no DOM needed.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const srcPath = (...parts: string[]): string => resolve(process.cwd(), 'src', ...parts)
const readSrc = (...parts: string[]): string => readFileSync(srcPath(...parts), 'utf8')

const rawCss = readSrc('kernel', 'design', 'motion.css')
const stripComments = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, '')
const css = stripComments(rawCss)

const mediaAnchor = '@media (prefers-reduced-motion: reduce)'
const mediaIndex = css.indexOf(mediaAnchor)
const cssMain = mediaIndex >= 0 ? css.slice(0, mediaIndex) : css
const cssReduce = mediaIndex >= 0 ? css.slice(mediaIndex) : ''

/** Top-level comma split (cubic-bezier(...) holds commas) → first token of each part. */
function transitionTargets(declaration: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const ch of declaration) {
    if (ch === '(') depth += 1
    if (ch === ')') depth -= 1
    if (ch === ',' && depth === 0) {
      parts.push(current)
      current = ''
      continue
    }
    current += ch
  }
  parts.push(current)
  return parts
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => part.split(/\s+/)[0] ?? '')
}

const transitionDeclarations = [...cssMain.matchAll(/transition:\s*([^;]+);/g)].map(
  (match) => match[1] ?? '',
)

describe('motion.css 红线守卫(动效批)', () => {
  it('动画只动 transform/opacity(vivo 合成器前科,白名单之外零目标)', () => {
    expect(transitionDeclarations.length).toBeGreaterThanOrEqual(8)
    const offenders = transitionDeclarations.flatMap((declaration) =>
      transitionTargets(declaration).filter(
        (target) => target !== 'transform' && target !== 'opacity',
      ),
    )
    expect(offenders, `offending animated properties: ${offenders.join(', ')}`).toEqual([])
  })

  it('全文件(含注释)零 blur/filter 族字样', () => {
    const lowered = rawCss.toLowerCase()
    expect(lowered).not.toContain('blur')
    expect(lowered).not.toContain('filter')
  })

  it('所有类选择器收敛在 mp-mo- 前缀下', () => {
    const classTokens = css.match(/\.[a-zA-Z][\w-]*/g) ?? []
    expect(classTokens.length).toBeGreaterThan(20)
    const offenders = classTokens.filter((token) => !token.startsWith('.mp-mo-'))
    expect(offenders, `classes outside the mp-mo- namespace: ${offenders.join(', ')}`).toEqual([])
  })

  it('时长全部走 --mp-mo-t 变量,且最大 320ms', () => {
    const bare = transitionDeclarations.filter((declaration) => !declaration.includes('var(--mp-mo-t)'))
    expect(bare, `durations not riding --mp-mo-t: ${bare.length}`).toEqual([])
    const durations = [...css.matchAll(/--mp-mo-t:\s*([\d.]+)ms/g)].map((match) => Number(match[1]))
    expect(durations.length).toBeGreaterThanOrEqual(8)
    expect(Math.max(...durations)).toBeLessThanOrEqual(320)
  })

  it('reduced-motion 总闸存在,且覆盖每一个带过渡的选择器', () => {
    expect(mediaIndex).toBeGreaterThanOrEqual(0)
    expect(cssReduce).toContain('--mp-mo-t: 0.01ms')
    const offenders: string[] = []
    for (const match of cssMain.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const body = match[2] ?? ''
      if (!body.includes('transition:')) continue
      for (const selector of (match[1] ?? '').split(',')) {
        const name = selector.trim()
        // Descendant rules (".root .child") inherit the zeroed variable from
        // their phase root — the ANCESTOR must sit inside the gate.
        const probe = name.includes(' ') ? (name.split(/\s+/)[0] ?? '') : name
        if (probe && !cssReduce.includes(probe)) offenders.push(name)
      }
    }
    expect(offenders, `selectors not covered by the reduced-motion gate: ${offenders.join(', ')}`).toEqual([])
  })
})

describe('动效挂点接线守卫', () => {
  it('motion.css 已引入 main.ts', () => {
    expect(readSrc('main.ts')).toContain('@/kernel/design/motion.css')
  })

  it('App.vue:聊天页推栈 Transition + stage 视差类在位', () => {
    const app = readSrc('App.vue')
    expect(app).toContain('<Transition name="mp-mo-push">')
    expect(app).toContain('mp-mo-stage')
    expect(app).toContain("'mp-mo-stage-under': chatOverlay")
  })

  it('六个底部面板挂面板标记类,ChatSessionView 七处 Transition(六面板+图片查看器)', () => {
    const sheets: Array<[string, string]> = [
      ['variables', 'VariablesSheet.vue'],
      ['worldinfo', 'WorldbookSheet.vue'],
      ['regex', 'RegexSheet.vue'],
      ['memory', 'MemorySheet.vue'],
      ['app', 'sections/SessionSettingsSheet.vue'],
      ['app', 'sections/StyleSheet.vue'],
    ]
    for (const [dir, file] of sheets) {
      expect(readSrc('kernel', dir, file), `${file} missing panel marker`).toContain('mp-mo-sheet-panel')
    }
    const view = readSrc('kernel', 'app', 'views', 'ChatSessionView.vue')
    expect((view.match(/name="mp-mo-sheet"/g) ?? []).length).toBe(6)
    expect((view.match(/name="mp-mo-center"/g) ?? []).length).toBe(1)
    expect(readSrc('kernel', 'app', 'chat', 'ImageViewer.vue')).toContain('mp-mo-center-card')
  })

  it('居中模态:确认/Fatal 升级到 mp-mo-center,旧 fade 类退役', () => {
    for (const file of ['ConfirmDialogHost.vue', 'FatalErrorHost.vue']) {
      const host = readSrc('kernel', 'ui', file)
      expect(host).toContain('name="mp-mo-center"')
      expect(host).toContain('mp-mo-center-card')
      expect(host).not.toContain('fade')
    }
  })
})
