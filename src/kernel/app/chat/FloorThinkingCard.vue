<script lang="ts">
// One thinking section (native reasoning or tag-based CoT) with its
// pre-rendered markdown html — the parent computes everything per floor.
export interface FloorThinkingItem {
  id: string
  title: string
  text: string
  chars: number
  live: boolean
  html: string
}
</script>

<script setup lang="ts">
// M4-f thinking card: native reasoning + tag-based CoT in one collapsible
// card above the prose (RP timeline shape, two sections max). Presentational.
import { ref, watch } from 'vue'

const props = defineProps<{ sections: FloorThinkingItem[]; open: boolean; live: boolean }>()
defineEmits<{ toggle: [] }>()

// Motion latch: the collapse animation needs the section html mounted
// through the close, so once a floor's card has been open it stays mounted
// (collapsed when closed); never-opened floors keep the lazy semantics.
const everOpened = ref(props.open)
watch(
  () => props.open,
  (open) => {
    if (open) everOpened.value = true
  },
)
</script>

<template>
  <div class="mb-1 overflow-hidden rounded-input border border-line bg-bg">
    <button
      type="button"
      class="flex w-full items-center justify-between px-2.5 py-1.5 text-left"
      :aria-expanded="open"
      @click="$emit('toggle')"
    >
      <span
        class="flex items-center gap-1.5 text-xs font-bold"
        :class="live ? 'text-chat-accent' : 'text-ink-2'"
      >
        <span v-if="live">⏳</span>
        <span v-else>💡</span>
        <span>{{ live ? '思考中…' : '思考' }}</span>
      </span>
      <span class="text-[10px] text-ink-3">{{ open ? '收起' : '展开' }}</span>
    </button>
    <div
      class="mp-mo-collapse"
      :class="open ? 'mp-mo-collapse-open' : ''"
    >
      <div
        class="mp-mo-collapse-inner"
        :class="open ? 'border-t border-line' : ''"
      >
        <div
          v-if="everOpened"
          class="px-2.5 py-2"
        >
          <div
            v-for="section in sections"
            :key="section.id"
            class="mb-2 last:mb-0"
          >
            <div class="mb-1 flex items-center justify-between text-[10px] font-bold text-ink-3">
              <span>{{ section.title }}</span>
              <span>{{ section.chars }} 字</span>
            </div>
            <!-- eslint-disable vue/no-v-html -- parent-rendered markdown (macro-replaced, DOMPurify-whitelisted) -->
            <div
              class="markdown-body text-[13px] leading-relaxed text-ink-2"
              v-html="section.html"
            />
            <!-- eslint-enable vue/no-v-html -->
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
@import './markdown-body.css';
</style>
