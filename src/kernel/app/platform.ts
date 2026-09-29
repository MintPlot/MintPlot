/**
 * Platform capability (M2) — the kernel implementation behind ctx.platform.
 * Native/web kind comes from Capacitor; identity values come from app-identity
 * (the @capacitor/app App plugin joins with the M3 native batch for live
 * versionCode reads).
 */

import { Capacitor } from '@capacitor/core'
import type { AppPlatformInfo, PluginPlatform } from '@contracts'
import { MP_VERSION_NAME, mpBuildType } from '@/kernel/app/app-identity'

export function createPlatformCapability(): PluginPlatform {
  return {
    kind: Capacitor.isNativePlatform() ? 'native' : 'web',
    async getAppInfo(): Promise<AppPlatformInfo> {
      const raw = Capacitor.getPlatform()
      return {
        platform: raw === 'android' || raw === 'ios' ? raw : 'web',
        versionName: MP_VERSION_NAME,
        buildType: mpBuildType(),
      }
    },
  }
}
