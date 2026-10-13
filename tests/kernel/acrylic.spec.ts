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

describe('材质配方(八系 × 明暗,预览值即代码)', () => {
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

  it('薄荷配方 = 定稿参考件原值(逐字)', () => {
    const lt = MATERIAL_RECIPES.mint.light
    expect(lt.base).toBe('linear-gradient(168deg, #EDF6F1 0%, #F6FBF8 46%, #EBF4EF 100%)')
    expect(lt.blobs[0]).toEqual({ hex: '#8DEAC4', alpha: 0.5 })
    expect(lt.surf).toBe('rgba(255,255,255,0.55)')
    expect(lt.aiBubble).toBe('rgba(255,255,255,0.62)')
    expect(lt.accentHi).toBe('#46C7AC')
    const dk = MATERIAL_RECIPES.mint.dark
    expect(dk.base).toBe('linear-gradient(170deg, #071310 0%, #0A1815 44%, #060F0D 100%)')
    expect(dk.surf).toBe('rgba(12,24,21,0.55)')
    expect(dk.aiBubble).toBe('rgba(16,32,28,0.5)')
  })
})

describe('auroraBlobStyles(辉光 = 色斑 alpha 倍率)', () => {
  it('默认辉光输出参考件原值;零辉光整层透明', () => {
    expect(auroraBlobStyles('mint', 'light')).toEqual([
      'rgba(141,234,196,0.5)', 'rgba(43,179,155,0.24)', 'rgba(123,216,232,0.3)', 'rgba(141,234,196,0.18)',
    ])
    expect(auroraBlobStyles('mint', 'light', 0)).toEqual([
      'transparent', 'transparent', 'transparent', 'transparent',
    ])
  })

  it('辉光 50% 减半;150% 封顶不溢出', () => {
    expect(auroraBlobStyles('mint', 'light', 50)[0]).toBe('rgba(141,234,196,0.25)')
    expect(auroraBlobStyles('mint', 'light', 150)[0]).toBe('rgba(141,234,196,0.75)')
    expect(auroraBlobStyles('ocean', 'light', 150)[0]).toBe('rgba(123,184,232,0.9)') // 0.6 × 1.5
  })
})

describe('buildMaterialVars(透明度映射,默认 = 参考件)', () => {
  it('默认透明度 45% → 参考件原值逐项', () => {
    const light = buildMaterialVars('mint', 'light')
    expect(light['--mp-aurora-base']).toBe('linear-gradient(168deg, #EDF6F1 0%, #F6FBF8 46%, #EBF4EF 100%)')
    expect(light['--mp-glass-bg']).toBe('rgba(255,255,255,0.55)')
    expect(light['--mp-glass-border']).toBe('rgba(255,255,255,0.7)')
    expect(light['--mp-glass-edge']).toBe('rgba(255,255,255,0.85)')
    expect(light['--mp-glass-shadow']).toBe('rgba(16,40,34,0.18)')
    expect(light['--mp-surface-ai-bubble']).toBe('rgba(255,255,255,0.62)')
    expect(light['--mp-c-primary-hi']).toBe('70 199 172')
    expect(light['--mp-card-fill-alpha']).toBe('0.72')

    const dark = buildMaterialVars('mint', 'dark')
    expect(dark['--mp-aurora-base']).toBe('linear-gradient(170deg, #071310 0%, #0A1815 44%, #060F0D 100%)')
    expect(dark['--mp-glass-bg']).toBe('rgba(12,24,21,0.55)')
    expect(dark['--mp-surface-ai-bubble']).toBe('rgba(16,32,28,0.5)')
    expect(dark['--mp-c-primary-hi']).toBe('53 196 168')
    expect(dark['--mp-card-fill-alpha']).toBe('0.74')
  })

  it('透明度滑杆绕参考锚点(45%)缩放玻璃与气泡,alpha 钳制可读区间', () => {
    const t60 = buildMaterialVars('mint', 'light', 60)
    expect(t60['--mp-glass-bg']).toBe('rgba(255,255,255,0.4)')
    expect(t60['--mp-surface-ai-bubble']).toBe('rgba(255,255,255,0.45)') // 0.62 × 0.727
    expect(t60['--mp-card-fill-alpha']).toBe('0.57')

    const t10 = buildMaterialVars('mint', 'light', 10)
    expect(t10['--mp-glass-bg']).toBe('rgba(255,255,255,0.9)') // 0.55 × 1.636
    expect(t10['--mp-surface-ai-bubble']).toBe('rgba(255,255,255,0.95)') // clamp 上限
  })

  it('非薄荷系输出本系配方(海蓝实锤)', () => {
    const ocean = buildMaterialVars('ocean', 'light')
    expect(ocean['--mp-aurora-base']).toContain('#D8E8F6')
    expect(ocean['--mp-glass-bg']).toBe('rgba(255,255,255,0.52)')
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
    expect(inlineVar('--mp-glass-bg')).toBe('rgba(12,24,21,0.4)')
    expect(inlineVar('--mp-aurora-base')).toContain('#071310')
  })

  it('滑杆变更经 watch 以当前色系即时重应用', () => {
    const { setFamily } = useMpColorFamily()
    setFamily('ocean')
    const { setTransparency } = useAcrylicSliders()
    setTransparency(60)
    expect(inlineVar('--mp-glass-bg')).toBe('rgba(255,255,255,0.38)') // 海蓝 surf 0.52 × 0.727
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

  it('渲染 4 个色斑 + 噪点层;色斑带参考件填充与几何', () => {
    const wrapper = mount(AuroraLayer)
    const blobs = wrapper.findAll('.mp-aurora-blob')
    expect(blobs).toHaveLength(4)
    expect(blobs[0]!.attributes('style')).toContain('141, 234, 196')
    expect(blobs[0]!.attributes('style')).toContain('width: 120%')
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
    expect(inlineVar('--mp-glass-bg')).toBe('rgba(255,255,255,0.4)')
    expect(localStorage.getItem('mp_acrylic_glass')).toBe('60')
  })
})
