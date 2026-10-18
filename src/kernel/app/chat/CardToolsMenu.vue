<script lang="ts">
export type CardToolId = 'variables' | 'worldbook' | 'regex' | 'memory' | 'presets'

export interface CardToolItem {
  id: CardToolId
  label: string
  description: string
}
</script>

<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'

const props = defineProps<{ items: readonly CardToolItem[] }>()
const emit = defineEmits<{ select: [id: CardToolId] }>()
const open = ref(false)
const trigger = ref<HTMLButtonElement | null>(null)
const menu = ref<HTMLElement | null>(null)

const icons: Record<CardToolId, string> = {
  variables: 'M4 7h16M7 4v16M4 17h16M17 4v16',
  worldbook: 'M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1Zm0 0v15',
  regex: 'M5 5v14M2 8l6 8M2 16l6-8M13 7h8M17 3v8M13 17h8',
  memory: 'M9 4a3 3 0 0 0-5 2 3 3 0 0 0-1 5 3 3 0 0 0 1 5 3 3 0 0 0 5 3V4Zm6 0a3 3 0 0 1 5 2 3 3 0 0 1 1 5 3 3 0 0 1-1 5 3 3 0 0 1-5 3V4M9 9H6m9 6h3',
  presets: 'M4 6h16M4 12h16M4 18h16M8 3v6M16 9v6M10 15v6',
}

const close = (restoreFocus = true): void => {
  open.value = false
  if (restoreFocus) trigger.value?.focus()
}

const toggle = async (): Promise<void> => {
  if (open.value) return close()
  open.value = true
  await nextTick()
  menu.value?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
}

const select = (id: CardToolId): void => {
  close(false)
  emit('select', id)
}

const onKeydown = (event: KeyboardEvent): void => {
  if (event.key === 'Escape' || event.key === 'Tab') {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
    }
    close()
    return
  }
  const buttons = [...(menu.value?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])]
  if (!buttons.length) return
  const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
  let target: number
  if (event.key === 'Home') target = 0
  else if (event.key === 'End') target = buttons.length - 1
  else if (event.key === 'ArrowDown' || event.key === 'ArrowRight') target = (current + 1) % buttons.length
  else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') target = (current - 1 + buttons.length) % buttons.length
  else return
  event.preventDefault()
  buttons[target]?.focus()
}

watch(() => props.items.length, (count) => {
  if (!count) close(false)
})
</script>

<template>
  <button
    v-if="items.length"
    ref="trigger"
    type="button"
    class="relative z-30 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-ink-2 active:text-primary"
    :class="open ? 'bg-primary-wash text-primary' : ''"
    aria-label="卡片工具"
    aria-haspopup="menu"
    :aria-expanded="open"
    aria-controls="card-tools-menu"
    @click="toggle"
    @keydown.esc.stop.prevent="close()"
  >
    <svg
      class="h-[18px] w-[18px]"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      aria-hidden="true"
    >
      <rect
        x="3"
        y="3"
        width="7"
        height="7"
        rx="1.5"
      />
      <rect
        x="14"
        y="3"
        width="7"
        height="7"
        rx="1.5"
      />
      <rect
        x="3"
        y="14"
        width="7"
        height="7"
        rx="1.5"
      />
      <rect
        x="14"
        y="14"
        width="7"
        height="7"
        rx="1.5"
      />
    </svg>
  </button>
  <template v-if="open && items.length">
    <div
      class="fixed inset-0 z-20"
      aria-hidden="true"
      data-card-tools-dismiss
      @click="close()"
    />
    <div
      id="card-tools-menu"
      ref="menu"
      role="menu"
      aria-labelledby="card-tools-title"
      class="mp-glass-strong absolute inset-x-0 top-full z-30 mt-2 max-h-[60vh] overflow-y-auto rounded-card p-2"
      @keydown="onKeydown"
    >
      <p
        id="card-tools-title"
        class="px-2 pb-2 pt-1 text-xs font-bold text-ink-2"
      >
        卡片工具
      </p>
      <div
        class="grid grid-cols-2 gap-1"
        role="none"
      >
        <button
          v-for="item in items"
          :key="item.id"
          type="button"
          role="menuitem"
          :aria-label="`打开${item.label}`"
          class="flex min-h-[64px] min-w-0 items-center gap-2 rounded-input px-2 py-2 text-left active:bg-primary-wash"
          @click="select(item.id)"
        >
          <span
            class="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-input bg-primary-wash text-primary"
            aria-hidden="true"
          >
            <svg
              class="h-[18px] w-[18px]"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.6"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path :d="icons[item.id]" />
            </svg>
          </span>
          <span class="min-w-0">
            <span class="block text-xs font-medium text-ink">{{ item.label }}</span>
            <span class="mt-0.5 block text-[10px] text-ink-3">{{ item.description }}</span>
          </span>
        </button>
      </div>
    </div>
  </template>
</template>
