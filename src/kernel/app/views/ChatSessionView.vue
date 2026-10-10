<script setup lang="ts">
// 全屏聊天页(M3):顶栏(返回/标题) + 消息流 + 输入坞,chatbox 与 card 两域共用
// 同一骨架(M3-i),域由 props.domain 决定 —— chatbox 走会话仓自带 system prompt;
// card 走角色卡库,每次发送现组装提示词(card-prompt,RP 最小式:名字+性格(+对话
// 示例)+末尾 [User Info]),开场白种为首楼、顶栏「清空重开」为卡域专属。发送 =
// 内核 llm.provider seam 流式(可中止);楼层经各自 store 增量持久化
// (chat-persistence 器官);用量回调经注入(usage-stats 写侧,组合根接线)。
import { computed, inject, nextTick, onMounted, onUnmounted, ref, shallowRef } from 'vue'
import {
  CARD_SESSION_STORE_KEY,
  CHATBOX_STORE_KEY,
  CHARACTER_STORE_KEY,
  SEAM_REGISTRY_KEY,
  SESSION_PROJECTION_KEY,
  SETTINGS_STATE_KEY,
  USAGE_RECORDER_KEY,
  VARIABLE_STORE_KEY,
  WORLDBOOK_STORE_KEY,
  REGEX_STORE_KEY,
  PRESET_STORE_KEY,
  MEMORY_STORE_KEY,
} from '@/kernel/app/chat-keys'
import { PLUGIN_RUNTIME_KEY } from '@/kernel/app/runtime-key'
import { useChatAttachments } from '@/kernel/app/chat/use-chat-attachments'
import { useChatMemory } from '@/kernel/app/chat/use-chat-memory'
import { useCardLedger } from '@/kernel/app/chat/use-card-ledger'
import { createRequestAssembler } from '@/kernel/app/chat/request-assembly'
import { pluginActive, useFloorActions } from '@/kernel/app/chat/use-floor-actions'
import { useChatTurn } from '@/kernel/app/chat/use-chat-turn'
import ChatFloorList from '@/kernel/app/chat/ChatFloorList.vue'
import type { FloorView } from '@/kernel/app/chat/ChatFloorList.vue'
import ChatComposer from '@/kernel/app/chat/ChatComposer.vue'
import ImageViewer from '@/kernel/app/chat/ImageViewer.vue'
import { closeConversation } from '@/kernel/app/chat-router'
import type { CharacterCard } from '@/kernel/characters/character-card'
import type { LlmProvider } from '@/kernel/llm/llm-provider'
// M3-n rich render: floors go through macro substitution + markdown/DOMPurify
// (full HTML documents run in sandboxed executable frames); the lifecycle
// module is a side-effect import (≤3 active frames red line).
import '@/kernel/render/html-frame-lifecycle'
import { contentUsesHtmlFrame, renderMessageHtml } from '@/kernel/render/message-render'
import { applyRegexPipeline } from '@/kernel/regex/regex-engine'
import { setExecutableFrameSlashHandler, startExecutableFrameHost } from '@/kernel/render/html-frame'
import type { CardSession } from '@/kernel/sessions/card-session-store'
import type { ChatboxConversation, ChatboxMessage } from '@/kernel/sessions/chatbox-store'
import { uiService } from '@/kernel/ui/toasts'
// M3-q variables: tag-block parsing/ledger on the card domain only — the
// request path expands {{getvar}} + appends the [Variables] section, the
// display path strips blocks into the floor capsule.
import { stripVariableBlocks } from '@/kernel/variables/variable-engine'
import type { PresetSnapshot } from '@/kernel/presets/preset-store'
// M4-f CoT layer: tag parsing + native reasoning display; the COT preset
// content syncs into the preset store as a managed entry. Plugin = the toggle.
import { parseCot } from '@/kernel/cot/cot-parser'
import VariablesSheet from '@/kernel/variables/VariablesSheet.vue'
import WorldbookSheet from '@/kernel/worldinfo/WorldbookSheet.vue'
import RegexSheet from '@/kernel/regex/RegexSheet.vue'
// M4-e memory layer: rolling-summary engine/ledger/pipeline stay kernel-
// side (red line: kernel never imports plugins); the plugin is the toggle.
import { createEmptyMemoryState } from '@/kernel/memory/memory-engine'
import MemorySheet from '@/kernel/memory/MemorySheet.vue'
import SessionSettingsSheet from '@/kernel/app/sections/SessionSettingsSheet.vue'

const props = withDefaults(defineProps<{ conversationId: string; domain?: 'chatbox' | 'card' }>(), { domain: 'chatbox' })

const store = inject(CHATBOX_STORE_KEY, null)
const cardSessions = inject(CARD_SESSION_STORE_KEY, null)
const characterStore = inject(CHARACTER_STORE_KEY, null)
const settingsState = inject(SETTINGS_STATE_KEY, null)
const projection = inject(SESSION_PROJECTION_KEY, null)
const seams = inject(SEAM_REGISTRY_KEY, null)
const recordUsage = inject(USAGE_RECORDER_KEY, null)
const variableStore = inject(VARIABLE_STORE_KEY, null)
const worldbookStore = inject(WORLDBOOK_STORE_KEY, null)
const regexStore = inject(REGEX_STORE_KEY, null)
const presetStore = inject(PRESET_STORE_KEY, null)
const memoryStore = inject(MEMORY_STORE_KEY, null)
// Variables plugin toggle (M3-q2): the tools-area entry gates the feature.
// No runtime injected (pure kernel tests) keeps variables active.
const runtime = inject(PLUGIN_RUNTIME_KEY, null)

// C7: one provider-resolution shape for the view's turn sites (the floor
// actions composable receives it as a dep).
const resolveProvider = (): LlmProvider | undefined => seams?.resolve<LlmProvider>('llm.provider')?.implementation

const conversation = ref<ChatboxConversation | null>(null)
const cardSession = ref<CardSession | null>(null)
const card = ref<CharacterCard | null>(null)
const cardCover = ref('')
const draft = ref('')
const streaming = ref(false)
const loadError = ref('')
// D3: request failures never write a message floor — they surface as a
// transient error bar above the composer and vanish on remount/retry/success.
const sendError = ref('')
const messagesEl = ref<HTMLElement | null>(null)
// Card artifact layers (variables ledger / worldbook / regex states, the
// per-floor panel pipeline, floor capsule and template analysis) live in
// use-card-ledger (2026-10 cleanup); onMounted writes the plugin gates onto
// the returned refs. Only the sheet-visibility flags stay here.
const showWorldbook = ref(false)
const showRegex = ref(false)
// Preset layer (M3-w): app-level; dormant = request assembles exactly as
// before this slice. The snapshot is replaced wholesale on changes.
const presetsActive = ref(true)
const presetSnapshot = shallowRef<PresetSnapshot | null>(null)
// CoT layer (M4-f): same gating shape — dormant = no thinking card, no COT
// preset sync, no request-side strip (raw tag passthrough). Native reasoning
// still rides the kernel stream capture; it just stays unshown.
const cotActive = ref(true)
// Story engine (M4-e): app-level — dormant = no principles, no stage table,
// no bookkeeping block. The stage value rides the variables ledger
// (`story.stage`), so the stage system additionally needs the card domain
// with variables active (request-assembly gates that itself).
const storyActive = ref(true)
// Session settings (M4-g3 parity): session-level system prompt (chatbox) and
// model override (both domains).
const showSessionSettings = ref(false)
const showVariables = ref(false)
// M4-d single-shot system instruction: rides one request, then clears.
const oneShotInstruction = ref('')

// M4-d chat image attachments: pending strip + picker handler + vision
// capability lookups live in the composable (2026-10 cleanup extraction).
const {
  pendingImages,
  pendingImagesNotReady,
  removePendingImage,
  onChatImageSelected,
  viewerImage,
  activeVisionCapable,
} = useChatAttachments({ settingsState, isStreaming: () => streaming.value })

const isCardDomain = computed(() => props.domain === 'card')
const messages = computed<ChatboxMessage[]>(() =>
  (isCardDomain.value ? cardSession.value?.messages : conversation.value?.messages) ?? [])
const title = computed(() =>
  (isCardDomain.value ? card.value?.name : conversation.value?.title) ?? (isCardDomain.value ? '角色' : '对话'))
const sessionLoaded = computed(() => (isCardDomain.value ? cardSession.value !== null : conversation.value !== null))

// Prose projection shared by the memory/ledger pipelines — delegates to the
// assembler's proseOf (C9: the strip chain is defined once, in one place).
const toProse = (text: string): string => proseOf(text)
// M4-e memory pipeline (composable, 2026-10 cleanup extraction): onMounted
// writes the plugin-toggle gate; the patrol and manual rebuild live there.
const {
  memoryActive,
  memoryState,
  memoryStatus,
  memoryBusy,
  showMemory,
  maybeRunMemoryPipeline,
  rebuildMemory,
} = useChatMemory({
  settingsState,
  memoryStore,
  recordUsage,
  isCardDomain: () => isCardDomain.value,
  card: () => card.value,
  messages: () => messages.value,
  toProse,
  userName: () => readUserInfo().name,
})

const scrollToBottom = async (): Promise<void> => {
  await nextTick()
  // Optional call: environments without element scrolling (jsdom) stay safe.
  messagesEl.value?.scrollTo?.({ top: messagesEl.value.scrollHeight })
}

onMounted(async () => {
  // Card-reported frame heights arrive via postMessage (idempotent install);
  // panel buttons ride the same channel (M3-t): a trigger sends a user turn —
  // rejected while a reply is streaming (RP same discipline).
  startExecutableFrameHost()
  setExecutableFrameSlashHandler((command) => {
    if (!streaming.value) void send(command)
  })
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
    variablesActive.value = pluginActive(runtime, 'variables')
    // M3-u: the worldbook layer gates on its own plugin the same way.
    worldbookActive.value = pluginActive(runtime, 'worldinfo')
    if (worldbookActive.value) {
      worldbookDisabledUids.value = (await worldbookStore?.getDisabled(card.value.id)) ?? new Set()
    }
    // M3-v: regex layer gates on its own plugin the same way.
    regexActive.value = pluginActive(runtime, 'regex')
    if (regexActive.value) {
      regexDisabledUids.value = (await regexStore?.getDisabled(card.value.id)) ?? new Set()
    }
    // M4-e: the memory layer gates on its own plugin the same way.
    memoryActive.value = pluginActive(runtime, 'memory')
    if (memoryActive.value) {
      memoryState.value = (await memoryStore?.ensure({ kind: 'card', id: card.value.id })) ?? null
    }
    // M3-w: presets are app-level — gate + load once per view mount.
    presetsActive.value = pluginActive(runtime, 'presets')
    if (presetsActive.value) {
      presetSnapshot.value = (await presetStore?.ensure()) ?? null
    }
    // M4-f: the CoT layer gates on its own plugin the same way.
    cotActive.value = pluginActive(runtime, 'cot')
    // M4-e 故事引擎:门控与预设层同形(app-level,两域通用;阶段系统在
    // request-assembly 内再按卡域 + 变量层二次门控)。
    storyActive.value = pluginActive(runtime, 'story')
    if (variablesActive.value) {
      // Seed = flat card defaults (mp_variables) + each template's initial
      // tree under its id (M3-r). First touch only; later ensures keep the
      // running ledger.
      const variableSnapshot = await variableStore?.ensure(card.value.id, buildVariableDefaults())
      if (variableSnapshot) {
        absorbVariableSnapshot(variableSnapshot)
      }
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
  setExecutableFrameSlashHandler(null)
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
 *  Q1 落库纪律). M3-v: card regexes rewrite the display projection of AI
 *  floors (depth always 0; promptOnly scripts skip display). User floors
 *  stay UNstyled (user feedback 2026-10-02): beautification wrappers make
 *  user bubbles look oversized — card regexes are authored for prose.
 *  The prompt surface is untouched: placement-[1] promptOnly scripts still
 *  rewrite user input in the request. */
const renderFloor = (message: ChatboxMessage): string => {
  let content = message.content
  // M4-f: thinking tags leave the display projection first (stored floor keeps
  // them verbatim — 落库纪律). HTML-frame floors render whole in the sandbox
  // iframe; tag surgery there could corrupt the document, so they skip CoT.
  if (cotActive.value && !contentUsesHtmlFrame(content)) {
    content = parseCot(content, !isStreamingFloor(message)).main
  }
  if (isCardDomain.value && variablesActive.value) content = stripVariableBlocks(content)
  const assistantFloor = message.role === 'assistant'
  if (isCardDomain.value && regexActive.value && assistantFloor && cardRegexScripts.value.length > 0) {
    content = applyRegexPipeline(content, {
      scripts: cardRegexScripts.value,
      surface: 'display',
      role: 'assistant',
      depth: 0,
      disabledUids: regexDisabledUids.value,
    })
  }
  return renderMessageHtml(content, macroContext.value, !isStreamingFloor(message))
}

/** M4-f thinking card: native reasoning (wire field) plus tag-based
 *  <think>/<cot> parsed from stored content, as two independent sections —
 *  providers deliver either or both (RP timeline collapsed to its thinking
 *  steps; tool-call steps have no MP counterpart). `live` = still receiving
 *  that section. */
interface FloorThinkingSection {
  id: string
  title: string
  text: string
  chars: number
  live: boolean
}

const floorThinkingSections = (message: ChatboxMessage): FloorThinkingSection[] => {
  if (message.role !== 'assistant' || !cotActive.value || contentUsesHtmlFrame(message.content)) return []
  const streamingFloor = isStreamingFloor(message)
  const sections: FloorThinkingSection[] = []
  const reasoning = String(message.reasoning ?? '').trim()
  if (reasoning) {
    sections.push({ id: 'native', title: '原生思考', text: reasoning, chars: reasoning.length, live: streamingFloor && !message.content })
  }
  const info = parseCot(message.content, !streamingFloor)
  if (info.cot) {
    sections.push({ id: 'cot', title: '分析过程', text: info.cot, chars: info.cot.length, live: streamingFloor && !info.isFinished })
  }
  return sections
}

/** Default open while the streaming floor finishes, collapsed once finished; a
 *  user toggle persists per floor (RP isSummaryOpen semantics). `sections`
 *  accepts the precomputed list so the view-model pass parses each floor once. */
const isCotCardOpen = (message: ChatboxMessage, sections: FloorThinkingSection[] = floorThinkingSections(message)): boolean =>
  message.cotOpen !== undefined ? message.cotOpen : isStreamingFloor(message) && sections.length > 0

const toggleCotCard = (message: ChatboxMessage): void => {
  message.cotOpen = !isCotCardOpen(message)
  void persistSession()
}

const renderThinkingText = (text: string): string => renderMessageHtml(text, macroContext.value, true)

const floorUsesHtmlFrame = (message: ChatboxMessage): boolean => contentUsesHtmlFrame(message.content)

const persistSession = async (): Promise<void> => {
  if (isCardDomain.value && cardSession.value) await cardSessions?.save(cardSession.value)
  else if (conversation.value) await store?.save(conversation.value)
}

const buildUserInfoLine = (): string => {
  const { name, persona } = readUserInfo()
  return [name ? `用户名字：${name}` : '', persona ? `用户人设：${persona}` : ''].filter(Boolean).join('\n')
}

// Card artifact layers (composable, 2026-10 cleanup extraction): onMounted
// writes the plugin gates; request assembly and the sheets consume the state.
const {
  variableState,
  variablesActive,
  worldbookActive,
  worldbookReport,
  worldbookDisabledUids,
  regexActive,
  regexDisabledUids,
  capsuleOpenId,
  analysisStatus,
  absorbVariableSnapshot,
  activeTemplates,
  worldbookEntries,
  toggleWorldbookEntry,
  cardRegexScripts,
  toggleRegexScript,
  templateStateOf,
  buildVariableDefaults,
  floorPanels,
  floorVariableSummary,
  toggleCapsule,
  onVariablesChanged,
  liveVariableSnapshot,
  applyMatchedTemplateUpdates,
  runTemplateAnalysisPipeline,
} = useCardLedger({
  settingsState,
  variableStore,
  worldbookStore,
  regexStore,
  recordUsage,
  isCardDomain: () => isCardDomain.value,
  card: () => card.value,
  messages: () => messages.value,
  isStreamingFloor,
  toProse,
  userName: () => readUserInfo().name,
  userInfoLine: buildUserInfoLine,
})

// Request assembly (factory, 2026-10 cleanup extraction): memory prune +
// presets + card prompt + worldbook + variables + regex/CoT/omission rewriting.
// The worldbook report rides out through onWorldbookArtifact into the ledger
// layer's ref; COT preset sync keeps the view's snapshot ref in sync.
const {
  stripCotText,
  proseOf,
  buildRequestMessages,
  syncCotPresetsIfActive,
} = createRequestAssembler({
  settingsState,
  presetStore,
  isCardDomain: () => isCardDomain.value,
  card: () => card.value,
  conversation: () => conversation.value,
  messages: () => messages.value,
  memoryActive: () => memoryActive.value,
  memoryState: () => memoryState.value,
  presetsActive: () => presetsActive.value,
  presetSnapshot: () => presetSnapshot.value,
  setPresetSnapshot: (snapshot) => { presetSnapshot.value = snapshot },
  cotActive: () => cotActive.value,
  storyActive: () => storyActive.value,
  variablesActive: () => variablesActive.value,
  variableState: () => variableState.value,
  activeTemplates: () => activeTemplates.value,
  templateStateOf,
  worldbookActive: () => worldbookActive.value,
  worldbookDisabledUids: () => worldbookDisabledUids.value,
  regexActive: () => regexActive.value,
  onWorldbookArtifact: (artifact) => { worldbookReport.value = artifact },
  cardRegexScripts: () => cardRegexScripts.value,
  regexDisabledUids: () => regexDisabledUids.value,
  activeVisionCapable,
  oneShotInstruction: () => oneShotInstruction.value,
  readUserInfo,
  macroContext: () => macroContext.value,
})

// Turn engine (composable, 2026-10 cleanup extraction): the streaming half of
// a turn plus send/retry; abort state and the retry's lastUserText live there.
const {
  stopStreaming,
  streamAssistantInto,
  retryLastSend,
  send,
} = useChatTurn({
  resolveProvider,
  streaming,
  sendError,
  draft,
  oneShotInstruction,
  pendingImages,
  pendingImagesNotReady,
  sessionLoaded: () => sessionLoaded.value,
  isCardDomain: () => isCardDomain.value,
  cardSession: () => cardSession.value,
  conversation: () => conversation.value,
  card: () => card.value,
  messages: () => messages.value,
  variablesActive: () => variablesActive.value,
  settingsState,
  recordUsage,
  variableStore,
  activeTemplates: () => activeTemplates.value,
  absorbVariableSnapshot,
  applyMatchedTemplateUpdates,
  runTemplateAnalysisPipeline,
  buildRequestMessages,
  syncCotPresetsIfActive,
  persistSession,
  scrollToBottom,
  maybeRunMemoryPipeline,
  domain: () => props.domain,
})

// Floor actions (composable, 2026-10 cleanup extraction): the swipe/regen
// candidates, edit/copy/delete row, speak intent and session-settings handoff.
const {
  editingFloorId,
  editDraft,
  ttsActive,
  isLastAssistantFloor,
  regenerateLast,
  switchCandidate,
  deleteFloorFrom,
  startEditFloor,
  cancelEditFloor,
  saveEditFloor,
  copyFloor,
  toggleSpeakFloor,
  onSessionSettingsSaved,
} = useFloorActions({
  resolveProvider,
  runtime,
  variableStore,
  isStreaming: () => streaming.value,
  sessionLoaded: () => sessionLoaded.value,
  isCardDomain: () => isCardDomain.value,
  card: () => card.value,
  cardSession: () => cardSession.value,
  conversation: () => conversation.value,
  messages: () => messages.value,
  variablesActive: () => variablesActive.value,
  absorbVariableSnapshot,
  buildRequestMessages,
  streamAssistantInto,
  syncCotPresetsIfActive,
  persistSession,
  stripCotText,
  domain: () => props.domain,
})

// C1: the per-floor view model — every derived value is computed ONCE per
// render pass (the old template re-invoked these functions 3-6 times per
// floor; floorVariableSummary alone re-scanned the whole event list ×4).
const floorViews = computed<FloorView[]>(() =>
  messages.value.map((message, index) => {
    const thinking = floorThinkingSections(message).map((section) => ({ ...section, html: renderThinkingText(section.text) }))
    const panels = floorPanels(message)
    const isHtmlFrame = floorUsesHtmlFrame(message)
    return {
      message,
      index,
      html: renderFloor(message),
      thinking,
      thinkingOpen: isCotCardOpen(message, thinking),
      thinkingLive: thinking.some((section) => section.live),
      panels,
      capsule: floorVariableSummary(message),
      capsuleOpen: capsuleOpenId.value === message.id,
      isHtmlFrame,
      wide: isHtmlFrame || panels.top.length > 0 || panels.bottom.length > 0,
      isStreaming: isStreamingFloor(message),
      isLastAssistant: isLastAssistantFloor(message),
    }
  }))

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
  // M3-q/M3-s: 清空重开 resets the ledger to a fresh full seed — flat card
  // defaults AND the template trees (previously only the flat rows were
  // re-seeded and template panels fell back to card initial state).
  // C3: absorb the WHOLE snapshot (events included) — writing state only left
  // the pre-reset events visible in the sheet and feeding panel replay.
  if (variablesActive.value) {
    const variableSnapshot = await variableStore?.reset(card.value.id, buildVariableDefaults())
    if (variableSnapshot) absorbVariableSnapshot(variableSnapshot)
  }
  // M4-e: clear-and-restart clears the memory ledger with everything else
  // - the summary describes the CLEARED story, keeping it would be wrong.
  if (memoryActive.value) {
    await memoryStore?.reset({ kind: 'card', id: card.value.id })
    memoryState.value = createEmptyMemoryState()
    memoryStatus.value = ''
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
        v-if="isCardDomain && worldbookActive && worldbookEntries.length > 0"
        type="button"
        class="flex-shrink-0 rounded-input px-2 py-1 text-xs text-ink-2"
        @click="showWorldbook = true"
      >
        世界书
      </button>
      <button
        v-if="isCardDomain && regexActive && cardRegexScripts.length > 0"
        type="button"
        class="flex-shrink-0 rounded-input px-2 py-1 text-xs text-ink-2"
        @click="showRegex = true"
      >
        正则
      </button>
      <button
        v-if="isCardDomain && memoryActive"
        type="button"
        class="flex-shrink-0 rounded-input px-2 py-1 text-xs text-ink-2"
        @click="showMemory = true"
      >
        记忆
      </button>
      <button
        type="button"
        class="flex-shrink-0 rounded-input px-2 py-1 text-xs text-ink-2"
        @click="showSessionSettings = true"
      >
        会话
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
          <ChatFloorList
            :views="floorViews"
            :editing-floor-id="editingFloorId"
            :edit-draft="editDraft"
            :streaming="streaming"
            :tts-active="ttsActive"
            @update:edit-draft="editDraft = $event"
            @cancel-edit="cancelEditFloor"
            @save-edit="saveEditFloor"
            @view-image="viewerImage = $event"
            @toggle-cot="toggleCotCard"
            @toggle-capsule="toggleCapsule"
            @switch="(message, direction) => switchCandidate(message, direction)"
            @regenerate="regenerateLast"
            @edit="startEditFloor"
            @copy="copyFloor"
            @speak="toggleSpeakFloor"
            @remove="deleteFloorFrom"
          />
        </div>
      </div>

      <div
        v-if="sendError"
        class="shrink-0 border-t border-danger/30 bg-danger-wash px-3 py-2"
        role="alert"
      >
        <div class="mx-auto flex max-w-xl items-center gap-2">
          <span class="min-w-0 flex-1 break-words text-xs text-danger">请求失败:{{ sendError }}</span>
          <button
            type="button"
            class="flex-shrink-0 rounded-input border border-danger/40 px-2 py-1 text-xs font-bold text-danger"
            @click="retryLastSend"
          >
            重试
          </button>
          <button
            type="button"
            class="flex-shrink-0 px-1 text-xs text-ink-3"
            aria-label="关闭错误提示"
            @click="sendError = ''"
          >
            ✕
          </button>
        </div>
      </div>

      <ChatComposer
        :pending-images="pendingImages"
        :draft="draft"
        :streaming="streaming"
        :one-shot-instruction="oneShotInstruction"
        :send-disabled="!draft.trim() || pendingImagesNotReady"
        @update:draft="draft = $event"
        @update:one-shot-instruction="oneShotInstruction = $event"
        @send="send()"
        @stop="stopStreaming"
        @files="onChatImageSelected"
        @remove-image="removePendingImage"
      />
    </template>

    <ImageViewer
      v-if="viewerImage"
      :src="viewerImage"
      @close="viewerImage = ''"
    />

    <VariablesSheet
      v-if="isCardDomain && showVariables && card"
      :card-id="card.id"
      :templates="activeTemplates"
      :analysis-status="analysisStatus"
      :live="liveVariableSnapshot"
      @changed="onVariablesChanged"
      @close="showVariables = false"
      @analyze="runTemplateAnalysisPipeline(messages[messages.length - 1]!, true)"
    />

    <WorldbookSheet
      v-if="isCardDomain && showWorldbook"
      :entries="worldbookEntries"
      :disabled-uids="worldbookDisabledUids"
      :report="worldbookReport"
      @toggle="toggleWorldbookEntry"
      @close="showWorldbook = false"
    />

    <RegexSheet
      v-if="isCardDomain && showRegex"
      :scripts="cardRegexScripts"
      :disabled-uids="regexDisabledUids"
      @toggle="toggleRegexScript"
      @close="showRegex = false"
    />

    <SessionSettingsSheet
      v-if="showSessionSettings"
      :domain="props.domain"
      :conversation="conversation"
      :card-session="cardSession"
      :settings-state="settingsState"
      @close="showSessionSettings = false"
      @saved="onSessionSettingsSaved"
    />
    <MemorySheet
      v-if="isCardDomain && showMemory && card"
      :state="memoryState"
      :status="memoryStatus"
      :busy="memoryBusy"
      :floor-count="messages.length"
      @close="showMemory = false"
      @summarize="maybeRunMemoryPipeline(true)"
      @rebuild="rebuildMemory"
    />
  </div>
</template>


