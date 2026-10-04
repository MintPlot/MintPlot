import { describe, expect, it } from 'vitest'
import {
  CHAT_COLOR_SLOTS,
  CHAT_PRESETS,
  CHAT_SWATCH_OPTIONS,
  activePresetId,
  applyMpChatPalette,
  hexToRgbTriplet,
  loadMpChatPalette,
  onBubbleInk,
} from '../../src/kernel/design/chat-palette'

describe('聊天配色(another · 四通道独立选色)', () => {
  it('预设覆盖需求方给定的全部色值', () => {
    const byId = Object.fromEntries(CHAT_PRESETS.map((preset) => [preset.id, preset.colors]))
    expect(byId['slate-blue']).toEqual({ bg: '#1A1D29', bubbleUser: '#364059', bubbleAi: '#272C3A', accent: '#D4AF37' })
    expect(byId['lilac']).toEqual({ bg: '#F3F1F7', bubbleUser: '#C9BDE0', bubbleAi: '#E7E2F0', accent: '#8A7FBC' })
    expect(byId['violet-black']).toEqual({ bg: '#121016', bubbleUser: '#352842', bubbleAi: '#1E1826', accent: '#A63D61' })
    expect(byId['rice-light']).toMatchObject({ bg: '#F4F0E8', bubbleUser: '#B85450', bubbleAi: '#E9E2D6' })
    expect(byId['rice-dark']).toMatchObject({ bg: '#1C2626', bubbleUser: '#8C3232', bubbleAi: '#2D3A3A' })
  })

  it('hex → RGB 三元组;非法色值拒绝', () => {
    expect(hexToRgbTriplet('#1A1D29')).toBe('26 29 41')
    expect(hexToRgbTriplet('#D4AF37')).toBe('212 175 55')
    expect(() => hexToRgbTriplet('#12345')).toThrow()
    expect(() => hexToRgbTriplet('1A1D29')).toThrow()
  })

  it('气泡文字色按 YIQ 推导:深底白字,浅底暖墨', () => {
    for (const hex of ['#364059', '#272C3A', '#352842', '#1E1826', '#B85450', '#8C3232', '#2D3A3A']) {
      expect(onBubbleInk(hex)).toBe('255 255 255')
    }
    for (const hex of ['#C9BDE0', '#E7E2F0', '#E9E2D6']) {
      expect(onBubbleInk(hex)).toBe('23 35 31')
    }
  })

  it('背景即主题色:深底派生整套表面 token 并切到 dark', () => {
    const root = document.documentElement
    applyMpChatPalette({ bg: '#1A1D29', bubbleUser: null, bubbleAi: null, accent: null })
    expect(root.style.getPropertyValue('--mp-c-bg')).toBe('26 29 41')
    expect(root.style.getPropertyValue('--mp-c-card')).toBe('26 29 41')
    expect(root.style.getPropertyValue('--mp-c-ink')).toBe('225 226 227')
    expect(root.style.getPropertyValue('--mp-c-ink-2')).toBe('159 160 165')
    expect(root.style.getPropertyValue('--mp-c-ink-3')).toBe('118 119 127')
    expect(root.style.getPropertyValue('--mp-line')).toBe('rgba(225,226,227,0.1)')
    expect(root.classList.contains('dark')).toBe(true)
  })

  it('浅底背景:卡片提亮保留底色气味,亮墨降深,不切 dark', () => {
    const root = document.documentElement
    applyMpChatPalette({ bg: '#F3F1F7', bubbleUser: null, bubbleAi: null, accent: null })
    expect(root.style.getPropertyValue('--mp-c-bg')).toBe('243 241 247')
    expect(root.style.getPropertyValue('--mp-c-card')).toBe('250 249 251')
    expect(root.style.getPropertyValue('--mp-c-ink')).toBe('32 31 32')
    expect(root.classList.contains('dark')).toBe(false)
  })

  it('用户气泡联动主操作色:primary / on-primary / pressed / wash 全套派生', () => {
    const root = document.documentElement
    applyMpChatPalette({ bg: null, bubbleUser: '#364059', bubbleAi: null, accent: null })
    expect(root.style.getPropertyValue('--mp-c-bubble-user')).toBe('54 64 89')
    expect(root.style.getPropertyValue('--mp-c-on-bubble-user')).toBe('255 255 255')
    expect(root.style.getPropertyValue('--mp-c-primary')).toBe('54 64 89')
    expect(root.style.getPropertyValue('--mp-c-on-primary')).toBe('255 255 255')
    expect(root.style.getPropertyValue('--mp-c-primary-pressed')).toBe('46 55 77')
    expect(root.style.getPropertyValue('--mp-accent-wash')).toBe('rgba(54,64,89,0.12)')
  })

  it('强调色:聊天域取原色;全局文本强调深底原色、浅底降深', () => {
    const root = document.documentElement
    applyMpChatPalette({ bg: '#1A1D29', bubbleUser: null, bubbleAi: null, accent: '#D4AF37' })
    expect(root.style.getPropertyValue('--mp-c-chat-accent')).toBe('212 175 55')
    expect(root.style.getPropertyValue('--mp-c-accent')).toBe('212 175 55')

    applyMpChatPalette({ bg: '#F3F1F7', bubbleUser: null, bubbleAi: null, accent: '#8A7FBC' })
    expect(root.style.getPropertyValue('--mp-c-chat-accent')).toBe('138 127 188')
    expect(root.style.getPropertyValue('--mp-c-accent')).toBe('99 91 135')
  })

  it('null 通道移除内联值回落主题默认,明暗 class 同步还原', () => {
    const root = document.documentElement
    applyMpChatPalette({ bg: '#1A1D29', bubbleUser: '#364059', bubbleAi: '#272C3A', accent: '#D4AF37' })
    expect(root.classList.contains('dark')).toBe(true)

    applyMpChatPalette({ bg: null, bubbleUser: null, bubbleAi: null, accent: null })
    expect(root.style.getPropertyValue('--mp-c-bg')).toBe('')
    expect(root.style.getPropertyValue('--mp-c-card')).toBe('')
    expect(root.style.getPropertyValue('--mp-c-ink')).toBe('')
    expect(root.style.getPropertyValue('--mp-c-primary')).toBe('')
    expect(root.style.getPropertyValue('--mp-c-on-bubble-user')).toBe('')
    expect(root.style.getPropertyValue('--mp-c-bubble-ai')).toBe('')
    expect(root.style.getPropertyValue('--mp-c-chat-accent')).toBe('')
    expect(root.classList.contains('dark')).toBe(false)
  })

  it('持久化往返:localStorage 存取 + 非法数据回落空配色', () => {
    localStorage.setItem('mp_chat_palette', JSON.stringify({ bg: '#121016', bubbleUser: 'oops', bubbleAi: 7, accent: '#A63D61' }))
    const palette = loadMpChatPalette()
    expect(palette.bg).toBe('#121016')
    expect(palette.bubbleUser).toBeNull()
    expect(palette.bubbleAi).toBeNull()
    expect(palette.accent).toBe('#A63D61')

    localStorage.setItem('mp_chat_palette', '{broken json')
    expect(loadMpChatPalette()).toEqual({ bg: null, bubbleUser: null, bubbleAi: null, accent: null })
    localStorage.removeItem('mp_chat_palette')
  })

  it('色卡单选高亮:全跟随 = 默认,整组命中 = 预设,混搭 = 自定义无高亮', () => {
    expect(activePresetId({ bg: null, bubbleUser: null, bubbleAi: null, accent: null })).toBe('default')
    expect(activePresetId({ ...CHAT_PRESETS[0]!.colors })).toBe('slate-blue')
    expect(activePresetId({ bg: '#1A1D29', bubbleUser: '#364059', bubbleAi: '#272C3A', accent: '#A63D61' })).toBeNull()
  })

  it('色板纪律:四通道均有可选色,且取色全部来自预设', () => {
    const presetHexes = new Set(CHAT_PRESETS.flatMap((preset) => Object.values(preset.colors)))
    for (const { key } of CHAT_COLOR_SLOTS) {
      const options = CHAT_SWATCH_OPTIONS[key]
      expect(options.length).toBeGreaterThan(0)
      for (const opt of options) {
        expect(presetHexes.has(opt.hex)).toBe(true)
        expect(opt.label.length).toBeGreaterThan(0)
      }
    }
  })
})
