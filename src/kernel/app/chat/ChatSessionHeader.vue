<script setup lang="ts">
import CardToolsMenu from './CardToolsMenu.vue'
import type { CardToolId, CardToolItem } from './CardToolsMenu.vue'

defineProps<{ isCardDomain: boolean; cardCover: string; title: string; cardTools: CardToolItem[] }>()
const emit = defineEmits<{ back: []; tool: [id: CardToolId]; settings: []; restart: [] }>()
</script>

<template>
  <header class="mp-glass mp-overlay-header-top absolute inset-x-3 z-10 flex items-center gap-2 rounded-panel px-1.5 py-1">
    <button
      type="button"
      class="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-input text-ink-2"
      aria-label="返回对话列表"
      @click="emit('back')"
    >
      <svg
        class="h-5 w-5"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M15 19l-7-7 7-7"
        />
      </svg>
    </button>
    <img
      v-if="isCardDomain && cardCover"
      :src="cardCover"
      alt=""
      class="h-8 w-8 flex-shrink-0 rounded-full object-cover"
    >
    <span
      v-else-if="isCardDomain"
      class="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-bg text-sm text-ink-2"
    >
      {{ title.slice(0, 1) }}
    </span>
    <h1 class="min-w-0 flex-1 truncate py-3 text-base">
      {{ title }}
    </h1>
    <CardToolsMenu
      v-if="isCardDomain"
      :items="cardTools"
      @select="emit('tool', $event)"
    />
    <button
      type="button"
      class="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-ink-2 active:text-primary"
      aria-label="会话设置"
      @click="emit('settings')"
    >
      <svg
        class="h-[18px] w-[18px]"
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
      >
        <circle
          cx="12"
          cy="5"
          r="1.6"
        />
        <circle
          cx="12"
          cy="12"
          r="1.6"
        />
        <circle
          cx="12"
          cy="19"
          r="1.6"
        />
      </svg>
    </button>
    <button
      v-if="isCardDomain"
      type="button"
      class="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-ink-2 active:text-danger"
      aria-label="清空重开"
      @click="emit('restart')"
    >
      <!-- rotate-ccw (restart): 清空重开 keeps the confirm dialog, only the
           bar affordance went from text to an icon (2026-10-12 user pick). -->
      <svg
        class="h-[18px] w-[18px]"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"
        />
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M3 3v5h5"
        />
      </svg>
    </button>
  </header>
</template>
