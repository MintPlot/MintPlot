import { watch } from 'vue'
import { Capacitor } from '@capacitor/core'
import { StatusBar, Style } from '@capacitor/status-bar'
import { subscribeEffectiveTheme, useMpTheme } from './theme'
import { useMpColorFamily } from './color-families'
import { MATERIAL_RECIPES } from './acrylic'

/**
 * Native status-bar sync (theme v3): on Android < 15 the system draws the
 * status bar with its own background — a static DayNight theme left it white
 * while the app flipped dark (white icons on white). The bar now follows the
 * app: fill = the current family's gradient top stop, icon style flips with
 * the mode. Web/no-native and Android 15 (edge-to-edge enforced) no-op.
 */
export function initMpStatusBar(): void {
  if (!Capacitor.isNativePlatform()) return
  const { theme } = useMpTheme()
  const { familyId } = useMpColorFamily()

  const apply = (): void => {
    const material = MATERIAL_RECIPES[familyId.value][theme.value]
    const dark = theme.value === 'dark'
    void StatusBar.setBackgroundColor({ color: material.base[0] }).catch(() => {})
    void StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light }).catch(() => {})
  }

  apply()
  subscribeEffectiveTheme(apply)
  watch(familyId, apply)
}
