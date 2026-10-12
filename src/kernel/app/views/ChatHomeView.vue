<script setup lang="ts">
// 对话 tab = 纯 AI 对话域(chatbox)落地视图(spec v1.2 §02 图 A)。
// M3:会话列表 + 新建对话;点行进全屏聊天页(chat-router);卡会话永不进本列表。
// 1.0.x:左滑删除 + 右划置顶 — 行内 pointer 手势,松手过阈值即触发(删除弹
// 确认框,置顶就地切换 + toast,均先弹回);手势期间禁用 transform 过渡。
// 删除/置顶钮纯视觉(不可点)。轻点开行的语义不变(拖动过的手势抑制其后的
// click,键盘 Enter 走 click 原路保留)。
import { computed, inject, onMounted, ref, watch } from 'vue'
import MintCat from '@/kernel/design/assets/MintCat.vue'
import { CHATBOX_STORE_KEY } from '@/kernel/app/chat-keys'
import { openConversation, useChatRoute } from '@/kernel/app/chat-router'
import { uiService } from '@/kernel/ui/toasts'
import type { ChatboxConversationSummary } from '@/kernel/sessions/chatbox-store'

const store = inject(CHATBOX_STORE_KEY, null)
const route = useChatRoute()

const conversations = ref<ChatboxConversationSummary[]>([])
// First paint already knows whether the store exists: a missing store renders
// the empty state immediately (spec §02 空态 = 品牌猫时刻).
const loading = ref(false)

const refresh = async (): Promise<void> => {
  if (!store) return
  conversations.value = await store.list()
  loading.value = false
}

onMounted(() => {
  if (!store) return
  loading.value = true
  void refresh()
})

// Returning from the chat page refreshes the list (title/preview/updatedAt).
watch(() => route.value.view, (view, previous) => {
  if (view === 'list' && previous === 'chat') void refresh()
})

// Returning from the chat page refreshes the list (title/preview/updatedAt).
const routeView = computed(() => route.value.view)

const createConversation = async (): Promise<void> => {
  if (!store) return
  const conversation = await store.create()
  openConversation(conversation.id)
}

// --- Swipe actions ---------------------------------------------------------
// Flick-and-confirm both ways: dragging left reveals the red delete zone,
// right reveals the pin zone; releasing past the threshold springs the row
// back and fires the action — delete raises the confirm dialog, pin toggles
// in place with a toast (reversible, no dialog). The offset is drag-only.
const REVEAL_WIDTH = 72
const SWIPE_FIRE_THRESHOLD = 36
const DRAG_START_THRESHOLD = 6

const swipeDrag = ref<{ id: string; startX: number; dx: number; moved: boolean } | null>(null)
// pointerup always precedes the click synthesised from the same gesture; the
// click handler must swallow exactly that one (keyboard Enter has no pointer
// up and must still open via click).
let swallowNextClick = false

const swipeOffsetOf = (id: string): number => {
  const drag = swipeDrag.value
  if (!drag || drag.id !== id) return 0
  return Math.max(-REVEAL_WIDTH, Math.min(REVEAL_WIDTH, drag.dx))
}

const onRowPointerDown = (id: string, event: PointerEvent): void => {
  swipeDrag.value = { id, startX: event.clientX, dx: 0, moved: false }
  // Track the gesture outside the row's bounds; jsdom has no capture API.
  ;(event.currentTarget as Element).setPointerCapture?.(event.pointerId)
}

const onRowPointerMove = (id: string, event: PointerEvent): void => {
  const drag = swipeDrag.value
  if (!drag || drag.id !== id) return
  drag.dx = event.clientX - drag.startX
  if (Math.abs(drag.dx) > DRAG_START_THRESHOLD) drag.moved = true
}

const onRowPointerUp = (id: string): void => {
  const drag = swipeDrag.value
  swipeDrag.value = null
  swallowNextClick = true
  if (!drag || drag.id !== id) return
  if (!drag.moved) {
    // Tap opens the conversation.
    if (routeView.value === 'list') openConversation(id)
    return
  }
  const finalOffset = Math.max(-REVEAL_WIDTH, Math.min(REVEAL_WIDTH, drag.dx))
  if (finalOffset > SWIPE_FIRE_THRESHOLD) void togglePin(id)
  else if (finalOffset < -SWIPE_FIRE_THRESHOLD) void deleteConversation(id)
}

const onRowClick = (id: string): void => {
  if (swallowNextClick) {
    swallowNextClick = false
    return
  }
  if (routeView.value === 'list') openConversation(id)
}

const togglePin = async (id: string): Promise<void> => {
  if (!store) return
  const conversation = conversations.value.find((entry) => entry.id === id)
  const pinned = !(conversation?.pinned ?? false)
  await store.setPinned(id, pinned)
  uiService.toast('shell', pinned ? '已置顶' : '已取消置顶', { tone: 'success' })
  await refresh()
}

const deleteConversation = async (id: string): Promise<void> => {
  if (!store) return
  const conversation = conversations.value.find((entry) => entry.id === id)
  const confirmed = await uiService.confirm('shell', {
    title: '删除对话',
    message: `将删除「${conversation?.title || '未命名对话'}」及其全部消息,删除后不可恢复。`,
    confirmLabel: '删除',
    cancelLabel: '取消',
  })
  if (!confirmed) return
  await store.remove(id)
  await refresh()
}

const timeLabel = (updatedAt: number): string => {
  const date = new Date(updatedAt)
  const today = new Date()
  if (date.toDateString() === today.toDateString()) {
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  }
  return `${date.getMonth() + 1}/${date.getDate()}`
}
</script>

<template>
  <section class="flex h-full flex-col">
    <header class="mp-glass mx-3 mt-3 flex shrink-0 items-center justify-between rounded-panel px-4 py-2.5">
      <h1 class="py-3 text-lg">
        对话
      </h1>
      <button
        type="button"
        class="flex h-11 w-11 items-center justify-center rounded-input text-xl text-primary"
        aria-label="新建对话"
        @click="createConversation"
      >
        +
      </button>
    </header>

    <div
      v-if="!loading && conversations.length === 0"
      class="flex flex-1 flex-col items-center justify-center gap-4 px-8 pb-16 text-center"
    >
      <MintCat class="h-24 w-24 text-ink" />
      <p class="text-sm text-ink-2">
        开始第一段对话
      </p>
    </div>

    <div
      v-else
      class="min-h-0 flex-1 overflow-y-auto"
    >
      <ul class="mx-auto max-w-xl">
        <li
          v-for="conversation in conversations"
          :key="conversation.id"
          class="relative overflow-hidden"
        >
          <!-- Reveal actions: purely visual during the drag — release past the
               threshold fires the action (confirm dialog for delete, instant
               toggle for pin), so these are never tappable. Rows are
               translucent over the aurora, so the reveal pair must exist only
               while its row is actually being swiped (rest state would bleed
               them through the row). -->
          <div
            v-show="swipeDrag?.id === conversation.id"
            class="absolute inset-y-0 left-0 flex w-[72px] flex-col items-center justify-center gap-1 bg-primary text-on-primary"
            aria-hidden="true"
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
              <path d="M12 17v5" />
              <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1z" />
            </svg>
            <span class="text-[11px]">{{ conversation.pinned ? '取消置顶' : '置顶' }}</span>
          </div>
          <div
            v-show="swipeDrag?.id === conversation.id"
            class="absolute inset-y-0 right-0 flex w-[72px] flex-col items-center justify-center gap-1 bg-danger text-on-primary"
            aria-hidden="true"
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
              <path d="M3 6h18" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
              <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              <path d="M10 11v6" />
              <path d="M14 11v6" />
            </svg>
            <span class="text-[11px]">删除</span>
          </div>
          <button
            type="button"
            class="relative flex w-full touch-pan-y select-none items-start gap-3 border-b border-line px-4 py-3 text-left transition-[transform,background-color]"
            :class="swipeDrag?.id === conversation.id ? 'duration-0' : 'duration-150'"
            :style="{ transform: `translateX(${swipeOffsetOf(conversation.id)}px)` }"
            @pointerdown="onRowPointerDown(conversation.id, $event)"
            @pointermove="onRowPointerMove(conversation.id, $event)"
            @pointerup="onRowPointerUp(conversation.id)"
            @pointercancel="swipeDrag = null"
            @click="onRowClick(conversation.id)"
          >
            <span class="min-w-0 flex-1">
              <span class="flex items-center gap-1">
                <svg
                  v-if="conversation.pinned"
                  class="h-3 w-3 flex-shrink-0 text-primary"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <path d="M12 17v5" />
                  <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1z" />
                </svg>
                <span class="truncate text-sm text-ink">{{ conversation.title }}</span>
              </span>
              <span class="mt-0.5 block truncate text-xs text-ink-3">{{ conversation.preview || '（空对话）' }}</span>
            </span>
            <time class="flex-shrink-0 pt-0.5 text-xs text-ink-3">{{ timeLabel(conversation.updatedAt) }}</time>
          </button>
        </li>
      </ul>
    </div>
  </section>
</template>
