import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import {
  GLOW_DEFAULT,
  GLASS_T_DEFAULT,
  MATERIAL_RECIPES,
  MATERIAL_VARS,
  auroraBlobStyles,
  buildMaterialVars,
  initAcrylicSliders,
  slidersAtDefault,
  statusBarFillOf,
  useAcrylicSliders,
} from '../../src/kernel/design/acrylic'
import AuroraLayer from '../../src/kernel/design/AuroraLayer.vue'
import {
  COLOR_FAMILIES,
  applyMpColorFamily,
  initMpColorFamily,
  useMpColorFamily,
} from '../../src/kernel/design/color-families'
import AppearanceSection from '../../src/kernel/app/sections/AppearanceSection.vue'

const RGBA_FULL = /^rgba\(\d+,\d+,\d+,[0-9.]+\)$/
const HEX6 = /^#[0-9a-fA-F]{6}$/

const inlineVar = (key: string): string =>
  document.documentElement.style.getPropertyValue(key).trim()

const resetSliders = (): void => {
  const { setGlow, setTransparency } = useAcrylicSliders()
  setGlow(GLOW_DEFAULT)
  setTransparency(GLASS_T_DEFAULT)
}

describe('材质配方(六系 × 明暗,预览值即代码)', () => {
  it('每系明暗配方齐全:基底三停、四色斑、表面 rgba 组、accentHi', () => {
    for (const family of COLOR_FAMILIES) {
      const recipeSet = MATERIAL_RECIPES[family.id]
      expect(recipeSet, family.id).toBeDefined()
      for (const modeName of ['light', 'dark'] as const) {
        const m = recipeSet[modeName]
        expect(m.base.startsWith('linear-gradient'), `${family.id}.${modeName} base`).toBe(true)
        expect(m.blobs).toHaveLength(4)
        for (const blob of m.blobs) {
          expect(HEX6.test(blob.hex), `${family.id}.${modeName} blob ${blob.hex}`).toBe(true)
          expect(blob.alpha).toBeGreaterThan(0)
          expect(blob.alpha).toBeLessThanOrEqual(1)
        }
        expect(RGBA_FULL.test(m.surf), `${family.id}.${modeName} surf`).toBe(true)
        expect(RGBA_FULL.test(m.hairline), `${family.id}.${modeName} hairline`).toBe(true)
        expect(RGBA_FULL.test(m.edge), `${family.id}.${modeName} edge`).toBe(true)
        expect(RGBA_FULL.test(m.aiBubble), `${family.id}.${modeName} aiBubble`).toBe(true)
        expect(HEX6.test(m.accentHi), `${family.id}.${modeName} accentHi`).toBe(true)
      }
    }
  })

  it('薄荷配方(原青碧升档,2026-10-16 定档值逐字)', () => {
    const lt = MATERIAL_RECIPES.mint.light
    expect(lt.base).toBe('linear-gradient(168deg, #E0F0EE 0%, #EDF7F5 46%, #DCEEEB 100%)')
    expect(lt.blobs[0]).toEqual({ hex: '#7DD8CB', alpha: 0.5 })
    expect(lt.surf).toBe('rgba(255,255,255,0.55)')
    expect(lt.aiBubble).toBe('rgba(255,255,255,0.62)')
    expect(lt.accentHi).toBe('#2BBFAF')
    const dk = MATERIAL_RECIPES.mint.dark
    expect(dk.base).toBe('linear-gradient(170deg, #061110 0%, #0A1817 44%, #050D0B 100%)')
    expect(dk.surf).toBe('rgba(10,22,20,0.55)')
    expect(dk.aiBubble).toBe('rgba(14,30,28,0.5)')
  })

  it('status-bar fill: valid #RRGGBB first stop of the base for every family/mode', () => {
    // Regression net for the vivo white-strip bug: apply() used to pass
    // material.base[0] ('l'), which native Color.parseColor rejects and the
    // caller's catch swallowed — the bar stayed white in every mode.
    for (const family of COLOR_FAMILIES) {
      for (const modeName of ['light', 'dark'] as const) {
        const fill = statusBarFillOf(family.id, modeName)
        expect(HEX6.test(fill), `${family.id}.${modeName} got ${fill}`).toBe(true)
        const base = MATERIAL_RECIPES[family.id][modeName].base
        expect(base.startsWith('linear-gradient(')).toBe(true)
        expect(base.indexOf(fill), `${family.id}.${modeName} fill must be the first stop`).toBe(base.indexOf('#'))
      }
    }
    expect(statusBarFillOf('mint', 'dark')).toBe('#061110')
    expect(statusBarFillOf('mint', 'light')).toBe('#E0F0EE')
  })
})

describe('auroraBlobStyles(辉光 = 色斑 alpha 倍率,真 DOM 色块填充)', () => {
  it('默认辉光 = 配方原值 rgba 填充 ×4', () => {
    const fills = auroraBlobStyles('mint', 'light')
    expect(fills).toHaveLength(4)
    expect(fills[0]).toBe('rgba(125,216,203,0.5)')
    expect(fills[1]).toBe('rgba(14,148,136,0.24)')
  })

  it('零辉光全透明;50% 减半;150% 增半(配方上限内不越 1)', () => {
    expect(auroraBlobStyles('mint', 'light', 0).every((fill) => fill === 'transparent')).toBe(true)
    expect(auroraBlobStyles('mint', 'light', 50)[0]).toBe('rgba(125,216,203,0.25)')
    expect(auroraBlobStyles('mint', 'light', 150)[0]).toBe('rgba(125,216,203,0.75)')
    expect(auroraBlobStyles('ocean', 'light', 150)[0]).toBe('rgba(123,184,232,0.9)') // 0.6 × 1.5
  })
})

describe('buildMaterialVars(透明度映射,默认 = 参考件)', () => {
  it('默认透明度 45% → 参考件原值逐项(极光不落令牌)', () => {
    const light = buildMaterialVars('mint', 'light')
    expect('--mp-aurora-base' in light).toBe(false)
    expect(light['--mp-glass-bg']).toBe('rgba(255,255,255,0.78)')
    expect(light['--mp-glass-border']).toBe('rgba(255,255,255,0.7)')
    expect(light['--mp-glass-edge']).toBe('rgba(255,255,255,0.85)')
    expect(light['--mp-glass-shadow']).toBe('rgba(10,40,36,0.18)')
    expect(light['--mp-surface-ai-bubble']).toBe('rgba(255,255,255,0.62)')
    expect(light['--mp-c-primary-hi']).toBe('43 191 175')
    expect(light['--mp-card-fill-alpha']).toBe('0.72')

    const dark = buildMaterialVars('mint', 'dark')
    expect(dark['--mp-glass-bg']).toBe('rgba(10,22,20,0.78)')
    expect(dark['--mp-surface-ai-bubble']).toBe('rgba(14,30,28,0.5)')
    expect(dark['--mp-c-primary-hi']).toBe('45 212 191')
    expect(dark['--mp-card-fill-alpha']).toBe('0.74')
  })

  it('透明度滑杆:玻璃走加实映射,气泡绕参考锚点缩放', () => {
    const t60 = buildMaterialVars('mint', 'light', 60)
    expect(t60['--mp-glass-bg']).toBe('rgba(255,255,255,0.63)') // 1.23 − 0.6
    expect(t60['--mp-surface-ai-bubble']).toBe('rgba(255,255,255,0.45)') // 0.62 × 0.727
    expect(t60['--mp-card-fill-alpha']).toBe('0.57')

    const t10 = buildMaterialVars('mint', 'light', 10)
    expect(t10['--mp-glass-bg']).toBe('rgba(255,255,255,0.95)') // clamp 上限
    expect(t10['--mp-surface-ai-bubble']).toBe('rgba(255,255,255,0.95)') // clamp 上限
  })

  it('非薄荷系输出本系配方(海蓝实锤)', () => {
    const ocean = buildMaterialVars('ocean', 'light')
    expect(ocean['--mp-glass-bg']).toBe('rgba(255,255,255,0.78)') // 加实映射与锚点无关
  })
})

describe('acrylic × 色系应用(mint 单一来源纪律)', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.style.cssText = ''
    resetSliders()
  })

  it('薄荷默认滑杆 = 清空全部内联(含材质变量),tokens.css 兜底', () => {
    applyMpColorFamily('ocean', 'light')
    expect(inlineVar('--mp-glass-bg')).not.toBe('')
    applyMpColorFamily('mint', 'light')
    for (const key of MATERIAL_VARS) {
      expect(inlineVar(key), key).toBe('')
    }
    expect(inlineVar('--mp-c-bg')).toBe('')
  })

  it('薄荷 + 滑杆偏离 = 只写材质覆盖,色系 token 仍归 tokens.css', () => {
    const { setTransparency } = useAcrylicSliders()
    setTransparency(60)
    applyMpColorFamily('mint', 'dark')
    expect(inlineVar('--mp-c-bg')).toBe('')
    expect(inlineVar('--mp-c-primary')).toBe('')
    expect(inlineVar('--mp-glass-bg')).toBe('rgba(10,22,20,0.63)')
    expect(inlineVar('--mp-aurora-base')).toBe('') // 极光永不走 CSS 令牌(组件直渲染)
  })

  it('滑杆变更经 watch 以当前色系即时重应用', () => {
    const { setFamily } = useMpColorFamily()
    setFamily('ocean')
    const { setTransparency } = useAcrylicSliders()
    setTransparency(60)
    expect(inlineVar('--mp-glass-bg')).toBe('rgba(255,255,255,0.63)')
  })

  it('滑杆持久化;脏值经 init 钳制回落', () => {
    const { setGlow } = useAcrylicSliders()
    setGlow(130)
    expect(localStorage.getItem('mp_acrylic_glow')).toBe('130')

    localStorage.setItem('mp_acrylic_glow', '999')
    localStorage.setItem('mp_acrylic_glass', 'abc')
    initAcrylicSliders()
    const { glow, transparency } = useAcrylicSliders()
    expect(glow.value).toBe(150)
    expect(transparency.value).toBe(GLASS_T_DEFAULT)
  })

  it('initMpColorFamily 组合根接线后默认滑杆 = 无内联材质', () => {
    initMpColorFamily()
    expect(slidersAtDefault()).toBe(true)
    expect(inlineVar('--mp-glass-bg')).toBe('')
  })
})

describe('AuroraLayer(真 DOM 模糊色块 + 噪点)', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.style.cssText = ''
    useMpColorFamily().setFamily('mint')
    resetSliders()
  })

  it('基底渐变内联 + 4 个 blur 色块 div + 噪点层', () => {
    const wrapper = mount(AuroraLayer)
    const root = wrapper.find('.mp-aurora')
    expect(root.exists()).toBe(true)
    expect(root.attributes('style')).toContain('background-image: linear-gradient(168deg')
    const blobs = wrapper.findAll('.mp-aurora-blob')
    expect(blobs).toHaveLength(4)
    expect(blobs[0]!.attributes('style')).toContain('rgba(125, 216, 203, 0.5)')
    expect(blobs[0]!.attributes('style')).toContain('120%')
    expect(wrapper.find('.mp-aurora-grain').exists()).toBe(true)
  })
})

describe('AppearanceSection 材质滑杆(主题 v3)', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.style.cssText = ''
    useMpColorFamily().setFamily('mint')
    resetSliders()
  })

  it('渲染辉光/透明度两滑杆,拖动即时生效并持久化', async () => {
    const wrapper = mount(AppearanceSection)
    const ranges = wrapper.findAll('input[type="range"]')
    expect(ranges).toHaveLength(4)
    expect(ranges[0]!.attributes('min')).toBe('0')
    expect(ranges[0]!.attributes('max')).toBe('150')
    expect(ranges[1]!.attributes('min')).toBe('10')
    expect(ranges[1]!.attributes('max')).toBe('70')
    expect(wrapper.text()).toContain('辉光强度')
    expect(wrapper.text()).toContain('玻璃透明度')

    await ranges[0]!.setValue(120)
    expect(localStorage.getItem('mp_acrylic_glow')).toBe('120')

    await ranges[1]!.setValue(60)
    expect(inlineVar('--mp-glass-bg')).toBe('rgba(255,255,255,0.63)') // 1.23 − 0.6
    expect(localStorage.getItem('mp_acrylic_glass')).toBe('60')
  })
})
