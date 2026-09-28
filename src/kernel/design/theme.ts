import { ref } from 'vue'

export type MpTheme = 'light' | 'dark'

/**
 * 主题机制(M0-c):明 / 夜航墨绿双主题,经 <html>.dark 切换(Tailwind darkMode: 'class')。
 * 默认跟随系统 prefers-color-scheme;M0 不做存储纪律 —— 偏好持久化随 M2+ 设置器官入驻。
 */
const theme = ref<MpTheme>(
  typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light',
)

function applyTheme(value: MpTheme): void {
  document.documentElement.classList.toggle('dark', value === 'dark')
}

export function useMpTheme() {
  const setTheme = (value: MpTheme): void => {
    theme.value = value
    applyTheme(value)
  }
  const toggleTheme = (): void => {
    setTheme(theme.value === 'dark' ? 'light' : 'dark')
  }
  return { theme, setTheme, toggleTheme }
}

export function initMpTheme(): void {
  applyTheme(theme.value)
}
