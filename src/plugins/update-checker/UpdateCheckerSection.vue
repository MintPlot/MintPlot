<script setup lang="ts">
// 关于与更新分区 — ported from RP src/components/settings/UpdateChecker.vue
// (baseline 4fedffd): inline update card (per-day dismiss) + version footer.
// MP adaptation: release notes render as plain text (no v-html — MP does not
// carry DOMPurify, and plain text removes the injection vector entirely).
import { computed } from 'vue'
import { getActiveService } from './service-instance'

const service = computed(() => getActiveService())
</script>

<template>
  <div
    v-if="service"
    class="select-none"
  >
    <div
      v-if="service.updateAvailable.value && !service.updateNoticeDismissedToday.value"
      class="mb-3 overflow-hidden rounded-card border border-line bg-bg"
    >
      <div class="flex items-start justify-between gap-3 border-b border-line px-4 pb-2 pt-3">
        <div>
          <h4 class="flex items-center gap-1.5 text-sm font-bold text-ink">
            <svg
              class="h-4 w-4 text-ink-3"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            发现新版本
          </h4>
          <p class="mt-0.5 font-mono text-[11px] text-ink-3">
            <template v-if="service.appVersionName.value">
              v{{ service.appVersionName.value }} →
            </template>v{{ service.latestVersionName.value }}
          </p>
        </div>
        <button
          class="shrink-0 text-[11px] text-ink-3 transition-colors hover:text-ink-2"
          @click="service.dismissUpdateNoticeToday()"
        >
          今日不再提示
        </button>
      </div>
      <div class="max-h-48 overflow-y-auto whitespace-pre-line px-4 py-3 text-[13px] leading-relaxed text-ink-2">
        {{ service.updateInfo.value?.body || '（无发布说明）' }}
      </div>
      <div class="px-4 pb-3">
        <button
          class="w-full rounded-input bg-primary py-2.5 text-sm font-bold text-on-primary shadow-md transition-all disabled:opacity-60"
          :disabled="service.downloadingUpdate.value || service.checkingUpdate.value"
          @click="service.downloadAndInstallUpdate()"
        >
          <template v-if="!service.downloadingUpdate.value">
            立即更新
          </template>
          <template v-else>
            {{ Math.round(service.downloadProgress.value * 100) }}%
          </template>
        </button>
      </div>
    </div>

    <div class="flex items-center justify-center gap-1.5 py-3 text-xs text-ink-3">
      <span>MintPlot</span>
      <span
        v-if="service.appVersionName.value"
        class="font-mono"
      >v{{ service.appVersionName.value }}</span>
      <span
        v-if="service.appBuildType.value"
        class="font-mono"
      >({{ service.appBuildType.value }})</span>
      <span
        v-if="service.latestVersionName.value"
        class="text-primary"
      >→ v{{ service.latestVersionName.value }}</span>
      <button
        class="ml-1.5 transition-colors hover:text-primary"
        title="检查更新"
        :disabled="service.checkingUpdate.value"
        @click="service.checkForUpdates(true)"
      >
        <svg
          class="inline h-3.5 w-3.5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
          />
        </svg>
      </button>
    </div>
  </div>
  <p
    v-else
    class="px-4 py-6 text-center text-xs text-ink-3"
  >
    更新检查服务未激活
  </p>
</template>
