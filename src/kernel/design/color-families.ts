import { ref } from 'vue'
import { subscribeEffectiveTheme, useMpTheme, type MpTheme } from './theme'

/**
 * Color families (Edge-style appearance): one curated hue row, each family
 * ships a hand-tuned light and dark surface set and follows the resolved
 * theme mode. Application writes inline CSS variables on <html> (inline
 * always wins over `.dark` overrides); the `mint` family clears all inline
 * values so the brand defaults in tokens.css stay the single source.
 * Mode ownership stays with theme.ts — this module never touches
 * `color-scheme` or the `.dark` class, it only re-applies on theme flips.
 * Shell-level preference, persisted in localStorage (same discipline as
 * the theme pref; never enters the mp_settings plugin domain).
 */
export type MpColorFamilyId =
  | 'mint'
  | 'ocean'
  | 'cyan'
  | 'forest'
  | 'amber'
  | 'vermilion'
  | 'rose'
  | 'violet'

/** Per-mode surface set; hex lives only at this entry point. */
export interface MpColorFamilyMode {
  readonly bg: string
  readonly card: string
  readonly ink: string
  readonly ink2: string
  readonly ink3: string
  /** Primary action / user bubble / send button. Light mode = the brighter
   *  fill; dark mode = a deep tonal fill (never pastel-bright) with light ink. */
  readonly accent: string
  /** Text on accent surfaces. */
  readonly onAccent: string
  /** Text emphasis / links; deeper than accent on light, equal on dark. */
  readonly accentText: string
  /** AI bubble surface — a derived neutral of the same hue family. */
  readonly aiBubble: string
}

export interface MpColorFamily {
  readonly id: MpColorFamilyId
  readonly label: string
  readonly light: MpColorFamilyMode
  readonly dark: MpColorFamilyMode
}

export const COLOR_FAMILIES: readonly MpColorFamily[] = [
  {
    id: 'mint',
    label: '薄荷',
    // Brand defaults — values mirror tokens.css; applying mint just clears.
    light: { bg: '#FAFAF7', card: '#FFFFFF', ink: '#17231F', ink2: '#4C5B55', ink3: '#8A978F', accent: '#2BB39B', onAccent: '#FFFFFF', accentText: '#1B6F70', aiBubble: '#FFFFFF' },
    dark: { bg: '#101D1A', card: '#101D1A', ink: '#DCE7E2', ink2: '#9FB3AB', ink3: '#6F857A', accent: '#2BB39B', onAccent: '#FFFFFF', accentText: '#5CDDB4', aiBubble: '#101D1A' },
  },
  {
    id: 'ocean',
    label: '海蓝',
    light: { bg: '#EFF4FA', card: '#FFFFFF', ink: '#17202B', ink2: '#3E4E60', ink3: '#6E7F92', accent: '#2E7CD6', onAccent: '#FFFFFF', accentText: '#1E5FA8', aiBubble: '#E2EBF5' },
    // Dark fills stay deep (tonal, white-on-ink); only text emphasis keeps the
    // bright hue for readability on dark surfaces.
    dark: { bg: '#0E141C', card: '#161E28', ink: '#E2E9F2', ink2: '#A3B2C4', ink3: '#6B7A8C', accent: '#2E63B0', onAccent: '#FFFFFF', accentText: '#5B9BFF', aiBubble: '#1A2430' },
  },
  {
    id: 'cyan',
    label: '青碧',
    light: { bg: '#EAF5F4', card: '#FFFFFF', ink: '#14211F', ink2: '#3A504D', ink3: '#6A817D', accent: '#0E9488', onAccent: '#FFFFFF', accentText: '#0A6E65', aiBubble: '#DFEFED' },
    dark: { bg: '#0B1514', card: '#12201E', ink: '#DFF0EC', ink2: '#9DB8B3', ink3: '#647D78', accent: '#0B6E64', onAccent: '#FFFFFF', accentText: '#2DD4BF', aiBubble: '#172825' },
  },
  {
    id: 'forest',
    label: '森绿',
    light: { bg: '#EFF5EC', card: '#FFFFFF', ink: '#1A2318', ink2: '#48543F', ink3: '#75826B', accent: '#43875F', onAccent: '#FFFFFF', accentText: '#2F6347', aiBubble: '#E4EDDF' },
    dark: { bg: '#0F1611', card: '#16201A', ink: '#E4EEE3', ink2: '#A8B8A0', ink3: '#71806A', accent: '#356B4C', onAccent: '#FFFFFF', accentText: '#7CC08B', aiBubble: '#1B271F' },
  },
  {
    id: 'amber',
    label: '琥珀',
    light: { bg: '#F8F2E7', card: '#FFFFFF', ink: '#26211A', ink2: '#54483A', ink3: '#837765', accent: '#C07A1D', onAccent: '#FFFFFF', accentText: '#8F5A12', aiBubble: '#F1E9DA' },
    dark: { bg: '#171310', card: '#201A14', ink: '#F0E8DC', ink2: '#BCAC96', ink3: '#877963', accent: '#A26712', onAccent: '#FFFFFF', accentText: '#E5A54B', aiBubble: '#282017' },
  },
  {
    id: 'vermilion',
    label: '绯红',
    light: { bg: '#F7F1E8', card: '#FFFFFF', ink: '#241E1A', ink2: '#52453D', ink3: '#80705F', accent: '#B85450', onAccent: '#FFFFFF', accentText: '#963E3B', aiBubble: '#F0E8DC' },
    dark: { bg: '#161210', card: '#1F1917', ink: '#F0E7E1', ink2: '#BBA8A0', ink3: '#86746C', accent: '#9C4541', onAccent: '#FFFFFF', accentText: '#D4756B', aiBubble: '#292019' },
  },
  {
    id: 'rose',
    label: '玫粉',
    light: { bg: '#F9F0F3', card: '#FFFFFF', ink: '#241A1E', ink2: '#543F48', ink3: '#826B74', accent: '#C2577F', onAccent: '#FFFFFF', accentText: '#93395F', aiBubble: '#F2E6EB' },
    dark: { bg: '#171114', card: '#1F171B', ink: '#F0E4EA', ink2: '#BCA3AF', ink3: '#846F79', accent: '#A04A6E', onAccent: '#FFFFFF', accentText: '#DA7FA7', aiBubble: '#291E24' },
  },
  {
    id: 'violet',
    label: '黛紫',
    light: { bg: '#F2F0F8', card: '#FFFFFF', ink: '#1C1A24', ink2: '#454153', ink3: '#6F6C80', accent: '#7160BE', onAccent: '#FFFFFF', accentText: '#52449B', aiBubble: '#EAE7F3' },
    dark: { bg: '#121018', card: '#1A1822', ink: '#E9E6F2', ink2: '#AFA9C4', ink3: '#767089', accent: '#5F51A8', onAccent: '#FFFFFF', accentText: '#9C8EE0', aiBubble: '#221F2C' },
  },
]

export const DEFAULT_FAMILY_ID: MpColorFamilyId = 'mint'

const FAMILY_IDS = COLOR_FAMILIES.map((family) => family.id)

export const findFamily = (id: string): MpColorFamily | undefined =>
  COLOR_FAMILIES.find((family) => family.id === id)

const HEX6 = /^#[0-9a-fA-F]{6}$/

/** '#1A1D29' → '26 29 41' (tokens.css RGB-triplet discipline). */
export function hexToRgbTriplet(hex: string): string {
  if (!HEX6.test(hex)) throw new Error(`[color-families] invalid hex: ${hex}`)
  const value = Number.parseInt(hex.slice(1), 16)
  return `${(value >> 16) & 0xff} ${(value >> 8) & 0xff} ${value & 0xff}`
}

const rgbOf = (hex: string): [number, number, number] => {
  const [r, g, b] = hexToRgbTriplet(hex).split(' ').map(Number)
  return [r!, g!, b!]
}

const tripletOf = (rgb: readonly [number, number, number]): string => `${rgb[0]} ${rgb[1]} ${rgb[2]}`

const rgbaOf = (rgb: readonly [number, number, number], alpha: number): string =>
  `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`

/** Blend toward black/white (ratio 0 = original, 1 = target), as an RGB triplet. */
const mix = (hex: string, target: 'black' | 'white', ratio: number): [number, number, number] =>
  rgbOf(hex).map((channel) =>
    Math.round(channel + (ratio * (target === 'white' ? 255 - channel : -channel))),
  ) as [number, number, number]

/** Every inline variable a family owns; mint clears exactly this list. */
const FAMILY_VARS = [
  '--mp-c-bg',
  '--mp-c-card',
  '--mp-c-ink',
  '--mp-c-ink-2',
  '--mp-c-ink-3',
  '--mp-line',
  '--mp-line-strong',
  '--mp-c-primary',
  '--mp-c-on-primary',
  '--mp-c-primary-pressed',
  '--mp-accent-wash',
  '--mp-c-accent',
  '--mp-c-bubble-user',
  '--mp-c-on-bubble-user',
  '--mp-c-bubble-ai',
  '--mp-c-on-bubble-ai',
  '--mp-c-chat-accent',
] as const

/** Apply a family for the given resolved mode; mint falls back to tokens.css. */
export function applyMpColorFamily(familyId: string, mode: MpTheme): void {
  if (typeof document === 'undefined') return
  const style = document.documentElement.style
  if (familyId === DEFAULT_FAMILY_ID) {
    for (const key of FAMILY_VARS) style.removeProperty(key)
    return
  }
  const family = findFamily(familyId)
  if (!family) {
    applyMpColorFamily(DEFAULT_FAMILY_ID, mode)
    return
  }
  const tokens = mode === 'dark' ? family.dark : family.light
  const accent = rgbOf(tokens.accent)
  const ink = rgbOf(tokens.ink)
  const bg = rgbOf(tokens.bg)
  const set = (key: string, value: string): void => style.setProperty(key, value)
  set('--mp-c-bg', tripletOf(bg))
  set('--mp-c-card', tripletOf(rgbOf(tokens.card)))
  set('--mp-c-ink', tripletOf(ink))
  set('--mp-c-ink-2', tripletOf(rgbOf(tokens.ink2)))
  set('--mp-c-ink-3', tripletOf(rgbOf(tokens.ink3)))
  set('--mp-line', rgbaOf(ink, 0.1))
  set('--mp-line-strong', rgbaOf(ink, 0.18))
  set('--mp-c-primary', tripletOf(accent))
  set('--mp-c-on-primary', tripletOf(rgbOf(tokens.onAccent)))
  set('--mp-c-primary-pressed', tripletOf(mix(tokens.accent, 'black', 0.14)))
  set('--mp-accent-wash', rgbaOf(accent, mode === 'dark' ? 0.12 : 0.09))
  set('--mp-c-accent', tripletOf(rgbOf(tokens.accentText)))
  set('--mp-c-bubble-user', tripletOf(accent))
  set('--mp-c-on-bubble-user', tripletOf(rgbOf(tokens.onAccent)))
  set('--mp-c-bubble-ai', tripletOf(rgbOf(tokens.aiBubble)))
  set('--mp-c-on-bubble-ai', tripletOf(ink))
  set('--mp-c-chat-accent', tripletOf(rgbOf(tokens.accentText)))
  if (mode === 'dark') {
    // Dark glass derives from the family surfaces; light mode keeps the
    // hue-neutral white glass defaults from tokens.css.
    set('--mp-glass-bg', rgbaOf(bg, 0.55))
    set('--mp-glass-border', rgbaOf(ink, 0.16))
    set('--mp-glass-solid', rgbaOf(bg, 0.85))
  } else {
    style.removeProperty('--mp-glass-bg')
    style.removeProperty('--mp-glass-border')
    style.removeProperty('--mp-glass-solid')
  }
}

const STORAGE_KEY = 'mp_color_family'
const LEGACY_STORAGE_KEY = 'mp_chat_palette'

function readStoredFamilyId(): MpColorFamilyId {
  if (typeof localStorage === 'undefined') return DEFAULT_FAMILY_ID
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    return saved !== null && FAMILY_IDS.includes(saved as MpColorFamilyId)
      ? (saved as MpColorFamilyId)
      : DEFAULT_FAMILY_ID
  } catch {
    return DEFAULT_FAMILY_ID
  }
}

function persistFamilyId(id: MpColorFamilyId): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, id)
  } catch (error) {
    console.error('[color-families] persist failed:', error)
  }
}

const familyId = ref<MpColorFamilyId>(readStoredFamilyId())

const reapply = (): void => {
  applyMpColorFamily(familyId.value, useMpTheme().theme.value)
}

export function useMpColorFamily() {
  const setFamily = (id: MpColorFamilyId): void => {
    if (!FAMILY_IDS.includes(id)) return
    familyId.value = id
    persistFamilyId(id)
    reapply()
  }
  return { familyId, setFamily }
}

/** Composition-root bootstrap: drop the v1 key, restore and bind the family. */
export function initMpColorFamily(): void {
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.removeItem(LEGACY_STORAGE_KEY)
    } catch {
      /* storage unavailable — nothing to clean up */
    }
  }
  familyId.value = readStoredFamilyId()
  reapply()
  subscribeEffectiveTheme(() => reapply())
}
