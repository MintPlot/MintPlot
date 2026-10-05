/**
 * Update-checker service instance — the ctx-bound half of the port. RP kept
 * this wiring in app.mjs's setup (checkForUpdates / dismissUpdateNoticeToday /
 * downloadAndInstallUpdate + the 5s silent auto-check); MP moves it into the
 * plugin against the PluginContext surfaces: platform (version identity),
 * storage (per-day dismiss), ui (toasts). One instance per activation, held
 * module-scoped for the section component to pick up.
 */

import { ref } from 'vue'
import type { Ref } from 'vue'
import type { PluginContext } from '@contracts'
import { checkForUpdate, downloadApk, saveAndInstallApk } from './service'
import type { MpReleaseInfo } from './service'

const DISMISS_KEY = 'update_notice_dismiss_date'
const AUTO_CHECK_DELAY_MS = 5000

function todayKey(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

export interface UpdateCheckerService {
  readonly checkingUpdate: Ref<boolean>
  readonly downloadingUpdate: Ref<boolean>
  readonly downloadProgress: Ref<number>
  readonly updateAvailable: Ref<boolean>
  readonly updateInfo: Ref<MpReleaseInfo | null>
  readonly latestVersionName: Ref<string>
  readonly appVersionName: Ref<string>
  readonly appBuildType: Ref<string>
  readonly updateNoticeDismissedToday: Ref<boolean>
  /** Silent when showResult=false (startup auto-check), toasts otherwise. */
  checkForUpdates(showResult?: boolean): Promise<void>
  dismissUpdateNoticeToday(): void
  downloadAndInstallUpdate(maxRetries?: number): Promise<void>
  /** Cancels the auto-check timer; invoked through the activation bag. */
  dispose(): void
}

export function createUpdateCheckerService(ctx: PluginContext): UpdateCheckerService {
  const checkingUpdate = ref(false)
  const downloadingUpdate = ref(false)
  const downloadProgress = ref(0)
  const updateAvailable = ref(false)
  const updateInfo = ref<MpReleaseInfo | null>(null)
  const latestVersionName = ref('')
  const appVersionName = ref('')
  const appBuildType = ref('')
  const updateNoticeDismissedToday = ref(false)

  let autoCheckTimer: ReturnType<typeof setTimeout> | undefined

  const checkForUpdates = async (showResult = false): Promise<void> => {
    if (checkingUpdate.value) return
    checkingUpdate.value = true
    try {
      const currentVer = appVersionName.value || '0.0'
      const result = await checkForUpdate(currentVer)
      if (result.release) {
        latestVersionName.value = result.release.tag_name.replace(/^v/i, '')
      }
      if (result.hasUpdate && result.release) {
        updateAvailable.value = true
        updateInfo.value = result.release
      } else if (showResult) {
        ctx.ui.toast('当前已是最新版本')
      }
    } catch {
      if (showResult) ctx.ui.toast('检查更新失败')
    } finally {
      checkingUpdate.value = false
    }
  }

  // "今日不再提示": persist the current local date; the update card hides
  // until the stored date differs from today (ported behavior, key preserved).
  const dismissUpdateNoticeToday = (): void => {
    updateNoticeDismissedToday.value = true
    ctx.storage.set(DISMISS_KEY, todayKey()).catch((error) => {
      console.error('[update-checker] dismiss save failed:', error)
    })
  }

  const downloadAndInstallUpdate = async (maxRetries = 2): Promise<void> => {
    if (downloadingUpdate.value) return
    downloadingUpdate.value = true
    downloadProgress.value = 0
    let lastError = ''
    try {
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        if (attempt > 1) {
          ctx.ui.toast(`重试下载第 ${attempt} / ${maxRetries} 次...`, { durationMs: 2000 })
        }
        // Transient status toasts — sticky (durationMs: 0) toasts here were
        // never dismissed (the plugin toast API returns void, so the handle
        // was lost) and stacked forever across retries.
        ctx.ui.toast('正在下载更新...', { durationMs: 2000 })
        const dlResult = await downloadApk((fraction) => {
          downloadProgress.value = fraction
        })
        if (dlResult.error) {
          lastError = dlResult.error
          if (attempt < maxRetries) continue
          ctx.ui.toast(`下载失败: ${dlResult.error}`, { durationMs: 5000 })
          return
        }
        ctx.ui.toast('正在安装...', { durationMs: 2000 })
        const installResult = await saveAndInstallApk(dlResult.data!, dlResult.tag!)
        if (installResult.error) {
          ctx.ui.toast(`安装失败: ${installResult.error}`, { durationMs: 5000 })
          return
        }
        ctx.ui.toast('已开始安装更新')
        return
      }
      ctx.ui.toast(`下载失败（已重试 ${maxRetries} 次）: ${lastError}`, { durationMs: 5000 })
    } catch (e) {
      ctx.ui.toast(`更新失败: ${e instanceof Error ? e.message : String(e)}`, { durationMs: 5000 })
    } finally {
      downloadingUpdate.value = false
      downloadProgress.value = 0
    }
  }

  const dispose = (): void => {
    if (autoCheckTimer !== undefined) clearTimeout(autoCheckTimer)
  }

  // Version identity arrives via ctx.platform; the per-day dismiss flag is
  // restored before any card can show (ported startup semantics). The restore
  // only ever SETS the flag: identity resolution is async and must not clobber
  // a dismissal the user performed in the meantime (default stays false).
  void ctx.platform.getAppInfo().then(async (info) => {
    appVersionName.value = info.versionName
    appBuildType.value = info.buildType
    try {
      const savedDate = await ctx.storage.get<string>(DISMISS_KEY)
      if (savedDate === todayKey()) {
        updateNoticeDismissedToday.value = true
      }
    } catch {
      // unreadable dismiss flag just means the card may show again
    }
    // Startup auto-check: silent fetch so the inline card is ready without
    // interrupting the user (ported 5s behavior; runs on web too).
    autoCheckTimer = setTimeout(() => {
      void checkForUpdates(false)
    }, AUTO_CHECK_DELAY_MS)
  })

  return {
    checkingUpdate,
    downloadingUpdate,
    downloadProgress,
    updateAvailable,
    updateInfo,
    latestVersionName,
    appVersionName,
    appBuildType,
    updateNoticeDismissedToday,
    checkForUpdates,
    dismissUpdateNoticeToday,
    downloadAndInstallUpdate,
    dispose,
  }
}

let activeService: UpdateCheckerService | null = null

export function setActiveService(service: UpdateCheckerService | null): void {
  activeService = service
}

export function getActiveService(): UpdateCheckerService | null {
  return activeService
}
