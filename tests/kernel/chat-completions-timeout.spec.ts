import { afterEach, describe, expect, it, vi } from 'vitest'
import { streamChatCompletion } from '@/kernel/llm/chat-completions'

/**
 * Stream timeout semantics: the abort timer is IDLE (re-armed per received
 * SSE frame), not an absolute cap — a slow but productive stream (long RP
 * replies, reasoning models) must never be killed mid-generation; only a
 * truly stalled connection aborts (MP-NET-001).
 */

const CONFIG = { baseUrl: 'https://api.example.com/v1', apiKey: 'k', model: 'm' }
const USER = [{ role: 'user', content: 'hi' }] as const

const sse = (payload: string): string => `data: ${payload}\n\n`

interface RemoteSseBody {
  stream: ReadableStream<Uint8Array>
  send: (payload: string) => void
  close: () => void
}

/** Fake SSE body wired to the request's abort signal — a real fetch body
 *  dies when its fetch is aborted; the mock stream must emulate that. */
function makeAbortAwareSseBody(signal: AbortSignal): RemoteSseBody {
  const encoder = new TextEncoder()
  let streamController: ReadableStreamDefaultController<Uint8Array> | null = null
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller
      signal.addEventListener(
        'abort',
        () => {
          try {
            controller.error(new DOMException('The operation was aborted.', 'AbortError'))
          } catch {
            // already closed or errored
          }
        },
        { once: true },
      )
    },
  })
  return {
    stream,
    send(payload: string): void {
      streamController?.enqueue(encoder.encode(payload))
    },
    close(): void {
      try {
        streamController?.close()
      } catch {
        // already closed or errored
      }
    },
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('kernel/llm · stream timeout is idle, not absolute', () => {
  it('re-arms per frame — a slow but productive stream survives past the old absolute cap', async () => {
    vi.useFakeTimers()
    let remote!: RemoteSseBody
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, options: { signal: AbortSignal }) => {
        remote = makeAbortAwareSseBody(options.signal)
        return new Response(remote.stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
      }),
    )

    const pending = streamChatCompletion(CONFIG, USER)
    await vi.advanceTimersByTimeAsync(1) // fetch resolves, pump starts

    remote.send(sse('{"model":"m","choices":[{"delta":{"content":"一"}}]}'))
    await vi.advanceTimersByTimeAsync(60_000)
    remote.send(sse('{"choices":[{"delta":{"content":"二"}}]}'))
    // 150s of total stream time — past the old absolute 120s cap, but only
    // 90s of the CURRENT idle window have elapsed, so the stream lives.
    await vi.advanceTimersByTimeAsync(90_000)
    remote.send(sse('[DONE]'))
    remote.close()

    await expect(pending).resolves.toMatchObject({ content: '一二', model: 'm' })
  })

  it('aborts with MP-NET-001 when the stream stalls past the idle window', async () => {
    vi.useFakeTimers()
    let remote!: RemoteSseBody
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, options: { signal: AbortSignal }) => {
        remote = makeAbortAwareSseBody(options.signal)
        return new Response(remote.stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
      }),
    )

    const pending = streamChatCompletion(CONFIG, USER)
    await vi.advanceTimersByTimeAsync(1)
    remote.send(sse('{"choices":[{"delta":{"content":"半"}}]}'))
    // One productive frame re-arms the window; then silence for 120s.
    await vi.advanceTimersByTimeAsync(120_000)

    await expect(pending).rejects.toMatchObject({ code: 'MP-NET-001', message: '请求超时' })
  })
})
