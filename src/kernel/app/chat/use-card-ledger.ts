/**
 * Card-domain artifact layers: the variables ledger projection (M3-q/r),
 * per-floor panel frames (M3-s), the floor variable capsule, worldbook and
 * regex toggle state (M3-u/v) and the secondary-model template analysis
 * (M3-t). Extracted from ChatSessionView (2026-10 cleanup) — pure move.
 *
 * The plugin gates stay view-side: onMounted reads the runtime and writes
 * the *Active refs; everything here just follows them. Request assembly
 * (view/request-assembly) consumes the exposed state.
 */
import { computed, ref, shallowRef } from 'vue'
import type { VariableState } from '@contracts'
import type { SettingsState } from '@/kernel/settings/settings-state'
import type { VariableStore, VariableSnapshot } from '@/kernel/variables/variable-store'
import type { WorldbookStore } from '@/kernel/worldinfo/worldbook-store'
import type { RegexStore } from '@/kernel/regex/regex-store'
import { filterCandidateEvents } from '@/kernel/variables/variable-store'
import { createTemplateFloorIndex } from '@/kernel/variables/template-floor-index'
import { limits, LruCache, PANEL_HTML_CACHE_SIZE } from '@/kernel/runtime/runtime-policy'
import {
  applyTemplateUpdates,
  matchTemplateUpdates,
  parseTemplateUpdatePayload,
  readCardVariableDefaults,
  replayVariableState,
  type ParsedTemplateUpdate,
} from '@/kernel/variables/variable-engine'
import { projectRegexScripts } from '@/kernel/regex/regex-engine'
import { renderTemplateString, stripTemplateCodeFence } from '@/kernel/render/template-interp'
import { createExecutableHtmlIframe } from '@/kernel/render/html-frame'
import { projectWorldbook, type WorldbookActivationReport } from '@/kernel/worldinfo/worldbook-engine'
import {
  readTemplateAnalysisSettings,
  runTemplateAnalysis,
  useBatchAnalysis,
  type AnalysisFloor,
} from '@/kernel/variables/analysis'
import { resolveApiConfig } from '@/kernel/llm/api-profiles'
import type { CardUiTemplate, CharacterCard } from '@/kernel/characters/character-card'
import type { ChatboxMessage } from '@/kernel/sessions/chatbox-store'
import type { UsageRecorder } from '@/kernel/app/chat-keys'

export interface CardLedgerOptions {
  settingsState: SettingsState | null
  variableStore: VariableStore | null
  worldbookStore: WorldbookStore | null
  regexStore: RegexStore | null
  recordUsage: UsageRecorder | null
  isCardDomain: () => boolean
  card: () => CharacterCard | null
  messages: () => ChatboxMessage[]
  isStreamingFloor: (message: ChatboxMessage) => boolean
  /** Prose projection (thinking + variable blocks out) for analysis reads. */
  toProse: (text: string) => string
  userName: () => string
  userInfoLine: () => string
}

export function useCardLedger(options: CardLedgerOptions) {
  const {
    settingsState, variableStore, worldbookStore, regexStore, recordUsage,
    isCardDomain, card, messages, isStreamingFloor, toProse, userName, userInfoLine,
  } = options

  // shallowRef — both are replaced wholesale from snapshots (never mutated in
  // place), and Vue's deep UnwrapRef explodes on the recursive VariableValue
  // union (TS2589).
  const variableState = shallowRef<Record<string, VariableState>>({})
  const variableEvents = shallowRef<VariableSnapshot['events']>([])
  const variablesActive = ref(true)
  // Worldbook layer (M3-u): the plugin toggle flips the view-side gate;
  // dormant = no scan, no injection, no panel entry.
  const worldbookActive = ref(true)
  const worldbookReport = shallowRef<WorldbookActivationReport | null>(null)
  const worldbookDisabledUids = shallowRef<ReadonlySet<number>>(new Set())
  // Regex layer (M3-v): same gating shape — dormant = no display rewrite, no
  // prompt rewrite, no panel entry. Card scripts ride extensions verbatim.
  const regexActive = ref(true)
  const regexDisabledUids = shallowRef<ReadonlySet<number>>(new Set())
  // Floor capsule open state + secondary-model analysis status (M3-t).
  const capsuleOpenId = ref<string | null>(null)
  const analysisStatus = ref('')

  // Candidate-aware ledger projection (M4-c): events tagged with a
  // candidateIndex only count toward the floor's ACTIVE candidate — switching
  // swipes must not mix sibling candidates' variables. Untagged events
  // (legacy, manual, plain floors) always count.
  // Only ids/array membership are dependencies here; live prose does not
  // rebuild the index. Candidate reads below still track swipe changes.
  const messageIndex = computed(() => new Map(messages().map((message, index) => [message.id, { message, index }])))
  const candidateIndexOf = (messageId: string): number | undefined => {
    const floor = messageIndex.value.get(messageId)?.message
    return floor?.candidates ? floor.activeIndex ?? 0 : undefined
  }
  const activeCandidateEvents = computed(() => filterCandidateEvents(variableEvents.value, candidateIndexOf))
  const floorIndexOfMessage = (messageId: string): number => messageIndex.value.get(messageId)?.index ?? -1
  const templateFloorIndex = computed(() => createTemplateFloorIndex(activeCandidateEvents.value, floorIndexOfMessage))
  const eventsByMessage = computed(() => {
    const groups = new Map<string, Array<VariableSnapshot['events'][number]>>()
    for (const event of activeCandidateEvents.value) {
      if (!event.messageId) continue
      let group = groups.get(event.messageId)
      if (!group) groups.set(event.messageId, group = [])
      group.push(event)
    }
    return groups
  })
  const absorbVariableSnapshot = (snapshot: VariableSnapshot): void => {
    variableEvents.value = snapshot.events
    variableState.value = replayVariableState(snapshot.seed, activeCandidateEvents.value)
  }

  /** Enabled card-embedded templates, highest order first (M3-r). Their state
   *  trees live in the ledger under the template id. */
  const activeTemplates = computed<CardUiTemplate[]>(() =>
    variablesActive.value && isCardDomain()
      ? [...(card()?.uiTemplates ?? [])].filter((entry) => entry.enabled).sort((a, b) => b.order - a.order)
      : [])
  const templateNames = computed(() => new Map(activeTemplates.value.map(entry => [entry.id, entry.name])))

  // M3-u worldbook: the projected entry view (verbatim card data → runtime
  // list); toggles ride worldbookDisabledUids, never the card record.
  const worldbookEntries = computed(() =>
    isCardDomain() ? projectWorldbook(card()?.book) : [])

  // M3-v regex: projected card scripts (verbatim extensions data → runtime
  // list); toggles ride regexDisabledUids, never the card record.
  const cardRegexScripts = computed(() =>
    isCardDomain() ? projectRegexScripts(card()?.extensions?.regex_scripts) : [])

  /** C10: the two per-uid toggle stores (worldbook/regex) shared one
   *  copy-mutate-toggle shape; this is that shape, once. */
  const toggleUid = (uids: ReadonlySet<number>, uid: number): Set<number> => {
    const next = new Set(uids)
    if (next.has(uid)) next.delete(uid)
    else next.add(uid)
    return next
  }

  const toggleWorldbookEntry = async (uid: number): Promise<void> => {
    worldbookDisabledUids.value = toggleUid(worldbookDisabledUids.value, uid)
    if (card()) await worldbookStore?.setDisabled(card()!.id, worldbookDisabledUids.value)
  }

  const toggleRegexScript = async (uid: number): Promise<void> => {
    regexDisabledUids.value = toggleUid(regexDisabledUids.value, uid)
    if (card()) await regexStore?.setDisabled(card()!.id, regexDisabledUids.value)
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
    if (!card()) return []
    return [
      ...readCardVariableDefaults(card()!.extensions),
      ...activeTemplates.value.map((entry) => ({
        name: entry.id,
        value: JSON.parse(JSON.stringify(entry.initialVariableState)) as VariableState['value'],
      })),
    ]
  }

  // Historical panels query a derived ledger index. The floor cache uses the
  // existing view-window budget, preventing a visible multi-template pass
  // from thrashing the smaller 32-entry HTML LRU. Neither cache grows with
  // history. Actual template/state inputs invalidate equal-count changes.
  interface PanelFrame {
    id: string
    html: string
  }
  interface FloorPanels {
    top: PanelFrame[]
    bottom: PanelFrame[]
  }
  const EMPTY_PANELS: FloorPanels = { top: [], bottom: [] }
  const panelHtmlCache = new LruCache<string, string>(PANEL_HTML_CACHE_SIZE)
  interface PanelInput {
    id: string
    placement: string
    source: string
    stateKey: string
  }
  const panelFramesCache = new LruCache<string, { inputs: PanelInput[]; panels: FloorPanels }>(limits.chatMaximum)

  const renderPanelHtml = (entry: CardUiTemplate, state: Record<string, unknown>): string => {
    const raw = stripTemplateCodeFence(entry.htmlTemplate)
    if (!raw || typeof document === 'undefined') return ''
    const cacheKey = JSON.stringify([entry.id, raw, state])
    const cached = panelHtmlCache.get(cacheKey)
    if (cached !== undefined) return cached
    const container = document.createElement('div')
    container.appendChild(createExecutableHtmlIframe(renderTemplateString(raw, state)))
    const html = container.innerHTML
    panelHtmlCache.set(cacheKey, html)
    return html
  }

  const floorPanels = (message: ChatboxMessage): FloorPanels => {
    if (!isCardDomain() || !variablesActive.value) return EMPTY_PANELS
    if (message.role !== 'assistant' || isStreamingFloor(message)) return EMPTY_PANELS
    if (activeTemplates.value.length === 0) return EMPTY_PANELS
    const targetFloor = floorIndexOfMessage(message.id)
    if (targetFloor < 0) return EMPTY_PANELS
    const projections = activeTemplates.value.map(entry => {
      const tree = templateFloorIndex.value.at(entry.id, targetFloor) ?? entry.initialVariableState
      const state = typeof tree === 'object' && tree !== null && !Array.isArray(tree)
        ? (tree as Record<string, unknown>)
        : entry.initialVariableState
      const input: PanelInput = { id: entry.id, placement: entry.placement, source: entry.htmlTemplate, stateKey: JSON.stringify(state) }
      return { entry, state, input }
    })
    const cached = panelFramesCache.get(message.id)
    if (cached && cached.inputs.length === projections.length && projections.every(({ input }, i) => {
      const prior = cached.inputs[i]!
      return input.id === prior.id && input.placement === prior.placement && input.source === prior.source && input.stateKey === prior.stateKey
    })) return cached.panels
    const panels: FloorPanels = { top: [], bottom: [] }
    for (const { entry, state } of projections) {
      const html = renderPanelHtml(entry, state)
      if (!html) continue
      const frame: PanelFrame = { id: entry.id, html }
      if (entry.placement === 'top') panels.top.push(frame)
      else panels.bottom.push(frame)
    }
    panelFramesCache.set(message.id, { inputs: projections.map(projection => projection.input), panels })
    return panels
  }

  const floorHasPanels = (message: ChatboxMessage): boolean => {
    const panels = floorPanels(message)
    return panels.top.length > 0 || panels.bottom.length > 0
  }

  // Floor capsule (review Q6) — LEDGER-DRIVEN (M3-r lesson: counting parsed
  // fields lies when the allow-list rejects them). A floor shows what the
  // ledger actually recorded for it: flat events as 「名 → 值」, template
  // events as one 「面板·名 → 已更新」 line each.
  const floorVariableSummary = (message: ChatboxMessage): { flat: Array<{ name: string; value: string }>; templateLines: string[]; total: number } => {
    if (!isCardDomain() || !variablesActive.value || message.role !== 'assistant') {
      return { flat: [], templateLines: [], total: 0 }
    }
    const flat: Array<{ name: string; value: string }> = []
    const templateLines: string[] = []
    for (const event of eventsByMessage.value.get(message.id) ?? []) {
      if (templateNames.value.has(event.name)) {
        templateLines.push(`${templateNames.value.get(event.name) ?? event.name} → 已更新`)
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
      const snapshot = await variableStore?.apply(card()!.id, [{ name: template.id, raw: result.nextState as VariableState['value'] }], {
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
    if (!card() || !settingsState) return
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
    const recentFloors: AnalysisFloor[] = messages()
      .filter((message) => message.role !== 'system' && message.id !== targetFloor.id)
      .slice(-depth)
      .map((message) => ({
        role: message.role as 'user' | 'assistant',
        name: message.role === 'user' ? userName() : card()!.name,
        // M4-f: the analysis reads prose — thinking blocks stay out.
        content: toProse(message.content),
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
        userInfo: userInfoLine(),
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

  return {
    variableState,
    variableEvents,
    variablesActive,
    worldbookActive,
    worldbookReport,
    worldbookDisabledUids,
    regexActive,
    regexDisabledUids,
    capsuleOpenId,
    analysisStatus,
    candidateIndexOf,
    activeCandidateEvents,
    absorbVariableSnapshot,
    activeTemplates,
    worldbookEntries,
    toggleWorldbookEntry,
    cardRegexScripts,
    toggleRegexScript,
    templateStateOf,
    buildVariableDefaults,
    floorIndexOfMessage,
    floorPanels,
    floorHasPanels,
    floorVariableSummary,
    toggleCapsule,
    onVariablesChanged,
    liveVariableSnapshot,
    applyMatchedTemplateUpdates,
    runTemplateAnalysisPipeline,
  }
}
