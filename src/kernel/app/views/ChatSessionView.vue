<script setup lang="ts">
// 全屏聊天页(M3):顶栏(返回/标题) + 消息流 + 输入坞,chatbox 与 card 两域共用
// 同一骨架(M3-i),域由 props.domain 决定 —— chatbox 走会话仓自带 system prompt;
// card 走角色卡库,每次发送现组装提示词(card-prompt,RP 最小式:名字+性格(+对话
// 示例)+末尾 [User Info]),开场白种为首楼、顶栏「清空重开」为卡域专属。发送 =
// 内核 llm.provider seam 流式(可中止);楼层经各自 store 增量持久化
// (chat-persistence 器官);用量回调经注入(usage-stats 写侧,组合根接线)。
import { computed, inject, nextTick, onMounted, onUnmounted, ref } from 'vue'
import {
  CARD_SESSION_STORE_KEY,
  CHATBOX_STORE_KEY,
  CHARACTER_STORE_KEY,
  SEAM_REGISTRY_KEY,
  SESSION_PROJECTION_KEY,
  SETTINGS_STATE_KEY,
  USAGE_RECORDER_KEY,
} from '@/kernel/app/chat-keys'
import { closeConversation } from '@/kernel/app/chat-router'
import { buildCardSystemPrompt, greetingFloorMissing } from '@/kernel/characters/card-prompt'
import type { CharacterCard } from '@/kernel/characters/character-card'
import type { LlmChatMessage } from '@/kernel/llm/chat-completions'
import type { LlmProvider } from '@/kernel/llm/llm-provider'
import type { CardSession } from '@/kernel/sessions/card-session-store'
import type { ChatboxConversation, ChatboxMessage } from '@/kernel/sessions/chatbox-store'
import { uiService } from '@/kernel/ui/toasts'

const props = withDefaults(defineProps<{ conversationId: string; domain?: 'chatbox' | 'card' }>(), { domain: 'chatbox' })

const store = inject(CHATBOX_STORE_KEY, null)
const cardSessions = inject(CARD_SESSION_STORE_KEY, null)
const characterStore = inject(CHARACTER_STORE_KEY, null)
const settingsState = inject(SETTINGS_STATE_KEY, null)
const projection = inject(SESSION_PROJECTION_KEY, null)
const seams = inject(SEAM_REGISTRY_KEY, null)
const recordUsage = inject(USAGE_RECORDER_KEY, null)

const conversation = ref<ChatboxConversation | null>(null)
const cardSession = ref<CardSession | null>(null)
const card = ref<CharacterCard | null>(null)
const cardCover = ref('')
const draft = ref('')
const streaming = ref(false)
const loadError = ref('')
const messagesEl = ref<HTMLElement | null>(null)
let abortController: AbortController | null = null

const isCardDomain = computed(() => props.domain === 'card')
const messages = computed<ChatboxMessage[]>(() =>
  (isCardDomain.value ? cardSession.value?.messages : conversation.value?.messages) ?? [])
const title = computed(() =>
  (isCardDomain.value ? card.value?.name : conversation.value?.title) ?? (isCardDomain.value ? '角色' : '对话'))
const sessionLoaded = computed(() => (isCardDomain.value ? cardSession.value !== null : conversation.value !== null))

const scrollToBottom = async (): Promise<void> => {
  await nextTick()
  // Optional call: environments without element scrolling (jsdom) stay safe.
  messagesEl.value?.scrollTo?.({ top: messagesEl.value.scrollHeight })
}

onMounted(async () => {
  if (isCardDomain.value) {
    if (!cardSessions || !characterStore) {
      loadError.value = '会话存储未接入'
      return
    }
    card.value = await characterStore.get(props.conversationId)
    if (!card.value) {
      loadError.value = '角色卡不存在'
      return
    }
    cardCover.value = (await characterStore.getCover(props.conversationId)) ?? ''
    // 进卡即接续:D3 每卡一会话,无历史则当场种下开场白首楼。
    cardSession.value = (await cardSessions.get(props.conversationId)) ?? (await cardSessions.create(card.value))
    // 卡域投影真实化(TTS 零改动生效):挂载即报卡名与实时楼层。
    projection?.setActiveCardSession({ cardId: card.value.id, cardName: card.value.name, messages: cardSession.value.messages })
  } else {
    if (!store) {
      loadError.value = '会话存储未接入'
      return
    }
    conversation.value = await store.get(props.conversationId)
    if (!conversation.value) loadError.value = '会话不存在'
  }
  await scrollToBottom()
})

onUnmounted(() => {
  projection?.setActiveCardSession(null)
})

const readUserInfo = (): { name: string; persona: string } => {
  const scope = settingsState?.scope(['userName', 'userPersona'])
  return { name: String(scope?.userName ?? ''), persona: String(scope?.userPersona ?? '') }
}

const buildRequestMessages = (): LlmChatMessage[] => {
  const floors = messages.value
  const result: LlmChatMessage[] = []
  const systemPrompt = isCardDomain.value && card.value
    ? buildCardSystemPrompt(card.value, readUserInfo())
    : conversation.value?.systemPrompt.trim() ?? ''
  if (systemPrompt.trim()) {
    result.push({ role: 'system', content: systemPrompt })
  }
  // RP 开场白保险:历史首楼不再是开场白时,请求里补注入(历史本身不改写)。
  if (isCardDomain.value && card.value && greetingFloorMissing(floors, card.value.firstMes)) {
    result.push({ role: 'assistant', content: card.value.firstMes })
  }
  for (const message of floors) {
    if (message.role === 'system') continue
    result.push({ role: message.role, content: message.content })
  }
  return result
}

const persistSession = async (): Promise<void> => {
  if (isCardDomain.value && cardSession.value) await cardSessions?.save(cardSession.value)
  else if (conversation.value) await store?.save(conversation.value)
}

const stopStreaming = (): void => {
  abortController?.abort()
  abortController = null
}

const send = async (): Promise<void> => {
  const provider = seams?.resolve<LlmProvider>('llm.provider')?.implementation
  if (!sessionLoaded.value || !provider) return
  const text = draft.value.trim()
  if (!text || streaming.value) return

  const now = Date.now()
  messages.value.push({ id: `m-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`, role: 'user', content: text, ts: now })
  // Title defaults to the first utterance (spec §03) — chatbox domain only;
  // the card domain keeps the card name.
  if (!isCardDomain.value && conversation.value && conversation.value.title === '新的对话') {
    conversation.value.title = text.slice(0, 24)
  }
  await persistSession()
  draft.value = ''
  await scrollToBottom()

  const assistantFloor: ChatboxMessage = {
    id: `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    role: 'assistant',
    content: '',
    ts: Date.now(),
  }
  messages.value.push(assistantFloor)
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
      // Attribution: the record must say which session it came from — the
      // card domain types itself 'card' (labeled 角色卡 in the ledger) and
      // names the card; the chatbox domain names the conversation.
      recordUsage?.(result.usage, {
        type: isCardDomain.value ? 'card' : 'chat',
        model: result.model ?? '',
        ...(isCardDomain.value
          ? { characterName: card.value?.name ?? '' }
          : { detail: conversation.value?.title ?? '' }),
      })
    }
  } catch (error) {
    if (!abortController.signal.aborted) {
      assistantFloor.content = `「请求失败」${(error as Error)?.message || '未知错误'}`
    }
  } finally {
    streaming.value = false
    abortController = null
    if (assistantFloor.content === '') {
      // Aborted before any token: drop the empty floor.
      const index = messages.value.findIndex((message) => message.id === assistantFloor.id)
      if (index >= 0) messages.value.splice(index, 1)
    }
    await persistSession()
    await scrollToBottom()
  }
}

const restartSession = async (): Promise<void> => {
  if (!isCardDomain.value || !card.value || !cardSessions) return
  const confirmed = await uiService.confirm('shell', {
    title: '清空重开',
    message: `清空与「${card.value.name}」的全部楼层,重新开始这段对话?`,
    confirmLabel: '清空重开',
  })
  if (!confirmed) return
  stopStreaming()
  cardSession.value = await cardSessions.reset(card.value)
  await scrollToBottom()
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
      <button
        v-if="isCardDomain"
        type="button"
        class="flex-shrink-0 rounded-input px-2 py-1 text-xs text-ink-3 active:text-danger"
        @click="restartSession"
      >
        清空重开
      </button>
    </header>

    <div
      v-if="loadError"
      class="flex flex-1 items-center justify-center text-sm text-ink-3"
    >
      {{ loadError }}
    </div>

    <template v-else-if="conversation || cardSession">
      <div
        ref="messagesEl"
        class="min-h-0 flex-1 overflow-y-auto px-4 py-4"
      >
        <div class="mx-auto flex max-w-xl flex-col gap-3">
          <p
            v-if="messages.length === 0"
            class="py-12 text-center text-xs text-ink-3"
          >
            发送第一条消息开始对话
          </p>
          <div
            v-for="message in messages"
            :key="message.id"
            class="flex"
            :class="message.role === 'user' ? 'justify-end' : 'justify-start'"
          >
            <div
              class="max-w-[85%] whitespace-pre-wrap break-words rounded-bubble-ai px-3.5 py-2.5 text-sm leading-relaxed"
              :class="message.role === 'user'
                ? 'rounded-bubble-user bg-primary text-on-primary'
                : 'border border-line bg-card text-ink'"
            >
              {{ message.content }}<span
                v-if="streaming && message === messages[messages.length - 1] && message.role === 'assistant'"
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
