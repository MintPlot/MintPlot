/**
 * OpenAI-compatible chat-completions streaming client (M3 minimal pipeline,
 * native) — the execution segment chatbox needs: stream deltas, abort,
 * timeout, usage capture. Retry/backoff and the diagnostics journal join
 * with the pipeline batch; the shape below is their landing surface.
 *
 * SSE discipline: lines split on \n, `data: ` prefix, `[DONE]` sentinel.
 * `stream_options.include_usage` requests the usage block; providers that
 * ignore it simply report nothing (usage-stats skips absent usage).
 */

export interface LlmChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface LlmRequestConfig {
  baseUrl: string
  apiKey: string
  model: string
}

export interface LlmUsage {
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
}

export interface StreamChatResult {
  content: string
  usage: LlmUsage | null
}

export interface StreamChatOptions {
  signal?: AbortSignal
  onDelta?: (delta: string) => void
}

export class LlmRequestError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'LlmRequestError'
  }
}

const FETCH_TIMEOUT_MS = 120000

/** Reads one SSE `data:` payload per line; returns null for non-data lines. */
function parseSseData(line: string): string | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith('data:')) return null
  return trimmed.slice(5).trim()
}

function readSseStream(body: ReadableStream<Uint8Array>, onChunk: (payload: string) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    const pump = async (): Promise<void> => {
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          let newlineIndex = buffer.indexOf('\n')
          while (newlineIndex !== -1) {
            const line = buffer.slice(0, newlineIndex)
            buffer = buffer.slice(newlineIndex + 1)
            const payload = parseSseData(line)
            if (payload !== null) onChunk(payload)
            newlineIndex = buffer.indexOf('\n')
          }
        }
        // Flush a trailing line without a newline terminator.
        const payload = parseSseData(buffer)
        if (payload !== null) onChunk(payload)
        resolve()
      } catch (error) {
        reject(error)
      }
    }
    void pump()
  })
}

interface ChatCompletionChunk {
  choices?: { delta?: { content?: string } }[]
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  } | null
}

export async function streamChatCompletion(
  config: LlmRequestConfig,
  messages: readonly LlmChatMessage[],
  options: StreamChatOptions = {},
): Promise<StreamChatResult> {
  const base = config.baseUrl.trim().replace(/\/+$/, '')
  if (!base) throw new LlmRequestError('未配置 API Base URL')
  if (!config.model.trim()) throw new LlmRequestError('未配置模型')

  const controller = new AbortController()
  const onAbort = (): void => controller.abort()
  options.signal?.addEventListener('abort', onAbort, { once: true })
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  let content = ''
  let usage: LlmUsage | null = null
  try {
    const response = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: config.model.trim(),
        messages,
        stream: true,
        stream_options: { include_usage: true },
      }),
      signal: controller.signal,
    })
    if (!response.ok) {
      let detail = ''
      try {
        detail = (await response.text()).slice(0, 300)
      } catch {
        // body unreadable — status is the message
      }
      throw new LlmRequestError(`HTTP ${response.status}${detail ? `: ${detail}` : ''}`, response.status)
    }
    if (!response.body) throw new LlmRequestError('响应没有可读流')

    await readSseStream(response.body, (payload) => {
      if (payload === '[DONE]') return
      let chunk: ChatCompletionChunk
      try {
        chunk = JSON.parse(payload) as ChatCompletionChunk
      } catch {
        return // keep-alive comments / partial frames are skipped
      }
      const delta = chunk.choices?.[0]?.delta?.content
      if (delta) {
        content += delta
        options.onDelta?.(delta)
      }
      if (chunk.usage) {
        usage = {
          inputTokens: chunk.usage.prompt_tokens ?? null,
          outputTokens: chunk.usage.completion_tokens ?? null,
          totalTokens: chunk.usage.total_tokens ?? null,
        }
      }
    })
    return { content, usage }
  } catch (error) {
    if (error instanceof LlmRequestError) throw error
    if ((error as Error)?.name === 'AbortError') {
      // Distinguish the caller's abort (return partial) from the timeout.
      if (options.signal?.aborted) {
        return { content, usage }
      }
      throw new LlmRequestError('请求超时')
    }
    throw new LlmRequestError(`请求失败: ${(error as Error)?.message || 'unknown error'}`)
  } finally {
    clearTimeout(timeout)
    options.signal?.removeEventListener('abort', onAbort)
  }
}
