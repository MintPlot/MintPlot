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
import { createExecutableHtmlIframe, setExecutableFrameSlashHandler, startExecutableFrameHost } from '@/kernel/render/html-frame'
import { renderTemplateString, stripTemplateCodeFence } from '@/kernel/render/template-interp'
import type { CardSession } from '@/kernel/sessions/card-session-store'
import type { ChatboxConversation, ChatboxMessage } from '@/kernel/sessions/chatbox-store'
import { uiService } from '@/kernel/ui/toasts'
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
import { replayTemplateStateAtFloor, type VariableSnapshot } from '@/kernel/variables/variable-store'
import {
  applyRegexPipeline,
  isFullHtmlDocument,
  HTML_FLOOR_OMISSION_MARKER,
  projectRegexScripts,
} from '@/kernel/regex/regex-engine'
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
const showVariables = ref(false)
const capsuleOpenId = ref<string | null>(null)
// Secondary-model analysis status (M3-t): surfaced in the variables sheet.
const analysisStatus = ref('')

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
      variableEvents.value,
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
    if (variablesActive.value) {
      // Seed = flat card defaults (mp_variables) + each template's initial
      // tree under its id (M3-r). First touch only; later ensures keep the
      // running ledger.
      const variableSnapshot = await variableStore?.ensure(card.value.id, buildVariableDefaults())
      if (variableSnapshot) {
        variableState.value = variableSnapshot.state
        variableEvents.value = variableSnapshot.events
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
 *  Q1 落库纪律). M3-v: card regexes then rewrite the display projection
 *  (depth always 0 on this surface; promptOnly scripts skip display). */
const renderFloor = (message: ChatboxMessage): string => {
  let content = message.content
  if (isCardDomain.value && variablesActive.value) content = stripVariableBlocks(content)
  if (isCardDomain.value && regexActive.value && cardRegexScripts.value.length > 0) {
    content = applyRegexPipeline(content, {
      scripts: cardRegexScripts.value,
      surface: 'display',
      role: message.role === 'user' ? 'user' : 'assistant',
      depth: 0,
      disabledUids: regexDisabledUids.value,
    })
  }
  return renderMessageHtml(content, macroContext.value, !isStreamingFloor(message))
}

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
      .map((message) => stripVariableBlocks(message.content))
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
  // M3-v: prompt-side omission switch (D7) — a floor that IS a frontend
  // HTML document is replaced by a marker in the request; display keeps the
  // iframe. Default on (the card's lore lives in the worldbook; the markup
  // itself is pure request weight). Off = verbatim floors.
  const promptOmitHtml = isCardDomain.value && regexActive.value
    ? settingsState?.scope(['promptOmitHtmlFloors']).promptOmitHtmlFloors !== false
    : false
  const promptScripts = isCardDomain.value && regexActive.value ? cardRegexScripts.value : []
  const rewritePromptFloor = (content: string, role: 'user' | 'assistant', depth: number): string => {
    let next = isCardDomain.value && variablesActive.value ? stripVariableBlocks(content) : content
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
  if (isCardDomain.value && card.value && greetingFloorMissing(floors, card.value.firstMes)) {
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
    const content = rewritePromptFloor(
      message.content,
      message.role === 'user' ? 'user' : 'assistant',
      floors.length - 1 - index,
    )
    // Macros resolve on the request path too (RP default script runs both
    // sides); the stored history itself stays untouched.
    result.push({ role: message.role, content: expandRequestText(content) })
  }
  // M3-u: at_depth injections splice into the history (depth counts
  // individual messages from the end; never ahead of the system block).
  for (const injection of worldbookAtDepth) {
    const index = Math.max(1, result.length - injection.depth)
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
  for (const event of variableEvents.value) {
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
  variableState.value = snapshot.state
  variableEvents.value = snapshot.events
}

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
    })
    if (snapshot) {
      variableState.value = snapshot.state
      variableEvents.value = snapshot.events
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
  const scope = settingsState.scope(['apiBaseUrl', 'apiKey'])
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
      content: stripVariableBlocks(message.content),
    }))
  const config = {
    baseUrl: String(scope.apiBaseUrl ?? ''),
    apiKey: String(scope.apiKey ?? ''),
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

const send = async (overrideText?: string): Promise<void> => {
  const provider = seams?.resolve<LlmProvider>('llm.provider')?.implementation
  if (!sessionLoaded.value || !provider) return
  // Panel-button triggers (M3-t bridge) pass the command directly; the normal
  // path sends the draft. Both share the streaming guard.
  const text = (typeof overrideText === 'string' ? overrideText : draft.value).trim()
  if (!text || streaming.value) return

  const now = Date.now()
  messages.value.push({ id: `m-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`, role: 'user', content: text, ts: now })
  // Title defaults to the first utterance (spec §03) — chatbox domain only;
  // the card domain keeps the card name.
  if (!isCardDomain.value && conversation.value && conversation.value.title === '新的对话') {
    conversation.value.title = text.slice(0, 24)
  }
  await persistSession()
  if (typeof overrideText !== 'string') draft.value = ''
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
      // M3-q/M3-r: the reply's variable blocks become ledger events
      // (source=ai, floor-attributed) — flat setvars/StatData entries and
      // template-bound ui_template_updates trees alike. Storage failures
      // must never fail the finished floor; malformed blocks were ignored
      // by the parsers.
      let matchedTemplateCount = 0
      try {
        const { updates } = parseVariableUpdates(assistantFloor.content)
        if (updates.length > 0) {
          const snapshot = await variableStore?.apply(card.value.id, updates, { source: 'ai', messageId: assistantFloor.id })
          if (snapshot) {
            variableState.value = snapshot.state
            variableEvents.value = snapshot.events
          }
        }
        const blocks = parseTemplateUpdateBlocks(assistantFloor.content)
        if (blocks.length > 0 && activeTemplates.value.length > 0) {
          const parsed = blocks.flatMap((body) => {
            try {
              return parseTemplateUpdatePayload(body)
            } catch {
              return []
            }
          })
          matchedTemplateCount = await applyMatchedTemplateUpdates(parsed, assistantFloor.id)
        }
      } catch (error) {
        console.error('[variables] failed to record AI-side updates:', error)
      }
      // M3-t: sub-model mode analyzes every reply; main-model mode falls
      // back only when no block was found or none routed to a template.
      if (activeTemplates.value.length > 0) {
        const analysisSettings = readTemplateAnalysisSettings(settingsState)
        if (!analysisSettings.mainModelAnalysis) {
          await runTemplateAnalysisPipeline(assistantFloor)
        } else if (matchedTemplateCount === 0 && analysisSettings.analysisModel) {
          await runTemplateAnalysisPipeline(assistantFloor)
        }
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
  // M3-q/M3-s: 清空重开 resets the ledger to a fresh full seed — flat card
  // defaults AND the template trees (previously only the flat rows were
  // re-seeded and template panels fell back to card initial state).
  if (variablesActive.value) {
    const variableSnapshot = await variableStore?.reset(card.value.id, buildVariableDefaults())
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
                floorUsesHtmlFrame(message) || floorHasPanels(message) ? 'w-full max-w-none' : 'max-w-[85%]',
              ]"
            >
              <!-- eslint-disable vue/no-v-html -- content is macro-replaced, DOMPurify-whitelisted or sandboxed-iframe (M3-n pipeline); panels are replay-interpolated card templates in the same sandbox -->
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
            :disabled="!draft.trim()"
            @click="send()"
          >
            发送
          </button>
        </div>
      </footer>
    </template>

    <VariablesSheet
      v-if="isCardDomain && showVariables && card"
      :card-id="card.id"
      :templates="activeTemplates"
      :analysis-status="analysisStatus"
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
  </div>
</template>

<style scoped>
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
