/**
 * The streaming turn engine: one assistant turn = provider stream into a
 * floor object, usage attribution, variable-block ingestion, template
 * analysis fallback, error-bar semantics (M3-err: failures never write
 * history) and the send/retry wrappers. Extracted from ChatSessionView
 * (2026-10 cleanup) — pure move; newFloorId names the floor-id literal once
 * (C6, the two in-view occurrences).
 */
import { getCurrentScope, onScopeDispose, type Ref } from 'vue'
import { createStreamPublication } from './stream-publication'
import type { SessionLocalWorkOptions } from './session-local-work'
import type { SettingsState } from '@/kernel/settings/settings-state'
import type { VariableStore, VariableSnapshot } from '@/kernel/variables/variable-store'
import {
  parseTemplateUpdateBlocks,
  parseTemplateUpdatePayload,
  parseVariableUpdates,
} from '@/kernel/variables/variable-engine'
import type { ParsedTemplateUpdate } from '@/kernel/variables/variable-engine'
import { readTemplateAnalysisSettings } from '@/kernel/variables/analysis'
import type { CardUiTemplate, CharacterCard } from '@/kernel/characters/character-card'
import type { CardSession } from '@/kernel/sessions/card-session-store'
import type { ChatboxConversation, ChatboxMessage } from '@/kernel/sessions/chatbox-store'
import type { LlmChatMessage, LlmRequestError as LlmRequestErrorType } from '@/kernel/llm/chat-completions'
import { LlmRequestError } from '@/kernel/llm/chat-completions'
import type { LlmProvider } from '@/kernel/llm/llm-provider'
import type { PendingChatImage } from '@/kernel/llm/vision'
import { errorHub } from '@/kernel/diagnostics/error-hub'
import type { UsageRecorder } from '@/kernel/app/chat-keys'

export interface ChatTurnOptions extends SessionLocalWorkOptions {
  resolveProvider: () => LlmProvider | undefined
  streaming: Ref<boolean>
  sendError: Ref<string>
  draft: Ref<string>
  oneShotInstruction: Ref<string>
  pendingImages: Ref<PendingChatImage[]>
  pendingImagesNotReady: Ref<boolean>
  sessionLoaded: () => boolean
  isCardDomain: () => boolean
  cardSession: () => CardSession | null
  conversation: () => ChatboxConversation | null
  card: () => CharacterCard | null
  messages: () => ChatboxMessage[]
  variablesActive: () => boolean
  settingsState: SettingsState | null
  recordUsage: UsageRecorder | null
  variableStore: VariableStore | null
  activeTemplates: () => CardUiTemplate[]
  absorbVariableSnapshot: (snapshot: VariableSnapshot) => void
  applyMatchedTemplateUpdates: (
    parsed: ParsedTemplateUpdate[],
    messageId: string,
    candidateIndex?: number,
    signal?: AbortSignal | null,
  ) => Promise<number>
  runTemplateAnalysisPipeline: (floor: ChatboxMessage) => Promise<void>
  buildRequestMessages: (floors?: ChatboxMessage[]) => LlmChatMessage[]
  syncCotPresetsIfActive: () => Promise<void>
  persistSession: () => Promise<void>
  scrollToBottom: () => Promise<void>
  followOutput?: () => Promise<void>
  maybeRunMemoryPipeline: () => Promise<void>
  domain: () => 'chatbox' | 'card'
}

export function useChatTurn(options: ChatTurnOptions) {
  const {
    resolveProvider, streaming, sendError, draft, oneShotInstruction, pendingImages, pendingImagesNotReady,
    sessionLoaded, isCardDomain, cardSession, conversation, card, messages, variablesActive, settingsState,
    recordUsage, variableStore, activeTemplates, absorbVariableSnapshot, applyMatchedTemplateUpdates,
    runTemplateAnalysisPipeline, buildRequestMessages, syncCotPresetsIfActive, persistSession,
    scrollToBottom, maybeRunMemoryPipeline, domain,
  } = options

  // C6: one floor-id shape (was duplicated at both turn sites).
  const newFloorId = (): string => `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

  let abortController: AbortController | null = null
  let publication: ReturnType<typeof createStreamPublication> | null = null
  let disposed = false
  let retired = false
  let settleCancelledTurn: (() => void) | null = null
  let releaseVisibility: (() => void) | null = null
  // The persisted user floor text behind the D3 error-bar retry.
  let lastUserText = ''

  const stopStreaming = (): void => {
    publication?.finish()
    abortController?.abort()
    abortController = null
    settleCancelledTurn?.()
    releaseVisibility?.()
    releaseVisibility = null
  }
  // Local finalization does not wait for a provider that ignores cancellation.
  const retire = (): void => { retired = true; stopStreaming() }
  if (getCurrentScope()) onScopeDispose(() => {
    retire()
    disposed = true
  })

  /** The streaming half of a turn, shared by fresh sends and M4-c floor
   *  regeneration: streams into an existing floor object, attributes usage and
   *  variable events (candidateIndex tags regen candidates), runs the analysis
   *  pipeline. Returns true when a reply fully landed. */
  const streamAssistantInto = async (
    floor: ChatboxMessage,
    requestMessages: LlmChatMessage[],
    turnOptions: { candidateIndex?: number; isNewFloor?: boolean; onCancelled?: () => void; onCompleted?: () => void } = {},
  ): Promise<boolean> => {
    const provider = resolveProvider()
    if (!provider || disposed || retired) return false
    const candidateIndex = turnOptions.candidateIndex
    streaming.value = true
    // Local alias: stopStreaming() may null the module ref while the stream's
    // rejection is still in flight — the catch must read the live signal.
    const controller = new AbortController()
    const sessionSignal = options.sessionSignal?.()
    const current = () => !controller.signal.aborted && !sessionSignal?.aborted && !disposed && !retired
    abortController = controller
    // Resolve the array entry once: callers may retain the raw object that
    // was pushed into a reactive array. Publishing through that raw reference
    // bypassed Vue's setters and left new replies invisible until completion.
    const target = messages().find((message) => message.id === floor.id) ?? floor
    const output = createStreamPublication((text) => {
      target.content = text.content
      target.reasoning = text.reasoning
      void (options.followOutput ?? scrollToBottom)()
    })
    publication = output
    let completed = false
    const settleCancelled = (): void => {
      if (completed) return
      if (turnOptions.isNewFloor && target.content === '') {
        const index = messages().findIndex((message) => message.id === target.id)
        if (index >= 0) messages().splice(index, 1)
      }
      turnOptions.onCancelled?.()
    }
    settleCancelledTurn = settleCancelled
    const onVisibilityChange = (): void => { if (document.hidden) output.flush() }
    document.addEventListener('visibilitychange', onVisibilityChange)
    const release = () => document.removeEventListener('visibilitychange', onVisibilityChange)
    releaseVisibility = release
    let succeeded = false
    try {
      const result = await provider.stream(requestMessages, {
        signal: controller.signal,
        // M4-g3 session-level model override (both domains; empty = global).
        model: (isCardDomain() ? cardSession()?.model : conversation()?.model) || undefined,
        onDelta: (delta) => {
          if (!controller.signal.aborted) output.append('content', delta)
        },
        // M4-f: native reasoning streams into its own floor field — the wire
        // capture runs regardless of the plugin toggle (data is not recoverable
        // later); the display card is what the toggle gates.
        onReasoningDelta: (delta) => {
          if (!controller.signal.aborted) output.append('reasoning', delta)
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
      output.finish({ content: result.content, reasoning: result.reasoning ?? '' })
      if (result.usage) {
        // Attribution: the record must say which session it came from — the
        // card domain types itself 'card' (labeled 角色卡 in the ledger) and
        // names the card; the chatbox domain names the conversation.
        recordUsage?.(result.usage, {
          type: isCardDomain() ? 'card' : 'chat',
          model: result.model ?? '',
          ...(isCardDomain()
            ? { characterName: card()?.name ?? '' }
            : { detail: conversation()?.title ?? '' }),
        })
      }
      // Reported usage remains real even for a cancelled request. A stop is
      // not a completed candidate, however, and must not apply AI-side state.
      if (!current()) return false
      succeeded = true
      completed = true
      turnOptions.onCompleted?.()
      if (isCardDomain() && card() && variablesActive() && floor.content) {
        // M3-q/M3-r: the reply's variable blocks become ledger events
        // (source=ai, floor-attributed) — flat setvars/StatData entries and
        // template-bound ui_template_updates trees alike. Keep the finished
        // floor even if a local commit fails, but surface the failure and
        // block further requests until authoritative storage is reread.
        let matchedTemplateCount = 0
        // Once provider output is accepted, complete its local ledger commit
        // as a unit. Departure joins this work; only network analysis may be
        // discarded. Cancelling half a commit can orphan candidate events.
        const commit = async (): Promise<void> => {
          const { updates } = parseVariableUpdates(floor.content)
          if (updates.length > 0) {
            const write = variableStore?.apply(card()!.id, updates, {
              source: 'ai',
              messageId: floor.id,
              ...(candidateIndex !== undefined ? { candidateIndex } : {}),
            })
            const snapshot = write ? await (options.trackLocalWrite?.(write) ?? write) : undefined
            if (snapshot) {
              absorbVariableSnapshot(snapshot)
            }
          }
          const blocks = parseTemplateUpdateBlocks(floor.content)
          if (blocks.length > 0 && activeTemplates().length > 0) {
            const parsed = blocks.flatMap((body) => {
              try {
                return parseTemplateUpdatePayload(body)
              } catch {
                return []
              }
            })
            matchedTemplateCount = await applyMatchedTemplateUpdates(parsed, floor.id, candidateIndex, null)
          }
        }
        const committing = commit()
        await (options.trackLocalWrite?.(committing) ?? committing)
        // M3-t: sub-model mode analyzes every reply; main-model mode falls
        // back only when no block was found or none routed to a template.
        if (current() && activeTemplates().length > 0) {
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
          code: (error as LlmRequestErrorType)?.code,
          message,
          context: { domain: domain() },
        })
      }
    } finally {
      output.finish()
      release()
      if (releaseVisibility === release) releaseVisibility = null
      if (publication === output) publication = null
      if (settleCancelledTurn === settleCancelled) settleCancelledTurn = null
      streaming.value = false
      if (abortController === controller) abortController = null
      if (turnOptions.isNewFloor && floor.content === '') {
        // Aborted or failed before any token: drop the empty floor. Failed
        // turns leave only the user floor — history stays request-clean (D3).
        const index = messages().findIndex((message) => message.id === floor.id)
        if (index >= 0) messages().splice(index, 1)
      }
      if (!retired) {
        try { await persistSession() } catch { sendError.value = '会话保存失败，请返回后重试' }
      }
      if (!disposed && !retired) await (options.followOutput ?? scrollToBottom)()
    }
    return succeeded && current()
  }

  const runAssistantTurn = async (signal = options.sessionSignal?.()): Promise<void> => {
    const provider = resolveProvider()
    if (!provider || signal?.aborted || retired || disposed || !sessionLoaded()) return
    await syncCotPresetsIfActive()
    if (signal?.aborted || retired || disposed || !sessionLoaded()) return
    const assistantFloor: ChatboxMessage = {
      id: newFloorId(),
      role: 'assistant',
      content: '',
      ts: Date.now(),
    }
    messages().push(assistantFloor)
    const landed = await streamAssistantInto(assistantFloor, buildRequestMessages(), { isNewFloor: true })
    // M4-e: the patrol never blocks the next send - fire, forget, busy-gated.
    if (landed && !retired && !disposed) void maybeRunMemoryPipeline()
  }

  const send = async (overrideText?: string): Promise<void> => {
    const signal = options.sessionSignal?.()
    const provider = resolveProvider()
    if (signal?.aborted || !sessionLoaded() || !provider) return
    // Panel-button triggers (M3-t bridge) pass the command directly; the normal
    // path sends the draft. Both share the streaming guard + the M4-d image
    // readiness gate (RP same: send waits until every attachment is described).
    const text = (typeof overrideText === 'string' ? overrideText : draft.value).trim()
    if (!text || streaming.value || pendingImagesNotReady.value) return

    const now = Date.now()
    const attachments = pendingImages.value.map(({ dataUrl, description }) => ({ dataUrl, description }))
    const userFloor: ChatboxMessage = {
      id: newFloorId(),
      role: 'user',
      content: text,
      ts: now,
      ...(attachments.length > 0 ? { imageAttachments: attachments } : {}),
    }
    messages().push(userFloor)
    pendingImages.value = []
    // Title defaults to the first utterance (spec §03) — chatbox domain only;
    // the card domain keeps the card name.
    if (!isCardDomain() && conversation() && conversation()!.title === '新的对话') {
      conversation()!.title = text.slice(0, 24)
    }
    try { await persistSession() } catch {
      sendError.value = '会话保存失败，请返回后重试'
      return
    }
    if (signal?.aborted || retired || disposed || !sessionLoaded()) return
    if (typeof overrideText !== 'string') draft.value = ''
    sendError.value = ''
    lastUserText = text
    await scrollToBottom()
    await runAssistantTurn(signal)
    // D3 single-shot: consumed by exactly one send (regeneration excluded).
    if (!signal?.aborted && !retired && !disposed) oneShotInstruction.value = ''
  }

  /** Retry re-streams a reply for the persisted user floor (D3 error bar). */
  const retryLastSend = async (): Promise<void> => {
    if (!sessionLoaded() || streaming.value || !lastUserText) return
    sendError.value = ''
    await runAssistantTurn()
  }

  return { stopStreaming, retire, streamAssistantInto, retryLastSend, send }
}
