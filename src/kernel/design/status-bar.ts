import { watch } from 'vue'
import { Capacitor } from '@capacitor/core'
import { StatusBar, Style } from '@capacitor/status-bar'
import { EdgeToEdge } from '@capawesome/capacitor-android-edge-to-edge-support'
import { subscribeEffectiveTheme, useMpTheme } from './theme'
import { useMpColorFamily } from './color-families'
import { statusBarFillOf } from './acrylic'

/**
 * Native status-bar sync (theme v3): the visible strip behind the status
 * bar is the WebView's parent view, painted opaque by the edge-to-edge
 * plugin (which also pushes the WebView below the strip). That opaque
 * parent covers the window scrim, so @capacitor/status-bar's
 * setBackgroundColor is useless here — the fill goes through the
 * edge-to-edge plugin: the current family's aurora base top stop
 * (statusBarFillOf), with the icon style flipping with the mode.
 * Web/no-native no-ops.
 */
export function initMpStatusBar(): void {
  if (!Capacitor.isNativePlatform()) return
  const { theme } = useMpTheme()
  const { familyId } = useMpColorFamily()

  const apply = (): void => {
    const dark = theme.value === 'dark'
    void StatusBar.setOverlaysWebView({ overlay: true }).catch(() => {})
    void EdgeToEdge.setBackgroundColor({ color: statusBarFillOf(familyId.value, theme.value) }).catch(() => {})
    void StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light }).catch(() => {})
  }

  apply()
  subscribeEffectiveTheme(apply)
  watch(familyId, apply)
  // Cheap insurance against OEM strip repaints: re-assert through the boot
  // window and on every foreground return. (History: an earlier version
  // passed material.base[0] — the character 'l' of the gradient string —
  // which native Color.parseColor rejects; the catch swallowed the reject,
  // so every "OriginOS boot race" observation was that silent failure.)
  for (const delay of [500, 1500, 3000, 5000, 8000, 12000, 16000]) {
    setTimeout(apply, delay)
  }
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) apply()
  })
  window.addEventListener('focus', apply)
}
