/**
 * Token usage formatting (ADR-004 absorption of the RP frozen surface's
 * kernel/lib token-format) — pure functions shared by usage-stats and any
 * later token-accounting consumer. Typed port, logic unchanged: these travel
 * via the @contracts barrel so every organ uses one source.
 *
 * Usage records are normalized from the many provider shapes (OpenAI,
 * Gemini-style candidate counts, Anthropic cache fields) into one record with
 * `reported` telling whether the provider reported anything at all.
 */

export const formatTokenUsageTime = (timestamp: number): string =>
  new Date(timestamp).toLocaleString('zh-CN', { hour12: false })

export const formatTokenAggregate = (value: number, reports: number): string =>
  reports > 0 && value > 0 ? `${Number((value / 1000000).toFixed(2))}M` : '0'

/** RP semantics: providers omit fields, so the input is nullable — anything
 *  non-finite renders as '0'. */
export const formatTokenCount = (value: number | null | undefined): string =>
  Number.isFinite(value) ? (value as number).toLocaleString() : '0'

/** Compact "7.18k"-style token counts for the inline usage bar. */
export const formatLatestTokenCount = (value: number): string => {
  const count = Number(value)
  if (!Number.isFinite(count) || count <= 0) return '0'
  return count >= 1000 ? `${(count / 1000).toFixed(2)}k` : String(count)
}

export type TokenUsageCategory = 'chat' | 'memory' | 'variables'

export const getTokenUsageCategory = (type: string): TokenUsageCategory => {
  if (['summary', 'embedding'].includes(type)) return 'memory'
  if (type === 'ui_template') return 'variables'
  return 'chat'
}

/** First finite non-negative number among the candidates, rounded. */
export const readUsageNumber = (...values: unknown[]): number | null => {
  for (const value of values) {
    const number = Number(value)
    if (Number.isFinite(number) && number >= 0) return Math.round(number)
  }
  return null
}

export interface NormalizedApiUsage {
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
  cacheReadTokens: number | null
  cacheWriteTokens: number
  reasoningTokens: number | null
  /** Whether any token field was reported at all. */
  reported: boolean
}

interface UnknownRecord {
  [key: string]: unknown
}

export const normalizeApiUsage = (usage: unknown): NormalizedApiUsage => {
  const source: UnknownRecord = usage && typeof usage === 'object' ? (usage as UnknownRecord) : {}
  const promptDetails: UnknownRecord = (source.prompt_tokens_details ?? source.input_tokens_details ?? {}) as UnknownRecord
  const completionDetails: UnknownRecord = (source.completion_tokens_details ?? source.output_tokens_details ?? {}) as UnknownRecord
  const cacheReadTokens = readUsageNumber(
    promptDetails.cached_tokens,
    promptDetails.cache_read_tokens,
    source.cache_read_input_tokens,
    source.cache_read_tokens,
    source.cachedContentTokenCount,
    source.cached_content_token_count,
  )
  const reportedCacheWriteTokens = readUsageNumber(
    promptDetails.cache_creation_tokens,
    promptDetails.cache_write_tokens,
    source.cache_creation_input_tokens,
    source.cache_creation_tokens,
    source.cache_write_input_tokens,
    source.cache_write_tokens,
  )
  const cacheWriteTokens = reportedCacheWriteTokens ?? 0
  const promptTokens = readUsageNumber(
    source.prompt_tokens,
    source.promptTokenCount,
    source.inputTokenCount,
  )
  const nativeInputTokens = readUsageNumber(source.input_tokens)
  const inputTokens = promptTokens !== null
    ? promptTokens
    : nativeInputTokens !== null
      ? nativeInputTokens + (cacheReadTokens || 0) + (cacheWriteTokens || 0)
      : null
  const outputTokens = readUsageNumber(
    source.completion_tokens,
    source.output_tokens,
    source.candidatesTokenCount,
    source.outputTokenCount,
  )
  const reasoningTokens = readUsageNumber(
    completionDetails.reasoning_tokens,
    source.reasoning_tokens,
    source.thoughtsTokenCount,
  )
  let totalTokens = readUsageNumber(source.total_tokens, source.totalTokenCount)
  if (totalTokens === null && (inputTokens !== null || outputTokens !== null)) {
    totalTokens = (inputTokens || 0) + (outputTokens || 0)
  }
  const reported = [inputTokens, outputTokens, totalTokens, cacheReadTokens, reasoningTokens, reportedCacheWriteTokens]
    .some((value) => value !== null)
  return { inputTokens, outputTokens, totalTokens, cacheReadTokens, cacheWriteTokens, reasoningTokens, reported }
}
