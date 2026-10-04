import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import {
  COLOR_FAMILIES,
  DEFAULT_FAMILY_ID,
  applyMpColorFamily,
  findFamily,
  hexToRgbTriplet,
  initMpColorFamily,
  useMpColorFamily,
} from '../../src/kernel/design/color-families'
import { useMpTheme } from '../../src/kernel/design/theme'
import AppearanceSection from '../../src/kernel/app/sections/AppearanceSection.vue'

const HEX6 = /^#[0-9a-fA-F]{6}$/

const inlineVar = (key: string): string =>
  document.documentElement.style.getPropertyValue(key).trim()

describe('色系目录(Edge 式一排色点,每系明暗两套)', () => {
  it('八系齐全、id 唯一、薄荷默认在首位', () => {
    expect(COLOR_FAMILIES).toHaveLength(8)
    const ids = COLOR_FAMILIES.map((family) => family.id)
    expect(new Set(ids).size).toBe(8)
    expect(ids[0]).toBe(DEFAULT_FAMILY_ID)
    expect(findFamily('ocean')?.label).toBe('海蓝')
    expect(findFamily('nope')).toBeUndefined()
  })

  it('每系明暗 token 集完备且 hex6 合法', () => {
    for (const family of COLOR_FAMILIES) {
      for (const mode of ['light', 'dark'] as const) {
        const tokens = family[mode]
        for (const [key, value] of Object.entries(tokens)) {
          expect(HEX6.test(value), `${family.id}.${mode}.${key} = ${value}`).toBe(true)
        }
      }
    }
  })

  it('浅色底恒浅、深色底恒深(YIQ 明暗判别)', () => {
    const yiq = (hex: string): number => {
      const v = Number.parseInt(hex.slice(1), 16)
      return ((v >> 16) * 299 + ((v >> 8) & 0xff) * 587 + (v & 0xff) * 114) / 1000
    }
    for (const family of COLOR_FAMILIES) {
      expect(yiq(family.light.bg), `${family.id} light.bg`).toBeGreaterThan(150)
      expect(yiq(family.dark.bg), `${family.id} dark.bg`).toBeLessThan(80)
    }
  })

  it('块面明暗方向:浅色 accent 恒亮于等于深色 accent(深色块面更深沉,用户拍板)', () => {
    const yiq = (hex: string): number => {
      const v = Number.parseInt(hex.slice(1), 16)
      return ((v >> 16) * 299 + ((v >> 8) & 0xff) * 587 + (v & 0xff) * 114) / 1000
    }
    for (const family of COLOR_FAMILIES) {
      expect(
        yiq(family.light.accent),
        `${family.id}: light.accent ${family.light.accent} 应亮于 dark.accent ${family.dark.accent}`,
      ).toBeGreaterThanOrEqual(yiq(family.dark.accent))
      // 深色块面配亮墨;文字强调在深底保持亮色可读
      expect(family.dark.onAccent.toLowerCase()).toBe('#ffffff')
      expect(yiq(family.dark.accentText)).toBeGreaterThanOrEqual(yiq(family.dark.accent))
    }
  })

  it('hexToRgbTriplet 走三元组纪律;非法输入抛错', () => {
    expect(hexToRgbTriplet('#1A1D29')).toBe('26 29 41')
    expect(() => hexToRgbTriplet('1A1D29')).toThrow()
  })
})

describe('色系应用(内联变量接管,mint 回落 tokens.css)', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.style.cssText = ''
  })

  it('非薄荷系按当前明暗写内联三元组;不碰 color-scheme 与 .dark 类', () => {
    applyMpColorFamily('ocean', 'light')
    const ocean = findFamily('ocean')!
    expect(inlineVar('--mp-c-bg')).toBe(hexToRgbTriplet(ocean.light.bg))
    expect(inlineVar('--mp-c-primary')).toBe(hexToRgbTriplet(ocean.light.accent))
    expect(inlineVar('--mp-c-bubble-user')).toBe(hexToRgbTriplet(ocean.light.accent))
    expect(inlineVar('--mp-c-bubble-ai')).toBe(hexToRgbTriplet(ocean.light.aiBubble))
    expect(inlineVar('--mp-c-accent')).toBe(hexToRgbTriplet(ocean.light.accentText))
    expect(inlineVar('--mp-accent-wash')).toBe('rgba(46,124,214,0.09)')
    expect(document.documentElement.style.getPropertyValue('color-scheme')).toBe('')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('深色模式换深色套并接管玻璃变量', () => {
    applyMpColorFamily('vermilion', 'dark')
    const vermilion = findFamily('vermilion')!
    expect(inlineVar('--mp-c-bg')).toBe(hexToRgbTriplet(vermilion.dark.bg))
    expect(inlineVar('--mp-c-bubble-user')).toBe(hexToRgbTriplet(vermilion.dark.accent))
    expect(inlineVar('--mp-glass-bg')).toBe('rgba(22,18,16,0.55)')
  })

  it('薄荷 = 清除全部内联变量,默认观感零位移', () => {
    applyMpColorFamily('ocean', 'light')
    expect(inlineVar('--mp-c-bg')).not.toBe('')
    applyMpColorFamily('mint', 'light')
    expect(inlineVar('--mp-c-bg')).toBe('')
    expect(inlineVar('--mp-c-primary')).toBe('')
  })
})

describe('明暗联动与持久化', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.style.cssText = ''
    localStorage.removeItem('mp_theme_pref')
  })

  it('主题档翻转经订阅以新模式重施当前色系', () => {
    initMpColorFamily()
    const { setFamily } = useMpColorFamily()
    setFamily('ocean')
    expect(inlineVar('--mp-c-bubble-user')).toBe(hexToRgbTriplet(findFamily('ocean')!.light.accent))
    const { setPref } = useMpTheme()
    setPref('dark')
    expect(inlineVar('--mp-c-bubble-user')).toBe(hexToRgbTriplet(findFamily('ocean')!.dark.accent))
    expect(inlineVar('--mp-c-bg')).toBe(hexToRgbTriplet(findFamily('ocean')!.dark.bg))
    setPref('light')
  })

  it('setFamily 持久化;垃圾值与缺失回落薄荷', () => {
    localStorage.setItem('mp_color_family', 'violet')
    initMpColorFamily()
    const { familyId } = useMpColorFamily()
    expect(familyId.value).toBe('violet')

    localStorage.setItem('mp_color_family', 'hack')
    expect(useMpColorFamily().familyId.value).toBe('violet') // 模块态不受脏存储影响
    const { setFamily } = useMpColorFamily()
    setFamily('nope' as never)
    expect(familyId.value).toBe('violet')
  })

  it('init 清理 v1 旧键 mp_chat_palette', () => {
    localStorage.setItem('mp_chat_palette', '{"bg":"#123456"}')
    initMpColorFamily()
    expect(localStorage.getItem('mp_chat_palette')).toBeNull()
  })
})

describe('AppearanceSection(主题分区)', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.style.cssText = ''
    localStorage.removeItem('mp_theme_pref')
  })

  it('渲染 8 个半明半暗色点;说明小字与自定义通道不再存在', () => {
    const wrapper = mount(AppearanceSection)
    const dots = wrapper.findAll('button[aria-label]')
    expect(dots).toHaveLength(8)
    expect(wrapper.text()).not.toContain('自定义')
    expect(wrapper.text()).not.toContain('背景即主题底色')
    expect(wrapper.text()).not.toContain('配色主题联动全局界面')
    const ocean = dots.find((dot) => dot.attributes('aria-label') === '海蓝')!
    // Vue 归一化内联样式:hex → rgb()
    const rgb = (hex: string): string => {
      const [r, g, b] = hexToRgbTriplet(hex).split(' ')
      return `rgb(${r}, ${g}, ${b})`
    }
    expect(ocean.attributes('style')).toContain(
      `linear-gradient(135deg, ${rgb(findFamily('ocean')!.light.accent)} 50%, ${rgb(findFamily('ocean')!.dark.accent)} 50%)`,
    )
  })

  it('点色点换系并落存储;分区标题为「主题」', async () => {
    const wrapper = mount(AppearanceSection)
    expect(wrapper.text()).toContain('主题')
    const ocean = wrapper.findAll('button[aria-label]').find((dot) => dot.attributes('aria-label') === '海蓝')!
    await ocean.trigger('click')
    expect(localStorage.getItem('mp_color_family')).toBe('ocean')
    expect(useMpColorFamily().familyId.value).toBe('ocean')
  })
})
