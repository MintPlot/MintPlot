<script setup lang="ts">
// Full-screen chat shared by card and chatbox sessions. Display projections
// remain independent from the complete request and persistence history.
import { computed, inject, nextTick, onScopeDispose, ref, shallowRef, watch } from 'vue'
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
import { useSessionEntry } from '@/kernel/app/chat/use-session-entry'
import { beginSessionWriteHandoff } from '@/kernel/app/chat/session-write-handoff'
import { createSessionLocalWork } from '@/kernel/app/chat/session-local-work'
import { activateSessionViewHost } from '@/kernel/app/chat/session-view-host'
import SessionBackdrop from '@/kernel/app/chat/SessionBackdrop.vue'
import type { SessionPageBackground } from '@/kernel/app/chat/session-shell-prototype'
import { useChatTurn } from '@/kernel/app/chat/use-chat-turn'
import { useChatScroll } from '@/kernel/app/chat/use-chat-scroll'
import ChatFloorList from '@/kernel/app/chat/ChatFloorList.vue'
import ChatComposer from '@/kernel/app/chat/ChatComposer.vue'
import ChatSessionHeader from '@/kernel/app/chat/ChatSessionHeader.vue'
import { createFloorProjection } from '@/kernel/app/chat/floor-projection'
import type { CardToolId, CardToolItem } from '@/kernel/app/chat/CardToolsMenu.vue'
import ImageViewer from '@/kernel/app/chat/ImageViewer.vue'
import { closeConversation, useChatRoute } from '@/kernel/app/chat-router'
import type { CharacterCard } from '@/kernel/characters/character-card'
import type { LlmProvider } from '@/kernel/llm/llm-provider'
// M3-n rich render: floors go through macro substitution + markdown/DOMPurify
// (full HTML documents run in sandboxed executable frames); the lifecycle
// module is a side-effect import (≤3 active frames red line).
import '@/kernel/render/html-frame-lifecycle'
import type { CardBackdrop, CardSession } from '@/kernel/sessions/card-session-store'
import { cardBackdropDefault } from '@/kernel/app/card-backdrop-default'
import type { ChatboxConversation, ChatboxMessage } from '@/kernel/sessions/chatbox-store'
import { uiService } from '@/kernel/ui/toasts'
// M3-q variables: tag-block parsing/ledger on the card domain only — the
// request path expands {{getvar}} + appends the [Variables] section, the
// display path strips blocks into the floor capsule.
import type { PresetSnapshot } from '@/kernel/presets/preset-store'
// M4-f CoT layer: tag parsing + native reasoning display; the COT preset
// content syncs into the preset store as a managed entry. Plugin = the toggle.
import VariablesSheet from '@/kernel/variables/VariablesSheet.vue'
import WorldbookSheet from '@/kernel/worldinfo/WorldbookSheet.vue'
import RegexSheet from '@/kernel/regex/RegexSheet.vue'
// M4-e memory layer: rolling-summary engine/ledger/pipeline stay kernel-
// side (red line: kernel never imports plugins); the plugin is the toggle.
import { createEmptyMemoryState } from '@/kernel/memory/memory-engine'
import MemorySheet from '@/kernel/memory/MemorySheet.vue'
import SessionSettingsSheet from '@/kernel/app/sections/SessionSettingsSheet.vue'
// 叙事风格维度系统(S3):卡域顶栏「风格」面板;选择落 CardSession.style,
// 请求装配经 cardStyle dep 读三态取材(全局/本卡覆盖)。chatbox 域无入口(D14)。
import StyleSheet from '@/kernel/app/sections/StyleSheet.vue'
import type { CardStyleSelection } from '@/kernel/presets/style-assembly'

const props = withDefaults(defineProps<{
  conversationId: string; domain?: 'chatbox' | 'card'; hosted?: boolean; presented?: boolean
}>(), { domain: 'chatbox', hosted: false, presented: true })
const emit = defineEmits<{ ready: [key: string]; backdrop: [value: SessionPageBackground] }>()
const route = useChatRoute()
const entryRoute = route.value
const linkedToRoute = entryRoute.view === 'chat' && entryRoute.kind === props.domain && entryRoute.conversationId === props.conversationId
const entryActive = computed(() => !linkedToRoute || route.value === entryRoute)
const localWork = createSessionLocalWork(() => {
  uiService.toast('shell', '会话保存失败，请返回后重试', { tone: 'error' })
})

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

// Backdrop tuning (1.0.x): effective value = per-card envelope override, else
// the global default (card-backdrop-default.ts). While the settings sheet is
// open, `backdropPreview` (live slider emissions) wins so the page previews
// each tweak; it clears on close (revert) and on save (envelope takes over).
// Scale stays fixed at 110% — it hides the blur edge bleed, not a taste
// parameter.
const backdropPreview = ref<CardBackdrop | null>(null)
const effectiveBackdrop = computed<CardBackdrop>(() => ({
  enabled: true,
  ...cardBackdropDefault.value,
  ...(cardSession.value?.bg ?? {}),
  ...(backdropPreview.value ?? {}),
}))
const closeSessionSettings = (): void => {
  showSessionSettings.value = false
  backdropPreview.value = null
}
const onSheetSaved = (draft: Parameters<typeof onSessionSettingsSaved>[0]): void => {
  backdropPreview.value = null
  void onSessionSettingsSaved(draft)
}
const onBackdropReset = (): void => {
  if (cardSession.value) {
    delete cardSession.value.bg
    void persistSession()
  }
  backdropPreview.value = null
}
const draft = ref('')
const streaming = ref(false)
const loadError = ref('')
const resettingSession = ref(false)
// D3: request failures never write a message floor — they surface as a
// transient error bar above the composer and vanish on remount/retry/success.
const sendError = ref('')
const messagesEl = ref<HTMLElement | null>(null)
const sessionRoot = ref<HTMLElement | null>(null)
const floorList = ref<InstanceType<typeof ChatFloorList> | null>(null)
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
// Session settings (M4-g3 parity): session-level system prompt (chatbox) and
// model override (both domains).
const showSessionSettings = ref(false)
const showVariables = ref(false)
const showStyle = ref(false)
const cardTools = computed<CardToolItem[]>(() => [
  ...(variablesActive.value ? [{ id: 'variables' as const, label: '变量', description: '状态与模板' }] : []),
  ...(worldbookActive.value ? [{ id: 'worldbook' as const, label: '世界书', description: '设定与触发条目' }] : []),
  ...(regexActive.value ? [{ id: 'regex' as const, label: '正则', description: '显示与提示词规则' }] : []),
  ...(memoryActive.value ? [{ id: 'memory' as const, label: '记忆', description: '摘要与人物档案' }] : []),
  ...(presetsActive.value ? [{ id: 'presets' as const, label: '叙事预设', description: '本卡叙事搭配' }] : []),
])
const openCardTool = (id: CardToolId): void => {
  if (id === 'variables') showVariables.value = true
  else if (id === 'worldbook') showWorldbook.value = true
  else if (id === 'regex') showRegex.value = true
  else if (id === 'memory') showMemory.value = true
  else showStyle.value = true
}
/** S3: per-card style override → the assembler's cardStyle dep. Absent =
 *  follow global (the resolver treats null as follow). */
const cardStyle = computed<CardStyleSelection | null>(() => cardSession.value?.style ?? null)
const onStyleSaved = (selection: CardStyleSelection): void => {
  if (!cardSession.value) return
  cardSession.value.style = selection
  void persistSession()
}
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
const pageInteractive = computed(() => entryActive.value && entryReady.value && (!props.hosted || props.presented))
const sessionLoaded = computed(() => pageInteractive.value && !resettingSession.value && !localWork.failed() && (isCardDomain.value ? cardSession.value !== null : conversation.value !== null))

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
  sessionSignal: localWork.signal,
  trackLocalWrite: localWork.track,
  settingsState,
  memoryStore,
  recordUsage,
  isCardDomain: () => isCardDomain.value,
  card: () => card.value,
  messages: () => messages.value,
  toProse,
  userName: () => readUserInfo().name,
})

const {
  followingOutput, scrollToBottom, followOutput, onMessageScroll, disposeScroll,
  onReaderPointerDown, onReaderPointerMove, clearReaderPointer, onReaderWheel, onReaderKeyDown,
} = useChatScroll(() => messagesEl.value, () => floorList.value)

let releaseHost = () => {}
onScopeDispose(() => releaseHost())
// A CSS leave keeps the component alive. Revoke its interactive host ownership
// at route departure, while allowing an aborted stream's existing final save.
watch(entryActive, (active) => { if (!active) depart() }, { flush: 'sync' })
const { entryReady } = useSessionEntry({
  id: () => props.conversationId,
  isCard: () => isCardDomain.value,
  active: () => entryActive.value,
  store, cardSessions, characters: characterStore, variables: variableStore,
  worldbook: worldbookStore, regex: regexStore, memory: memoryStore, presets: presetStore,
  featureActive: (feature) => pluginActive(runtime, feature),
  publish: (snapshot) => {
    conversation.value = snapshot.conversation
    card.value = snapshot.card
    cardSession.value = snapshot.session
    cardCover.value = snapshot.cover
    variablesActive.value = snapshot.gates.variables
    worldbookActive.value = snapshot.gates.worldinfo
    regexActive.value = snapshot.gates.regex
    memoryActive.value = snapshot.gates.memory
    presetsActive.value = snapshot.gates.presets
    cotActive.value = snapshot.gates.cot
    worldbookDisabledUids.value = snapshot.worldbookDisabled
    regexDisabledUids.value = snapshot.regexDisabled
    memoryState.value = snapshot.memory
    presetSnapshot.value = snapshot.presets
    if (snapshot.variables) absorbVariableSnapshot(snapshot.variables)
  },
  failed: (message) => { loadError.value = message },
  ready: () => {
    publishBackdrop()
    emit('ready', `${props.domain}:${props.conversationId}`)
  },
  presented: () => { if (!props.hosted) return scrollToBottom() },
})
const publishBackdrop = (): void => emit('backdrop', {
  cover: isCardDomain.value ? cardCover.value : '', backdrop: { ...effectiveBackdrop.value },
})
watch([cardCover, effectiveBackdrop], () => {
  if (props.hosted && entryReady.value && entryActive.value) publishBackdrop()
}, { flush: 'post' })
watch(pageInteractive, (active) => {
  releaseHost()
  if (active && !loadError.value) {
    releaseHost = activateSessionViewHost(projection, card.value && cardSession.value
      ? { cardId: card.value.id, cardName: card.value.name, messages: cardSession.value.messages } : null,
    (command) => { if (sessionLoaded.value && !streaming.value) void send(command) },
    (frame) => sessionRoot.value?.contains(frame) === true)
    if (props.hosted) void scrollToBottom()
  }
}, { flush: 'sync' })

const readUserInfo = (): { name: string; persona: string } => {
  const scope = settingsState?.scope(['userName', 'userPersona'])
  return { name: String(scope?.userName ?? ''), persona: String(scope?.userPersona ?? '') }
}

// M3-n display-side macro context: the card domain resolves both macros, the
// chatbox domain has no char ({{char}} stays literal — RP replaces {{user}}
// only as well). F5: an unset nickname used to collapse {{user}} to an empty
// string (greetings rendered 「你好，！」) — fall back to the generic name.
const macroContext = computed(() => ({
  charName: isCardDomain.value ? card.value?.name ?? '' : '',
  userName: readUserInfo().name || '用户',
}))

const isStreamingFloor = (message: ChatboxMessage): boolean =>
  streaming.value && message.role === 'assistant' && message === messages.value[messages.value.length - 1]

let departed = false
const writeSession = async (): Promise<void> => {
  // An aborted turn can settle while reset is awaiting I/O, before the view
  // replaces its old session reference. Its final save must not queue after reset.
  if (resettingSession.value) return
  if (isCardDomain.value && cardSession.value) await cardSessions?.save(cardSession.value)
  else if (conversation.value) await store?.save(conversation.value)
}
const persistSession = async (): Promise<void> => {
  if (!departed) await localWork.track(writeSession())
}
const depart = (): void => {
  if (departed) return
  departed = true
  releaseHost()
  disposeScroll()
  localWork.retire()
  retire()
  const owner = isCardDomain.value ? cardSessions : store
  if (!owner || (!cardSession.value && !conversation.value)) return
  const pendingLocalWork = localWork.hasPending()
  void beginSessionWriteHandoff(owner, props.conversationId, async () => {
    const results = await Promise.allSettled([writeSession(), localWork.drain()])
    if (results.some(result => result.status === 'rejected')) throw new Error('session_handoff_failed')
    if (pendingLocalWork) await writeSession()
  }).catch(() => {
    uiService.toast('shell', '会话保存失败，请返回后重试', { tone: 'error' })
  })
}
onScopeDispose(depart)

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
  sessionSignal: localWork.signal,
  trackLocalWrite: localWork.track,
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
  cardStyle: () => cardStyle.value,
  setPresetSnapshot: (snapshot) => { presetSnapshot.value = snapshot },
  cotActive: () => cotActive.value,
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
  retire,
  streamAssistantInto,
  retryLastSend,
  send,
} = useChatTurn({
  sessionSignal: localWork.signal,
  trackLocalWrite: localWork.track,
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
  // The virtual list follows append/height changes itself. Await only the
  // DOM publication here; do not issue another scroll command per flush.
  followOutput: async () => { await nextTick() },
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
  sessionSignal: localWork.signal,
  trackLocalWrite: localWork.track,
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
  scrollToBottom,
  domain: () => props.domain,
})

const { projectFloor, toggleCotCard } = createFloorProjection({
  isStreamingFloor,
  cotActive: () => cotActive.value,
  isCardDomain: () => isCardDomain.value,
  variablesActive: () => variablesActive.value,
  regexActive: () => regexActive.value,
  cardRegexScripts: () => cardRegexScripts.value,
  regexDisabledUids: () => regexDisabledUids.value,
  macroContext: () => macroContext.value,
  persistSession, floorPanels, floorVariableSummary,
  capsuleOpenId: () => capsuleOpenId.value,
  isLastAssistantFloor,
})

const restartSession = async (): Promise<void> => {
  if (!isCardDomain.value || !card.value || !cardSessions || resettingSession.value) return
  const resetCard = card.value
  const confirmed = await uiService.confirm('shell', {
    title: '清空重开',
    message: `清空与「${card.value.name}」的全部楼层,重新开始这段对话?`,
    confirmLabel: '清空重开',
  })
  if (!confirmed || resettingSession.value || !sessionLoaded.value) return
  resettingSession.value = true
  localWork.cancel()
  stopStreaming()
  const previousWrites = localWork.drain()
  const reset = async (): Promise<void> => {
    try {
      await previousWrites
      cardSession.value = await cardSessions.reset(resetCard)
      // Reset all local state before a new page may read this session.
      if (variablesActive.value) {
        const variableSnapshot = await variableStore?.reset(resetCard.id, buildVariableDefaults())
        if (variableSnapshot) absorbVariableSnapshot(variableSnapshot)
      }
      if (memoryActive.value) {
        await memoryStore?.reset({ kind: 'card', id: resetCard.id })
        memoryState.value = createEmptyMemoryState()
        memoryStatus.value = ''
      }
      sendError.value = ''
      await scrollToBottom()
    } finally {
      resettingSession.value = false
    }
  }
  try { await localWork.track(reset()) } catch {
    sendError.value = '会话重开失败，请返回后重试'
  }
}
</script>

<template>
  <div
    v-if="entryReady && (!hosted || presented)"
    ref="sessionRoot"
    class="inset-0 z-40 flex flex-col pt-[env(safe-area-inset-top)]"
    :class="hosted ? 'absolute' : 'fixed'"
  >
    <SessionBackdrop
      v-if="!hosted"
      :cover="isCardDomain ? cardCover : ''"
      :backdrop="effectiveBackdrop"
    />
    <!-- mp-overlay-header-top: safe-area-aware top (base.css real class — the
         overlay is a fixed child of the app root, so the root's pt-[env] does
         NOT push this abspos header; a bare top-3 tucks it under the status
         bar on edge-to-edge devices). -->
    <ChatSessionHeader
      :is-card-domain="isCardDomain"
      :card-cover="cardCover"
      :title="title"
      :card-tools="cardTools"
      @back="stopStreaming(); closeConversation()"
      @tool="openCardTool"
      @settings="showSessionSettings = true"
      @restart="restartSession"
    />

    <div
      v-if="loadError"
      class="relative z-[2] flex flex-1 items-center justify-center text-sm text-ink-3"
    >
      {{ loadError }}
    </div>

    <template v-else-if="conversation || cardSession">
      <div
        ref="messagesEl"
        class="mp-overlay-flow-top absolute inset-0 z-[2] overflow-y-auto px-4 pb-[calc(112px+env(safe-area-inset-bottom))]"
        @scroll.passive="onMessageScroll"
        @pointerdown.passive="onReaderPointerDown"
        @pointermove.passive="onReaderPointerMove"
        @pointerup.passive="clearReaderPointer"
        @pointercancel.passive="clearReaderPointer"
        @wheel.passive="onReaderWheel"
        @keydown="onReaderKeyDown"
      >
        <button
          v-if="!followingOutput"
          type="button"
          class="fixed bottom-36 right-5 z-10 rounded-full border border-line bg-card px-3 py-2 text-xs text-ink shadow-lg"
          @click="scrollToBottom"
        >
          回到最新
        </button>
        <div class="mx-auto flex max-w-xl flex-col gap-3">
          <ChatFloorList
            ref="floorList"
            :messages="messages"
            :scroll-element="messagesEl"
            :following-output="followingOutput"
            :project="projectFloor"
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
            @viewport-resize="followOutput"
          />
        </div>
      </div>

      <!-- Error bar + composer float over the scrolling floors (theme v3
           content-under-glass): floors slide beneath them. -->
      <div class="absolute inset-x-0 bottom-0 z-10">
        <div
          v-if="sendError"
          class="border-t border-danger/30 bg-danger-wash px-3 py-2"
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
          :send-disabled="!sessionLoaded || !draft.trim() || pendingImagesNotReady"
          @update:draft="draft = $event"
          @update:one-shot-instruction="oneShotInstruction = $event"
          @send="send()"
          @stop="stopStreaming"
          @files="onChatImageSelected"
          @remove-image="removePendingImage"
        />
      </div>
    </template>

    <Transition name="mp-mo-center">
      <ImageViewer
        v-if="viewerImage"
        :src="viewerImage"
        @close="viewerImage = ''"
      />
    </Transition>

    <Transition name="mp-mo-sheet">
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
    </Transition>

    <Transition name="mp-mo-sheet">
      <WorldbookSheet
        v-if="isCardDomain && showWorldbook"
        :entries="worldbookEntries"
        :disabled-uids="worldbookDisabledUids"
        :report="worldbookReport"
        @toggle="toggleWorldbookEntry"
        @close="showWorldbook = false"
      />
    </Transition>

    <Transition name="mp-mo-sheet">
      <RegexSheet
        v-if="isCardDomain && showRegex"
        :scripts="cardRegexScripts"
        :disabled-uids="regexDisabledUids"
        @toggle="toggleRegexScript"
        @close="showRegex = false"
      />
    </Transition>

    <Transition name="mp-mo-sheet">
      <SessionSettingsSheet
        v-if="showSessionSettings"
        :domain="props.domain"
        :conversation="conversation"
        :card-session="cardSession"
        :settings-state="settingsState"
        :card-cover="cardCover"
        @close="closeSessionSettings"
        @saved="onSheetSaved"
        @preview="backdropPreview = $event"
        @reset-bg="onBackdropReset"
      />
    </Transition>
    <Transition name="mp-mo-sheet">
      <StyleSheet
        v-if="isCardDomain && showStyle && cardSession"
        :selection="cardStyle"
        :snapshot="presetSnapshot"
        @save="onStyleSaved"
        @close="showStyle = false"
      />
    </Transition>
    <Transition name="mp-mo-sheet">
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
    </Transition>
  </div>
</template>


