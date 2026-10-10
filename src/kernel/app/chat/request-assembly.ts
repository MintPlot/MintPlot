/**
 * Request assembly: the full prompt pipeline for one assistant turn —
 * memory prune + <role_memory>, preset split, card system prompt, worldbook
 * activation (seven positions), variables section, greeting insurance,
 * prompt-side regex/CoT/omission rewriting, hybrid-vision parts, macro
 * expansion and the trailing instruction blocks. Extracted from
 * ChatSessionView (2026-10 cleanup) as a factory over injected getters.
 *
 * Two cleanup items landed with the move: the worldbook scan-settings
 * fallbacks now read DEFAULT_SCAN_SETTINGS instead of restated literals
 * (C4), and the strip-then-prose chain lives here once as proseOf (C9) —
 * the memory and ledger pipelines receive it as their toProse.
 */
import type { VariableState } from '@contracts'
import type { SettingsState } from '@/kernel/settings/settings-state'
import type { PresetStore, PresetSnapshot } from '@/kernel/presets/preset-store'
import { COT_PRESET_NAME, revertCotPrefillEntries, syncCotPresetEntries } from '@/kernel/cot/cot-preset-sync'
import { parseCot } from '@/kernel/cot/cot-parser'
import { buildCardSystemPrompt, greetingFloorMissing } from '@/kernel/characters/card-prompt'
import type { CardUiTemplate, CharacterCard } from '@/kernel/characters/character-card'
import type { ChatboxConversation, ChatboxMessage } from '@/kernel/sessions/chatbox-store'
import { replaceCardMacros } from '@/kernel/render/macros'
import {
  applyRegexPipeline,
  isFullHtmlDocument,
  HTML_FLOOR_OMISSION_MARKER,
  type RegexScript,
} from '@/kernel/regex/regex-engine'
import {
  buildWorldbookInjections,
  DEFAULT_SCAN_SETTINGS,
  type WorldbookActivationReport,
} from '@/kernel/worldinfo/worldbook-engine'
import {
  expandGetvarMacros,
  renderTemplateUpdateSection,
  renderVariablesSection,
  stripVariableBlocks,
} from '@/kernel/variables/variable-engine'
import { renderTemplateStateContext, readTemplateAnalysisSettings } from '@/kernel/variables/analysis'
import {
  buildStoryPromptBlock,
  parseStoryStages,
  DEFAULT_STORY_PRINCIPLES,
  DEFAULT_STORY_STAGES,
  STORY_STAGE_VARIABLE,
} from '@/kernel/app/story-prompt'
import { buildMemoryContext, createEmptyMemoryState, pruneFloorsForMemory, type MemoryState } from '@/kernel/memory/memory-engine'
import { readMemorySummarySettings } from '@/kernel/memory/summary-pipeline'
import type { LlmChatMessage, LlmContentPart } from '@/kernel/llm/chat-completions'
import { userImageContextText } from '@/kernel/llm/vision'
import { resolveApiConfig } from '@/kernel/llm/api-profiles'

export interface RequestAssemblerDeps {
  settingsState: SettingsState | null
  presetStore: PresetStore | null
  isCardDomain: () => boolean
  card: () => CharacterCard | null
  conversation: () => ChatboxConversation | null
  messages: () => ChatboxMessage[]
  memoryActive: () => boolean
  memoryState: () => MemoryState | null
  presetsActive: () => boolean
  presetSnapshot: () => PresetSnapshot | null
  /** syncCotPresetEntries rewrites the store; the view's snapshot ref follows. */
  setPresetSnapshot: (snapshot: PresetSnapshot) => void
  cotActive: () => boolean
  /** 故事引擎(M4-e):叙事原则两域通用;阶段系统仅在卡域 + 变量层激活时注入。 */
  storyActive: () => boolean
  variablesActive: () => boolean
  variableState: () => Record<string, VariableState>
  activeTemplates: () => CardUiTemplate[]
  templateStateOf: (entry: CardUiTemplate) => Record<string, unknown>
  worldbookActive: () => boolean
  worldbookDisabledUids: () => ReadonlySet<number>
  regexActive: () => boolean
  /** The activation report rides out through here (sheet visibility panel). */
  onWorldbookArtifact: (artifact: WorldbookActivationReport) => void
  cardRegexScripts: () => RegexScript[]
  regexDisabledUids: () => ReadonlySet<number>
  activeVisionCapable: () => boolean
  oneShotInstruction: () => string
  readUserInfo: () => { name: string; persona: string }
  macroContext: () => { charName: string; userName: string }
}

export function createRequestAssembler(deps: RequestAssemblerDeps) {
  /** Request/consumer projection: the reply without its thinking blocks (RP
   * strips CoT from history before sending). Plugin-off keeps raw
   * passthrough; the stored floor is never rewritten. */
  const stripCotText = (text: string): string => (deps.cotActive() ? parseCot(text).main : text)

  /** C9: the shared prose chain — thinking out, then variable tag blocks.
   * The memory and ledger pipelines take this as their toProse. */
  const proseOf = (text: string): string => stripVariableBlocks(stripCotText(text))

  // M3-q request-side expansion chain (card domain): {{getvar}} → char/user
  // macros. The chatbox domain keeps the M3-n macro pass only — variables
  // never enter it (review Q4), so {{getvar}} stays literal there. The plugin
  // toggle (M3-q2) puts the whole variable layer to sleep.
  const expandRequestText = (text: string): string => {
    const withVariables = deps.isCardDomain() && deps.variablesActive()
      ? expandGetvarMacros(text, (name) => deps.variableState()[name]?.value)
      : text
    return replaceCardMacros(withVariables, deps.macroContext())
  }

  const buildRequestMessages = (floorsSource: ChatboxMessage[] = deps.messages()): LlmChatMessage[] => {
    // M4-e memory layer: with a live summary the request prunes to the last
    // keepFloors floors (request projection only - storage is never touched)
    // and a fixed <role_memory> prefix joins below. The greeting-insurance
    // check keeps reading the UNPRUNED source: it decides on the session's
    // real first floor, pruning must not fake a reseed.
    const memoryBlock = deps.memoryActive() && deps.isCardDomain()
      ? buildMemoryContext(deps.memoryState() ?? createEmptyMemoryState())
      : ''
    const memoryKeep = memoryBlock ? readMemorySummarySettings(deps.settingsState).keepFloors : 0
    const floors = memoryKeep > 0 ? pruneFloorsForMemory(floorsSource, memoryKeep) : floorsSource
    const result: LlmChatMessage[] = []
    // M3-w presets: the active group's entries, split by role. system entries
    // ride the very front of the system prompt; user/assistant entries become
    // standalone prefill messages right after the system block (RP semantics:
    // at-depth injections clamp to never land before them).
    let presetSystemArea = ''
    const presetPrefills: Array<{ role: 'user' | 'assistant'; content: string }> = []
    if (deps.presetsActive() && deps.presetSnapshot()) {
      const snapshot = deps.presetSnapshot()!
      const activeGroup = snapshot.groups.find((group) => group.enabled)?.id ?? 'default'
      const activeEntries = snapshot.entries.filter(
        (entry) => entry.enabled && entry.content.trim() && entry.group === activeGroup,
        // M4-f: the managed COT entry assembles only while the CoT layer is
        // active — plugin-off means the request goes out WITHOUT the thinking
        // protocol even though the entry survives in the store.
      ).filter((entry) => deps.cotActive() || entry.name !== COT_PRESET_NAME)
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
    let systemPrompt = deps.isCardDomain() && deps.card()
      ? buildCardSystemPrompt(deps.card()!, deps.readUserInfo())
      : deps.conversation()?.systemPrompt.trim() ?? ''
    if (presetSystemArea) {
      systemPrompt = `${presetSystemArea}\n\n${systemPrompt}`
    }
    // M3-u worldbook: one artifact per request — activation over the last
    // scanDepth floors, whole-entry budget, seven-position injections. The
    // report rides out through the dep for the sheet's visibility panel
    // (预算丢弃必须可见).
    let worldbookSystemArea = ''
    const worldbookBeforeChar: string[] = []
    const worldbookAtDepth: Array<{ depth: number; content: string }> = []
    let worldbookArtifact: WorldbookActivationReport | null = null
    if (deps.isCardDomain() && deps.worldbookActive() && deps.card()?.book) {
      // Settings live in mp_settings (sheet exposes 预算/扫描深度); clamp here.
      // C4: fallbacks read DEFAULT_SCAN_SETTINGS — the literals used to be
      // restated here and could drift from the engine's defaults.
      const scope = deps.settingsState?.scope(['worldInfoTokenBudget', 'worldInfoScanDepth'])
      const settings = {
        ...DEFAULT_SCAN_SETTINGS,
        tokenBudget: Math.max(0, Math.round(Number(scope?.worldInfoTokenBudget ?? DEFAULT_SCAN_SETTINGS.tokenBudget)) || 0),
        scanDepth: Math.min(20, Math.max(1, Math.round(Number(scope?.worldInfoScanDepth ?? DEFAULT_SCAN_SETTINGS.scanDepth)) || DEFAULT_SCAN_SETTINGS.scanDepth)),
      }
      const scanText = floors
        .filter((message) => message.role !== 'system')
        .slice(-Math.max(1, settings.scanDepth))
        // M4-f: the scan mirrors what the model sees in history — thinking is
        // stripped from the request projection, so it must not trigger entries.
        .map((message) => proseOf(message.content))
        .join('\n')
      const artifact = buildWorldbookInjections({
        book: deps.card()!.book,
        scanText,
        turnSeed: floors.length,
        settings,
        disabledUids: deps.worldbookDisabledUids(),
      })
      worldbookArtifact = artifact
      deps.onWorldbookArtifact(artifact)
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
    if (deps.isCardDomain() && deps.variablesActive()) {
      const templateIds = new Set(deps.activeTemplates().map((entry) => entry.id))
      const flatState = Object.fromEntries(
        Object.entries(deps.variableState()).filter(([name]) => !templateIds.has(name)),
      )
      const variablesSection = renderVariablesSection(flatState)
      if (variablesSection) systemPrompt = systemPrompt ? `${systemPrompt}\n\n${variablesSection}` : variablesSection
      // M3-t sub-model mode: the state snapshot rides the system prompt (read
      // only — the model never writes variables in this mode); the main-model
      // update instruction is NOT appended in this mode.
      const analysisSettings = readTemplateAnalysisSettings(deps.settingsState)
      if (deps.activeTemplates().length > 0 && !analysisSettings.mainModelAnalysis && analysisSettings.injectContext) {
        const context = renderTemplateStateContext(
          deps.activeTemplates().map((entry) => ({ name: entry.name, state: deps.templateStateOf(entry) })),
        )
        if (context) systemPrompt = systemPrompt ? `${systemPrompt}\n\n${context}` : context
      }
    }
    // M4-e 故事引擎:叙事原则 + 关系阶段表注入(系统提示尾部,变量区之后)。
    // 阶段系统仅卡域 + 变量层激活(需要 setvars 解析落账);当前阶段读账本
    // 的 story.stage 变量,记账指令引用同一名字,下一轮自动生效。与模板 id
    // 同名时阶段系统让位;清空的阶段表('[]')= 有意关闭。
    if (deps.storyActive()) {
      const storyScope = deps.settingsState?.scope(['storyPrinciples', 'storyStages', 'storyBookkeeping'])
      const stageSystemOn = deps.isCardDomain()
        && deps.variablesActive()
        && !deps.activeTemplates().some((entry) => entry.id === STORY_STAGE_VARIABLE)
      let stages = stageSystemOn ? parseStoryStages(storyScope?.storyStages) : []
      if (stageSystemOn && storyScope?.storyStages === undefined) stages = [...DEFAULT_STORY_STAGES]
      const stageRaw = stageSystemOn ? deps.variableState()[STORY_STAGE_VARIABLE]?.value : undefined
      const currentStage = typeof stageRaw === 'string' ? stageRaw.trim() : ''
      const block = buildStoryPromptBlock(
        {
          principles: storyScope?.storyPrinciples === undefined ? DEFAULT_STORY_PRINCIPLES : String(storyScope.storyPrinciples),
          stages,
          bookkeeping: stageSystemOn && storyScope?.storyBookkeeping !== false,
        },
        currentStage,
      )
      if (block) systemPrompt = systemPrompt ? `${systemPrompt}\n\n${block}` : block
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
    const promptOmitHtml = deps.isCardDomain() && deps.regexActive()
      ? deps.settingsState?.scope(['promptOmitHtmlFloors']).promptOmitHtmlFloors !== false
      : false
    const promptScripts = deps.isCardDomain() && deps.regexActive() ? deps.cardRegexScripts() : []
    const rewritePromptFloor = (content: string, role: 'user' | 'assistant', depth: number): string => {
      // M4-f: thinking leaves the request projection first (RP strips CoT from
      // history before sending — both domains). Full-HTML floors skip tag
      // surgery; the omission marker below handles them wholesale.
      let next = deps.cotActive() && !isFullHtmlDocument(content) ? parseCot(content).main : content
      if (deps.isCardDomain() && deps.variablesActive()) next = stripVariableBlocks(next)
      if (promptOmitHtml && isFullHtmlDocument(next)) return HTML_FLOOR_OMISSION_MARKER
      if (promptScripts.length > 0) {
        next = applyRegexPipeline(next, {
          scripts: promptScripts,
          surface: 'prompt',
          role,
          depth,
          disabledUids: deps.regexDisabledUids(),
        })
      }
      return next
    }
    // RP 开场白保险:历史首楼不再是开场白时,请求里补注入(历史本身不改写)。
    if (deps.isCardDomain() && deps.card() && greetingFloorMissing(floorsSource, deps.card()!.firstMes)) {
      result.push({ role: 'assistant', content: expandRequestText(rewritePromptFloor(deps.card()!.firstMes, 'assistant', floors.length)) })
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
        if (isCurrentTurn && deps.activeVisionCapable()) {
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
    const userTop = worldbookArtifact?.injections.find((injection) => injection.position === 'user_top')
    if (lastUserIndex >= 0 && userTop) {
      result[lastUserIndex] = { role: 'user', content: `${userTop.content}\n${result[lastUserIndex]!.content}` }
    }
    // M4-d single-shot instruction (D3): rides exactly one request, placed
    // before the trailing instruction blocks (the last system instruction
    // wins — RP placement) but after the worldbook at-depth splices.
    if (deps.oneShotInstruction().trim()) {
      result.push({ role: 'system', content: `[单次指令]\n${expandRequestText(deps.oneShotInstruction().trim())}` })
    }
    const assistantTop = worldbookArtifact?.injections.find((injection) => injection.position === 'assistant_top')
    if (assistantTop) {
      result.push({ role: 'system', content: `[Instructions for next message]\n${assistantTop.content}` })
    }
    if (deps.isCardDomain() && deps.variablesActive() && readTemplateAnalysisSettings(deps.settingsState).mainModelAnalysis) {
      const templateSection = renderTemplateUpdateSection(
        deps.activeTemplates().map((entry) => ({
          id: entry.id,
          name: entry.name,
          currentVariables: deps.templateStateOf(entry),
          variableSchema: entry.variableSchema,
        })),
      )
      if (templateSection) {
        result.push({ role: 'system', content: `[Instructions for next message]\n${templateSection}` })
      }
    }
    return result
  }

  /** M4-f: COT preset content sync before the request assembles — the managed
   * 'COT' entry and the 破限预注入 · AI prefill rewrites track live state
   * (model / memory / variable analysis). Idempotent; a failed sync must never
   * block the send (assembly proceeds with whatever the store holds). When the
   * layer is dormant, the surviving prefill rewrites revert to seed content
   * (assembly filters the managed COT entry itself). */
  const syncCotPresetsIfActive = async (): Promise<void> => {
    if (!deps.presetStore || !deps.settingsState) return
    try {
      if (!deps.cotActive()) {
        await revertCotPrefillEntries(deps.presetStore)
        deps.setPresetSnapshot(await deps.presetStore.get())
        return
      }
      await syncCotPresetEntries(deps.presetStore, {
        model: resolveApiConfig(deps.settingsState.snapshot()).model,
        memoryEnabled: deps.isCardDomain() && deps.memoryActive(),
        variablesAnalysisEnabled:
          deps.isCardDomain()
          && deps.variablesActive()
          && deps.activeTemplates().length > 0
          && readTemplateAnalysisSettings(deps.settingsState).mainModelAnalysis,
      })
      deps.setPresetSnapshot(await deps.presetStore.get())
    } catch (error) {
      console.error('[cot] preset sync failed:', error)
    }
  }

  return { stripCotText, proseOf, expandRequestText, buildRequestMessages, syncCotPresetsIfActive }
}
