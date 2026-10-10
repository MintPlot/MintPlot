<script setup lang="ts">
// Composer dock (M4-d): pending attachment strip, 📎 picker (the file input
// lives here), single-shot instruction popover and the draft input row.
// Pure input surface — draft/instruction flow up as v-model, intents emit.
import { ref } from 'vue'
import type { PendingChatImage } from '@/kernel/llm/vision'

defineProps<{
  pendingImages: PendingChatImage[]
  draft: string
  streaming: boolean
  oneShotInstruction: string
  sendDisabled: boolean
}>()
const emit = defineEmits<{
  'update:draft': [string]
  'update:oneShotInstruction': [string]
  send: []
  stop: []
  files: [Event]
  'remove-image': [string]
}>()

// Composer-local UI state (the panel is only reachable from this dock).
const showOneShotPanel = ref(false)
const imageInputEl = ref<HTMLInputElement | null>(null)
</script>

<template>
  <footer class="shrink-0 border-t border-line bg-card px-3 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-2">
    <!-- M4-d pending attachment strip: thumbnails with per-image status. -->
    <div
      v-if="pendingImages.length > 0"
      class="mx-auto mb-2 flex max-w-xl gap-2 overflow-x-auto pb-1"
    >
      <div
        v-for="image in pendingImages"
        :key="image.id"
        class="relative flex-shrink-0"
      >
        <img
          v-if="image.dataUrl"
          :src="image.dataUrl"
          alt="待发送图片"
          class="h-16 w-16 rounded-input border border-line object-cover"
        >
        <div
          v-else
          class="flex h-16 w-16 items-center justify-center rounded-input border border-line bg-bg text-[10px] text-ink-3"
        >
          读取中
        </div>
        <span
          v-if="image.status === 'analyzing'"
          class="absolute inset-x-0 bottom-0 rounded-b-input bg-black/50 px-1 text-center text-[9px] text-white"
        >
          识别中…
        </span>
        <span
          v-else-if="image.status === 'error'"
          class="absolute inset-x-0 bottom-0 rounded-b-input bg-danger px-1 text-center text-[9px] text-on-primary"
          :title="image.error"
        >
          识别失败
        </span>
        <button
          type="button"
          class="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-bg text-[10px] text-ink-2 shadow"
          :aria-label="`移除待发送图片(${image.status === 'ready' ? image.description.slice(0, 12) : '未就绪'})`"
          @click="emit('remove-image', image.id)"
        >
          ✕
        </button>
      </div>
    </div>
    <div class="mx-auto flex max-w-xl items-end gap-2">
      <!-- M4-d attach + single-shot instruction (D2/D3, RP composer left
           controls): direct buttons; the inputActions panel stays reserved. -->
      <div class="relative flex flex-col items-center gap-1">
        <button
          type="button"
          class="flex h-9 w-9 items-center justify-center rounded-full border border-line bg-bg text-base text-ink-2 active:text-primary disabled:opacity-40"
          aria-label="添加图片"
          :disabled="streaming"
          @click="imageInputEl?.click()"
        >
          📎
        </button>
        <input
          ref="imageInputEl"
          type="file"
          accept="image/*"
          multiple
          class="hidden"
          @change="emit('files', $event)"
        >
      </div>
      <div class="relative flex flex-col items-center gap-1">
        <button
          type="button"
          class="flex h-9 w-9 items-center justify-center rounded-full border text-base"
          :class="oneShotInstruction.trim() ? 'border-primary bg-primary-wash text-primary' : 'border-line bg-bg text-ink-2'"
          aria-label="单次指令"
          @click="showOneShotPanel = !showOneShotPanel"
        >
          ⌘
        </button>
        <div
          v-if="showOneShotPanel"
          class="absolute bottom-11 left-0 z-40 w-64 rounded-bubble-ai border border-line bg-card p-2 shadow-lg"
        >
          <p class="mb-1 text-xs font-bold text-ink">
            单次指令
            <span class="ml-1 font-normal text-ink-3">只影响下一次发送</span>
          </p>
          <textarea
            :value="oneShotInstruction"
            rows="3"
            placeholder="例:这段用更轻快的语气写…"
            class="w-full resize-none rounded-input border border-line bg-bg px-2 py-1.5 text-xs text-ink outline-none focus:border-primary"
            @input="emit('update:oneShotInstruction', ($event.target as HTMLTextAreaElement).value)"
          />
          <div class="mt-1 flex justify-end gap-2">
            <button
              type="button"
              class="rounded-input border border-line px-2 py-1 text-xs text-ink-2"
              @click="emit('update:oneShotInstruction', ''); showOneShotPanel = false"
            >
              清空
            </button>
            <button
              type="button"
              class="rounded-input bg-primary px-2 py-1 text-xs font-bold text-on-primary"
              @click="showOneShotPanel = false"
            >
              完成
            </button>
          </div>
        </div>
      </div>
      <textarea
        :value="draft"
        rows="1"
        placeholder="输入…"
        class="max-h-32 min-h-[44px] flex-1 resize-none rounded-input border border-line bg-bg px-3 py-2.5 text-sm text-ink outline-none focus:border-primary"
        @input="emit('update:draft', ($event.target as HTMLTextAreaElement).value)"
        @keydown.enter.exact.prevent="emit('send')"
      />
      <button
        v-if="streaming"
        type="button"
        class="min-h-[44px] rounded-input bg-danger px-4 text-sm font-bold text-on-primary"
        @click="emit('stop')"
      >
        中止
      </button>
      <button
        v-else
        type="button"
        class="min-h-[44px] rounded-input bg-primary px-4 text-sm font-bold text-on-primary disabled:opacity-40"
        :disabled="sendDisabled"
        @click="emit('send')"
      >
        发送
      </button>
    </div>
  </footer>
</template>
