import { ref } from 'vue'

/**
 * 主题机制(仿 Edge 外观):浅色 / 深色 / 跟随系统三档偏好,持久化于
 * localStorage(Edge 同款纪律:外观偏好属壳层,不进 mp_settings 插件域)。
 * `pref` 是用户选择,`theme` 是解析后的实际明暗 —— 跟随系统档实时响应
 * prefers-color-scheme 变化;`.dark` 类切换走 Tailwind darkMode: 'class'。
 */
export type MpTheme = 'light' | 'dark'
export type MpThemePref = 'light' | 'dark' | 'system'

const PREF_KEY = 'mp_theme_pref'

const prefersDark = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-color-scheme: dark)').matches

function readPref(): MpThemePref {
  if (typeof localStorage === 'undefined') return 'system'
  const saved = localStorage.getItem(PREF_KEY)
  return saved === 'light' || saved === 'dark' || saved === 'system' ? saved : 'system'
}

const pref = ref<MpThemePref>(readPref())
const theme = ref<MpTheme>(pref.value === 'system' ? (prefersDark() ? 'dark' : 'light') : pref.value)

type EffectiveThemeListener = (theme: MpTheme) => void

const themeListeners = new Set<EffectiveThemeListener>()

/** Notify on every resolved light/dark flip (pref change or system follow). */
export function subscribeEffectiveTheme(listener: EffectiveThemeListener): () => void {
  themeListeners.add(listener)
  return () => {
    themeListeners.delete(listener)
  }
}

function applyResolved(): void {
  document.documentElement.classList.toggle('dark', theme.value === 'dark')
  for (const listener of themeListeners) listener(theme.value)
}

let media: MediaQueryList | null = null

function bindSystemMedia(): void {
  if (media !== null || typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
  media = window.matchMedia('(prefers-color-scheme: dark)')
  const onChange = (event: MediaQueryListEvent): void => {
    if (pref.value !== 'system') return
    theme.value = event.matches ? 'dark' : 'light'
    applyResolved()
  }
  // 老内核只有 addListener(Capacitor WebView 兜底)
  if (typeof media.addEventListener === 'function') media.addEventListener('change', onChange)
  else media.addListener(onChange)
}

export function useMpTheme() {
  const setPref = (value: MpThemePref): void => {
    pref.value = value
    try {
      localStorage.setItem(PREF_KEY, value)
    } catch {
      /* 持久化失败不阻断切换 */
    }
    theme.value = value === 'system' ? (prefersDark() ? 'dark' : 'light') : value
    applyResolved()
  }
  const setTheme = (value: MpTheme): void => setPref(value)
  const toggleTheme = (): void => setPref(theme.value === 'dark' ? 'light' : 'dark')
  return { pref, theme, setPref, setTheme, toggleTheme }
}

export function initMpTheme(): void {
  bindSystemMedia()
  applyResolved()
}
