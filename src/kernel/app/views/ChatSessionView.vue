<script setup lang="ts">
// 全屏聊天页(M3):顶栏(返回/标题) + 消息流 + 输入坞,chatbox 与 card 两域共用
// 同一骨架(M3-i),域由 props.domain 决定 —— chatbox 走会话仓自带 system prompt;
// card 走角色卡库,每次发送现组装提示词(card-prompt,RP 最小式:名字+性格(+对话
// 示例)+末尾 [User Info]),开场白种为首楼、顶栏「清空重开」为卡域专属。发送 =
// 内核 llm.provider seam 流式(可中止);楼层经各自 store 增量持久化
// (chat-persistence 器官);用量回调经注入(usage-stats 写侧,组合根接线)。
import { computed, inject, nextTick, onMounted, onUnmounted, ref } from 'vue'
import type { VariableState } from '@contracts'
import {
  CARD_SESSION_STORE_KEY,
  CHATBOX_STORE_KEY,
  CHARACTER_STORE_KEY,
  SEAM_REGISTRY_KEY,
  SESSION_PROJECTION_KEY,
  SETTINGS_STATE_KEY,
  USAGE_RECORDER_KEY,
  VARIABLE_STORE_KEY,
} from '@/kernel/app/chat-keys'
import { PLUGIN_RUNTIME_KEY } from '@/kernel/app/runtime-key'
import { closeConversation } from '@/kernel/app/chat-router'
import { buildCardSystemPrompt, greetingFloorMissing } from '@/kernel/characters/card-prompt'
import type { CharacterCard } from '@/kernel/characters/character-card'
import type { LlmChatMessage } from '@/kernel/llm/chat-completions'
import type { LlmProvider } from '@/kernel/llm/llm-provider'
// M3-n rich render: floors go through macro substitution + markdown/DOMPurify
// (full HTML documents run in sandboxed executable frames); the lifecycle
// module is a side-effect import (≤3 active frames red line).
import '@/kernel/render/html-frame-lifecycle'
import { replaceCardMacros } from '@/kernel/render/macros'
import { contentUsesHtmlFrame, renderMessageHtml } from '@/kernel/render/message-render'
import { startExecutableFrameHost } from '@/kernel/render/html-frame'
import type { CardSession } from '@/kernel/sessions/card-session-store'
import type { ChatboxConversation, ChatboxMessage } from '@/kernel/sessions/chatbox-store'
import { uiService } from '@/kernel/ui/toasts'
// M3-q variables: tag-block parsing/ledger on the card domain only — the
// request path expands {{getvar}} + appends the [Variables] section, the
// display path strips blocks into the floor capsule.
import {
  expandGetvarMacros,
  parseVariableUpdates,
  readCardVariableDefaults,
  renderVariablesSection,
  stripVariableBlocks,
} from '@/kernel/variables/variable-engine'
import type { ParsedVariableUpdate } from '@/kernel/variables/variable-engine'
import type { VariableSnapshot } from '@/kernel/variables/variable-store'
import VariablesSheet from '@/kernel/variables/VariablesSheet.vue'

const props = withDefaults(defineProps<{ conversationId: string; domain?: 'chatbox' | 'card' }>(), { domain: 'chatbox' })

const store = inject(CHATBOX_STORE_KEY, null)
const cardSessions = inject(CARD_SESSION_STORE_KEY, null)
const characterStore = inject(CHARACTER_STORE_KEY, null)
const settingsState = inject(SETTINGS_STATE_KEY, null)
const projection = inject(SESSION_PROJECTION_KEY, null)
const seams = inject(SEAM_REGISTRY_KEY, null)
const recordUsage = inject(USAGE_RECORDER_KEY, null)
const variableStore = inject(VARIABLE_STORE_KEY, null)
// Variables plugin toggle (M3-q2): the tools-area entry gates the feature.
// No runtime injected (pure kernel tests) keeps variables active.
const runtime = inject(PLUGIN_RUNTIME_KEY, null)

const conversation = ref<ChatboxConversation | null>(null)
const cardSession = ref<CardSession | null>(null)
const card = ref<CharacterCard | null>(null)
const cardCover = ref('')
const draft = ref('')
const streaming = ref(false)
const loadError = ref('')
const messagesEl = ref<HTMLElement | null>(null)
const variableState = ref<Record<string, VariableState>>({})
const variablesActive = ref(true)
const showVariables = ref(false)
const capsuleOpenId = ref<string | null>(null)
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
  // Card-reported frame heights arrive via postMessage (idempotent install).
  startExecutableFrameHost()
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
    // M3-q:变量建档(首触播种 extensions.mp_variables 卡默认值)——插件停用时
    // 整体休眠:不播种、不解析、不展开、不注入、面板入口隐藏;账本数据不动。
    const pluginState = runtime === null ? 'active' : runtime.stateOf('variables')
    variablesActive.value = pluginState === 'active' || pluginState === 'degraded'
    if (variablesActive.value) {
      const variableSnapshot = await variableStore?.ensure(card.value.id, readCardVariableDefaults(card.value.extensions))
      if (variableSnapshot) variableState.value = variableSnapshot.state
    }
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

// M3-n display-side macro context: the card domain resolves both macros, the
// chatbox domain has no char ({{char}} stays literal — RP replaces {{user}}
// only as well).
const macroContext = computed(() => ({
  charName: isCardDomain.value ? card.value?.name ?? '' : '',
  userName: readUserInfo().name,
}))

const isStreamingFloor = (message: ChatboxMessage): boolean =>
  streaming.value && message.role === 'assistant' && message === messages.value[messages.value.length - 1]

/** v-html render for one floor; streaming floors bypass the LRU (content
 *  changes every flush). The card domain strips variable tag blocks first —
 *  a display projection only, the stored floor keeps them verbatim (review
 *  Q1 落库纪律). */
const renderFloor = (message: ChatboxMessage): string =>
  renderMessageHtml(
    isCardDomain.value && variablesActive.value ? stripVariableBlocks(message.content) : message.content,
    macroContext.value,
    !isStreamingFloor(message),
  )

const floorUsesHtmlFrame = (message: ChatboxMessage): boolean => contentUsesHtmlFrame(message.content)

// M3-q request-side expansion chain (card domain): {{getvar}} → char/user
// macros. The chatbox domain keeps the M3-n macro pass only — variables
// never enter it (review Q4), so {{getvar}} stays literal there. The plugin
// toggle (M3-q2) puts the whole variable layer to sleep.
const expandRequestText = (text: string): string => {
  const withVariables = isCardDomain.value && variablesActive.value
    ? expandGetvarMacros(text, (name) => variableState.value[name]?.value)
    : text
  return replaceCardMacros(withVariables, macroContext.value)
}

const buildRequestMessages = (): LlmChatMessage[] => {
  const floors = messages.value
  const result: LlmChatMessage[] = []
  let systemPrompt = isCardDomain.value && card.value
    ? buildCardSystemPrompt(card.value, readUserInfo())
    : conversation.value?.systemPrompt.trim() ?? ''
  // M3-q: the variables artifact section rides the system-prompt tail (review
  // Q5 compact line form); an empty state injects nothing.
  if (isCardDomain.value && variablesActive.value) {
    const variablesSection = renderVariablesSection(variableState.value)
    if (variablesSection) systemPrompt = systemPrompt ? `${systemPrompt}\n\n${variablesSection}` : variablesSection
  }
  if (systemPrompt.trim()) {
    result.push({ role: 'system', content: expandRequestText(systemPrompt) })
  }
  // RP 开场白保险:历史首楼不再是开场白时,请求里补注入(历史本身不改写)。
  if (isCardDomain.value && card.value && greetingFloorMissing(floors, card.value.firstMes)) {
    result.push({ role: 'assistant', content: expandRequestText(card.value.firstMes) })
  }
  for (const message of floors) {
    if (message.role === 'system') continue
    // Macros resolve on the request path too (RP default script runs both
    // sides); the stored history itself stays untouched.
    result.push({ role: message.role, content: expandRequestText(message.content) })
  }
  return result
}

// Floor capsule (review Q6): AI floors that shipped variable tag blocks show
// 「⚙ 变量 ×N」; tapping toggles the per-name detail. Derived from the stored
// content at render time — no extra state to keep consistent.
const floorVariableUpdates = (message: ChatboxMessage): ParsedVariableUpdate[] =>
  isCardDomain.value && variablesActive.value && message.role === 'assistant' ? parseVariableUpdates(message.content).updates : []

const toggleCapsule = (messageId: string): void => {
  capsuleOpenId.value = capsuleOpenId.value === messageId ? null : messageId
}

const capsuleDelta = (update: ParsedVariableUpdate): string => (update.raw === null ? '已删除' : String(update.raw))

const onVariablesChanged = (snapshot: VariableSnapshot): void => {
  variableState.value = snapshot.state
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
    if (isCardDomain.value && card.value && variablesActive.value && assistantFloor.content) {
      // M3-q: the reply's variable tag blocks become ledger events
      // (source=ai, floor-attributed); malformed blocks were ignored by the
      // parser. A storage failure must never fail the finished floor.
      try {
        const { updates } = parseVariableUpdates(assistantFloor.content)
        if (updates.length > 0) {
          const snapshot = await variableStore?.apply(card.value.id, updates, { source: 'ai', messageId: assistantFloor.id })
          if (snapshot) variableState.value = snapshot.state
        }
      } catch (error) {
        console.error('[variables] failed to record AI-side updates:', error)
      }
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
  // M3-q: 清空重开 resets the variables ledger to a fresh card-default seed.
  if (variablesActive.value) {
    const variableSnapshot = await variableStore?.reset(card.value.id, readCardVariableDefaults(card.value.extensions))
    if (variableSnapshot) variableState.value = variableSnapshot.state
  }
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
        v-if="isCardDomain && variablesActive"
        type="button"
        class="flex-shrink-0 rounded-input px-2 py-1 text-xs text-ink-2"
        @click="showVariables = true"
      >
        变量
      </button>
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
              class="break-words rounded-bubble-ai px-3.5 py-2.5 text-sm leading-relaxed"
              :class="[
                message.role === 'user'
                  ? 'rounded-bubble-user bg-primary text-on-primary'
                  : 'border border-line bg-card text-ink',
                floorUsesHtmlFrame(message) ? 'w-full max-w-none' : 'max-w-[85%]',
              ]"
            >
              <!-- eslint-disable vue/no-v-html -- content is macro-replaced, DOMPurify-whitelisted or sandboxed-iframe (M3-n pipeline) -->
              <div
                class="markdown-body"
                v-html="renderFloor(message)"
              />
              <!-- eslint-enable vue/no-v-html -->
              <button
                v-if="floorVariableUpdates(message).length > 0"
                type="button"
                class="mt-1 inline-flex items-center gap-1 rounded-full border border-line bg-bg px-2 py-0.5 text-[10px] text-ink-2"
                @click="toggleCapsule(message.id)"
              >
                ⚙ 变量 ×{{ floorVariableUpdates(message).length }}
              </button>
              <div
                v-if="capsuleOpenId === message.id"
                class="mt-1 rounded-input border border-line bg-bg px-2 py-1 text-[10px] text-ink-2"
              >
                <div
                  v-for="update in floorVariableUpdates(message)"
                  :key="update.name"
                >
                  {{ update.name }} → {{ capsuleDelta(update) }}
                </div>
              </div>
              <span
                v-if="isStreamingFloor(message)"
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

    <VariablesSheet
      v-if="isCardDomain && showVariables && card"
      :card-id="card.id"
      @changed="onVariablesChanged"
      @close="showVariables = false"
    />
  </div>
</template>

<style scoped>
/* Minimal markdown presentation inside bubbles — Tailwind preflight strips
 * the browser defaults marked output relies on (RP ships a markdown-body
 * theme; this is the MP minimal equivalent). */
.markdown-body :where(p) {
  margin: 0.35em 0;
}
.markdown-body :where(> :first-child) {
  margin-top: 0;
}
.markdown-body :where(> :last-child) {
  margin-bottom: 0;
}
.markdown-body :where(h1, h2, h3, h4, h5, h6) {
  font-weight: 700;
  margin: 0.6em 0 0.25em;
}
.markdown-body :where(ul, ol) {
  margin: 0.35em 0;
  padding-left: 1.3em;
  list-style: revert;
}
.markdown-body :where(code) {
  padding: 1px 4px;
  border-radius: 4px;
  background: rgba(127, 127, 127, 0.14);
  font-family: ui-monospace, Consolas, monospace;
  font-size: 0.85em;
}
.markdown-body :where(pre) {
  margin: 0.4em 0;
  padding: 8px 10px;
  border-radius: 6px;
  background: rgba(127, 127, 127, 0.14);
  overflow-x: auto;
}
.markdown-body :where(pre code) {
  padding: 0;
  background: transparent;
}
.markdown-body :where(blockquote) {
  margin: 0.4em 0;
  padding-left: 8px;
  border-left: 3px solid rgba(127, 127, 127, 0.4);
  opacity: 0.85;
}
.markdown-body :where(a) {
  text-decoration: underline;
}
.markdown-body :where(img, video) {
  max-width: 100%;
  height: auto;
}
.markdown-body :where(table) {
  border-collapse: collapse;
  margin: 0.4em 0;
}
.markdown-body :where(th, td) {
  border: 1px solid rgba(127, 127, 127, 0.4);
  padding: 3px 8px;
}
.markdown-body :where(hr) {
  border: none;
  border-top: 1px solid rgba(127, 127, 127, 0.4);
}
</style>
