<script setup lang="ts">
// 全屏聊天页(M3):顶栏(返回/标题) + 消息流 + 输入坞,chatbox 与 card 两域共用
// 同一骨架(M3-i),域由 props.domain 决定 —— chatbox 走会话仓自带 system prompt;
// card 走角色卡库,每次发送现组装提示词(card-prompt,RP 最小式:名字+性格(+对话
// 示例)+末尾 [User Info]),开场白种为首楼、顶栏「清空重开」为卡域专属。发送 =
// 内核 llm.provider seam 流式(可中止);楼层经各自 store 增量持久化
// (chat-persistence 器官);用量回调经注入(usage-stats 写侧,组合根接线)。
import { computed, inject, nextTick, onMounted, onUnmounted, ref, shallowRef } from 'vue'
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
  WORLDBOOK_STORE_KEY,
  REGEX_STORE_KEY,
  PRESET_STORE_KEY,
  MEMORY_STORE_KEY,
} from '@/kernel/app/chat-keys'
import { PLUGIN_RUNTIME_KEY } from '@/kernel/app/runtime-key'
import { useChatAttachments } from '@/kernel/app/chat/use-chat-attachments'
import { closeConversation } from '@/kernel/app/chat-router'
import { buildCardSystemPrompt, greetingFloorMissing } from '@/kernel/characters/card-prompt'
import type { CharacterCard } from '@/kernel/characters/character-card'
import { errorHub } from '@/kernel/diagnostics/error-hub'
import type { LlmChatMessage, LlmContentPart } from '@/kernel/llm/chat-completions'
import { LlmRequestError } from '@/kernel/llm/chat-completions'
import { resolveApiConfig } from '@/kernel/llm/api-profiles'
import { userImageContextText } from '@/kernel/llm/vision'
import type { LlmProvider } from '@/kernel/llm/llm-provider'
// M3-n rich render: floors go through macro substitution + markdown/DOMPurify
// (full HTML documents run in sandboxed executable frames); the lifecycle
// module is a side-effect import (≤3 active frames red line).
import '@/kernel/render/html-frame-lifecycle'
import { replaceCardMacros } from '@/kernel/render/macros'
import { contentUsesHtmlFrame, renderMessageHtml } from '@/kernel/render/message-render'
import { createExecutableHtmlIframe, setExecutableFrameSlashHandler, startExecutableFrameHost } from '@/kernel/render/html-frame'
import { renderTemplateString, stripTemplateCodeFence } from '@/kernel/render/template-interp'
import type { CardSession } from '@/kernel/sessions/card-session-store'
import type { ChatboxConversation, ChatboxMessage } from '@/kernel/sessions/chatbox-store'
import { uiService } from '@/kernel/ui/toasts'
import { copyText } from '@/kernel/app/ui/clipboard'
// M3-q variables: tag-block parsing/ledger on the card domain only — the
// request path expands {{getvar}} + appends the [Variables] section, the
// display path strips blocks into the floor capsule.
import {
  applyTemplateUpdates,
  expandGetvarMacros,
  matchTemplateUpdates,
  parseTemplateUpdateBlocks,
  parseTemplateUpdatePayload,
  parseVariableUpdates,
  readCardVariableDefaults,
  renderTemplateUpdateSection,
  renderVariablesSection,
  stripVariableBlocks,
} from '@/kernel/variables/variable-engine'
import type { ParsedTemplateUpdate } from '@/kernel/variables/variable-engine'
import { replayTemplateStateAtFloor, filterCandidateEvents, eventsBeforeFloor, type VariableSnapshot } from '@/kernel/variables/variable-store'
import { replayVariableState } from '@/kernel/variables/variable-engine'
import {
  applyRegexPipeline,
  isFullHtmlDocument,
  HTML_FLOOR_OMISSION_MARKER,
  projectRegexScripts,
} from '@/kernel/regex/regex-engine'
import type { PresetSnapshot } from '@/kernel/presets/preset-store'
// M4-f CoT layer: tag parsing + native reasoning display; the COT preset
// content syncs into the preset store as a managed entry. Plugin = the toggle.
import { parseCot } from '@/kernel/cot/cot-parser'
import { COT_PRESET_NAME, revertCotPrefillEntries, syncCotPresetEntries } from '@/kernel/cot/cot-preset-sync'
import {
  buildWorldbookInjections,
  projectWorldbook,
  DEFAULT_SCAN_SETTINGS,
} from '@/kernel/worldinfo/worldbook-engine'
import type { WorldbookActivationReport } from '@/kernel/worldinfo/worldbook-engine'
import {
  readTemplateAnalysisSettings,
  renderTemplateStateContext,
  runTemplateAnalysis,
  useBatchAnalysis,
} from '@/kernel/variables/analysis'
import type { AnalysisFloor } from '@/kernel/variables/analysis'
import type { CardUiTemplate } from '@/kernel/characters/character-card'
import VariablesSheet from '@/kernel/variables/VariablesSheet.vue'
import WorldbookSheet from '@/kernel/worldinfo/WorldbookSheet.vue'
import RegexSheet from '@/kernel/regex/RegexSheet.vue'
// M4-e memory layer: rolling-summary engine/ledger/pipeline stay kernel-
// side (red line: kernel never imports plugins); the plugin is the toggle.
import { buildMemoryContext, computePendingBatch, createEmptyMemoryState, pruneFloorsForMemory } from '@/kernel/memory/memory-engine'
import type { MemoryState } from '@/kernel/memory/memory-engine'
import { readMemorySummarySettings, runRollingSummary } from '@/kernel/memory/summary-pipeline'
import type { SummaryFloor } from '@/kernel/memory/summary-pipeline'
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
const lastUserText = ref('')
const messagesEl = ref<HTMLElement | null>(null)
// shallowRef — both are replaced wholesale from snapshots (never mutated in
// place), and Vue's deep UnwrapRef explodes on the recursive VariableValue
// union (TS2589).
const variableState = shallowRef<Record<string, VariableState>>({})
const variableEvents = shallowRef<VariableSnapshot['events']>([])
const variablesActive = ref(true)
// Worldbook layer (M3-u): same gating shape as variables — the plugin toggle
// flips the runtime state; dormant = no scan, no injection, no panel entry.
const worldbookActive = ref(true)
const showWorldbook = ref(false)
const worldbookReport = shallowRef<WorldbookActivationReport | null>(null)
const worldbookDisabledUids = shallowRef<ReadonlySet<number>>(new Set())
// Regex layer (M3-v): same gating shape — dormant = no display rewrite, no
// prompt rewrite, no panel entry. Card scripts ride extensions verbatim.
const regexActive = ref(true)
const showRegex = ref(false)
const regexDisabledUids = shallowRef<ReadonlySet<number>>(new Set())
// Preset layer (M3-w): app-level; dormant = request assembles exactly as
// before this slice. The snapshot is replaced wholesale on changes.
const presetsActive = ref(true)
const presetSnapshot = shallowRef<PresetSnapshot | null>(null)
// Memory layer (M4-e): rolling-summary state rides its reserved key; the
// plugin toggle (sessions:['card']) flips the runtime state - dormant =
// no injection, no pruning, no background summary, ledger data untouched.
const memoryActive = ref(true)
const memoryState = shallowRef<MemoryState | null>(null)
const memoryStatus = ref('')
const memoryBusy = ref(false)
const showMemory = ref(false)
// CoT layer (M4-f): same gating shape — dormant = no thinking card, no COT
// preset sync, no request-side strip (raw tag passthrough). Native reasoning
// still rides the kernel stream capture; it just stays unshown.
const cotActive = ref(true)
// Session settings (M4-g3 parity): session-level system prompt (chatbox) and
// model override (both domains).
const showSessionSettings = ref(false)
const showVariables = ref(false)
const capsuleOpenId = ref<string | null>(null)
// Secondary-model analysis status (M3-t): surfaced in the variables sheet.
const analysisStatus = ref('')
// M4-c floor actions: in-place editor state for one floor at a time.
const editingFloorId = ref('')
const editDraft = ref('')
// M4-d single-shot system instruction: rides one request, then clears.
const oneShotInstruction = ref('')
const showOneShotPanel = ref(false)

// M4-d chat image attachments: pending strip + picker handler + vision
// capability lookups live in the composable (2026-10 cleanup extraction).
const {
  pendingImages,
  pendingImagesNotReady,
  removePendingImage,
  onChatImageSelected,
  imageInputEl,
  viewerImage,
  activeVisionCapable,
} = useChatAttachments({ settingsState, isStreaming: () => streaming.value })

// Candidate-aware ledger projection (M4-c): events tagged with a
// candidateIndex only count toward the floor's ACTIVE candidate — switching
// swipes must not mix sibling candidates' variables. Untagged events
// (legacy, manual, plain floors) always count.
const candidateIndexOf = (messageId: string): number | undefined => {
  const floor = messages.value.find((message) => message.id === messageId)
  return floor?.candidates ? floor.activeIndex ?? 0 : undefined
}
const activeCandidateEvents = computed(() => filterCandidateEvents(variableEvents.value, candidateIndexOf))
const absorbVariableSnapshot = (snapshot: VariableSnapshot): void => {
  variableEvents.value = snapshot.events
  variableState.value = replayVariableState(snapshot.seed, activeCandidateEvents.value)
}

/** Enabled card-embedded templates, highest order first (M3-r). Their state
 *  trees live in the ledger under the template id. */
const activeTemplates = computed<CardUiTemplate[]>(() =>
  variablesActive.value && isCardDomain.value
    ? [...(card.value?.uiTemplates ?? [])].filter((entry) => entry.enabled).sort((a, b) => b.order - a.order)
    : [])

// M3-u worldbook: the projected entry view (verbatim card data → runtime
// list); toggles ride worldbookDisabledUids, never the card record.
const worldbookEntries = computed(() =>
  isCardDomain.value ? projectWorldbook(card.value?.book) : [])

const toggleWorldbookEntry = async (uid: number): Promise<void> => {
  const next = new Set(worldbookDisabledUids.value)
  if (next.has(uid)) next.delete(uid)
  else next.add(uid)
  worldbookDisabledUids.value = next
  if (card.value) await worldbookStore?.setDisabled(card.value.id, next)
}

// M3-v regex: projected card scripts (verbatim extensions data → runtime
// list); toggles ride regexDisabledUids, never the card record.
const cardRegexScripts = computed(() =>
  isCardDomain.value ? projectRegexScripts(card.value?.extensions?.regex_scripts) : [])

const toggleRegexScript = async (uid: number): Promise<void> => {
  const next = new Set(regexDisabledUids.value)
  if (next.has(uid)) next.delete(uid)
  else next.add(uid)
  regexDisabledUids.value = next
  if (card.value) await regexStore?.setDisabled(card.value.id, next)
}

const templateStateOf = (entry: CardUiTemplate): Record<string, unknown> => {
  const value = variableState.value[entry.id]?.value
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : entry.initialVariableState
}

/** Seed rows for a fresh ledger: flat card defaults + each template's initial
 *  tree under its id (M3-r) — shared by mount-time ensure and 清空重开 reset
 *  (M3-s fix: reset previously dropped the template trees). */
const buildVariableDefaults = (): Array<{ name: string; value: VariableState['value'] }> => {
  if (!card.value) return []
  return [
    ...readCardVariableDefaults(card.value.extensions),
    ...activeTemplates.value.map((entry) => ({
      name: entry.id,
      value: JSON.parse(JSON.stringify(entry.initialVariableState)) as VariableState['value'],
    })),
  ]
}

// M3-s 逐楼快照: panel frames render per floor from the ledger — RP stores an
// interpolated snapshot on each message, MP re-derives the state at render
// time (replayTemplateStateAtFloor) so storage stays duplicate-free. Frames
// ride the same sandboxed-iframe pipeline and ≤3-active-frame budget as M3-n
// card documents; the gu-class templates are ~78KB, so interpolation results
// cache by (template, state) and per-floor frames by a ledger/template stamp.
interface PanelFrame {
  id: string
  html: string
}
interface FloorPanels {
  top: PanelFrame[]
  bottom: PanelFrame[]
}
const EMPTY_PANELS: FloorPanels = { top: [], bottom: [] }
const panelFramesCache = new Map<string, { stamp: string; panels: FloorPanels }>()
const panelHtmlCache = new Map<string, string>()

const floorIndexOfMessage = (messageId: string): number =>
  messages.value.findIndex((message) => message.id === messageId)

const renderPanelHtml = (entry: CardUiTemplate, state: Record<string, unknown>): string => {
  const raw = stripTemplateCodeFence(entry.htmlTemplate)
  if (!raw || typeof document === 'undefined') return ''
  const cacheKey = `${entry.id}|${JSON.stringify(state)}`
  const cached = panelHtmlCache.get(cacheKey)
  if (cached !== undefined) return cached
  const container = document.createElement('div')
  container.appendChild(createExecutableHtmlIframe(renderTemplateString(raw, state)))
  const html = container.innerHTML
  if (panelHtmlCache.size >= 32) panelHtmlCache.clear()
  panelHtmlCache.set(cacheKey, html)
  return html
}

const floorPanels = (message: ChatboxMessage): FloorPanels => {
  if (!isCardDomain.value || !variablesActive.value) return EMPTY_PANELS
  if (message.role !== 'assistant' || isStreamingFloor(message)) return EMPTY_PANELS
  if (activeTemplates.value.length === 0) return EMPTY_PANELS
  const targetFloor = messages.value.indexOf(message)
  if (targetFloor < 0) return EMPTY_PANELS
  // The reads below feed Vue's reactivity: ledger/template changes re-render.
  const stamp = `${variableEvents.value.length}|${messages.value.length}|${activeTemplates.value.length}`
  const cached = panelFramesCache.get(message.id)
  if (cached && cached.stamp === stamp) return cached.panels
  const panels: FloorPanels = { top: [], bottom: [] }
  for (const entry of activeTemplates.value) {
    const tree = replayTemplateStateAtFloor(
      activeCandidateEvents.value,
      entry.id,
      entry.initialVariableState as VariableState['value'],
      floorIndexOfMessage,
      targetFloor,
    )
    const state = typeof tree === 'object' && tree !== null && !Array.isArray(tree)
      ? (tree as Record<string, unknown>)
      : entry.initialVariableState
    const html = renderPanelHtml(entry, state)
    if (!html) continue
    const frame: PanelFrame = { id: entry.id, html }
    if (entry.placement === 'top') panels.top.push(frame)
    else panels.bottom.push(frame)
  }
  panelFramesCache.set(message.id, { stamp, panels })
  return panels
}

const floorHasPanels = (message: ChatboxMessage): boolean => {
  const panels = floorPanels(message)
  return panels.top.length > 0 || panels.bottom.length > 0
}

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
    const pluginState = runtime === null ? 'active' : runtime.stateOf('variables')
    variablesActive.value = pluginState === 'active' || pluginState === 'degraded'
    // M3-u: the worldbook layer gates on its own plugin the same way.
    const worldinfoState = runtime === null ? 'active' : runtime.stateOf('worldinfo')
    worldbookActive.value = worldinfoState === 'active' || worldinfoState === 'degraded'
    if (worldbookActive.value) {
      worldbookDisabledUids.value = (await worldbookStore?.getDisabled(card.value.id)) ?? new Set()
    }
    // M3-v: regex layer gates on its own plugin the same way.
    const regexState = runtime === null ? 'active' : runtime.stateOf('regex')
    regexActive.value = regexState === 'active' || regexState === 'degraded'
    if (regexActive.value) {
      regexDisabledUids.value = (await regexStore?.getDisabled(card.value.id)) ?? new Set()
    }
    // M4-e: the memory layer gates on its own plugin the same way.
    const memoryPluginState = runtime === null ? 'active' : runtime.stateOf('memory')
    memoryActive.value = memoryPluginState === 'active' || memoryPluginState === 'degraded'
    if (memoryActive.value) {
      memoryState.value = (await memoryStore?.ensure({ kind: 'card', id: card.value.id })) ?? null
    }
    // M3-w: presets are app-level — gate + load once per view mount.
    const presetState = runtime === null ? 'active' : runtime.stateOf('presets')
    presetsActive.value = presetState === 'active' || presetState === 'degraded'
    if (presetsActive.value) {
      presetSnapshot.value = (await presetStore?.ensure()) ?? null
    }
    // M4-f: the CoT layer gates on its own plugin the same way.
    const cotPluginState = runtime === null ? 'active' : runtime.stateOf('cot')
    cotActive.value = cotPluginState === 'active' || cotPluginState === 'degraded'
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

/** Default open while the floor is streaming, collapsed once finished; a
 *  user toggle persists per floor (RP isSummaryOpen semantics). */
const isCotCardOpen = (message: ChatboxMessage): boolean =>
  message.cotOpen !== undefined ? message.cotOpen : isStreamingFloor(message) && floorThinkingSections(message).length > 0

const cotCardLive = (message: ChatboxMessage): boolean => floorThinkingSections(message).some((section) => section.live)

const toggleCotCard = (message: ChatboxMessage): void => {
  message.cotOpen = !isCotCardOpen(message)
  void persistSession()
}

const renderThinkingText = (text: string): string => renderMessageHtml(text, macroContext.value, true)

/** Request/consumer projection: the reply without its thinking blocks (RP
 *  strips CoT from history before sending). Plugin-off keeps raw passthrough;
 *  the stored floor is never rewritten. */
const stripCotText = (text: string): string => (cotActive.value ? parseCot(text).main : text)

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

const buildRequestMessages = (floorsSource: ChatboxMessage[] = messages.value): LlmChatMessage[] => {
  // M4-e memory layer: with a live summary the request prunes to the last
  // keepFloors floors (request projection only - storage is never touched)
  // and a fixed <role_memory> prefix joins below. The greeting-insurance
  // check keeps reading the UNPRUNED source: it decides on the session's
  // real first floor, pruning must not fake a reseed.
  const memoryBlock = memoryActive.value && isCardDomain.value
    ? buildMemoryContext(memoryState.value ?? createEmptyMemoryState())
    : ''
  const memoryKeep = memoryBlock ? readMemorySummarySettings(settingsState).keepFloors : 0
  const floors = memoryKeep > 0 ? pruneFloorsForMemory(floorsSource, memoryKeep) : floorsSource
  const result: LlmChatMessage[] = []
  // M3-w presets: the active group's entries, split by role. system entries
  // ride the very front of the system prompt; user/assistant entries become
  // standalone prefill messages right after the system block (RP semantics:
  // at-depth injections clamp to never land before them).
  let presetSystemArea = ''
  const presetPrefills: Array<{ role: 'user' | 'assistant'; content: string }> = []
  if (presetsActive.value && presetSnapshot.value) {
    const activeGroup = presetSnapshot.value.groups.find((group) => group.enabled)?.id ?? 'default'
    const activeEntries = presetSnapshot.value.entries.filter(
      (entry) => entry.enabled && entry.content.trim() && entry.group === activeGroup,
      // M4-f: the managed COT entry assembles only while the CoT layer is
      // active — plugin-off means the request goes out WITHOUT the thinking
      // protocol even though the entry survives in the store.
    ).filter((entry) => cotActive.value || entry.name !== COT_PRESET_NAME)
    const systemEntries = activeEntries.filter((entry) => entry.role === 'system')
    if (systemEntries.length > 0) {
      presetSystemArea = systemEntries.map((entry) => `[${entry.name}]\n${entry.content}`).join('\n\n')
    }
    for (const entry of activeEntries) {
      if (entry.role === 'user' || entry.role === 'assistant') {
        presetPrefills.push({ role: entry.role, content: entry.content })
      }
    }
  }
  let systemPrompt = isCardDomain.value && card.value
    ? buildCardSystemPrompt(card.value, readUserInfo())
    : conversation.value?.systemPrompt.trim() ?? ''
  if (presetSystemArea) {
    systemPrompt = `${presetSystemArea}\n\n${systemPrompt}`
  }
  // M3-u worldbook: one artifact per request — activation over the last
  // scanDepth floors, whole-entry budget, seven-position injections. The
  // report feeds the sheet's visibility panel (预算丢弃必须可见).
  let worldbookSystemArea = ''
  const worldbookBeforeChar: string[] = []
  const worldbookAtDepth: Array<{ depth: number; content: string }> = []
  if (isCardDomain.value && worldbookActive.value && card.value?.book) {
    // Settings live in mp_settings (sheet exposes 预算/扫描深度); clamp here.
    const scope = settingsState?.scope(['worldInfoTokenBudget', 'worldInfoScanDepth'])
    const settings = {
      ...DEFAULT_SCAN_SETTINGS,
      tokenBudget: Math.max(0, Math.round(Number(scope?.worldInfoTokenBudget ?? 4000)) || 0),
      scanDepth: Math.min(20, Math.max(1, Math.round(Number(scope?.worldInfoScanDepth ?? 2)) || 2)),
    }
    const scanText = floors
      .filter((message) => message.role !== 'system')
      .slice(-Math.max(1, settings.scanDepth))
      // M4-f: the scan mirrors what the model sees in history — thinking is
      // stripped from the request projection, so it must not trigger entries.
      .map((message) => stripVariableBlocks(stripCotText(message.content)))
      .join('\n')
    const artifact = buildWorldbookInjections({
      book: card.value.book,
      scanText,
      turnSeed: floors.length,
      settings,
      disabledUids: worldbookDisabledUids.value,
    })
    worldbookReport.value = artifact
    const systemArea = artifact.injections.filter(
      (injection) => injection.position === 'system_top' || injection.position === 'global_note',
    )
    // system_top rides the very top; global_note after it, still ahead of the
    // character block (RP prompt order). `global_note` ignores depth (D5).
    if (systemArea.length > 0) {
      worldbookSystemArea = systemArea.map((injection) => injection.content).join('\n\n')
    }
    for (const injection of artifact.injections) {
      if (injection.position === 'before_char') worldbookBeforeChar.push(injection.content)
      else if (injection.position === 'at_depth') worldbookAtDepth.push({ depth: injection.depth, content: injection.content })
    }
  }
  if (worldbookBeforeChar.length > 0) {
    systemPrompt = `${worldbookBeforeChar.join('\n\n')}\n\n${systemPrompt}`
  }
  if (worldbookSystemArea) {
    systemPrompt = `${worldbookSystemArea}\n\n${systemPrompt}`
  }
  // M3-q: the flat variables artifact section rides the system-prompt tail
  // (review Q5 compact line form). The M3-r template update section does NOT
  // ride here anymore — M3-s moves it to the very last message (RP's
  // "[Instructions for next message]" placement: the final instruction wins,
  // a system-prompt tail drowns in long prompts).
  if (isCardDomain.value && variablesActive.value) {
    const templateIds = new Set(activeTemplates.value.map((entry) => entry.id))
    const flatState = Object.fromEntries(
      Object.entries(variableState.value).filter(([name]) => !templateIds.has(name)),
    )
    const variablesSection = renderVariablesSection(flatState)
    if (variablesSection) systemPrompt = systemPrompt ? `${systemPrompt}\n\n${variablesSection}` : variablesSection
    // M3-t sub-model mode: the state snapshot rides the system prompt (read
    // only — the model never writes variables in this mode); the main-model
    // update instruction is NOT appended in this mode.
    const analysisSettings = readTemplateAnalysisSettings(settingsState)
    if (activeTemplates.value.length > 0 && !analysisSettings.mainModelAnalysis && analysisSettings.injectContext) {
      const context = renderTemplateStateContext(
        activeTemplates.value.map((entry) => ({ name: entry.name, state: templateStateOf(entry) })),
      )
      if (context) systemPrompt = systemPrompt ? `${systemPrompt}\n\n${context}` : context
    }
  }
  if (systemPrompt.trim()) {
    result.push({ role: 'system', content: expandRequestText(systemPrompt) })
  }
  // M3-w: message-role presets ride as standalone prefill messages right
  // after the system block, in array order (RP prefill slot). Outside the
  // system-prompt guard — prefills must survive an empty system prompt.
  for (const prefill of presetPrefills) {
    result.push({ role: prefill.role, content: expandRequestText(prefill.content) })
  }
  // M4-e: the memory block rides as a user-role fixed prefix after the
  // preset prefills, before the greeting/history (RP position semantics) -
  // never pruned, never macro-expanded (system-generated content).
  if (memoryBlock) {
    result.push({ role: 'user', content: memoryBlock })
  }
  // M3-v: prompt-side omission switch (D7) — a floor that IS a frontend
  // HTML document is replaced by a marker in the request; display keeps the
  // iframe. Default on (the card's lore lives in the worldbook; the markup
  // itself is pure request weight). Off = verbatim floors.
  const promptOmitHtml = isCardDomain.value && regexActive.value
    ? settingsState?.scope(['promptOmitHtmlFloors']).promptOmitHtmlFloors !== false
    : false
  const promptScripts = isCardDomain.value && regexActive.value ? cardRegexScripts.value : []
  const rewritePromptFloor = (content: string, role: 'user' | 'assistant', depth: number): string => {
    // M4-f: thinking leaves the request projection first (RP strips CoT from
    // history before sending — both domains). Full-HTML floors skip tag
    // surgery; the omission marker below handles them wholesale.
    let next = cotActive.value && !isFullHtmlDocument(content) ? parseCot(content).main : content
    if (isCardDomain.value && variablesActive.value) next = stripVariableBlocks(next)
    if (promptOmitHtml && isFullHtmlDocument(next)) return HTML_FLOOR_OMISSION_MARKER
    if (promptScripts.length > 0) {
      next = applyRegexPipeline(next, {
        scripts: promptScripts,
        surface: 'prompt',
        role,
        depth,
        disabledUids: regexDisabledUids.value,
      })
    }
    return next
  }
  // RP 开场白保险:历史首楼不再是开场白时,请求里补注入(历史本身不改写)。
  if (isCardDomain.value && card.value && greetingFloorMissing(floorsSource, card.value.firstMes)) {
    result.push({ role: 'assistant', content: expandRequestText(rewritePromptFloor(card.value.firstMes, 'assistant', floors.length)) })
  }
  for (let index = 0; index < floors.length; index += 1) {
    const message = floors[index]!
    if (message.role === 'system') continue
    // M3-s: protocol blocks stay out of the model's context too — RP strips
    // them from message content at parse time, and the ecosystem regex
    // convention is display+prompt double-strip. The stored floor keeps them
    // verbatim; this strips the request projection only.
    // M3-v: omission marker / card regexes then rewrite the prompt
    // projection (depth anchored from the end, 0 = last floor).
    let content = rewritePromptFloor(
      message.content,
      message.role === 'user' ? 'user' : 'assistant',
      floors.length - 1 - index,
    )
    // M4-d hybrid vision (D1): the description mode appends the vision-model
    // text as a <user_image_context> block (RP semantics — descriptions ride
    // history permanently); direct mode sends the CURRENT turn's user floor
    // as content parts instead, and older floors degrade to plain text.
    const attachments = message.imageAttachments
    if (attachments?.length) {
      // "Current turn" = the last user floor with no assistant content after
      // it — the streaming pipeline pushes an EMPTY assistant placeholder
      // before assembling the request, so index-vs-length never works here.
      const isCurrentTurn = message.role === 'user'
        && floors.slice(index + 1).every((floor) => floor.role !== 'assistant' || floor.content === '')
      if (isCurrentTurn && activeVisionCapable()) {
        const parts: LlmContentPart[] = [
          { type: 'text', text: expandRequestText(content) },
          ...attachments.map((image) => ({ type: 'image_url' as const, image_url: { url: image.dataUrl, detail: 'high' as const } })),
        ]
        result.push({ role: message.role, content: parts })
        continue
      }
      content = `${content}\n\n${userImageContextText(attachments)}`
    }
    // Macros resolve on the request path too (RP default script runs both
    // sides); the stored history itself stays untouched.
    result.push({ role: message.role, content: expandRequestText(content) })
  }
  // M3-u: at_depth injections splice into the history (depth counts
  // individual messages from the end; never ahead of the system block).
  // M3-w: at-depth injections clamp to never land before the preset prefills
  // (RP safeTargetLimit semantics — the 破限 multi-turn order stays intact).
  const prefillCount = presetPrefills.length
  for (const injection of worldbookAtDepth) {
    const index = Math.max(1 + prefillCount, result.length - injection.depth)
    result.splice(index, 0, { role: 'system', content: injection.content })
  }
  // M3-u: user_top prepends to the last user floor (RP same); assistant_top
  // rides the trailing system-note channel — BEFORE the template instruction,
  // which stays the true last message (final instruction wins).
  let lastUserIndex = -1
  for (let index = result.length - 1; index >= 0; index -= 1) {
    if (result[index]?.role === 'user') {
      lastUserIndex = index
      break
    }
  }
  const userTop = worldbookReport.value?.injections.find((injection) => injection.position === 'user_top')
  if (lastUserIndex >= 0 && userTop) {
    result[lastUserIndex] = { role: 'user', content: `${userTop.content}\n${result[lastUserIndex]!.content}` }
  }
  // M4-d single-shot instruction (D3): rides exactly one request, placed
  // before the trailing instruction blocks (the last system instruction
  // wins — RP placement) but after the worldbook at-depth splices.
  if (oneShotInstruction.value.trim()) {
    result.push({ role: 'system', content: `[单次指令]\n${expandRequestText(oneShotInstruction.value.trim())}` })
  }
  const assistantTop = worldbookReport.value?.injections.find((injection) => injection.position === 'assistant_top')
  if (assistantTop) {
    result.push({ role: 'system', content: `[Instructions for next message]\n${assistantTop.content}` })
  }
  if (isCardDomain.value && variablesActive.value && readTemplateAnalysisSettings(settingsState).mainModelAnalysis) {
    const templateSection = renderTemplateUpdateSection(
      activeTemplates.value.map((entry) => ({
        id: entry.id,
        name: entry.name,
        currentVariables: templateStateOf(entry),
        variableSchema: entry.variableSchema,
      })),
    )
    if (templateSection) {
      result.push({ role: 'system', content: `[Instructions for next message]\n${templateSection}` })
    }
  }
  return result
}

// Floor capsule (review Q6) — LEDGER-DRIVEN (M3-r lesson: counting parsed
// fields lies when the allow-list rejects them). A floor shows what the
// ledger actually recorded for it: flat events as 「名 → 值」, template
// events as one 「面板·名 → 已更新」 line each.
const floorVariableSummary = (message: ChatboxMessage): { flat: Array<{ name: string; value: string }>; templateLines: string[]; total: number } => {
  if (!isCardDomain.value || !variablesActive.value || message.role !== 'assistant') {
    return { flat: [], templateLines: [], total: 0 }
  }
  const templateIds = new Set(activeTemplates.value.map((entry) => entry.id))
  const templateNames = new Map(activeTemplates.value.map((entry) => [entry.id, entry.name] as const))
  const flat: Array<{ name: string; value: string }> = []
  const templateLines: string[] = []
  for (const event of activeCandidateEvents.value) {
    if (event.messageId !== message.id) continue
    if (templateIds.has(event.name)) {
      templateLines.push(`${templateNames.get(event.name) ?? event.name} → 已更新`)
    } else {
      // Not String() — its overload resolution explodes on the recursive
      // VariableValue union (TS2589, same as Array.find).
      const after = event.after
      flat.push({
        name: event.name,
        value: after === null ? '已删除' : typeof after === 'object' ? JSON.stringify(after) : String(after),
      })
    }
  }
  return { flat, templateLines, total: flat.length + templateLines.length }
}

const toggleCapsule = (messageId: string): void => {
  capsuleOpenId.value = capsuleOpenId.value === messageId ? null : messageId
}

const onVariablesChanged = (snapshot: VariableSnapshot): void => {
  absorbVariableSnapshot(snapshot)
}

// Live ledger projection pushed down to VariablesSheet (M4-a): AI-side applies
// land here on every turn, so the open sheet re-renders without close/reopen.
const liveVariableSnapshot = computed<Pick<VariableSnapshot, 'state' | 'events'>>(() => ({
  state: variableState.value,
  events: variableEvents.value,
}))

const persistSession = async (): Promise<void> => {
  if (isCardDomain.value && cardSession.value) await cardSessions?.save(cardSession.value)
  else if (conversation.value) await store?.save(conversation.value)
}

const stopStreaming = (): void => {
  abortController?.abort()
  abortController = null
}

// Shared ledger chain for parsed template-update entries (main-model blocks
// and analysis replies both land here): route → deep-merge → whitelist →
// floor-attributed event. Returns how many templates were matched.
const applyMatchedTemplateUpdates = async (
  parsed: ParsedTemplateUpdate[],
  messageId: string,
  candidateIndex?: number,
): Promise<number> => {
  let matched = 0
  for (const { template, updates: templateUpdates } of matchTemplateUpdates(parsed, activeTemplates.value)) {
    matched += 1
    const result = applyTemplateUpdates(templateStateOf(template), templateUpdates, {
      initial: template.initialVariableState,
      schema: template.variableSchema,
    })
    if (result.rejectedKeys.length > 0) {
      console.warn(`[variables] template "${template.name}" rejected undefined keys:`, result.rejectedKeys)
    }
    if (result.changedKeys.length === 0) continue
    const snapshot = await variableStore?.apply(card.value!.id, [{ name: template.id, raw: result.nextState as VariableState['value'] }], {
      source: 'ai',
      messageId,
      ...(candidateIndex !== undefined ? { candidateIndex } : {}),
    })
    if (snapshot) {
      absorbVariableSnapshot(snapshot)
    }
  }
  return matched
}

// M3-t secondary-model analysis: fallback when the main-model mode produced
// no routable block, mandatory in sub-model mode. Recent floors, the card's
// own schema and a decoupled token budget ride the same OpenAI-compatible
// endpoint; parsing/routing/application reuse the block path above.
const runTemplateAnalysisPipeline = async (targetFloor: ChatboxMessage, force = false): Promise<void> => {
  if (!card.value || !settingsState) return
  const settings = readTemplateAnalysisSettings(settingsState)
  if (!settings.analysisModel) {
    analysisStatus.value = '未配置分析模型'
    return
  }
  // M4-b profiles: resolve the ACTIVE profile - the legacy flat keys read
  // empty in profile mode (latent bug surfaced while wiring M4-e).
  const apiConfig = resolveApiConfig(settingsState.snapshot())
  const analysisTemplates = activeTemplates.value.map((entry) => ({
    id: entry.id,
    name: entry.name,
    currentVariables: templateStateOf(entry),
    variableSchema: entry.variableSchema,
  }))
  const depth = settings.analysisDepth
  const recentFloors: AnalysisFloor[] = messages.value
    .filter((message) => message.role !== 'system' && message.id !== targetFloor.id)
    .slice(-depth)
    .map((message) => ({
      role: message.role as 'user' | 'assistant',
      name: message.role === 'user' ? readUserInfo().name : card.value!.name,
      // M4-f: the analysis reads prose — thinking blocks stay out.
      content: stripVariableBlocks(stripCotText(message.content)),
    }))
  const config = {
    baseUrl: apiConfig.baseUrl,
    apiKey: apiConfig.apiKey,
    model: settings.analysisModel,
    temperature: 0.2,
    maxTokens: settings.maxOutputTokens,
    jsonMode: settings.jsonMode,
  }
  analysisStatus.value = '分析中…'
  try {
    const outcome = await runTemplateAnalysis({
      config,
      templates: analysisTemplates,
      recentFloors,
      userInfo: buildUserInfoLine(),
      batch: useBatchAnalysis(settings, analysisTemplates.length),
      force,
      onUsage: (usage, meta) => {
        if (usage) recordUsage?.(usage, meta)
      },
    })
    let changed = 0
    for (const reply of outcome.replies) {
      try {
        changed += await applyMatchedTemplateUpdates(parseTemplateUpdatePayload(reply.content), targetFloor.id)
      } catch {
        // Malformed analysis JSON is skipped — same tolerance as block path.
      }
    }
    analysisStatus.value = outcome.failedTemplates > 0
      ? `${outcome.failedTemplates} 个失败${outcome.firstError ? `：${outcome.firstError.slice(0, 80)}` : ''}`
      : changed > 0
        ? `更新 ${changed} 项`
        : '无变化'
  } catch (error) {
    analysisStatus.value = `分析失败：${(error as Error)?.message || '未知错误'}`
  }
}

const buildUserInfoLine = (): string => {
  const { name, persona } = readUserInfo()
  return [name ? `用户名字：${name}` : '', persona ? `用户人设：${persona}` : ''].filter(Boolean).join('\n')
}

/** The streaming half of a turn, shared by fresh sends and M4-c floor
 *  regeneration: streams into an existing floor object, attributes usage and
 *  variable events (candidateIndex tags regen candidates), runs the analysis
 *  pipeline. Returns true when a reply fully landed. */
const streamAssistantInto = async (
  floor: ChatboxMessage,
  requestMessages: LlmChatMessage[],
  options: { candidateIndex?: number; isNewFloor?: boolean } = {},
): Promise<boolean> => {
  const provider = seams?.resolve<LlmProvider>('llm.provider')?.implementation
  if (!provider) return false
  const candidateIndex = options.candidateIndex
  streaming.value = true
  // Local alias: stopStreaming() may null the module ref while the stream's
  // rejection is still in flight — the catch must read the live signal.
  const controller = new AbortController()
  abortController = controller
  let succeeded = false
  try {
    const result = await provider.stream(requestMessages, {
      signal: controller.signal,
      // M4-g3 session-level model override (both domains; empty = global).
      model: (isCardDomain.value ? cardSession.value?.model : conversation.value?.model) || undefined,
      onDelta: (delta) => {
        floor.content += delta
        void scrollToBottom()
      },
      // M4-f: native reasoning streams into its own floor field — the wire
      // capture runs regardless of the plugin toggle (data is not recoverable
      // later); the display card is what the toggle gates.
      onReasoningDelta: (delta) => {
        floor.reasoning = (floor.reasoning ?? '') + delta
      },
    })
    // A stream that settles cleanly with zero content (thinking-only local
    // engines, upstream error frames older builds swallowed) is a failure the
    // user must see — never a silent no-op turn (D3 would drop the floor).
    // Reasoning-only replies get their own wording (M4-f): the model spent
    // its budget thinking and never wrote the prose.
    if (!result.content.trim()) {
      throw new LlmRequestError(
        result.reasoning?.trim() ? '模型只输出了思考内容，没有正文' : '模型返回了空回复',
        undefined,
        'MP-CHAT-003',
      )
    }
    floor.content = result.content
    floor.reasoning = result.reasoning ?? ''
    succeeded = true
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
    if (isCardDomain.value && card.value && variablesActive.value && floor.content) {
      // M3-q/M3-r: the reply's variable blocks become ledger events
      // (source=ai, floor-attributed) — flat setvars/StatData entries and
      // template-bound ui_template_updates trees alike. Storage failures
      // must never fail the finished floor; malformed blocks were ignored
      // by the parsers.
      let matchedTemplateCount = 0
      try {
        const { updates } = parseVariableUpdates(floor.content)
        if (updates.length > 0) {
          const snapshot = await variableStore?.apply(card.value.id, updates, {
            source: 'ai',
            messageId: floor.id,
            ...(candidateIndex !== undefined ? { candidateIndex } : {}),
          })
          if (snapshot) {
            absorbVariableSnapshot(snapshot)
          }
        }
        const blocks = parseTemplateUpdateBlocks(floor.content)
        if (blocks.length > 0 && activeTemplates.value.length > 0) {
          const parsed = blocks.flatMap((body) => {
            try {
              return parseTemplateUpdatePayload(body)
            } catch {
              return []
            }
          })
          matchedTemplateCount = await applyMatchedTemplateUpdates(parsed, floor.id, candidateIndex)
        }
      } catch (error) {
        console.error('[variables] failed to record AI-side updates:', error)
      }
      // M3-t: sub-model mode analyzes every reply; main-model mode falls
      // back only when no block was found or none routed to a template.
      if (activeTemplates.value.length > 0) {
        const analysisSettings = readTemplateAnalysisSettings(settingsState)
        if (!analysisSettings.mainModelAnalysis) {
          await runTemplateAnalysisPipeline(floor)
        } else if (matchedTemplateCount === 0 && analysisSettings.analysisModel) {
          await runTemplateAnalysisPipeline(floor)
        }
      }
    }
  } catch (error) {
    if (!controller.signal.aborted) {
      const message = (error as Error)?.message || '未知错误'
      sendError.value = message
      // M3-err1: journal the failure with its unified code (throw-site).
      errorHub.record({
        severity: 'error',
        category: 'chat',
        action: 'request_failed',
        code: (error as LlmRequestError)?.code,
        message,
        context: { domain: props.domain },
      })
    }
  } finally {
    streaming.value = false
    if (abortController === controller) abortController = null
    if (options.isNewFloor && floor.content === '') {
      // Aborted or failed before any token: drop the empty floor. Failed
      // turns leave only the user floor — history stays request-clean (D3).
      const index = messages.value.findIndex((message) => message.id === floor.id)
      if (index >= 0) messages.value.splice(index, 1)
    }
    await persistSession()
    await scrollToBottom()
  }
  return succeeded
}

/** M4-f: COT preset content sync before the request assembles — the managed
 *  'COT' entry and the 破限预注入 · AI prefill rewrites track live state
 *  (model / memory / variable analysis). Idempotent; a failed sync must never
 *  block the send (assembly proceeds with whatever the store holds). When the
 *  layer is dormant, the surviving prefill rewrites revert to seed content
 *  (assembly filters the managed COT entry itself). */
const syncCotPresetsIfActive = async (): Promise<void> => {
  if (!presetStore || !settingsState) return
  try {
    if (!cotActive.value) {
      await revertCotPrefillEntries(presetStore)
      presetSnapshot.value = await presetStore.get()
      return
    }
    await syncCotPresetEntries(presetStore, {
      model: resolveApiConfig(settingsState.snapshot()).model,
      memoryEnabled: isCardDomain.value && memoryActive.value,
      variablesAnalysisEnabled:
        isCardDomain.value
        && variablesActive.value
        && activeTemplates.value.length > 0
        && readTemplateAnalysisSettings(settingsState).mainModelAnalysis,
    })
    presetSnapshot.value = await presetStore.get()
  } catch (error) {
    console.error('[cot] preset sync failed:', error)
  }
}

const runAssistantTurn = async (): Promise<void> => {
  const provider = seams?.resolve<LlmProvider>('llm.provider')?.implementation
  if (!provider) return
  await syncCotPresetsIfActive()
  const assistantFloor: ChatboxMessage = {
    id: `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    role: 'assistant',
    content: '',
    ts: Date.now(),
  }
  messages.value.push(assistantFloor)
  await streamAssistantInto(assistantFloor, buildRequestMessages(), { isNewFloor: true })
  // M4-e: the patrol never blocks the next send - fire, forget, busy-gated.
  void maybeRunMemoryPipeline()
}

const send = async (overrideText?: string): Promise<void> => {
  const provider = seams?.resolve<LlmProvider>('llm.provider')?.implementation
  if (!sessionLoaded.value || !provider) return
  // Panel-button triggers (M3-t bridge) pass the command directly; the normal
  // path sends the draft. Both share the streaming guard + the M4-d image
  // readiness gate (RP same: send waits until every attachment is described).
  const text = (typeof overrideText === 'string' ? overrideText : draft.value).trim()
  if (!text || streaming.value || pendingImagesNotReady.value) return

  const now = Date.now()
  const attachments = pendingImages.value.map(({ dataUrl, description }) => ({ dataUrl, description }))
  const userFloor: ChatboxMessage = {
    id: `m-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    role: 'user',
    content: text,
    ts: now,
    ...(attachments.length > 0 ? { imageAttachments: attachments } : {}),
  }
  messages.value.push(userFloor)
  pendingImages.value = []
  // Title defaults to the first utterance (spec §03) — chatbox domain only;
  // the card domain keeps the card name.
  if (!isCardDomain.value && conversation.value && conversation.value.title === '新的对话') {
    conversation.value.title = text.slice(0, 24)
  }
  await persistSession()
  if (typeof overrideText !== 'string') draft.value = ''
  sendError.value = ''
  lastUserText.value = text
  await scrollToBottom()
  await runAssistantTurn()
  // D3 single-shot: consumed by exactly one send (regeneration excluded).
  oneShotInstruction.value = ''
}

/** Retry re-streams a reply for the persisted user floor (D3 error bar). */
const retryLastSend = async (): Promise<void> => {
  if (streaming.value || !lastUserText.value) return
  sendError.value = ''
  await runAssistantTurn()
}

// ── M4-c floor actions ──────────────────────────────────────────────────────
// Every floor carries a persistent action row (RP-Hub shape, plan D1/D2);
// the LAST assistant floor adds the swipe group and regenerate (D3).

const isLastAssistantFloor = (message: ChatboxMessage): boolean =>
  message.role === 'assistant' && messages.value[messages.value.length - 1]?.id === message.id

/** Regenerate (D3): re-rolls the last assistant floor as an ADDITIONAL
 *  candidate. The ledger's pre-floor state drives the request; the previous
 *  candidate stays switchable, and its untagged events are retagged first so
 *  per-candidate replay stays disjoint. Abort/failure restores the previous
 *  candidate untouched. */
const regenerateLast = async (floor: ChatboxMessage): Promise<void> => {
  if (streaming.value || !isLastAssistantFloor(floor)) return
  const provider = seams?.resolve<LlmProvider>('llm.provider')?.implementation
  if (!provider || !sessionLoaded.value) return
  await syncCotPresetsIfActive()
  if (isCardDomain.value && card.value && variablesActive.value) {
    await variableStore?.retagUntaggedEvents(card.value.id, floor.id, floor.activeIndex ?? 0)
  }
  if (!floor.candidates) {
    floor.candidates = [floor.content]
    floor.activeIndex = 0
  }
  // M4-f: per-candidate reasoning alignment — backfill the previous
  // candidate's slot (first regen on a legacy floor) so switching candidates
  // never shows one candidate's thinking under another's prose.
  if (!floor.candidateReasoning || floor.candidateReasoning.length !== floor.candidates.length) {
    const prev = floor.activeIndex ?? 0
    floor.candidateReasoning = floor.candidates.map((_, index) => (index === prev ? floor.reasoning ?? '' : ''))
  }
  const prevIndex = floor.activeIndex ?? 0
  const prevContent = floor.candidates[prevIndex] ?? floor.content
  const prevReasoning = floor.reasoning ?? ''
  const newIndex = floor.candidates.length
  // The request sees the ledger AS OF before this floor (variables partition,
  // worldbook scan, macros) — the floor itself is being rewritten.
  const snapshot = isCardDomain.value && card.value ? await variableStore?.get(card.value.id) : null
  if (snapshot) {
    const preFloorEvents = eventsBeforeFloor(snapshot.events, floor.id)
    variableEvents.value = preFloorEvents
    variableState.value = replayVariableState(snapshot.seed, filterCandidateEvents(preFloorEvents, candidateIndexOf))
  }
  floor.activeIndex = newIndex
  floor.candidates.push('')
  floor.candidateReasoning!.push('')
  floor.reasoning = ''
  const ok = await streamAssistantInto(
    floor,
    buildRequestMessages(messages.value.slice(0, -1)),
    { candidateIndex: newIndex },
  )
  if (ok) {
    floor.candidates[newIndex] = floor.content
    floor.candidateReasoning![newIndex] = floor.reasoning ?? ''
    floor.activeIndex = newIndex
  } else {
    // Aborted or failed: drop the placeholder candidate, restore the previous.
    floor.candidates.pop()
    floor.candidateReasoning!.pop()
    floor.activeIndex = prevIndex
    floor.content = prevContent
    floor.reasoning = prevReasoning
    const restored = isCardDomain.value && card.value ? await variableStore?.get(card.value.id) : null
    if (restored) absorbVariableSnapshot(restored)
  }
  await persistSession()
}

/** Swipe (D3): switch the displayed candidate; the ledger projection follows
 *  the active candidate (candidate-aware replay). */
const switchCandidate = async (floor: ChatboxMessage, direction: -1 | 1): Promise<void> => {
  if (streaming.value || !floor.candidates?.length) return
  const next = (floor.activeIndex ?? 0) + direction
  if (next < 0 || next >= floor.candidates.length) return
  floor.activeIndex = next
  floor.content = floor.candidates[next] ?? ''
  // M4-f: the thinking card follows the candidate (parallel reasoning slots).
  floor.reasoning = floor.candidateReasoning?.[next] ?? ''
  await persistSession()
  if (isCardDomain.value && card.value && variablesActive.value) {
    const snapshot = await variableStore?.get(card.value.id)
    if (snapshot) absorbVariableSnapshot(snapshot)
  }
}

/** Delete (D4): a floor and EVERYTHING after it leaves the conversation;
 *  their ledger events roll back with them (confirm modal states the count). */
const deleteFloorFrom = async (floor: ChatboxMessage): Promise<void> => {
  if (streaming.value) return
  const index = messages.value.findIndex((message) => message.id === floor.id)
  if (index < 0) return
  const count = messages.value.length - index
  const confirmed = await uiService.confirm('shell', {
    title: '删除楼层',
    message: count > 1 ? `将删除此楼及其后 ${count} 楼,不可恢复。` : '将删除此楼,不可恢复。',
    confirmLabel: '删除',
  })
  if (!confirmed) return
  if (isCardDomain.value && card.value && variablesActive.value) {
    await variableStore?.rollbackFloors(card.value.id, messages.value.slice(index).map((message) => message.id))
  }
  messages.value.splice(index)
  await persistSession()
  if (isCardDomain.value && card.value && variablesActive.value) {
    const snapshot = await variableStore?.get(card.value.id)
    if (snapshot) absorbVariableSnapshot(snapshot)
  }
}

// ── M4-e memory pipeline ───────────────────────────────────────────────────────────
// Fire-and-forget patrol: after a turn fully lands, cover the backlog
// (window = total − keepFloors) in rewrite batches. Busy-gated; failures
// park the anchor and surface in the sheet + diagnostics journal. Deleting
// floors needs no rollback here (D7): the anchor is a COUNT, the window
// recomputes over the remaining floors, done batches never re-run.

const maybeRunMemoryPipeline = async (force = false): Promise<void> => {
  if (!memoryActive.value || !isCardDomain.value || !card.value || !memoryStore || memoryBusy.value) return
  const settings = readMemorySummarySettings(settingsState)
  const state = memoryState.value ?? createEmptyMemoryState()
  if (!force) {
    const pending = computePendingBatch(messages.value.length, settings.keepFloors, settings.batchSize, state)
    if (!pending) return
  }
  const apiConfig = resolveApiConfig(settingsState?.snapshot() ?? {})
  const model = settings.model || apiConfig.model
  if (!apiConfig.baseUrl || !model) {
    memoryStatus.value = '未配置模型,无法整理记忆'
    return
  }
  memoryBusy.value = true
  memoryStatus.value = '整理中…'
  try {
    const floors: SummaryFloor[] = messages.value.map((message) => ({
      role: message.role === 'user' ? 'user' : 'assistant',
      name: message.role === 'user' ? readUserInfo().name : card.value!.name,
      // M4-f: the summary consumes prose — thinking blocks never enter the
      // memory pipeline (RP feeds parseCot().main the same way).
      content: stripVariableBlocks(stripCotText(message.content)),
    }))
    const result = await runRollingSummary({
      config: { baseUrl: apiConfig.baseUrl, apiKey: apiConfig.apiKey, model },
      floors,
      state,
      settings: { keepFloors: settings.keepFloors, batchSize: settings.batchSize, maxOutputTokens: settings.maxOutputTokens },
      onUsage: (usage, meta) => {
        if (usage) recordUsage?.(usage, meta)
      },
    })
    memoryState.value = result.state
    await memoryStore.save({ kind: 'card', id: card.value.id }, result.state)
    if (result.error) {
      memoryStatus.value = `整理失败:${result.error.slice(0, 80)}`
      errorHub.record({
        severity: 'warn',
        category: 'chat',
        action: 'memory_summary_failed',
        message: result.error,
        context: { cardId: card.value.id },
      })
    } else {
      memoryStatus.value = result.batches > 0 ? `已整理 ${result.batches} 批` : '记忆已是最新'
    }
  } catch (error) {
    memoryStatus.value = `整理失败:${(error as Error)?.message || '未知错误'}`
  } finally {
    memoryBusy.value = false
  }
}

const rebuildMemory = async (): Promise<void> => {
  if (!isCardDomain.value || !card.value || !memoryStore) return
  const confirmed = await uiService.confirm('shell', {
    title: '清空重建记忆',
    message: `将删除与「${card.value.name}」的摘要与档案,之后从原文重新整理。楼层本身不受影响。`,
    confirmLabel: '清空重建',
  })
  if (!confirmed) return
  await memoryStore.reset({ kind: 'card', id: card.value.id })
  memoryState.value = createEmptyMemoryState()
  memoryStatus.value = '已清空,整理后重新积累'
}

// In-place editor (plan §2): the bubble becomes a textarea; saving rewrites
// the stored floor (and the active candidate's slot).
const startEditFloor = (floor: ChatboxMessage): void => {
  editingFloorId.value = floor.id
  editDraft.value = floor.content
}
const cancelEditFloor = (): void => {
  editingFloorId.value = ''
  editDraft.value = ''
}
const saveEditFloor = async (): Promise<void> => {
  const floor = messages.value.find((message) => message.id === editingFloorId.value)
  if (!floor) {
    cancelEditFloor()
    return
  }
  floor.content = editDraft.value
  if (floor.candidates && floor.activeIndex !== undefined) {
    floor.candidates[floor.activeIndex] = floor.content
  }
  cancelEditFloor()
  await persistSession()
}

const copyFloor = async (floor: ChatboxMessage): Promise<void> => {
  const succeeded = await copyText(floor.content)
  uiService.toast('shell', succeeded ? '已复制楼层原文' : '复制失败:剪贴板不可用', {
    tone: succeeded ? 'success' : 'error',
  })
}

/** Speak (D5): the kernel emits an intent; the tts plugin toggles reading.
 *  Red line — the view never imports the plugin, the bus carries the request
 *  with the floor text (projection-index free). */
const ttsActive = computed(() => {
  if (!runtime) return true
  const state = runtime.stateOf('tts')
  return state === 'active' || state === 'degraded'
})
const toggleSpeakFloor = (floor: ChatboxMessage): void => {
  if (streaming.value) return
  const floorIndex = messages.value.findIndex((message) => message.id === floor.id)
  runtime?.emit('tts.speak.requested', {
    sessionId: isCardDomain.value ? card.value?.id ?? '' : conversation.value?.id ?? '',
    kind: props.domain,
    messageId: floor.id,
    floorIndex,
    // M4-f (plan D4): read the prose, not the thinking — tag-based CoT strips
    // from the spoken text (native reasoning never lives in content).
    text: stripCotText(floor.content),
  })
}

// M4-g3: the sheet hands over drafts; this side owns the store objects and
// persists through the domain's own store.
const onSessionSettingsSaved = async (draft: { systemPrompt: string; model: string }): Promise<void> => {
  if (isCardDomain.value && cardSession.value) {
    if (draft.model) cardSession.value.model = draft.model
    else delete cardSession.value.model
    await cardSessions?.save(cardSession.value)
  } else if (conversation.value) {
    conversation.value.systemPrompt = draft.systemPrompt
    conversation.value.model = draft.model
    await store?.save(conversation.value)
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
  // M3-q/M3-s: 清空重开 resets the ledger to a fresh full seed — flat card
  // defaults AND the template trees (previously only the flat rows were
  // re-seeded and template panels fell back to card initial state).
  if (variablesActive.value) {
    const variableSnapshot = await variableStore?.reset(card.value.id, buildVariableDefaults())
    if (variableSnapshot) variableState.value = variableSnapshot.state
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
          <p
            v-if="messages.length === 0"
            class="py-12 text-center text-xs text-chat-accent"
          >
            发送第一条消息开始对话
          </p>
          <div
            v-for="(message, floorIndex) in messages"
            :key="message.id"
            class="flex flex-col"
            :class="message.role === 'user' ? 'items-end' : 'items-start'"
          >
            <!-- M4-c in-place editor (plan §2): saving rewrites the stored floor. -->
            <div
              v-if="editingFloorId === message.id"
              class="w-full max-w-[85%] rounded-bubble-ai border border-primary bg-card p-2"
            >
              <textarea
                v-model="editDraft"
                rows="3"
                class="w-full resize-y rounded-input border border-line bg-bg px-2 py-1.5 text-sm leading-relaxed text-ink outline-none focus:border-primary"
              />
              <div class="mt-1 flex justify-end gap-2">
                <button
                  type="button"
                  class="rounded-input border border-line px-2 py-1 text-xs text-ink-2"
                  @click="cancelEditFloor"
                >
                  取消
                </button>
                <button
                  type="button"
                  class="rounded-input bg-primary px-2 py-1 text-xs font-bold text-on-primary"
                  @click="saveEditFloor"
                >
                  保存
                </button>
              </div>
            </div>
            <div
              v-else
              class="break-words rounded-bubble-ai px-3.5 py-2.5 text-sm leading-relaxed"
              :class="[
                message.role === 'user'
                  ? 'rounded-bubble-user bg-chat-bubble-user text-chat-on-bubble-user'
                  : 'border border-line bg-chat-bubble-ai text-chat-on-bubble-ai',
                floorUsesHtmlFrame(message) || floorHasPanels(message) ? 'w-full max-w-none' : 'max-w-[85%]',
              ]"
            >
              <!-- eslint-disable vue/no-v-html -- content is macro-replaced, DOMPurify-whitelisted or sandboxed-iframe (M3-n pipeline); panels are replay-interpolated card templates in the same sandbox -->
              <!-- M4-d attached-image thumbnails (user floors): tap to view. -->
              <div
                v-if="message.imageAttachments?.length"
                class="mb-1 grid gap-1"
                :class="message.imageAttachments.length === 1 ? 'w-40' : 'grid-cols-2'"
              >
                <img
                  v-for="(image, imageIndex) in message.imageAttachments"
                  :key="imageIndex"
                  :src="image.dataUrl"
                  :alt="`附件图片 ${imageIndex + 1}`"
                  class="w-full cursor-zoom-in rounded-input border border-line object-cover"
                  @click="viewerImage = image.dataUrl"
                >
              </div>
              <!-- M4-f thinking card: native reasoning + tag-based CoT in one
                   collapsible card above the prose (RP timeline shape, two
                   sections max). Open while streaming by default; the toggle
                   persists per floor. -->
              <div
                v-if="floorThinkingSections(message).length > 0"
                class="mb-1 overflow-hidden rounded-input border border-line bg-bg"
              >
                <button
                  type="button"
                  class="flex w-full items-center justify-between px-2.5 py-1.5 text-left"
                  :aria-expanded="isCotCardOpen(message)"
                  @click="toggleCotCard(message)"
                >
                  <span
                    class="flex items-center gap-1.5 text-xs font-bold"
                    :class="cotCardLive(message) ? 'text-chat-accent' : 'text-ink-2'"
                  >
                    <span v-if="cotCardLive(message)">⏳</span>
                    <span v-else>💡</span>
                    <span>{{ cotCardLive(message) ? '思考中…' : '思考' }}</span>
                  </span>
                  <span class="text-[10px] text-ink-3">{{ isCotCardOpen(message) ? '收起' : '展开' }}</span>
                </button>
                <div
                  v-if="isCotCardOpen(message)"
                  class="border-t border-line px-2.5 py-2"
                >
                  <div
                    v-for="section in floorThinkingSections(message)"
                    :key="section.id"
                    class="mb-2 last:mb-0"
                  >
                    <div class="mb-1 flex items-center justify-between text-[10px] font-bold text-ink-3">
                      <span>{{ section.title }}</span>
                      <span>{{ section.chars }} 字</span>
                    </div>
                    <div
                      class="markdown-body text-[13px] leading-relaxed text-ink-2"
                      v-html="renderThinkingText(section.text)"
                    />
                  </div>
                </div>
              </div>
              <div
                v-for="frame in floorPanels(message).top"
                :key="`top-${frame.id}`"
                class="mp-panel-frame"
                v-html="frame.html"
              />
              <div
                class="markdown-body"
                v-html="renderFloor(message)"
              />
              <button
                v-if="floorVariableSummary(message).total > 0"
                type="button"
                class="mt-1 inline-flex items-center gap-1 rounded-full border border-line bg-bg px-2 py-0.5 text-[10px] text-ink-2"
                @click="toggleCapsule(message.id)"
              >
                ⚙ 变量 ×{{ floorVariableSummary(message).total }}
              </button>
              <div
                v-if="capsuleOpenId === message.id"
                class="mt-1 rounded-input border border-line bg-bg px-2 py-1 text-[10px] text-ink-2"
              >
                <div
                  v-for="update in floorVariableSummary(message).flat"
                  :key="update.name"
                >
                  {{ update.name }} → {{ update.value }}
                </div>
                <div
                  v-for="line in floorVariableSummary(message).templateLines"
                  :key="line"
                >
                  面板·{{ line }}
                </div>
              </div>
              <div
                v-for="frame in floorPanels(message).bottom"
                :key="`bottom-${frame.id}`"
                class="mp-panel-frame"
                v-html="frame.html"
              />
              <!-- eslint-enable vue/no-v-html -->
              <span
                v-if="isStreamingFloor(message)"
                class="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-ink-3 align-middle"
              />
            </div>
            <!-- M4-c floor action row (RP-Hub shape, plan D1/D2): persistent
                 under every floor; the last assistant floor adds the swipe
                 group and regenerate. Hidden while streaming. -->
            <div
              v-if="!streaming && editingFloorId !== message.id"
              class="mt-0.5 flex items-center gap-0.5"
            >
              <template v-if="isLastAssistantFloor(message)">
                <template v-if="(message.candidates?.length ?? 0) > 1">
                  <button
                    type="button"
                    class="floor-act"
                    :class="{ 'opacity-40': (message.activeIndex ?? 0) <= 0 }"
                    :aria-label="`切换到上一候选(${(message.activeIndex ?? 0) + 1}/${message.candidates?.length})`"
                    @click="switchCandidate(message, -1)"
                  >
                    ‹
                  </button>
                  <span class="font-mono text-[10px] text-ink-3">{{ (message.activeIndex ?? 0) + 1 }}/{{ message.candidates?.length }}</span>
                  <button
                    type="button"
                    class="floor-act"
                    :class="{ 'opacity-40': (message.activeIndex ?? 0) >= (message.candidates?.length ?? 1) - 1 }"
                    :aria-label="`切换到下一候选(${(message.activeIndex ?? 0) + 1}/${message.candidates?.length})`"
                    @click="switchCandidate(message, 1)"
                  >
                    ›
                  </button>
                </template>
                <button
                  type="button"
                  class="floor-act text-primary"
                  aria-label="重新生成(追加候选)"
                  @click="regenerateLast(message)"
                >
                  ⟳
                </button>
              </template>
              <button
                type="button"
                class="floor-act"
                :aria-label="`编辑第 ${floorIndex + 1} 楼`"
                @click="startEditFloor(message)"
              >
                ✎
              </button>
              <button
                type="button"
                class="floor-act"
                :aria-label="`复制第 ${floorIndex + 1} 楼`"
                @click="copyFloor(message)"
              >
                ⧉
              </button>
              <button
                v-if="message.role === 'assistant' && ttsActive"
                type="button"
                class="floor-act"
                :aria-label="`朗读第 ${floorIndex + 1} 楼`"
                @click="toggleSpeakFloor(message)"
              >
                🔊
              </button>
              <button
                type="button"
                class="floor-act text-danger"
                :aria-label="`删除第 ${floorIndex + 1} 楼及其后`"
                @click="deleteFloorFrom(message)"
              >
                🗑
              </button>
            </div>
          </div>
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

      <footer class="shrink-0 border-t border-line bg-card px-3 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-2">
        <!-- M4-d pending attachment strip: thumbnails with per-image status. -->
        <div
          v-if="pendingImages.length > 0"
          class="mx-auto mb-2 flex max-w-xl gap-2 overflow-x-auto pb-1"
        >
          <div
            v-for="image in pendingImages"
            :key="image.id"
            class="relative flex-shrink-0"
          >
            <img
              v-if="image.dataUrl"
              :src="image.dataUrl"
              alt="待发送图片"
              class="h-16 w-16 rounded-input border border-line object-cover"
            >
            <div
              v-else
              class="flex h-16 w-16 items-center justify-center rounded-input border border-line bg-bg text-[10px] text-ink-3"
            >
              读取中
            </div>
            <span
              v-if="image.status === 'analyzing'"
              class="absolute inset-x-0 bottom-0 rounded-b-input bg-black/50 px-1 text-center text-[9px] text-white"
            >
              识别中…
            </span>
            <span
              v-else-if="image.status === 'error'"
              class="absolute inset-x-0 bottom-0 rounded-b-input bg-danger px-1 text-center text-[9px] text-on-primary"
              :title="image.error"
            >
              识别失败
            </span>
            <button
              type="button"
              class="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-bg text-[10px] text-ink-2 shadow"
              :aria-label="`移除待发送图片(${image.status === 'ready' ? image.description.slice(0, 12) : '未就绪'})`"
              @click="removePendingImage(image.id)"
            >
              ✕
            </button>
          </div>
        </div>
        <div class="mx-auto flex max-w-xl items-end gap-2">
          <!-- M4-d attach + single-shot instruction (D2/D3, RP composer left
               controls): direct buttons; the inputActions panel stays reserved. -->
          <div class="relative flex flex-col items-center gap-1">
            <button
              type="button"
              class="flex h-9 w-9 items-center justify-center rounded-full border border-line bg-bg text-base text-ink-2 active:text-primary disabled:opacity-40"
              aria-label="添加图片"
              :disabled="streaming"
              @click="imageInputEl?.click()"
            >
              📎
            </button>
            <input
              ref="imageInputEl"
              type="file"
              accept="image/*"
              multiple
              class="hidden"
              @change="onChatImageSelected"
            >
          </div>
          <div class="relative flex flex-col items-center gap-1">
            <button
              type="button"
              class="flex h-9 w-9 items-center justify-center rounded-full border text-base"
              :class="oneShotInstruction.trim() ? 'border-primary bg-primary-wash text-primary' : 'border-line bg-bg text-ink-2'"
              aria-label="单次指令"
              @click="showOneShotPanel = !showOneShotPanel"
            >
              ⌘
            </button>
            <div
              v-if="showOneShotPanel"
              class="absolute bottom-11 left-0 z-40 w-64 rounded-bubble-ai border border-line bg-card p-2 shadow-lg"
            >
              <p class="mb-1 text-xs font-bold text-ink">
                单次指令
                <span class="ml-1 font-normal text-ink-3">只影响下一次发送</span>
              </p>
              <textarea
                v-model="oneShotInstruction"
                rows="3"
                placeholder="例:这段用更轻快的语气写…"
                class="w-full resize-none rounded-input border border-line bg-bg px-2 py-1.5 text-xs text-ink outline-none focus:border-primary"
              />
              <div class="mt-1 flex justify-end gap-2">
                <button
                  type="button"
                  class="rounded-input border border-line px-2 py-1 text-xs text-ink-2"
                  @click="oneShotInstruction = ''; showOneShotPanel = false"
                >
                  清空
                </button>
                <button
                  type="button"
                  class="rounded-input bg-primary px-2 py-1 text-xs font-bold text-on-primary"
                  @click="showOneShotPanel = false"
                >
                  完成
                </button>
              </div>
            </div>
          </div>
          <textarea
            v-model="draft"
            rows="1"
            placeholder="输入…"
            class="max-h-32 min-h-[44px] flex-1 resize-none rounded-input border border-line bg-bg px-3 py-2.5 text-sm text-ink outline-none focus:border-primary"
            @keydown.enter.exact.prevent="send()"
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
            :disabled="!draft.trim() || pendingImagesNotReady"
            @click="send()"
          >
            发送
          </button>
        </div>
      </footer>
    </template>

    <!-- M4-d image viewer: tap a floor thumbnail to inspect the attachment. -->
    <div
      v-if="viewerImage"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      @click="viewerImage = ''"
    >
      <img
        :src="viewerImage"
        alt="图片查看"
        class="max-h-full max-w-full object-contain"
      >
    </div>

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

<style scoped>
/* M4-c floor action row: 24px+ hit targets, quiet until touched. */
.floor-act {
  min-width: 26px;
  height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  font-size: 12px;
  line-height: 1;
  color: var(--color-ink-3, #93a69d);
}
.floor-act:active {
  background: rgba(23, 168, 139, 0.12);
  color: var(--color-primary, #17a88b);
}

/* M3-s panel frames: full-width slots above/below the floor text; the inner
 * iframe is created via v-html so it needs a deep rule (v-html content is
 * outside scoped-data attributes). */
.mp-panel-frame {
  width: 100%;
  margin-top: 0.5rem;
}
.mp-panel-frame:first-child {
  margin-top: 0;
}
.mp-panel-frame :deep(iframe.executable-html-frame) {
  width: 100%;
  display: block;
  border: 0;
}
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
