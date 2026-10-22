<script setup lang="ts">
// A stable floor owns its projection and its sandboxed DOM.
import { computed, onMounted, watch } from 'vue'
import type { ChatboxMessage } from '@/kernel/sessions/chatbox-store'
import type { FloorView } from './floor-view'
import FloorThinkingCard from './FloorThinkingCard.vue'
import FloorActionsRow from './FloorActionsRow.vue'

const props = defineProps<{
  message: ChatboxMessage
  index: number
  project: (message: ChatboxMessage, index: number) => FloorView
  editingFloorId: string
  editDraft: string
  streaming: boolean
  ttsActive: boolean
}>()
const emit = defineEmits<{
  'update:editDraft': [string]
  'cancel-edit': []
  'save-edit': []
  'view-image': [string]
  'toggle-cot': [message: ChatboxMessage]
  'toggle-capsule': [messageId: string]
  'switch': [message: ChatboxMessage, direction: -1 | 1]
  'regenerate': [message: ChatboxMessage]
  'edit': [message: ChatboxMessage]
  'copy': [message: ChatboxMessage]
  'speak': [message: ChatboxMessage]
  'remove': [message: ChatboxMessage]
  'frame-row': [messageId: string]
}>()
const view = computed(() => props.project(props.message, props.index))
const reportFrame = (): void => {
  if (view.value.isHtmlFrame || view.value.panels.top.length || view.value.panels.bottom.length) emit('frame-row', props.message.id)
}
onMounted(reportFrame)
watch(() => view.value.isHtmlFrame || view.value.panels.top.length > 0 || view.value.panels.bottom.length > 0, reportFrame)
</script>

<template>
  <div
    class="flex flex-col"
    :class="view.message.role === 'user' ? 'items-end' : 'items-start'"
  >
    <!-- M4-c in-place editor (plan §2): saving rewrites the stored floor. -->
    <div
      v-if="editingFloorId === view.message.id"
      class="w-full max-w-[85%] rounded-bubble-ai border border-primary bg-card p-2"
    >
      <textarea
        :value="editDraft"
        rows="3"
        class="w-full resize-y rounded-input border border-line bg-bg px-2 py-1.5 text-sm leading-relaxed text-ink outline-none focus:border-primary"
        @input="emit('update:editDraft', ($event.target as HTMLTextAreaElement).value)"
      />
      <div class="mt-1 flex justify-end gap-2">
        <button
          type="button"
          class="rounded-input border border-line px-2 py-1 text-xs text-ink-2"
          @click="emit('cancel-edit')"
        >
          取消
        </button>
        <button
          type="button"
          class="rounded-input bg-primary px-2 py-1 text-xs font-bold text-on-primary"
          @click="emit('save-edit')"
        >
          保存
        </button>
      </div>
    </div>
    <div
      v-else
      class="break-words rounded-bubble-ai px-3.5 py-2.5 text-sm leading-relaxed"
      :class="[
        view.message.role === 'user'
          ? 'mp-accent-fill rounded-bubble-user text-chat-on-bubble-user'
          : 'mp-bubble text-chat-on-bubble-ai',
        view.wide ? 'w-full max-w-none' : 'max-w-[85%]',
      ]"
    >
      <!-- eslint-disable vue/no-v-html -- content is macro-replaced, DOMPurify-whitelisted or sandboxed-iframe (M3-n pipeline); panels are replay-interpolated card templates in the same sandbox -->
      <!-- M4-d attached-image thumbnails (user floors): tap to view. -->
      <div
        v-if="view.message.imageAttachments?.length"
        class="mb-1 grid gap-1"
        :class="view.message.imageAttachments.length === 1 ? 'w-40' : 'grid-cols-2'"
      >
        <img
          v-for="(image, imageIndex) in view.message.imageAttachments"
          :key="imageIndex"
          :src="image.dataUrl"
          :alt="`附件图片 ${imageIndex + 1}`"
          class="w-full cursor-zoom-in rounded-input border border-line object-cover"
          @click="emit('view-image', image.dataUrl)"
        >
      </div>
      <FloorThinkingCard
        v-if="view.thinking.length > 0"
        :sections="view.thinking"
        :open="view.thinkingOpen"
        :live="view.thinkingLive"
        @toggle="emit('toggle-cot', view.message)"
      />
      <div
        v-for="frame in view.panels.top"
        :key="`top-${frame.id}`"
        class="mp-panel-frame"
        v-html="frame.html"
      />
      <div
        class="markdown-body"
        v-html="view.html"
      />
      <button
        v-if="view.capsule.total > 0"
        type="button"
        class="mt-1 inline-flex items-center gap-1 rounded-full border border-line bg-bg/50 px-2 py-0.5 text-[10px] text-ink-2"
        @click="emit('toggle-capsule', view.message.id)"
      >
        ⚙ 变量 ×{{ view.capsule.total }}
      </button>
      <div
        class="mp-mo-collapse rounded-input"
        :class="view.capsuleOpen ? 'mp-mo-collapse-open mt-1 border border-line bg-bg/50' : ''"
      >
        <div class="mp-mo-collapse-inner">
          <div class="px-2 py-1 text-[10px] text-ink-2">
            <div
              v-for="update in view.capsule.flat"
              :key="update.name"
            >
              {{ update.name }} → {{ update.value }}
            </div>
            <div
              v-for="line in view.capsule.templateLines"
              :key="line"
            >
              面板·{{ line }}
            </div>
          </div>
        </div>
      </div>
      <div
        v-for="frame in view.panels.bottom"
        :key="`bottom-${frame.id}`"
        class="mp-panel-frame"
        v-html="frame.html"
      />
      <!-- eslint-enable vue/no-v-html -->
      <span
        v-if="view.isStreaming"
        class="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-ink-3 align-middle"
      />
    </div>
    <FloorActionsRow
      v-if="!streaming && editingFloorId !== view.message.id"
      :message="view.message"
      :floor-index="view.index"
      :is-last="view.isLastAssistant"
      :tts-active="ttsActive"
      @switch="(direction) => emit('switch', view.message, direction)"
      @regenerate="emit('regenerate', view.message)"
      @edit="emit('edit', view.message)"
      @copy="emit('copy', view.message)"
      @speak="emit('speak', view.message)"
      @remove="emit('remove', view.message)"
    />
  </div>
</template>

<style scoped>
@import './markdown-body.css';

/* M3-s panel frames: full-width slots above/below the floor text; the inner
 * iframe is created via v-html so it needs a deep rule (v-html content is
 * outside scoped-data attributes). */
.mp-panel-frame {
  width: 100%;
  margin-top: 0.5rem;
}
.mp-panel-frame:first-child {
  margin-top: 0;
}
.mp-panel-frame :deep(iframe.executable-html-frame) {
  width: 100%;
  display: block;
  border: 0;
}
</style>
