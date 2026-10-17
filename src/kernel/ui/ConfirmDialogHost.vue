<script setup lang="ts">
// Confirm modal host (M4-a shared-UI upgrade) — renders the frontmost pending
// request from confirm-dialog.ts; sibling of FatalErrorHost in App.vue.
import { computed } from 'vue'
import { resolveConfirm, useConfirmDialog } from '@/kernel/ui/confirm-dialog'

const queue = useConfirmDialog()
const current = computed(() => queue.value[0] ?? null)
</script>

<template>
  <Transition name="mp-mo-center">
    <div
      v-if="current"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-6"
      role="dialog"
      aria-modal="true"
      :aria-label="current.title"
    >
      <div class="mp-mo-center-card mp-glass w-full max-w-sm rounded-bubble-ai p-5">
        <h2 class="text-base font-bold text-ink">
          {{ current.title }}
        </h2>
        <p
          v-if="current.message"
          class="mt-2 break-words text-sm text-ink-2"
        >
          {{ current.message }}
        </p>
        <div class="mt-4 flex gap-2">
          <button
            type="button"
            class="min-h-[40px] flex-1 rounded-input border border-line bg-bg text-sm font-bold text-ink-2"
            @click="resolveConfirm(current.id, false)"
          >
            {{ current.cancelLabel }}
          </button>
          <button
            type="button"
            class="min-h-[40px] flex-1 rounded-input bg-primary text-sm font-bold text-on-primary"
            @click="resolveConfirm(current.id, true)"
          >
            {{ current.confirmLabel }}
          </button>
        </div>
      </div>
    </div>
  </Transition>
</template>
