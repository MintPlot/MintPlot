<script setup lang="ts">
// Composer dock (M4-d): pending attachment strip, attach picker (the file
// input lives here), single-shot instruction popover and the draft input row.
// Pure input surface — draft/instruction flow up as v-model, intents emit.
// QQ-desktop-style floating dock: icon toolbar on top, draft area below,
// icon send/stop at the bottom-right. All glyphs are stroke SVGs
// (Lucide-style paths, MIT) matching the floor action row — the emoji/text
// glyph mix rendered inconsistently before.
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

// IME composition guard: Chromium reports keydown Enter with isComposing
// (or legacy keyCode 229) while a Chinese/Japanese IME is still composing —
// that Enter confirms the candidate, it must NOT send the draft. This guard
// has been silently lost twice in refactors (492a264 → 711ce5f), so it stays
// a named handler with a regression test pinning it.
const onDraftKeydown = (event: KeyboardEvent): void => {
  if (event.isComposing || event.keyCode === 229) return
  event.preventDefault()
  emit('send')
}
</script>

<template>
  <footer class="px-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] pt-2">
    <div class="mx-auto max-w-xl">
      <!-- M4-d pending attachment strip: thumbnails with per-image status. -->
      <div
        v-if="pendingImages.length > 0"
        class="mp-glass mb-2 flex gap-2 overflow-x-auto rounded-3xl p-2"
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
            class="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-bg text-ink-2 shadow"
            :aria-label="`移除待发送图片(${image.status === 'ready' ? image.description.slice(0, 12) : '未就绪'})`"
            @click="emit('remove-image', image.id)"
          >
            <svg
              class="h-2.5 w-2.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
              aria-hidden="true"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>
      </div>
      <div class="mp-glass relative rounded-3xl">
        <!-- Toolbar row: attach + single-shot instruction (D2/D3, RP composer
             left controls); the inputActions panel stays reserved. -->
        <div class="flex items-center gap-0.5 px-1 pt-1">
          <div class="relative">
            <button
              type="button"
              class="flex h-8 w-8 items-center justify-center rounded-full text-ink-2 active:text-primary disabled:opacity-40"
              aria-label="添加图片"
              :disabled="streaming"
              @click="imageInputEl?.click()"
            >
              <svg
                class="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
              </svg>
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
          <!-- NOTE: intentionally NOT relative — the one-shot panel anchors to
               the composer root (nearest positioned ancestor) so it opens
               above the WHOLE dock, not just this button. -->
          <div>
            <button
              type="button"
              class="flex h-8 w-8 items-center justify-center rounded-full"
              :class="oneShotInstruction.trim() ? 'bg-primary-wash text-primary' : 'text-ink-2 active:text-primary'"
              aria-label="单次指令"
              @click="showOneShotPanel = !showOneShotPanel"
            >
              <svg
                class="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="M18 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3H6a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3 3 3 0 0 0 3 3h12a3 3 0 0 0 3-3 3 3 0 0 0-3-3" />
              </svg>
            </button>
            <div
              v-if="showOneShotPanel"
              class="mp-glass-strong absolute bottom-full left-0 z-40 mb-3 w-64 rounded-card p-2"
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
        </div>
        <textarea
          :value="draft"
          rows="1"
          placeholder="输入…"
          class="max-h-40 min-h-[44px] w-full resize-none bg-transparent px-3 py-2 pr-14 text-sm text-ink outline-none placeholder:text-ink-3"
          @input="emit('update:draft', ($event.target as HTMLTextAreaElement).value)"
          @keydown.enter.exact="onDraftKeydown"
        />
        <button
          v-if="streaming"
          type="button"
          class="absolute bottom-1.5 right-1.5 flex h-9 w-9 items-center justify-center rounded-full bg-danger text-on-primary"
          aria-label="中止"
          @click="emit('stop')"
        >
          <svg
            class="h-4 w-4"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <rect
              x="7"
              y="7"
              width="10"
              height="10"
              rx="1.5"
              fill="currentColor"
            />
          </svg>
        </button>
        <button
          v-else
          type="button"
          class="mp-accent-fill absolute bottom-1.5 right-1.5 flex h-9 w-9 items-center justify-center rounded-full text-on-primary disabled:opacity-40"
          :disabled="sendDisabled"
          aria-label="发送"
          @click="emit('send')"
        >
          <svg
            class="h-[18px] w-[18px]"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M12 19V5" />
            <path d="m5 12 7-7 7 7" />
          </svg>
        </button>
      </div>
    </div>
  </footer>
</template>

<style scoped>
/* base.css draws a global primary :focus-visible ring + glow; on the
 * borderless dock textarea it reads as a stray blue box — the caret is the
 * focus affordance here. Scoped specificity (0,3,0) beats the global rule. */
textarea:focus-visible {
  outline: none;
  box-shadow: none;
}
</style>
