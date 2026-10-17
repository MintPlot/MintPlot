<script setup lang="ts">
// Fatal-error modal (M3-err1, D11) — the app-in-app dialog for data-endangering
// failures (never window.confirm); fired by the error hub, session-once per
// error code. "查看诊断" lands with the diagnostics page (M3-err2).
import { errorCodeLabel } from '@/kernel/diagnostics/error-codes'
import { dismissFatalError, useFatalError } from '@/kernel/ui/fatal-error'

const fatal = useFatalError()
</script>

<template>
  <Transition name="mp-mo-center">
    <div
      v-if="fatal"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-6"
      role="alertdialog"
      aria-modal="true"
      aria-label="严重错误"
    >
      <div class="mp-mo-center-card mp-glass w-full max-w-sm rounded-bubble-ai p-5">
        <div class="mb-2 flex items-center gap-2">
          <svg
            class="h-5 w-5 text-danger"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
            />
          </svg>
          <h2 class="text-base font-bold text-ink">
            严重错误
          </h2>
          <span
            v-if="fatal.code"
            class="ml-auto rounded bg-danger-wash px-1.5 py-0.5 font-mono text-[10px] text-danger"
          >{{ fatal.code }}</span>
        </div>
        <p class="break-words text-sm text-ink-2">
          {{ fatal.message }}
        </p>
        <p class="mt-1 text-xs text-ink-3">
          {{ errorCodeLabel(fatal.code) }}
        </p>
        <p class="mt-2 text-xs text-ink-3">
          应用数据安全性已受影响,建议重启应用。
        </p>
        <button
          type="button"
          class="mt-4 min-h-[40px] w-full rounded-input bg-primary text-sm font-bold text-on-primary"
          @click="dismissFatalError"
        >
          知道了
        </button>
      </div>
    </div>
  </Transition>
</template>
