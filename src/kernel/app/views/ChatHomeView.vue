<script setup lang="ts">
// 对话 tab = 纯 AI 对话域(chatbox)落地视图(spec v1.2 §02 图 A)。
// M3:会话列表 + 新建对话;点行进全屏聊天页(chat-router);卡会话永不进本列表。
import { computed, inject, onMounted, ref, watch } from 'vue'
import MintCat from '@/kernel/design/assets/MintCat.vue'
import { CHATBOX_STORE_KEY } from '@/kernel/app/chat-keys'
import { openConversation, useChatRoute } from '@/kernel/app/chat-router'
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
    <header class="flex shrink-0 items-center justify-between border-b border-line bg-card px-4">
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
        >
          <button
            type="button"
            class="flex w-full items-start gap-3 border-b border-line px-4 py-3 text-left transition-colors active:bg-bg"
            @click="routeView === 'list' && openConversation(conversation.id)"
          >
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm text-ink">{{ conversation.title }}</span>
              <span class="mt-0.5 block truncate text-xs text-ink-3">{{ conversation.preview || '（空对话）' }}</span>
            </span>
            <time class="flex-shrink-0 pt-0.5 text-xs text-ink-3">{{ timeLabel(conversation.updatedAt) }}</time>
          </button>
        </li>
      </ul>
    </div>
  </section>
</template>
