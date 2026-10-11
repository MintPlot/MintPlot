<script setup lang="ts">
// M4-c floor action row (RP-Hub shape, plan D1/D2): persistent under every
// floor; the last assistant floor adds the swipe group and regenerate.
// Presentational — actions emit, the parent owns all behavior.
// Icons are inline stroke SVGs (Lucide-style paths, MIT) so the whole row
// shares one visual language and follows the theme via currentColor —
// text glyphs + color emoji (🔊/🗑) rendered platform-inconsistently before.
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
          <svg
            class="floor-ico"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
        <span class="font-mono text-[10px] text-ink-3">{{ (message.activeIndex ?? 0) + 1 }}/{{ message.candidates?.length }}</span>
        <button
          type="button"
          class="floor-act"
          :class="{ 'opacity-40': (message.activeIndex ?? 0) >= (message.candidates?.length ?? 1) - 1 }"
          :aria-label="`切换到下一候选(${(message.activeIndex ?? 0) + 1}/${message.candidates?.length})`"
          @click="$emit('switch', 1)"
        >
          <svg
            class="floor-ico"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path d="m9 18 6-6-6-6" />
          </svg>
        </button>
      </template>
      <button
        type="button"
        class="floor-act accent"
        aria-label="重新生成(追加候选)"
        @click="$emit('regenerate')"
      >
        <svg
          class="floor-ico"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
          <path d="M21 3v5h-5" />
          <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
          <path d="M8 16H3v5" />
        </svg>
      </button>
    </template>
    <button
      type="button"
      class="floor-act"
      :aria-label="`编辑第 ${floorIndex + 1} 楼`"
      @click="$emit('edit')"
    >
      <svg
        class="floor-ico"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
      </svg>
    </button>
    <button
      type="button"
      class="floor-act"
      :aria-label="`复制第 ${floorIndex + 1} 楼`"
      @click="$emit('copy')"
    >
      <svg
        class="floor-ico"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <rect
          width="14"
          height="14"
          x="8"
          y="8"
          rx="2"
          ry="2"
        />
        <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
      </svg>
    </button>
    <button
      v-if="message.role === 'assistant' && ttsActive"
      type="button"
      class="floor-act"
      :aria-label="`朗读第 ${floorIndex + 1} 楼`"
      @click="$emit('speak')"
    >
      <svg
        class="floor-ico"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path d="M11 5 6 9H2v6h4l5 4V5Z" />
        <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
        <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
      </svg>
    </button>
    <button
      type="button"
      class="floor-act danger"
      :aria-label="`删除第 ${floorIndex + 1} 楼及其后`"
      @click="$emit('remove')"
    >
      <svg
        class="floor-ico"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path d="M3 6h18" />
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
        <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        <path d="M10 11v6" />
        <path d="M14 11v6" />
      </svg>
    </button>
  </div>
</template>

<style scoped>
/* 26px hit targets, quiet until touched. Color modifiers win over the base
 * rule by class order — Tailwind utilities were too weak against the scoped
 * attribute selector, which is why accent/danger never actually applied. */
.floor-act {
  min-width: 26px;
  height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  color: rgb(var(--mp-c-ink-3));
}
.floor-ico {
  width: 15px;
  height: 15px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.floor-act.accent {
  color: rgb(var(--mp-c-primary));
}
.floor-act.danger {
  color: var(--mp-danger);
}
.floor-act:active {
  background: rgb(var(--mp-c-primary) / 0.12);
  color: rgb(var(--mp-c-primary));
}
.floor-act.danger:active {
  background: var(--mp-danger-wash);
  color: var(--mp-danger);
}
</style>
