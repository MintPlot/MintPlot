import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import {
  AURORA_RECIPES,
  GLASS_T_DEFAULT,
  GLOW_DEFAULT,
  MATERIAL_VARS,
  buildMaterialVars,
  initAcrylicSliders,
  slidersAtDefault,
  useAcrylicSliders,
} from '../../src/kernel/design/acrylic'
import {
  COLOR_FAMILIES,
  applyMpColorFamily,
  findFamily,
  initMpColorFamily,
  useMpColorFamily,
} from '../../src/kernel/design/color-families'
import AppearanceSection from '../../src/kernel/app/sections/AppearanceSection.vue'

const HEX6 = /^#[0-9a-fA-F]{6}$/

const mint = findFamily('mint')!

const inlineVar = (key: string): string =>
  document.documentElement.style.getPropertyValue(key).trim()

const resetSliders = (): void => {
  const { setGlow, setTransparency } = useAcrylicSliders()
  setGlow(GLOW_DEFAULT)
  setTransparency(GLASS_T_DEFAULT)
}

describe('acrylic 极光配方(八系 × 明暗)', () => {
  it('每系配方齐全:基底三停 hex6、四色斑合法、暗色 edge 为 rgba', () => {
    for (const family of COLOR_FAMILIES) {
      const recipe = AURORA_RECIPES[family.id]
      expect(recipe, family.id).toBeDefined()
      for (const mode of ['light', 'dark'] as const) {
        const aurora = recipe[mode]
        for (const stop of aurora.base) {
          expect(HEX6.test(stop), `${family.id}.${mode} base ${stop}`).toBe(true)
        }
        expect(aurora.blobs).toHaveLength(4)
        for (const blob of aurora.blobs) {
          expect(HEX6.test(blob.hex), `${family.id}.${mode} blob ${blob.hex}`).toBe(true)
          expect(blob.alpha).toBeGreaterThan(0)
          expect(blob.alpha).toBeLessThanOrEqual(1)
        }
        expect(aurora.edge.startsWith('rgba('), `${family.id}.${mode} edge`).toBe(true)
      }
    }
  })
})

describe('buildMaterialVars(辉光缩放 / 透明度映射)', () => {
  it('默认滑杆 = 预览拍板值:四色斑 + 基底、chrome 0.55、内容面 0.72/0.74', () => {
    const light = buildMaterialVars(mint, 'light')
    expect(light['--mp-bg-image']).toContain('linear-gradient(168deg, #EDF6F1 0%, #F6FBF8 46%, #EBF4EF 100%)')
    expect(light['--mp-bg-image']).toContain('rgba(141,234,196,0.5)')
    expect((light['--mp-bg-image']!.match(/radial-gradient/g) ?? [])).toHaveLength(4)
    expect(light['--mp-glass-bg']).toBe('rgba(255,255,255,0.55)')
    expect(light['--mp-card-fill-alpha']).toBe('0.72')
    expect(light['--mp-surface-ai-bubble']).toBe('rgba(255,255,255,0.72)')

    const dark = buildMaterialVars(mint, 'dark')
    expect(dark['--mp-glass-bg']).toBe('rgba(16,29,26,0.55)')
    expect(dark['--mp-glass-border']).toBe('rgba(220,231,226,0.16)')
    expect(dark['--mp-glass-edge']).toBe('rgba(140,240,200,0.08)')
    expect(dark['--mp-card-fill-alpha']).toBe('0.74')
    expect(dark['--mp-surface-ai-bubble']).toBe('rgba(16,29,26,0.74)')
    expect(dark['--mp-c-primary-hi']).toBe('85 194 175')
  })

  it('辉光滑杆按乘数缩放色斑 alpha;0 档整层丢弃只留基底', () => {
    const half = buildMaterialVars(mint, 'dark', 50, GLASS_T_DEFAULT)
    expect(half['--mp-bg-image']).toContain('rgba(20,110,95,0.28)') // 0.55 × 0.5
    expect((half['--mp-bg-image']!.match(/radial-gradient/g) ?? [])).toHaveLength(4)

    const off = buildMaterialVars(mint, 'dark', 0, GLASS_T_DEFAULT)
    expect(off['--mp-bg-image']).not.toContain('radial-gradient')
    expect(off['--mp-bg-image']).toContain('linear-gradient(168deg, #071310')

    const boost = buildMaterialVars(mint, 'dark', 150, GLASS_T_DEFAULT)
    expect(boost['--mp-bg-image']).toContain('rgba(20,110,95,0.83)') // 0.825 → round
  })

  it('透明度滑杆映射两级表面 alpha 并钳制在可读区间', () => {
    const light = buildMaterialVars(mint, 'light', GLOW_DEFAULT, 70)
    expect(light['--mp-glass-bg']).toBe('rgba(255,255,255,0.3)') // chrome 1 − 0.7
    expect(light['--mp-card-fill-alpha']).toBe('0.47') // 1.17 − 0.7

    const dark = buildMaterialVars(mint, 'dark', GLOW_DEFAULT, 70)
    expect(dark['--mp-card-fill-alpha']).toBe('0.49') // +0.02 dark readability

    const solid = buildMaterialVars(mint, 'light', GLOW_DEFAULT, 10)
    expect(solid['--mp-glass-bg']).toBe('rgba(255,255,255,0.9)')
    expect(solid['--mp-card-fill-alpha']).toBe('0.95') // clamp 上限
    expect(solid['--mp-glass-solid']).toBe('rgba(255,255,255,0.88)')
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
    expect(inlineVar('--mp-bg-image')).not.toBe('')
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
    expect(inlineVar('--mp-bg-image')).toContain('#071310')
    expect(inlineVar('--mp-glass-bg')).toBe('rgba(16,29,26,0.4)') // 1 − 0.6
  })

  it('非薄荷系写本系极光与玻璃;海蓝基底实锤', () => {
    applyMpColorFamily('ocean', 'light')
    expect(inlineVar('--mp-bg-image')).toContain('#D8E8F6')
    expect(inlineVar('--mp-bg-image')).toContain('rgba(123,184,232,0.6)')
    expect(inlineVar('--mp-glass-bg')).toBe('rgba(255,255,255,0.55)')
  })

  it('滑杆变更经 watch 以当前色系即时重应用', () => {
    const { setFamily } = useMpColorFamily()
    setFamily('ocean')
    const { setGlow } = useAcrylicSliders()
    setGlow(120)
    expect(inlineVar('--mp-bg-image')).toContain('rgba(123,184,232,0.72)') // 0.6 × 1.2
    expect(inlineVar('--mp-c-bubble-user')).toBe('46 124 214')
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
    expect(inlineVar('--mp-bg-image')).toBe('')
  })
})

describe('AppearanceSection 材质滑杆(主题 v3)', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.style.cssText = ''
    useMpColorFamily().setFamily('mint')
    resetSliders()
  })

  it('渲染辉光/透明度两滑杆,拖动即时改内联材质并持久化', async () => {
    const wrapper = mount(AppearanceSection)
    const ranges = wrapper.findAll('input[type="range"]')
    // 材质两杆先于卡图背景两杆(模糊/压暗)出现在 DOM
    expect(ranges).toHaveLength(4)
    expect(ranges[0]!.attributes('min')).toBe('0')
    expect(ranges[0]!.attributes('max')).toBe('150')
    expect(ranges[1]!.attributes('min')).toBe('10')
    expect(ranges[1]!.attributes('max')).toBe('70')
    expect(wrapper.text()).toContain('辉光强度')
    expect(wrapper.text()).toContain('玻璃透明度')

    await ranges[0]!.setValue(120)
    expect(inlineVar('--mp-bg-image')).toContain('rgba(141,234,196,0.6)') // 0.5 × 1.2
    expect(localStorage.getItem('mp_acrylic_glow')).toBe('120')

    await ranges[1]!.setValue(60)
    expect(inlineVar('--mp-glass-bg')).toBe('rgba(255,255,255,0.4)') // 1 − 0.6
    expect(localStorage.getItem('mp_acrylic_glass')).toBe('60')
  })
})
