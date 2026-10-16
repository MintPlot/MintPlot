// @vitest-environment node
// Overlay z-order guard (2026-10-16 bleed bug): negative z-index children of
// the fixed chat overlay are composited BELOW the sibling tab pages on some
// chromium compositors — the chat page went see-through (list/grid/header
// shining through, card art clashing with the aurora). The fix is
// structural: every layer in the overlay carries an explicit NON-NEGATIVE z
// (aurora z-0 → cover z-[1] → stream z-[2] → chrome z-10). This spec pins
// both the fix and the ban. Node env: source scan, no DOM needed.
import { readFileSync, globSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const src = (...parts: string[]): string => resolve(process.cwd(), 'src', ...parts)

const vueFiles: string[] = globSync('src/**/*.vue', { cwd: process.cwd() })

describe('覆盖层层序守卫(负 z 合成器坑 + Tailwind 静默缺规则坑)', () => {
  it('全仓 .vue 模板零负 z-index 类(合成器会把 fixed 覆盖层的负 z 子层画到兄弟页面之下)', () => {
    expect(vueFiles.length).toBeGreaterThan(10)
    const offenders: string[] = []
    for (const file of vueFiles) {
      if (/-z-\d/.test(readFileSync(resolve(process.cwd(), file), 'utf8'))) offenders.push(file)
    }
    expect(offenders, `negative z classes found: ${offenders.join(', ')}`).toEqual([])
  })

  it('全仓 .vue 零负前缀任意值类(Tailwind v4 对负前缀+方括号值静默不生成规则)', () => {
    const offenders: string[] = []
    for (const file of vueFiles) {
      const source = readFileSync(resolve(process.cwd(), file), 'utf8')
      // negative arbitrary utility: `-top-[`, `-left-[`, ... (standard negatives like -top-3 are fine)
      const matches = source.match(/[\s"']-[a-z]+-\[/g)
      if (matches) offenders.push(`${file}: ${matches.map((m) => m.trim()).join(' ')}`)
    }
    expect(offenders, `negative arbitrary classes found: ${offenders.join('; ')}`).toEqual([])
  })

  it('聊天覆盖层分层在位:极光 z-0 < 卡图 z-[1] < 楼层流 z-[2],chrome z-10', () => {
    const view = readFileSync(src('kernel', 'app', 'views', 'ChatSessionView.vue'), 'utf8')
    expect(view).toContain('absolute inset-0 z-0"') // aurora — full-bleed, no env gymnastics
    expect(view).toContain('absolute inset-0 z-[1] overflow-hidden"') // card backdrop
    expect(view).toContain('absolute inset-0 z-[2] overflow-y-auto') // floor stream
    expect(view).toContain('relative z-[2] flex flex-1') // load-error state above the backdrop
    expect(view).toContain('mp-overlay-header-top') // safe-area-aware header top (base.css)
    expect(view).toContain('mp-overlay-flow-top') // safe-area-aware stream padding (base.css)
  })

  it('安全区补偿类真身存在于 base.css(不依赖 Tailwind 任意值生成)', () => {
    const css = readFileSync(src('kernel', 'design', 'base.css'), 'utf8')
    expect(css).toContain('.mp-overlay-header-top')
    expect(css).toContain('top: calc(env(safe-area-inset-top) + 0.75rem)')
    expect(css).toContain('.mp-overlay-flow-top')
    expect(css).toContain('padding-top: calc(env(safe-area-inset-top) + 6rem)')
  })
})
