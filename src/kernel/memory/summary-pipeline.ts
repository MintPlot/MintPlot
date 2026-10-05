/**
 * Rolling-summary pipeline (M4-e, native) — the rewrite chain behind the
 * memory plugin: every batch feeds {previous summary + profile + raw turns}
 * through one NON-streaming completion and rewrites them together (RP
 * semantics — a new-only digest drifts). Requests ride the ACTIVE profile's
 * endpoint with the dedicated memory-model slot (empty = the chat model);
 * temperature 0.2, a token budget decoupled from chat, 2 attempts on
 * retryable errors, JSON-tolerant parsing with a plain-text downgrade.
 *
 * Batches run sequentially until the window is covered. A failure parks the
 * anchor (the failed range retries on the next trigger) and stops the chain;
 * the >200-floor breaker stops runaway chains so a poisoned session can
 * never loop forever. Parsing/application split follows the analysis
 * pipeline shape (M3-t): this module returns the new state, the caller
 * persists it.
 */

import type { LlmChatMessage, LlmRequestConfig, LlmUsage } from '@/kernel/llm/chat-completions'
import { completeChatCompletion } from '@/kernel/llm/chat-completions'
import type { SettingsState } from '@/kernel/settings/settings-state'
import { computePendingBatch, sanitizeMemoryProfile } from './memory-engine'
import type { MemoryState } from './memory-engine'
import { MEMORY_SUMMARY_SYSTEM_PROMPT } from './prompts'

export interface MemorySummarySettings {
  /** Dedicated memory-model slot; empty = follow the chat model. */
  model: string
  keepFloors: number
  batchSize: number
  maxOutputTokens: number
}

const clamp = (value: number, min: number, max: number, fallback: number): number =>
  Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback

export function readMemorySummarySettings(settings: SettingsState | null): MemorySummarySettings {
  if (!settings) {
    return { model: '', keepFloors: 16, batchSize: 8, maxOutputTokens: 1024 }
  }
  const scope = settings.scope(['memoryModel', 'memoryKeepFloors', 'memoryBatchSize', 'memoryMaxOutputTokens'])
  return {
    model: String(scope.memoryModel ?? '').trim(),
    keepFloors: clamp(Number(scope.memoryKeepFloors), 8, 40, 16),
    batchSize: clamp(Number(scope.memoryBatchSize), 4, 24, 8),
    maxOutputTokens: clamp(Number(scope.memoryMaxOutputTokens), 256, 8192, 1024),
  }
}

/** One turn as the pipeline sees it (request projection, storage untouched). */
export interface SummaryFloor {
  role: 'user' | 'assistant'
  name: string
  content: string
}

/** Breaker: past this anchor a session must be rebuilt, not extended. */
export const MEMORY_ANCHOR_LIMIT = 200

const SUMMARY_MAX_ATTEMPTS = 2
const RETRY_BACKOFF_MS = 800

const isRetryable = (error: unknown): boolean => {
  const status = (error as { status?: number })?.status
  if (status === 429 || (typeof status === 'number' && status >= 500 && status <= 599)) return true
  const message = String((error as Error)?.message ?? '')
  return message.includes('请求失败') // network-layer TypeError wrapper
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

type CompleteFn = (
  config: LlmRequestConfig,
  messages: readonly LlmChatMessage[],
  options: { signal?: AbortSignal },
) => Promise<{ content: string; usage: LlmUsage | null; model: string }>

const requestWithRetry = async (
  complete: CompleteFn,
  config: LlmRequestConfig,
  messages: LlmChatMessage[],
  signal: AbortSignal | undefined,
): Promise<{ content: string; usage: LlmUsage | null; model: string }> => {
  let lastError: unknown
  for (let attempt = 0; attempt < SUMMARY_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await complete(config, messages, { signal })
    } catch (error) {
      lastError = error
      if (signal?.aborted) throw error
      if (!isRetryable(error) || attempt >= SUMMARY_MAX_ATTEMPTS - 1) break
      await sleep(RETRY_BACKOFF_MS * (attempt + 1))
    }
  }
  throw lastError
}

/**
 * Fault-tolerant reply parsing (RP tolerance ladder): direct JSON → fence
 * stripped → brace span; a reply with no parsable JSON downgrades to the
 * short summary verbatim (prose IS a summary — better than dropping the
 * batch). Missing/invalid fields keep the previous values.
 */
export function parseSummaryReply(
  content: string,
  previous: MemoryState,
): Pick<MemoryState, 'short' | 'long' | 'profile'> {
  const text = content.trim()
  if (!text) throw new Error('模型没有返回有效内容')
  const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
  const braceStart = stripped.indexOf('{')
  const braceEnd = stripped.lastIndexOf('}')
  const candidates = [stripped, ...(braceStart >= 0 && braceEnd > braceStart ? [stripped.slice(braceStart, braceEnd + 1)] : [])]
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue
      const obj = parsed as Record<string, unknown>
      const profile = sanitizeMemoryProfile(obj.profile)
      return {
        short: typeof obj.short === 'string' && obj.short.trim() ? obj.short.trim() : previous.short,
        long: typeof obj.long === 'string' && obj.long.trim() ? obj.long.trim() : previous.long,
        profile: {
          characters: profile.characters.length > 0 ? profile.characters : previous.profile.characters,
          relations: profile.relations.length > 0 ? profile.relations : previous.profile.relations,
          openPlots: profile.openPlots.length > 0 ? profile.openPlots : previous.profile.openPlots,
        },
      }
    } catch {
      // try the next candidate
    }
  }
  return { short: text.length > 400 ? text.slice(0, 400) : text, long: previous.long, profile: previous.profile }
}

export interface RollingSummaryOptions {
  config: { baseUrl: string; apiKey: string; model: string }
  /** The session's FULL floor projection in stored order (index space of
   *  the anchor). Callers map system floors out IF they exist — the count
   *  must match what the pruning/injection path uses. */
  floors: readonly SummaryFloor[]
  state: MemoryState
  settings: { keepFloors: number; batchSize: number; maxOutputTokens: number }
  signal?: AbortSignal
  complete?: CompleteFn
  onUsage?: (usage: LlmUsage | null, meta: { type: 'summary'; model: string; detail: string }) => void
}

export interface RollingSummaryResult {
  state: MemoryState
  batches: number
  /** Empty when the chain finished (or was aborted); otherwise the first
   *  failure message — the failed range stays parked for retry. */
  error: string
}

export async function runRollingSummary(options: RollingSummaryOptions): Promise<RollingSummaryResult> {
  const complete = options.complete ?? completeChatCompletion
  const { signal } = options
  let state = options.state
  let batches = 0
  let error = ''

  if (state.anchor >= MEMORY_ANCHOR_LIMIT) {
    return { state, batches, error: `已整理 ${state.anchor} 楼,达到上限,请清空重建记忆` }
  }

  for (;;) {
    if (signal?.aborted) break
    const pending = computePendingBatch(options.floors.length, options.settings.keepFloors, options.settings.batchSize, state)
    if (!pending) break
    const turns = options.floors
      .slice(pending.from, pending.to)
      .map(({ role, name, content }) => ({ role, name, content }))
    const messages: LlmChatMessage[] = [
      { role: 'system', content: MEMORY_SUMMARY_SYSTEM_PROMPT },
      { role: 'user', content: JSON.stringify({ previous: { short: state.short, long: state.long, profile: state.profile }, turns }) },
    ]
    const config: LlmRequestConfig = {
      baseUrl: options.config.baseUrl,
      apiKey: options.config.apiKey,
      model: options.config.model,
      temperature: 0.2,
      maxTokens: options.settings.maxOutputTokens,
      jsonMode: true,
    }
    try {
      const result = await requestWithRetry(complete, config, messages, signal)
      const picked = parseSummaryReply(result.content, state)
      state = {
        short: picked.short,
        long: picked.long,
        profile: picked.profile,
        batches: [...state.batches, { from: pending.from, to: pending.to, status: 'done', at: Date.now() }],
        anchor: pending.to,
        updatedAt: Date.now(),
      }
      options.onUsage?.(result.usage, {
        type: 'summary',
        model: result.model,
        detail: `滚动摘要 ${pending.from + 1}–${pending.to} 楼`,
      })
      batches += 1
    } catch (cause) {
      if (signal?.aborted) break
      const message = (cause as Error)?.message || '未知错误'
      state = {
        ...state,
        batches: [...state.batches, { from: pending.from, to: pending.to, status: 'failed', at: Date.now(), error: message }],
        updatedAt: Date.now(),
      }
      error = message
      break
    }
  }
  return { state, batches, error }
}
