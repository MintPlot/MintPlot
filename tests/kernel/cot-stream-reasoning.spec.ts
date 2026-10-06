import { afterEach, describe, expect, it, vi } from 'vitest'
import { completeChatCompletion, streamChatCompletion } from '@/kernel/llm/chat-completions'

afterEach(() => {
  vi.unstubAllGlobals()
})

const sse = (frames: string[]): ReadableStream<Uint8Array> =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(frames.join('\n')))
      controller.close()
    },
  })

const CONFIG = { baseUrl: 'https://api.example.com/v1', apiKey: '', model: 'reasoner-v1' }

describe('kernel/llm · native reasoning capture (M4-f)', () => {
  it('streaming: reasoning_content deltas accumulate into result.reasoning and onReasoningDelta', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          sse([
            `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: '先想' } }] })}`,
            `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: '一步' } }] })}`,
            `data: ${JSON.stringify({ choices: [{ delta: { content: '正文' } }] })}`,
            'data: [DONE]',
            '',
          ]),
          { status: 200 },
        ),
      ),
    )
    const reasoningDeltas: string[] = []
    const result = await streamChatCompletion(CONFIG, [{ role: 'user', content: 'hi' }], {
      onReasoningDelta: (delta) => reasoningDeltas.push(delta),
    })
    expect(result.reasoning).toBe('先想一步')
    expect(result.content).toBe('正文')
    expect(reasoningDeltas).toEqual(['先想', '一步'])
  })

  it('streaming: the reasoning alias family and choice-level fields are probed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          sse([
            `data: ${JSON.stringify({ choices: [{ delta: { reasoning: 'openrouter' } }] })}`,
            `data: ${JSON.stringify({ choices: [{ reasoning_content: 'choice 级' }] })}`,
            'data: [DONE]',
            '',
          ]),
          { status: 200 },
        ),
      ),
    )
    const result = await streamChatCompletion(CONFIG, [])
    expect(result.reasoning).toBe('openrouterchoice 级')
  })

  it('streaming: a reply without reasoning fields still reports an empty string', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(sse([`data: ${JSON.stringify({ choices: [{ delta: { content: '普通回复' } }] })}`, 'data: [DONE]', '']), {
          status: 200,
        }),
      ),
    )
    const result = await streamChatCompletion(CONFIG, [])
    expect(result.reasoning).toBe('')
    expect(result.content).toBe('普通回复')
  })

  it('non-streaming: message.reasoning_content lands in result.reasoning', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ choices: [{ message: { role: 'assistant', content: '结论', reasoning_content: '过程' } }], model: 'reasoner-v1' }),
          { status: 200 },
        ),
      ),
    )
    const result = await completeChatCompletion(CONFIG, [])
    expect(result.reasoning).toBe('过程')
    expect(result.content).toBe('结论')
  })
})
