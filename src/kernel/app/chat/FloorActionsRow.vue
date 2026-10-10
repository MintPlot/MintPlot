<script setup lang="ts">
// M4-c floor action row (RP-Hub shape, plan D1/D2): persistent under every
// floor; the last assistant floor adds the swipe group and regenerate.
// Presentational — actions emit, the parent owns all behavior.
import type { ChatboxMessage } from '@/kernel/sessions/chatbox-store'

defineProps<{
  message: ChatboxMessage
  floorIndex: number
  isLast: boolean
  ttsActive: boolean
}>()
defineEmits<{
  switch: [direction: -1 | 1]
  regenerate: []
  edit: []
  copy: []
  speak: []
  remove: []
}>()
</script>

<template>
  <div class="mt-0.5 flex items-center gap-0.5">
    <template v-if="isLast">
      <template v-if="(message.candidates?.length ?? 0) > 1">
        <button
          type="button"
          class="floor-act"
          :class="{ 'opacity-40': (message.activeIndex ?? 0) <= 0 }"
          :aria-label="`切换到上一候选(${(message.activeIndex ?? 0) + 1}/${message.candidates?.length})`"
          @click="$emit('switch', -1)"
        >
          ‹
        </button>
        <span class="font-mono text-[10px] text-ink-3">{{ (message.activeIndex ?? 0) + 1 }}/{{ message.candidates?.length }}</span>
        <button
          type="button"
          class="floor-act"
          :class="{ 'opacity-40': (message.activeIndex ?? 0) >= (message.candidates?.length ?? 1) - 1 }"
          :aria-label="`切换到下一候选(${(message.activeIndex ?? 0) + 1}/${message.candidates?.length})`"
          @click="$emit('switch', 1)"
        >
          ›
        </button>
      </template>
      <button
        type="button"
        class="floor-act text-primary"
        aria-label="重新生成(追加候选)"
        @click="$emit('regenerate')"
      >
        ⟳
      </button>
    </template>
    <button
      type="button"
      class="floor-act"
      :aria-label="`编辑第 ${floorIndex + 1} 楼`"
      @click="$emit('edit')"
    >
      ✎
    </button>
    <button
      type="button"
      class="floor-act"
      :aria-label="`复制第 ${floorIndex + 1} 楼`"
      @click="$emit('copy')"
    >
      ⧉
    </button>
    <button
      v-if="message.role === 'assistant' && ttsActive"
      type="button"
      class="floor-act"
      :aria-label="`朗读第 ${floorIndex + 1} 楼`"
      @click="$emit('speak')"
    >
      🔊
    </button>
    <button
      type="button"
      class="floor-act text-danger"
      :aria-label="`删除第 ${floorIndex + 1} 楼及其后`"
      @click="$emit('remove')"
    >
      🗑
    </button>
  </div>
</template>

<style scoped>
/* 24px+ hit targets, quiet until touched. */
.floor-act {
  min-width: 26px;
  height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  font-size: 12px;
  line-height: 1;
  color: var(--color-ink-3, #93a69d);
}
.floor-act:active {
  background: rgba(23, 168, 139, 0.12);
  color: var(--color-primary, #17a88b);
}
</style>
