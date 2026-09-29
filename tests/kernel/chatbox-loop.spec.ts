import { afterEach, describe, expect, it, vi } from 'vitest'
import { LlmRequestError, streamChatCompletion } from '@/kernel/llm/chat-completions'
import { createOpenAiCompatibleProvider, readApiConfig } from '@/kernel/llm/llm-provider'
import { createSettingsState } from '@/kernel/settings/settings-state'
import { createStorageRepository } from '@/kernel/store/storage-repository'
import { createChatboxStore } from '@/kernel/sessions/chatbox-store'
import { createMemoryEngine } from '@/kernel/store/kv-store'

function sseResponse(frames: string[]): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame))
      controller.close()
    },
  })
  return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

function sseChunk(delta?: string, usage?: Record<string, number>): string {
  return `data: ${JSON.stringify({
    ...(delta !== undefined ? { choices: [{ delta: { content: delta } }] } : {}),
    ...(usage ? { usage } : {}),
  })}\n\n`
}

describe('kernel/llm · streamChatCompletion (SSE)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('accumulates deltas, captures usage and stops at [DONE]', async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse([
      sseChunk('你好'),
      sseChunk('，世界'),
      sseChunk(undefined, { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 }),
      'data: [DONE]\n\n',
    ]))
    vi.stubGlobal('fetch', fetchMock)

    const deltas: string[] = []
    const result = await streamChatCompletion(
      { baseUrl: 'https://api.example.com/v1', apiKey: 'sk-x', model: 'test-model' },
      [{ role: 'user', content: 'hi' }],
      { onDelta: (delta) => deltas.push(delta) },
    )

    expect(deltas).toEqual(['你好', '，世界'])
    expect(result.content).toBe('你好，世界')
    expect(result.usage).toEqual({ inputTokens: 12, outputTokens: 5, totalTokens: 17 })

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.example.com/v1/chat/completions')
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: 'test-model',
      stream: true,
      messages: [{ role: 'user', content: 'hi' }],
    })
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-x')
  })

  it('surfaces HTTP errors as LlmRequestError with status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('quota exceeded', { status: 429 })))
    const error = await streamChatCompletion(
      { baseUrl: 'https://api.example.com/v1', apiKey: '', model: 'm' },
      [{ role: 'user', content: 'hi' }],
    ).then(() => null, (e: unknown) => e)
    expect(error).toBeInstanceOf(LlmRequestError)
    expect((error as LlmRequestError).status).toBe(429)
    expect((error as LlmRequestError).message).toContain('429')
  })

  it('rejects an empty base url before touching the network', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(streamChatCompletion({ baseUrl: '', apiKey: '', model: 'm' }, []))
      .rejects.toThrow('未配置 API Base URL')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns partial content when the caller aborts mid-stream', async () => {
    const controller = new AbortController()
    let streamController: ReadableStreamDefaultController<Uint8Array> | null = null
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        streamController = c
        c.enqueue(new TextEncoder().encode(sseChunk('部分')))
        // Never closes — the caller's abort errors the body, like real fetch.
      },
    })
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (_url: unknown, init?: { signal?: AbortSignal }) => {
      init?.signal?.addEventListener('abort', () => {
        streamController?.error(new DOMException('The operation was aborted.', 'AbortError'))
      }, { once: true })
      return new Response(stream, { status: 200 })
    }))

    const result = await streamChatCompletion(
      { baseUrl: 'https://api.example.com/v1', apiKey: '', model: 'm' },
      [{ role: 'user', content: 'hi' }],
      {
        signal: controller.signal,
        onDelta: () => controller.abort(), // user hits 中止 after the first token
      },
    )
    expect(result.content).toBe('部分')
  })
})

describe('kernel/llm · provider default (R-09)', () => {
  it('reads config from the settings state and reports configured()', async () => {
    vi.useFakeTimers()
    const settings = createSettingsState(createStorageRepository(createMemoryEngine()))
    await vi.advanceTimersByTimeAsync(0)

    const provider = createOpenAiCompatibleProvider(settings)
    expect(provider.configured()).toBe(false)

    const scope = settings.scope(['apiBaseUrl', 'apiKey', 'apiModel'])
    scope.apiBaseUrl = 'https://api.example.com/v1/'
    scope.apiKey = 'sk-secret'
    scope.apiModel = 'test-model'
    await settings.flush()

    // The trusted read restores the api key (secret channel round-trip).
    expect(readApiConfig(settings)).toEqual({
      baseUrl: 'https://api.example.com/v1/',
      apiKey: 'sk-secret',
      model: 'test-model',
    })
    expect(provider.configured()).toBe(true)

    const fetchMock = vi.fn().mockResolvedValue(sseResponse([sseChunk('ok'), 'data: [DONE]\n\n']))
    vi.stubGlobal('fetch', fetchMock)
    const result = await provider.stream([{ role: 'user', content: 'x' }], {})
    expect(result.content).toBe('ok')
    const [url] = fetchMock.mock.calls[0] as unknown as [string]
    expect(url).toBe('https://api.example.com/v1/chat/completions')
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })
})

describe('chatbox store · kind-partitioned persistence (ADR-003 keys)', () => {
  it('create → save → list → remove round-trips through chat:chatbox:<id>', async () => {
    const engine = createMemoryEngine()
    const store = createChatboxStore(createStorageRepository(engine))

    const conversation = await store.create()
    conversation.messages.push({ id: 'a1', role: 'user', content: '第一条', ts: 1 })
    await store.save(conversation)

    // At rest the record lives under the chatbox-domain partition key.
    expect(await engine.get('chat:chatbox:' + conversation.id)).not.toBeNull()
    expect(await engine.get('chat:card:' + conversation.id)).toBeNull()

    const list = await store.list()
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ title: '新的对话', preview: '第一条' })

    const reloaded = (await store.get(conversation.id))!
    expect(reloaded.messages.map((message) => message.id)).toEqual(['a1'])

    // Incremental edits: append + delete one row.
    reloaded.messages.push({ id: 'a2', role: 'assistant', content: '回复', ts: 2 })
    reloaded.messages.shift()
    await store.save(reloaded)
    const after = (await store.get(conversation.id))!
    expect(after.messages.map((message) => message.id)).toEqual(['a2'])

    await store.remove(conversation.id)
    expect(await store.list()).toEqual([])
    expect(await engine.get('chat:chatbox:' + conversation.id)).toBeNull()
  })

  it('lists most-recent-first', async () => {
    const store = createChatboxStore(createStorageRepository(createMemoryEngine()))
    const first = await store.create('早')
    const second = await store.create('晚')
    first.updatedAt = 1
    second.updatedAt = 2
    await store.save(first)
    await store.save(second)
    const list = await store.list()
    expect(list.map((entry) => entry.title)).toEqual(['晚', '早'])
  })
})
