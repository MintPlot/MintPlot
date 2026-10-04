import { describe, expect, it } from 'vitest'
import { useMpTheme } from '../../src/kernel/design/theme'

describe('主题三档(仿 Edge:浅色 / 深色 / 跟随系统)', () => {
  it('偏好持久化;theme 恒为解析后的明暗;dark 类随解析值切换', () => {
    localStorage.removeItem('mp_theme_pref')
    const { pref, theme, setPref } = useMpTheme()
    // 无偏好时跟随系统;jsdom 无 matchMedia → 解析为浅色
    expect(pref.value).toBe('system')
    expect(theme.value).toBe('light')

    setPref('dark')
    expect(pref.value).toBe('dark')
    expect(theme.value).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(localStorage.getItem('mp_theme_pref')).toBe('dark')

    setPref('system')
    expect(pref.value).toBe('system')
    expect(theme.value).toBe('light')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    localStorage.removeItem('mp_theme_pref')
  })
})
