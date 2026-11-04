/**
 * 文本输出形式 turn-engine branch: 'whole' mode prefers provider.complete()
 * (single-shot publish), falls back to a delta-suppressed stream on providers
 * without complete(); the default 'stream' mode keeps the incremental path.
 */
import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { useChatTurn, type ChatTurnOptions } from '@/kernel/app/chat/use-chat-turn'
import { createSettingsState } from '@/kernel/settings/settings-state'
import { createStorageRepository } from '@/kernel/store/storage-repository'
import { createMemoryEngine } from '@/kernel/store/kv-store'
import type { ChatboxMessage } from '@/kernel/sessions/chatbox-store'
import type { LlmProvider } from '@/kernel/llm/llm-provider'

const makeSettings = async (mode: 'whole' | null) => {
  const settings = createSettingsState(createStorageRepository(createMemoryEngine()))
  if (mode) {
    const scope = settings.scope(['uiTextOutputMode'])
    scope.uiTextOutputMode = mode
    await settings.flush()
  }
  return settings
}

const makeOptions = (messages: ChatboxMessage[], provider: LlmProvider, settingsState: unknown): ChatTurnOptions => ({
  sessionSignal: () => new AbortController().signal,
  trackLocalWrite: <T>(write: Promise<T>) => write,
  resolveProvider: () => provider,
  streaming: ref(false),
  sendError: ref(''),
  draft: ref(''),
  oneShotInstruction: ref(''),
  pendingImages: ref([]),
  pendingImagesNotReady: ref(false),
  sessionLoaded: () => true,
  isCardDomain: () => false,
  cardSession: () => null,
  conversation: () => null,
  card: () => null,
  messages: () => messages,
  variablesActive: () => false,
  settingsState: settingsState as ChatTurnOptions['settingsState'],
  recordUsage: null,
  variableStore: null,
  activeTemplates: () => [],
  absorbVariableSnapshot: () => {},
  applyMatchedTemplateUpdates: async () => 0,
  runTemplateAnalysisPipeline: async () => {},
  buildRequestMessages: () => [],
  syncCotPresetsIfActive: () => Promise.resolve(),
  persistSession: () => Promise.resolve(),
  scrollToBottom: () => Promise.resolve(),
  maybeRunMemoryPipeline: async () => {},
  domain: () => 'chatbox',
})

describe('turn engine · 文本输出形式 branch', () => {
  it('whole mode: provider.complete is used, stream is not, floor lands in one piece', async () => {
    const settings = await makeSettings('whole')
    const messages: ChatboxMessage[] = []
    const stream = vi.fn(async () => ({ content: 'should-not-be-used', usage: null }))
    const complete = vi.fn(async () => ({ content: '整段回复', reasoning: '', usage: null }))
    const provider = { providerId: 'openai-compatible' as const, configured: () => true, stream, complete }
    const turn = useChatTurn(makeOptions(messages, provider, settings))
    await turn.send('你好')
    expect(complete).toHaveBeenCalledTimes(1)
    expect(stream).not.toHaveBeenCalled()
    expect(messages.map((message) => message.content)).toEqual(['你好', '整段回复'])
  })

  it('whole mode without complete(): suppressed stream buffers deltas, one-shot publish', async () => {
    const settings = await makeSettings('whole')
    const messages: ChatboxMessage[] = []
    let sawDeltaAppended = false
    const stream = vi.fn(async (_messages: unknown, options: { onDelta?: (delta: string) => void }) => {
      options.onDelta?.('整')
      // The publication must NOT have flushed the delta into the floor yet —
      // whole mode publishes only through finish().
      const assistantFloor = messages.find((message) => message.role === 'assistant')
      if (assistantFloor && assistantFloor.content !== '') sawDeltaAppended = true
      options.onDelta?.('段回复')
      return { content: '整段回复', reasoning: '', usage: null }
    })
    const provider = { providerId: 'openai-compatible' as const, configured: () => true, stream }
    const turn = useChatTurn(makeOptions(messages, provider, settings))
    await turn.send('你好')
    expect(stream).toHaveBeenCalledTimes(1)
    expect(sawDeltaAppended).toBe(false)
    expect(messages[messages.length - 1]!.content).toBe('整段回复')
  })

  it('stream mode (default): stream is used, complete is not, deltas append live', async () => {
    const settings = await makeSettings(null)
    const messages: ChatboxMessage[] = []
    let sawMidStreamContent = false
    const stream = vi.fn(async (_messages: unknown, options: { onDelta?: (delta: string) => void }) => {
      options.onDelta?.('流式')
      const assistantFloor = messages.find((message) => message.role === 'assistant')
      if (assistantFloor && assistantFloor.content === '流式') sawMidStreamContent = true
      return { content: '流式回复', reasoning: '', usage: null }
    })
    const complete = vi.fn(async () => ({ content: 'should-not-be-used', usage: null }))
    const provider = { providerId: 'openai-compatible' as const, configured: () => true, stream, complete }
    const turn = useChatTurn(makeOptions(messages, provider, settings))
    await turn.send('你好')
    expect(complete).not.toHaveBeenCalled()
    expect(sawMidStreamContent).toBe(true)
    expect(messages[messages.length - 1]!.content).toBe('流式回复')
  })
})
