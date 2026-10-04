<script setup lang="ts">
// chatbox 聊天页(M3,全屏沉浸,spec 图 B):顶栏(返回/标题) + 消息流 + 输入坞。
// 发送 = 内核 llm.provider seam 流式(可中止);楼层经 chatbox store 增量持久化
// (chat-persistence 器官);用量回调经注入(usage-stats 写侧,组合根接线)。
import { computed, inject, nextTick, onMounted, ref } from 'vue'
import { CHATBOX_STORE_KEY, SEAM_REGISTRY_KEY, USAGE_RECORDER_KEY } from '@/kernel/app/chat-keys'
import { closeConversation } from '@/kernel/app/chat-router'
import type { LlmChatMessage } from '@/kernel/llm/chat-completions'
import type { LlmProvider } from '@/kernel/llm/llm-provider'
import type { ChatboxConversation, ChatboxMessage } from '@/kernel/sessions/chatbox-store'

const props = defineProps<{ conversationId: string }>()

const store = inject(CHATBOX_STORE_KEY, null)
const seams = inject(SEAM_REGISTRY_KEY, null)
const recordUsage = inject(USAGE_RECORDER_KEY, null)

const conversation = ref<ChatboxConversation | null>(null)
const draft = ref('')
const streaming = ref(false)
const loadError = ref('')
const messagesEl = ref<HTMLElement | null>(null)
let abortController: AbortController | null = null

const title = computed(() => conversation.value?.title ?? '对话')

const scrollToBottom = async (): Promise<void> => {
  await nextTick()
  messagesEl.value?.scrollTo({ top: messagesEl.value.scrollHeight })
}

onMounted(async () => {
  if (!store) {
    loadError.value = '会话存储未接入'
    return
  }
  conversation.value = await store.get(props.conversationId)
  if (!conversation.value) loadError.value = '会话不存在'
  await scrollToBottom()
})

const buildRequestMessages = (): LlmChatMessage[] => {
  const conversationValue = conversation.value!
  const messages: LlmChatMessage[] = []
  if (conversationValue.systemPrompt.trim()) {
    messages.push({ role: 'system', content: conversationValue.systemPrompt.trim() })
  }
  for (const message of conversationValue.messages) {
    if (message.role === 'system') continue
    messages.push({ role: message.role, content: message.content })
  }
  return messages
}

const stopStreaming = (): void => {
  abortController?.abort()
  abortController = null
}

const send = async (): Promise<void> => {
  const conversationValue = conversation.value
  const resolved = seams?.resolve<LlmProvider>('llm.provider')
  const provider = resolved?.implementation
  if (!conversationValue || !store || !provider) return
  const text = draft.value.trim()
  if (!text || streaming.value) return

  const now = Date.now()
  conversationValue.messages.push({ id: `m-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`, role: 'user', content: text, ts: now })
  // Title defaults to the first utterance (spec §03: 标题默认取首句).
  if (conversationValue.title === '新的对话') {
    conversationValue.title = text.slice(0, 24)
  }
  await store.save(conversationValue)
  draft.value = ''
  await scrollToBottom()

  const assistantFloor: ChatboxMessage = {
    id: `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    role: 'assistant',
    content: '',
    ts: Date.now(),
  }
  conversationValue.messages.push(assistantFloor)
  streaming.value = true
  abortController = new AbortController()
  try {
    const result = await provider.stream(buildRequestMessages(), {
      signal: abortController.signal,
      onDelta: (delta) => {
        assistantFloor.content += delta
        void scrollToBottom()
      },
    })
    assistantFloor.content = result.content
    if (result.usage) {
      recordUsage?.(result.usage, { type: 'chat', model: 'default' })
    }
  } catch (error) {
    assistantFloor.content = assistantFloor.content || ''
    if (!abortController.signal.aborted) {
      assistantFloor.content = `「请求失败」${(error as Error)?.message || '未知错误'}`
    }
  } finally {
    streaming.value = false
    abortController = null
    if (assistantFloor.content === '' && !conversationValue.messages.some((m) => m.id === assistantFloor.id && m.content)) {
      // Aborted before any token: drop the empty floor.
      const index = conversationValue.messages.findIndex((message) => message.id === assistantFloor.id)
      if (index >= 0) conversationValue.messages.splice(index, 1)
    }
    await store.save(conversationValue)
    await scrollToBottom()
  }
}
</script>

<template>
  <div class="fixed inset-0 z-40 flex flex-col bg-bg">
    <header class="flex shrink-0 items-center gap-2 border-b border-line bg-card px-2">
      <button
        type="button"
        class="flex h-11 w-11 items-center justify-center rounded-input text-ink-2"
        aria-label="返回对话列表"
        @click="stopStreaming(); closeConversation()"
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
      <h1 class="min-w-0 flex-1 truncate py-3 text-base">
        {{ title }}
      </h1>
    </header>

    <div
      v-if="loadError"
      class="flex flex-1 items-center justify-center text-sm text-ink-3"
    >
      {{ loadError }}
    </div>

    <template v-else-if="conversation">
      <div
        ref="messagesEl"
        class="min-h-0 flex-1 overflow-y-auto px-4 py-4"
      >
        <div class="mx-auto flex max-w-xl flex-col gap-3">
          <p
            v-if="conversation.messages.length === 0"
            class="py-12 text-center text-xs text-chat-accent"
          >
            发送第一条消息开始对话
          </p>
          <div
            v-for="message in conversation.messages"
            :key="message.id"
            class="flex"
            :class="message.role === 'user' ? 'justify-end' : 'justify-start'"
          >
            <div
              class="max-w-[85%] whitespace-pre-wrap break-words rounded-bubble-ai px-3.5 py-2.5 text-sm leading-relaxed"
              :class="message.role === 'user'
                ? 'rounded-bubble-user bg-chat-bubble-user text-chat-on-bubble-user'
                : 'border border-line bg-chat-bubble-ai text-chat-on-bubble-ai'"
            >
              {{ message.content }}<span
                v-if="streaming && message === conversation.messages[conversation.messages.length - 1] && message.role === 'assistant'"
                class="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-ink-3 align-middle"
              />
            </div>
          </div>
        </div>
      </div>

      <footer class="shrink-0 border-t border-line bg-card px-3 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-2">
        <div class="mx-auto flex max-w-xl items-end gap-2">
          <textarea
            v-model="draft"
            rows="1"
            placeholder="输入…"
            class="max-h-32 min-h-[44px] flex-1 resize-none rounded-input border border-line bg-bg px-3 py-2.5 text-sm text-ink outline-none focus:border-primary"
            @keydown.enter.exact.prevent="send"
          />
          <button
            v-if="streaming"
            type="button"
            class="min-h-[44px] rounded-input bg-danger px-4 text-sm font-bold text-on-primary"
            @click="stopStreaming"
          >
            中止
          </button>
          <button
            v-else
            type="button"
            class="min-h-[44px] rounded-input bg-primary px-4 text-sm font-bold text-on-primary disabled:opacity-40"
            :disabled="!draft.trim()"
            @click="send"
          >
            发送
          </button>
        </div>
      </footer>
    </template>
  </div>
</template>
