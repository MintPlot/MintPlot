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
  it('动画只动 transform/opacity + 收编的 grid-template-rows(vivo 合成器前科;grid-rows 为规划 §2 明文允许的塌陷技巧,小 subtree 布局)', () => {
    expect(transitionDeclarations.length).toBeGreaterThanOrEqual(8)
    const sanctioned = new Set(['transform', 'opacity', 'grid-template-rows'])
    const offenders = transitionDeclarations.flatMap((declaration) =>
      transitionTargets(declaration).filter((target) => !sanctioned.has(target)),
    )
    expect(offenders, `offending animated properties: ${offenders.join(', ')}`).toEqual([])
  })

  it('transition/animation 声明零 blur/filter 族目标(注释与非动画声明不计——去卡顿用的 visibility 停用规则是合法的)', () => {
    const animatedLines = [
      ...css.matchAll(/(?:transition|animation):\s*([^;]+);/g),
    ].map((match) => match[1] ?? '')
    expect(animatedLines.length).toBeGreaterThanOrEqual(8)
    const offenders = animatedLines.filter((line) => /blur|filter|backdrop/i.test(line))
    expect(offenders, `blur/filter family in animated declarations: ${offenders.join(' | ')}`).toEqual([])
  })

  it('所有类选择器收敛在 mp-mo- 前缀下(跨域作用域选择器 .mp-aurora-blob 白名单)', () => {
    const classTokens = css.match(/\.[a-zA-Z][\w-]*/g) ?? []
    expect(classTokens.length).toBeGreaterThan(20)
    const foreign = new Set(['.mp-aurora-blob'])
    const offenders = classTokens.filter((token) => !token.startsWith('.mp-mo-') && !foreign.has(token))
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

  it('App.vue:聊天页推栈 Transition 在位 + tab stage 裁剪(右入 16px 悬出曾触发横向滚动条=不对称卡顿)', () => {
    const app = readSrc('App.vue')
    expect(app).toContain('<Transition name="mp-mo-push">')
    expect(app).not.toContain('mp-mo-stage')
    expect(app).toContain('min-h-0 flex-1 overflow-hidden')
  })

  it('App.vue:tab 切换 out-in 方向感知双类 + KeepAlive 在位', () => {
    const app = readSrc('App.vue')
    expect(app).toContain('mode="out-in"')
    expect(app).toContain(':name="tabDirection"')
    expect(app).toContain("ref('mp-mo-tab-next')")
    expect(app).toContain("'mp-mo-tab-next'")
    expect(app).toContain("'mp-mo-tab-back'")
    // KeepAlive (device report 2026-10-17): cached tab pages, refresh via onActivated
    expect(app).toContain('<KeepAlive>')
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

  it('keeps list-removal transitions but does not animate virtual floor mounts', () => {
    const floors = readSrc('kernel', 'app', 'chat', 'ChatFloorList.vue')
    expect(floors).not.toContain('<TransitionGroup')
    expect(floors).toContain('data-message-id')
    const home = readSrc('kernel', 'app', 'views', 'ChatHomeView.vue')
    expect(home).toContain('tag="ul"')
    expect(home).toContain('name="mp-mo-row"')
    const chars = readSrc('kernel', 'app', 'views', 'CharactersView.vue')
    expect(chars).toContain('tag="div"')
    expect(chars).toContain('name="mp-mo-cell"')
    const toast = readSrc('kernel', 'ui', 'ToastHost.vue')
    expect(toast).toContain('name="mp-toast"')
    expect(toast).toContain('0.15s')
  })

  it('手风琴折叠接线:全部折叠点(不止一级)都走 collapse 组', () => {
    const settings = readSrc('kernel', 'app', 'views', 'SettingsView.vue')
    expect(settings).not.toContain('v-show="isExpanded')
    expect((settings.match(/mp-mo-collapse-open/g) ?? []).length).toBeGreaterThanOrEqual(1)
    const tools = readSrc('kernel', 'app', 'views', 'ToolsView.vue')
    expect((tools.match(/mp-mo-collapse-open/g) ?? []).length).toBeGreaterThanOrEqual(2)
    expect(tools).not.toContain('v-if="areaOpen')
    // round 2: every remaining disclosure joins the same pattern —
    // appearance theme, plugin groups + entries, thinking card, capsule
    // detail, variables records (device report: "只应用了第一级")
    expect(readSrc('kernel', 'app', 'sections', 'AppearanceSection.vue')).toContain('mp-mo-collapse-open')
    const pluginArea = readSrc('kernel', 'app', 'sections', 'PluginArea.vue')
    expect((pluginArea.match(/mp-mo-collapse-open/g) ?? []).length).toBeGreaterThanOrEqual(2)
    expect(readSrc('kernel', 'app', 'chat', 'FloorThinkingCard.vue')).toContain('mp-mo-collapse-open')
    expect(readSrc('kernel', 'app', 'chat', 'ChatFloor.vue')).toContain('mp-mo-collapse-open')
    expect(readSrc('kernel', 'variables', 'VariablesSheet.vue')).toContain('mp-mo-collapse-open')
  })

  it('滑动 reveal 语义(round-3):按钮区贴行边跟行平移,零 v-show/零渐显', () => {
    const home = readSrc('kernel', 'app', 'views', 'ChatHomeView.vue')
    expect(home).toContain('zoneTranslate')
    expect(home).not.toContain('v-show="isRevealing')
    expect(home).not.toContain('zoneOpacity')
  })

  it('强玻璃材质(round-3):弹窗/Toast/弹层盖忙碌内容,零气泡圆角混用', () => {
    const base = readSrc('kernel', 'design', 'base.css')
    expect(base).toContain('.mp-glass-strong')
    expect(base).toContain('var(--mp-glass-strong-bg)')
    for (const file of ['ConfirmDialogHost.vue', 'FatalErrorHost.vue', 'ToastHost.vue']) {
      const host = readSrc('kernel', 'ui', file)
      expect(host, file).toContain('mp-glass-strong')
      expect(host, file).not.toContain('rounded-bubble-ai')
    }
    expect(readSrc('kernel', 'app', 'chat', 'ChatComposer.vue')).toContain('mp-glass-strong')
    // sheets ride the strong tier through mp-glass-bar (base.css swap)
    const bar = base.slice(base.indexOf('.mp-glass-bar'), base.indexOf('.mp-glass-bar') + 200)
    expect(bar).toContain('var(--mp-glass-strong-bg)')
  })
})
