import { watch } from 'vue'
import { Capacitor } from '@capacitor/core'
import { StatusBar, Style } from '@capacitor/status-bar'
import { EdgeToEdge } from '@capawesome/capacitor-android-edge-to-edge-support'
import { subscribeEffectiveTheme, useMpTheme } from './theme'
import { useMpColorFamily } from './color-families'
import { MATERIAL_RECIPES } from './acrylic'

/**
 * Native status-bar sync (theme v3): on Android < 15 the system draws the
 * status bar with its own background — a static DayNight theme left it white
 * while the app flipped dark (white icons on white). The bar now follows the
 * app: fill = the current family's gradient top stop, icon style flips with
 * the mode. Web/no-native and Android 15 (edge-to-edge enforced) no-op.
 *
 * The plain platform setBackgroundColor is IGNORED by OriginOS-class skins
 * (device-verified: the call resolves, the bar stays #FAFAFA), so the color
 * goes through the capawesome edge-to-edge plugin, which paints a view
 * behind the status bar directly.
 */
export function initMpStatusBar(): void {
  if (!Capacitor.isNativePlatform()) return
  const { theme } = useMpTheme()
  const { familyId } = useMpColorFamily()

  const apply = (): void => {
    const material = MATERIAL_RECIPES[familyId.value][theme.value]
    const dark = theme.value === 'dark'
    void StatusBar.setOverlaysWebView({ overlay: true }).catch(() => {})
    void EdgeToEdge.setBackgroundColor({ color: material.base[0] }).catch(() => {})
    void StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light }).catch(() => {})
  }

  apply()
  subscribeEffectiveTheme(apply)
  watch(familyId, apply)
  // Boot-race repair (OriginOS-verified): the bridge-resident color view is
  // not yet in place when the first apply fires during page load, and the
  // strip falls back to the white window background. Re-assert through the
  // boot window and on every foreground return.
  for (const delay of [300, 1000, 2500]) {
    setTimeout(apply, delay)
  }
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) apply()
  })
}
