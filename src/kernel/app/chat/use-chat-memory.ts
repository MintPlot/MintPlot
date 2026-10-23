/**
 * Rolling-summary memory pipeline (M4-e): background patrol, manual rebuild
 * and the sheet-facing status. Extracted from ChatSessionView (2026-10
 * cleanup) — pure move; the plugin toggle stays a view-side gate write.
 */
import { ref, shallowRef } from 'vue'
import type { SettingsState } from '@/kernel/settings/settings-state'
import type { MemoryStore } from '@/kernel/memory/memory-store'
import { computePendingBatch, createEmptyMemoryState, type MemoryState } from '@/kernel/memory/memory-engine'
import { readMemorySummarySettings, runRollingSummary, type SummaryFloor } from '@/kernel/memory/summary-pipeline'
import { resolveApiConfig } from '@/kernel/llm/api-profiles'
import { errorHub } from '@/kernel/diagnostics/error-hub'
import { uiService } from '@/kernel/ui/toasts'
import type { CharacterCard } from '@/kernel/characters/character-card'
import type { ChatboxMessage } from '@/kernel/sessions/chatbox-store'
import type { UsageRecorder } from '@/kernel/app/chat-keys'
import type { SessionLocalWorkOptions } from './session-local-work'

export interface ChatMemoryOptions extends SessionLocalWorkOptions {
  settingsState: SettingsState | null
  memoryStore: MemoryStore | null
  recordUsage: UsageRecorder | null
  isCardDomain: () => boolean
  card: () => CharacterCard | null
  messages: () => ChatboxMessage[]
  /** Prose projection fed to the pipeline (thinking/variable blocks out). */
  toProse: (text: string) => string
  userName: () => string
}

export function useChatMemory(options: ChatMemoryOptions) {
  const { settingsState, memoryStore, recordUsage, isCardDomain, card, messages, toProse, userName } = options

  const memoryActive = ref(true)
  const memoryState = shallowRef<MemoryState | null>(null)
  const memoryStatus = ref('')
  const memoryBusy = ref(false)
  const showMemory = ref(false)
  let patrolGeneration = 0

  // Fire-and-forget patrol: after a turn fully lands, cover the backlog
  // (window = total − keepFloors) in rewrite batches. Busy-gated; failures
  // park the anchor and surface in the sheet + diagnostics journal. Deleting
  // floors needs no rollback here (D7): the anchor is a COUNT, the window
  // recomputes over the remaining floors, done batches never re-run.
  const maybeRunMemoryPipeline = async (force = false): Promise<void> => {
    const signal = options.sessionSignal?.()
    if (signal?.aborted || !memoryActive.value || !isCardDomain() || !card() || !memoryStore || memoryBusy.value) return
    const settings = readMemorySummarySettings(settingsState)
    const state = memoryState.value ?? createEmptyMemoryState()
    if (!force) {
      const pending = computePendingBatch(messages().length, settings.keepFloors, settings.batchSize, state)
      if (!pending) return
    }
    const apiConfig = resolveApiConfig(settingsState?.snapshot() ?? {})
    const model = settings.model || apiConfig.model
    if (!apiConfig.baseUrl || !model) {
      memoryStatus.value = '未配置模型,无法整理记忆'
      return
    }
    memoryBusy.value = true
    const generation = ++patrolGeneration
    const current = () => !signal?.aborted && generation === patrolGeneration
    const cancelled = () => { if (generation === patrolGeneration) memoryBusy.value = false }
    signal?.addEventListener('abort', cancelled, { once: true })
    memoryStatus.value = '整理中…'
    try {
      const floors: SummaryFloor[] = messages().map((message) => ({
        role: message.role === 'user' ? 'user' : 'assistant',
        name: message.role === 'user' ? userName() : card()!.name,
        // M4-f: the summary consumes prose — thinking blocks never enter the
        // memory pipeline (RP feeds parseCot().main the same way).
        content: toProse(message.content),
      }))
      const result = await runRollingSummary({
        config: { baseUrl: apiConfig.baseUrl, apiKey: apiConfig.apiKey, model },
        floors,
        state,
        signal,
        settings: { keepFloors: settings.keepFloors, batchSize: settings.batchSize, maxOutputTokens: settings.maxOutputTokens },
        onUsage: (usage, meta) => {
          if (usage) recordUsage?.(usage, meta)
        },
      })
      if (!current()) return
      memoryState.value = result.state
      const write = memoryStore.save({ kind: 'card', id: card()!.id }, result.state)
      await (options.trackLocalWrite?.(write) ?? write)
      if (!current()) return
      if (result.error) {
        memoryStatus.value = `整理失败:${result.error.slice(0, 80)}`
        errorHub.record({
          severity: 'warn',
          category: 'chat',
          action: 'memory_summary_failed',
          message: result.error,
          context: { cardId: card()!.id },
        })
      } else {
        memoryStatus.value = result.batches > 0 ? `已整理 ${result.batches} 批` : '记忆已是最新'
      }
    } catch (error) {
      if (current()) memoryStatus.value = `整理失败:${(error as Error)?.message || '未知错误'}`
    } finally {
      signal?.removeEventListener('abort', cancelled)
      if (generation === patrolGeneration) memoryBusy.value = false
    }
  }

  const rebuildMemory = async (): Promise<void> => {
    const signal = options.sessionSignal?.()
    if (!isCardDomain() || !card() || !memoryStore) return
    const confirmed = await uiService.confirm('shell', {
      title: '清空重建记忆',
      message: `将删除与「${card()!.name}」的摘要与档案,之后从原文重新整理。楼层本身不受影响。`,
      confirmLabel: '清空重建',
    })
    if (!confirmed || signal?.aborted) return
    const write = memoryStore.reset({ kind: 'card', id: card()!.id })
    await (options.trackLocalWrite?.(write) ?? write)
    memoryState.value = createEmptyMemoryState()
    memoryStatus.value = '已清空,整理后重新积累'
  }

  return {
    memoryActive,
    memoryState,
    memoryStatus,
    memoryBusy,
    showMemory,
    maybeRunMemoryPipeline,
    rebuildMemory,
  }
}
