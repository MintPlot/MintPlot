import { reactive } from 'vue'
import { useMpTheme } from './theme'

/**
 * 聊天配色(another · M3):背景 / 用户气泡 / AI 气泡 / 强调色四个通道,
 * 各通道独立选择。预设只是四通道的一次性整体填充,选中后逐项可改。
 *
 * 联动规则(界面颜色跟随背景):
 *  - 背景即主题色:直接覆盖全局 --mp-c-bg,并按背景明暗派生整套表面 token
 *    (卡片 / 墨色三级 / 边线 / 玻璃),同步 <html>.dark 与 color-scheme,
 *    使按钮以外的顶栏、卡片、文字等全部界面跟随背景明暗。
 *  - 用户气泡:同时驱动主操作色 --mp-c-primary(发送按钮、选中态、链接、焦点环)。
 *  - AI 气泡:仅聊天域气泡。
 *  - 强调色:聊天域(角色名字 / 提示)取原色;全局文本强调在浅底上降深保证可读。
 *
 * 纪律同 tokens.css:CSS 变量是唯一真源,hex 只在选色入口出现,应用时转
 * RGB 三元组 / rgba 写入 <html> 内联变量(内联优先级恒高于 .dark 覆盖)。
 * 持久化走 localStorage:壳级外观偏好与主题一致,不进 mp_settings 插件域。
 */

export type MpChatColorKey = 'bg' | 'bubbleUser' | 'bubbleAi' | 'accent'

/** 单通道取色;null = 跟随当前明暗主题的默认值。 */
export type MpChatColor = string | null

export interface MpChatPalette {
  bg: MpChatColor
  bubbleUser: MpChatColor
  bubbleAi: MpChatColor
  accent: MpChatColor
}

export interface ChatPalettePreset {
  readonly id: string
  readonly label: string
  readonly colors: Readonly<Record<MpChatColorKey, string>>
}

/**
 * 预设配色(需求方给定;宣纸两版的强调色未指定,取其朱砂 #B85450 保证
 * 米灰 / 青黛黑底上均可读 —— 通道本就可独立改,预设只是初始组合)。
 */
export const CHAT_PRESETS: readonly ChatPalettePreset[] = [
  {
    id: 'slate-blue',
    label: '深灰蓝',
    colors: { bg: '#1A1D29', bubbleUser: '#364059', bubbleAi: '#272C3A', accent: '#D4AF37' },
  },
  {
    id: 'lilac',
    label: '浅淡紫灰',
    colors: { bg: '#F3F1F7', bubbleUser: '#C9BDE0', bubbleAi: '#E7E2F0', accent: '#8A7FBC' },
  },
  {
    id: 'violet-black',
    label: '极深紫黑',
    colors: { bg: '#121016', bubbleUser: '#352842', bubbleAi: '#1E1826', accent: '#A63D61' },
  },
  {
    id: 'rice-light',
    label: '宣纸·浅',
    colors: { bg: '#F4F0E8', bubbleUser: '#B85450', bubbleAi: '#E9E2D6', accent: '#B85450' },
  },
  {
    id: 'rice-dark',
    label: '宣纸·深',
    colors: { bg: '#1C2626', bubbleUser: '#8C3232', bubbleAi: '#2D3A3A', accent: '#B85450' },
  },
]

/** 四通道元数据:设置页行顺序与文案。 */
export const CHAT_COLOR_SLOTS: readonly { key: MpChatColorKey; label: string }[] = [
  { key: 'bg', label: '背景' },
  { key: 'bubbleUser', label: '用户气泡' },
  { key: 'bubbleAi', label: 'AI 气泡' },
  { key: 'accent', label: '强调色' },
]

/** 单通道可选色板 = 全部预设在该通道的取色(按 hex 去重,保留首个来源标签)。 */
const swatchesFor = (key: MpChatColorKey): readonly { hex: string; label: string }[] => {
  const seen = new Map<string, string>()
  for (const preset of CHAT_PRESETS) {
    const hex = preset.colors[key]
    if (!seen.has(hex)) seen.set(hex, preset.label)
  }
  return [...seen].map(([hex, label]) => ({ hex, label }))
}

/** 各通道可选色板。 */
export const CHAT_SWATCH_OPTIONS: Readonly<Record<MpChatColorKey, readonly { hex: string; label: string }[]>> = {
  bg: swatchesFor('bg'),
  bubbleUser: swatchesFor('bubbleUser'),
  bubbleAi: swatchesFor('bubbleAi'),
  accent: swatchesFor('accent'),
}

const HEX6 = /^#[0-9a-fA-F]{6}$/

/** '#1A1D29' → '26 29 41'(tokens.css 的 RGB 三元组存放纪律)。 */
export function hexToRgbTriplet(hex: string): string {
  if (!HEX6.test(hex)) throw new Error(`[chat-palette] 非法色值:${hex}`)
  const value = Number.parseInt(hex.slice(1), 16)
  return `${(value >> 16) & 0xff} ${(value >> 8) & 0xff} ${value & 0xff}`
}

const rgbOf = (hex: string): [number, number, number] => {
  const [r, g, b] = hexToRgbTriplet(hex).split(' ').map(Number)
  return [r!, g!, b!]
}

const tripletOf = (rgb: readonly [number, number, number]): string => `${rgb[0]} ${rgb[1]} ${rgb[2]}`

const rgbaOf = (rgb: readonly [number, number, number], alpha: number): string => `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`

/** 向黑 / 白按比例混合(0 = 原色,1 = 目标色),返回 RGB 三元组。 */
const mix = (hex: string, target: 'black' | 'white', ratio: number): [number, number, number] =>
  rgbOf(hex).map((channel) => Math.round(channel + (ratio * (target === 'white' ? 255 - channel : -channel)))) as [number, number, number]

const yiqOf = (rgb: readonly [number, number, number]): number => (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000

/** 明暗判定:YIQ ≥ 150 视为浅底(预设全色板均落在判别安全区)。 */
const isLight = (hex: string): boolean => yiqOf(rgbOf(hex)) >= 150

/** 气泡上的文字:浅底用暖墨,深底用白。 */
export function onBubbleInk(hex: string): string {
  return isLight(hex) ? '23 35 31' : '255 255 255'
}

const BG_DERIVED_VARS = [
  '--mp-c-bg',
  '--mp-c-card',
  '--mp-c-ink',
  '--mp-c-ink-2',
  '--mp-c-ink-3',
  '--mp-line',
  '--mp-line-strong',
  '--mp-glass-bg',
  '--mp-glass-border',
  '--mp-glass-solid',
] as const

const BUBBLE_USER_DERIVED_VARS = [
  '--mp-c-bubble-user',
  '--mp-c-on-bubble-user',
  '--mp-c-primary',
  '--mp-c-on-primary',
  '--mp-c-primary-pressed',
  '--mp-accent-wash',
] as const

/** 写入 <html> 内联变量;null 通道移除内联值,回落到主题默认。 */
export function applyMpChatPalette(palette: Readonly<MpChatPalette>): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  const style = root.style
  const set = (key: string, value: string): void => {
    style.setProperty(key, value)
  }
  const unset = (key: string): void => {
    style.removeProperty(key)
  }

  // ── 背景 = 主题色:派生表面 / 墨色 / 线 / 玻璃,并同步明暗 ──
  const bg = palette.bg
  if (bg) {
    const light = isLight(bg)
    const bgRgb = rgbOf(bg)
    set('--mp-c-bg', tripletOf(bgRgb))
    if (light) {
      // 浅底:卡片向白提亮保留底色气味;墨色向黑收敛保留色相
      const card = mix(bg, 'white', 0.55)
      const ink = mix(bg, 'black', 0.87)
      set('--mp-c-card', tripletOf(card))
      set('--mp-c-ink', tripletOf(ink))
      set('--mp-c-ink-2', tripletOf(mix(bg, 'black', 0.55)))
      set('--mp-c-ink-3', tripletOf(mix(bg, 'black', 0.35)))
      set('--mp-line', rgbaOf(ink, 0.1))
      set('--mp-line-strong', rgbaOf(ink, 0.18))
      set('--mp-glass-bg', 'rgba(255,255,255,0.62)')
      set('--mp-glass-border', 'rgba(255,255,255,0.7)')
      set('--mp-glass-solid', 'rgba(255,255,255,0.85)')
    } else {
      // 深底:卡片与底同色,分层靠白线(设计语言 §06);墨色向白收敛
      const ink = mix(bg, 'white', 0.87)
      set('--mp-c-card', tripletOf(bgRgb))
      set('--mp-c-ink', tripletOf(ink))
      set('--mp-c-ink-2', tripletOf(mix(bg, 'white', 0.58)))
      set('--mp-c-ink-3', tripletOf(mix(bg, 'white', 0.4)))
      set('--mp-line', rgbaOf(ink, 0.1))
      set('--mp-line-strong', rgbaOf(ink, 0.18))
      set('--mp-glass-bg', rgbaOf(bgRgb, 0.55))
      set('--mp-glass-border', rgbaOf(ink, 0.16))
      set('--mp-glass-solid', rgbaOf(bgRgb, 0.85))
    }
    style.setProperty('color-scheme', light ? 'light' : 'dark')
    root.classList.toggle('dark', !light)
  } else {
    for (const key of BG_DERIVED_VARS) unset(key)
    style.removeProperty('color-scheme')
    root.classList.toggle('dark', useMpTheme().theme.value === 'dark')
  }

  // ── 用户气泡:同时驱动主操作色 ──
  const bubbleUser = palette.bubbleUser
  if (bubbleUser) {
    const bubbleRgb = rgbOf(bubbleUser)
    set('--mp-c-bubble-user', tripletOf(bubbleRgb))
    set('--mp-c-on-bubble-user', onBubbleInk(bubbleUser))
    set('--mp-c-primary', tripletOf(bubbleRgb))
    set('--mp-c-on-primary', onBubbleInk(bubbleUser))
    set('--mp-c-primary-pressed', tripletOf(mix(bubbleUser, 'black', 0.14)))
    set('--mp-accent-wash', rgbaOf(bubbleRgb, isLight(bubbleUser) ? 0.09 : 0.12))
  } else {
    for (const key of BUBBLE_USER_DERIVED_VARS) unset(key)
  }

  // ── AI 气泡 ──
  const bubbleAi = palette.bubbleAi
  if (bubbleAi) {
    set('--mp-c-bubble-ai', hexToRgbTriplet(bubbleAi))
    set('--mp-c-on-bubble-ai', onBubbleInk(bubbleAi))
  } else {
    unset('--mp-c-bubble-ai')
    unset('--mp-c-on-bubble-ai')
  }

  // ── 强调色:聊天域取原色;全局文本强调在浅底降深保证可读 ──
  const accent = palette.accent
  if (accent) {
    set('--mp-c-chat-accent', hexToRgbTriplet(accent))
    const bgLight = palette.bg ? isLight(palette.bg) : useMpTheme().theme.value !== 'dark'
    set('--mp-c-accent', bgLight ? tripletOf(mix(accent, 'black', 0.28)) : hexToRgbTriplet(accent))
  } else {
    unset('--mp-c-chat-accent')
    unset('--mp-c-accent')
  }
}

const STORAGE_KEY = 'mp_chat_palette'

export function loadMpChatPalette(): MpChatPalette {
  const empty: MpChatPalette = { bg: null, bubbleUser: null, bubbleAi: null, accent: null }
  if (typeof localStorage === 'undefined') return empty
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return empty
    const saved = JSON.parse(raw) as Partial<MpChatPalette>
    const read = (key: MpChatColorKey): MpChatColor => {
      const value = saved[key]
      return typeof value === 'string' && HEX6.test(value) ? value : null
    }
    return { bg: read('bg'), bubbleUser: read('bubbleUser'), bubbleAi: read('bubbleAi'), accent: read('accent') }
  } catch {
    return empty
  }
}

export function saveMpChatPalette(palette: Readonly<MpChatPalette>): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(palette))
  } catch (error) {
    console.error('[chat-palette] persist failed:', error)
  }
}

const chatPalette = reactive<MpChatPalette>(loadMpChatPalette())

const persistAndApply = (): void => {
  saveMpChatPalette(chatPalette)
  applyMpChatPalette(chatPalette)
}

export function useMpChatPalette() {
  const setColor = (key: MpChatColorKey, value: MpChatColor): void => {
    chatPalette[key] = value
    persistAndApply()
  }
  const applyPreset = (presetId: string): void => {
    const preset = CHAT_PRESETS.find((entry) => entry.id === presetId)
    if (!preset) return
    Object.assign(chatPalette, preset.colors)
    persistAndApply()
  }
  const resetToTheme = (): void => {
    chatPalette.bg = null
    chatPalette.bubbleUser = null
    chatPalette.bubbleAi = null
    chatPalette.accent = null
    persistAndApply()
  }
  return { chatPalette, setColor, applyPreset, resetToTheme }
}

/**
 * 当前色卡(仿 Edge 主题库单选高亮):'default' = 全通道跟随主题;
 * 命中某个预设返回其 id;四通道混合搭配(自定义)返回 null,网格无高亮卡。
 */
export function activePresetId(palette: Readonly<MpChatPalette>): string | null {
  if (CHAT_COLOR_SLOTS.every(({ key }) => palette[key] === null)) return 'default'
  for (const preset of CHAT_PRESETS) {
    if (CHAT_COLOR_SLOTS.every(({ key }) => palette[key] === preset.colors[key])) return preset.id
  }
  return null
}

/** 组合根启动时调用:恢复上次配色。 */
export function initMpChatPalette(): void {
  applyMpChatPalette(chatPalette)
}
