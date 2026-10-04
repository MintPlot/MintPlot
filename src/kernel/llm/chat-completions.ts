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

/** Multimodal content part (M4-d): direct-vision requests send the user turn
 *  as text + image_url parts; providers without vision reject with their own
 *  error (surfaces through the normal error bar). */
export interface LlmTextPart {
  type: 'text'
  text: string
}

export interface LlmImageUrlPart {
  type: 'image_url'
  image_url: { url: string; detail?: 'high' | 'low' | 'auto' }
}

export type LlmContentPart = LlmTextPart | LlmImageUrlPart

export interface LlmChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | LlmContentPart[]
}

export interface LlmRequestConfig {
  baseUrl: string
  apiKey: string
  model: string
  /** Sampling temperature (analysis runs at 0.2; chat leaves it unset). */
  temperature?: number
  /** Output token cap — the analysis budget is decoupled from chat. */
  maxTokens?: number
  /** Ask the provider for structured JSON output (response_format). */
  jsonMode?: boolean
}

export interface LlmUsage {
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
  /** Cached prompt tokens when the provider reports the detail block. */
  cacheReadTokens: number | null
}

export interface StreamChatResult {
  content: string
  usage: LlmUsage | null
  /** Model id as reported by the response, falling back to the request config. */
  model: string
}

export interface StreamChatOptions {
  signal?: AbortSignal
  onDelta?: (delta: string) => void
}

export class LlmRequestError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    /** Unified error code (M3-err1) — attached at the throw site. */
    readonly code?: string,
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
  model?: string
  choices?: { delta?: { content?: string } }[]
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
    prompt_tokens_details?: { cached_tokens?: number } | null
  } | null
}

export async function streamChatCompletion(
  config: LlmRequestConfig,
  messages: readonly LlmChatMessage[],
  options: StreamChatOptions = {},
): Promise<StreamChatResult> {
  const base = config.baseUrl.trim().replace(/\/+$/, '')
  if (!base) throw new LlmRequestError('未配置 API Base URL', undefined, 'MP-CHAT-001')
  if (!config.model.trim()) throw new LlmRequestError('未配置模型', undefined, 'MP-CHAT-002')

  const controller = new AbortController()
  const onAbort = (): void => controller.abort()
  options.signal?.addEventListener('abort', onAbort, { once: true })
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  let content = ''
  let usage: LlmUsage | null = null
  let model = config.model.trim()
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
        ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
        ...(config.maxTokens !== undefined ? { max_tokens: config.maxTokens } : {}),
        ...(config.jsonMode ? { response_format: { type: 'json_object' } } : {}),
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
      throw new LlmRequestError(`HTTP ${response.status}${detail ? `: ${detail}` : ''}`, response.status, 'MP-NET-002')
    }
    if (!response.body) throw new LlmRequestError('响应没有可读流', undefined, 'MP-NET-004')

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
      if (chunk.model) model = chunk.model
      if (chunk.usage) {
        usage = {
          inputTokens: chunk.usage.prompt_tokens ?? null,
          outputTokens: chunk.usage.completion_tokens ?? null,
          totalTokens: chunk.usage.total_tokens ?? null,
          cacheReadTokens: chunk.usage.prompt_tokens_details?.cached_tokens ?? null,
        }
      }
    })
    return { content, usage, model }
  } catch (error) {
    if (error instanceof LlmRequestError) throw error
    if ((error as Error)?.name === 'AbortError') {
      // Distinguish the caller's abort (return partial) from the timeout.
      if (options.signal?.aborted) {
        return { content, usage, model }
      }
      throw new LlmRequestError('请求超时', undefined, 'MP-NET-001')
    }
    throw new LlmRequestError(`请求失败: ${(error as Error)?.message || 'unknown error'}`, undefined, 'MP-NET-003')
  } finally {
    clearTimeout(timeout)
    options.signal?.removeEventListener('abort', onAbort)
  }
}

interface ChatCompletionResponse {
  model?: string
  choices?: { message?: { content?: string } }[]
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
    prompt_tokens_details?: { cached_tokens?: number } | null
  } | null
}

const normalizeUsage = (usage: ChatCompletionResponse['usage']): LlmUsage | null =>
  usage
    ? {
        inputTokens: usage.prompt_tokens ?? null,
        outputTokens: usage.completion_tokens ?? null,
        totalTokens: usage.total_tokens ?? null,
        cacheReadTokens: usage.prompt_tokens_details?.cached_tokens ?? null,
      }
    : null

/** One-shot (non-streaming) completion — the secondary-model analysis path
 *  (M3-t): temperature 0.2, its own token budget, optional JSON mode, same
 *  timeout/error discipline as the streaming client. */
export async function completeChatCompletion(
  config: LlmRequestConfig,
  messages: readonly LlmChatMessage[],
  options: { signal?: AbortSignal } = {},
): Promise<StreamChatResult> {
  const base = config.baseUrl.trim().replace(/\/+$/, '')
  if (!base) throw new LlmRequestError('未配置 API Base URL')
  if (!config.model.trim()) throw new LlmRequestError('未配置模型')

  const controller = new AbortController()
  const onAbort = (): void => controller.abort()
  options.signal?.addEventListener('abort', onAbort, { once: true })
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

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
        ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
        ...(config.maxTokens !== undefined ? { max_tokens: config.maxTokens } : {}),
        ...(config.jsonMode ? { response_format: { type: 'json_object' } } : {}),
        stream: false,
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
    const data = (await response.json()) as ChatCompletionResponse
    return {
      content: data.choices?.[0]?.message?.content ?? '',
      usage: normalizeUsage(data.usage),
      model: data.model ?? config.model.trim(),
    }
  } catch (error) {
    if (error instanceof LlmRequestError) throw error
    if ((error as Error)?.name === 'AbortError') {
      if (options.signal?.aborted) throw new LlmRequestError('分析已取消')
      throw new LlmRequestError('请求超时')
    }
    throw new LlmRequestError(`请求失败: ${(error as Error)?.message || 'unknown error'}`)
  } finally {
    clearTimeout(timeout)
    options.signal?.removeEventListener('abort', onAbort)
  }
}
