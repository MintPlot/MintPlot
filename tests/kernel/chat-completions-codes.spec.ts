import { afterEach, describe, expect, it, vi } from 'vitest'
import { streamChatCompletion } from '@/kernel/llm/chat-completions'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('kernel/llm · unified error codes on LlmRequestError (M3-err1)', () => {
  it('validation failures carry the CHAT codes from the throw site', async () => {
    await expect(streamChatCompletion({ baseUrl: '  ', apiKey: '', model: 'm' }, [])).rejects.toMatchObject({
      code: 'MP-CHAT-001',
      message: '未配置 API Base URL',
    })
    await expect(streamChatCompletion({ baseUrl: 'https://api.example.com/v1', apiKey: '', model: ' ' }, [])).rejects.toMatchObject({
      code: 'MP-CHAT-002',
      message: '未配置模型',
    })
  })

  it('connection-level failures carry MP-NET-003 with the wrapped message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(
      streamChatCompletion({ baseUrl: 'https://api.example.com/v1', apiKey: '', model: 'm' }, [{ role: 'user', content: 'hi' }]),
    ).rejects.toMatchObject({ code: 'MP-NET-003', message: '请求失败: Failed to fetch' })
  })

  it('HTTP error statuses carry MP-NET-002 with a clamped body excerpt', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"error":"quota"}', { status: 429 })))
    await expect(
      streamChatCompletion({ baseUrl: 'https://api.example.com/v1', apiKey: '', model: 'm' }, [{ role: 'user', content: 'hi' }]),
    ).rejects.toMatchObject({ code: 'MP-NET-002', status: 429 })
  })
})

describe('kernel/llm · upstream SSE error frames (M4-e follow-up)', () => {
  it('an event:error data frame rejects with MP-NET-005 carrying the upstream message', async () => {
    // LM Studio with a strict chat template reports mid-stream failures as an
    // error frame instead of an HTTP status — unrecognized, it used to end as
    // a silent empty turn.
    const frame = [
      'event: error',
      `data: ${JSON.stringify({ error: { message: 'Jinja Exception: System message must be at the beginning' } })}`,
      '',
    ].join('\n')
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(frame))
        controller.close()
      },
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status: 200 })))
    await expect(
      streamChatCompletion({ baseUrl: 'https://api.example.com/v1', apiKey: '', model: 'm' }, [{ role: 'user', content: 'hi' }]),
    ).rejects.toMatchObject({ code: 'MP-NET-005', message: expect.stringContaining('System message must be at the beginning') })
  })

  it('a plain-string upstream error also surfaces', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ error: 'engine overloaded' })}\n\n`))
        controller.close()
      },
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status: 200 })))
    await expect(
      streamChatCompletion({ baseUrl: 'https://api.example.com/v1', apiKey: '', model: 'm' }, [{ role: 'user', content: 'hi' }]),
    ).rejects.toMatchObject({ code: 'MP-NET-005', message: expect.stringContaining('engine overloaded') })
  })
})
