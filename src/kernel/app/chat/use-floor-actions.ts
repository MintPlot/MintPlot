/**
 * Floor actions (M4-c): the per-floor action row behaviors — swipe/regenerate
 * candidates, in-place editing, copy, delete-with-tail, the TTS speak intent
 * and the session-settings handoff. Extracted from ChatSessionView (2026-10
 * cleanup) — pure move plus three dedups: pluginActive (C2, the
 * active-or-degraded gate shape), resolveProvider (C7) and the
 * read-ledger-then-absorb helper (C8).
 */
import { computed, ref } from 'vue'
import type { PluginRuntime } from '@/kernel/runtime/runtime'
import type { VariableStore, VariableSnapshot } from '@/kernel/variables/variable-store'
import { eventsBeforeFloor } from '@/kernel/variables/variable-store'
import type { CharacterCard } from '@/kernel/characters/character-card'
import type { ChatboxConversation, ChatboxMessage } from '@/kernel/sessions/chatbox-store'
import type { LlmChatMessage } from '@/kernel/llm/chat-completions'
import type { LlmProvider } from '@/kernel/llm/llm-provider'
import { uiService } from '@/kernel/ui/toasts'
import { copyText } from '@/kernel/app/ui/clipboard'

/** C2: the active-or-degraded gate shape, once. NOTE (known asymmetry,
 * deliberately unchanged in the cleanup batch): the view's six mount-time
 * layer gates are SNAPSHOTS written in onMounted, while the tts computed in
 * use-floor-actions is reactive — mid-session plugin toggles update the
 * speak button immediately, the layer gates apply on the next card entry. */
export function pluginActive(runtime: PluginRuntime | null, id: string): boolean {
  if (!runtime) return true
  const state = runtime.stateOf(id)
  return state === 'active' || state === 'degraded'
}

export interface FloorActionsOptions {
  resolveProvider: () => LlmProvider | undefined
  runtime: PluginRuntime | null
  variableStore: VariableStore | null
  isStreaming: () => boolean
  sessionLoaded: () => boolean
  isCardDomain: () => boolean
  card: () => CharacterCard | null
  cardSession: () => { model?: string } | null
  conversation: () => ChatboxConversation | null
  messages: () => ChatboxMessage[]
  variablesActive: () => boolean
  absorbVariableSnapshot: (snapshot: VariableSnapshot) => void
  buildRequestMessages: (floors?: ChatboxMessage[]) => LlmChatMessage[]
  streamAssistantInto: (
    floor: ChatboxMessage,
    requestMessages: LlmChatMessage[],
    options?: { candidateIndex?: number; isNewFloor?: boolean },
  ) => Promise<boolean>
  syncCotPresetsIfActive: () => Promise<void>
  persistSession: () => Promise<void>
  stripCotText: (text: string) => string
  domain: () => 'chatbox' | 'card'
}

export function useFloorActions(options: FloorActionsOptions) {
  const {
    resolveProvider, runtime, variableStore, isStreaming, sessionLoaded, isCardDomain,
    card, cardSession, conversation, messages, variablesActive,
    absorbVariableSnapshot, buildRequestMessages, streamAssistantInto,
    syncCotPresetsIfActive, persistSession, stripCotText, domain,
  } = options

  // M4-c floor actions: in-place editor state for one floor at a time.
  const editingFloorId = ref('')
  const editDraft = ref('')

  /** C8: switch/delete/regenerate-restore all shared read-ledger-then-absorb. */
  const refreshLedger = async (): Promise<void> => {
    if (!(isCardDomain() && card() && variablesActive())) return
    const snapshot = await variableStore?.get(card()!.id)
    if (snapshot) absorbVariableSnapshot(snapshot)
  }

  const isLastAssistantFloor = (message: ChatboxMessage): boolean =>
    message.role === 'assistant' && messages()[messages().length - 1]?.id === message.id

  /** Regenerate (D3): re-rolls the last assistant floor as an ADDITIONAL
   *  candidate. The ledger's pre-floor state drives the request; the previous
   *  candidate stays switchable, and its untagged events are retagged first so
   *  per-candidate replay stays disjoint. Abort/failure restores the previous
   *  candidate untouched. */
  const regenerateLast = async (floor: ChatboxMessage): Promise<void> => {
    if (isStreaming() || !isLastAssistantFloor(floor)) return
    const provider = resolveProvider()
    if (!provider || !sessionLoaded()) return
    await syncCotPresetsIfActive()
    if (isCardDomain() && card() && variablesActive()) {
      await variableStore?.retagUntaggedEvents(card()!.id, floor.id, floor.activeIndex ?? 0)
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
    const snapshot = isCardDomain() && card() ? await variableStore?.get(card()!.id) : null
    if (snapshot) {
      const preFloorEvents = eventsBeforeFloor(snapshot.events, floor.id)
      absorbVariableSnapshot({ ...snapshot, events: preFloorEvents })
    }
    floor.activeIndex = newIndex
    floor.candidates.push('')
    floor.candidateReasoning!.push('')
    floor.reasoning = ''
    const ok = await streamAssistantInto(
      floor,
      buildRequestMessages(messages().slice(0, -1)),
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
      await refreshLedger()
    }
    await persistSession()
  }

  /** Swipe (D3): switch the displayed candidate; the ledger projection follows
   *  the active candidate (candidate-aware replay). */
  const switchCandidate = async (floor: ChatboxMessage, direction: -1 | 1): Promise<void> => {
    if (isStreaming() || !floor.candidates?.length) return
    const next = (floor.activeIndex ?? 0) + direction
    if (next < 0 || next >= floor.candidates.length) return
    floor.activeIndex = next
    floor.content = floor.candidates[next] ?? ''
    // M4-f: the thinking card follows the candidate (parallel reasoning slots).
    floor.reasoning = floor.candidateReasoning?.[next] ?? ''
    await persistSession()
    await refreshLedger()
  }

  /** Delete (D4): a floor and EVERYTHING after it leaves the conversation;
   *  their ledger events roll back with them (confirm modal states the count). */
  const deleteFloorFrom = async (floor: ChatboxMessage): Promise<void> => {
    if (isStreaming()) return
    const index = messages().findIndex((message) => message.id === floor.id)
    if (index < 0) return
    const count = messages().length - index
    const confirmed = await uiService.confirm('shell', {
      title: '删除楼层',
      message: count > 1 ? `将删除此楼及其后 ${count} 楼,不可恢复。` : '将删除此楼,不可恢复。',
      confirmLabel: '删除',
    })
    if (!confirmed) return
    if (isCardDomain() && card() && variablesActive()) {
      await variableStore?.rollbackFloors(card()!.id, messages().slice(index).map((message) => message.id))
    }
    messages().splice(index)
    await persistSession()
    await refreshLedger()
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
    const floor = messages().find((message) => message.id === editingFloorId.value)
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
  const ttsActive = computed(() => pluginActive(runtime, 'tts'))
  const toggleSpeakFloor = (floor: ChatboxMessage): void => {
    if (isStreaming()) return
    const floorIndex = messages().findIndex((message) => message.id === floor.id)
    runtime?.emit('tts.speak.requested', {
      sessionId: isCardDomain() ? card()?.id ?? '' : conversation()?.id ?? '',
      kind: domain(),
      messageId: floor.id,
      floorIndex,
      // M4-f (plan D4): read the prose, not the thinking — tag-based CoT strips
      // from the spoken text (native reasoning never lives in content).
      text: stripCotText(floor.content),
    })
  }

  // M4-g3: the sheet hands over drafts; this side owns the store objects and
  // persists through the domain's own store (C5: the save dispatch reuses
  // persistSession instead of restating it). 1.0.x: title rides the same
  // payload for the chatbox domain — empty = keep the current title.
  const onSessionSettingsSaved = async (draft: { title: string; systemPrompt: string; model: string }): Promise<void> => {
    if (isCardDomain() && cardSession()) {
      if (draft.model) cardSession()!.model = draft.model
      else delete cardSession()!.model
    } else if (conversation()) {
      if (draft.title) conversation()!.title = draft.title
      conversation()!.systemPrompt = draft.systemPrompt
      conversation()!.model = draft.model
    }
    await persistSession()
  }

  return {
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
  }
}
