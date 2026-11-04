/**
 * LLM provider seam default (R-09: the kernel owns the interface and the
 * default implementation) — an OpenAI-compatible provider whose config comes
 * from the host settings store through the M4-b profile resolution
 * (`apiProfiles` + `apiActiveProfileId`, legacy flat trio as read fallback;
 * keys ride the secret channel). Plugins override via
 * ctx.registerSeamProvider('llm.provider', …); consumers resolve through
 * ctx.seams or the registry.
 */

import { resolveApiConfig } from '@/kernel/llm/api-profiles'
import type { ApiConfigSnapshot } from '@/kernel/llm/api-profiles'
import type { LlmChatMessage, LlmRequestConfig, LlmUsage } from '@/kernel/llm/chat-completions'
import { completeChatCompletion, streamChatCompletion } from '@/kernel/llm/chat-completions'
import type { SettingsState } from '@/kernel/settings/settings-state'

export const API_SETTINGS_KEYS = ['apiBaseUrl', 'apiKey', 'apiModel', 'apiProfiles', 'apiActiveProfileId'] as const

/** The stream()/complete() shared result shape. */
export interface LlmTurnResult {
  content: string
  /** Native thinking text; optional so third-party providers stay source-
   *  compatible (the default implementation always sets it, '' when none). */
  reasoning?: string
  usage: LlmUsage | null
  model?: string
}

export interface LlmProvider {
  readonly providerId: 'openai-compatible'
  stream(
    messages: readonly LlmChatMessage[],
    options: {
      signal?: AbortSignal
      onDelta?: (delta: string) => void
      /** Native reasoning deltas (M4-f) — optional, older providers omit. */
      onReasoningDelta?: (delta: string) => void
      /** Session-level model override (M4-g3 parity): replaces the active
       *  profile's model name; endpoint/key still come from the profile. */
      model?: string
    },
  ): Promise<LlmTurnResult>
  /** Non-streaming single-shot completion (文本输出形式 'whole' mode).
   *  OPTIONAL so third-party seam overrides stay source-compatible — the
   *  turn engine falls back to a delta-suppressed stream when absent. */
  complete?(
    messages: readonly LlmChatMessage[],
    options: {
      signal?: AbortSignal
      /** Session-level model override, same semantics as stream(). */
      model?: string
    },
  ): Promise<LlmTurnResult>
  configured(): boolean
}

export type { ApiConfigSnapshot } from '@/kernel/llm/api-profiles'

export function readApiConfig(settings: SettingsState): ApiConfigSnapshot {
  return resolveApiConfig(settings.snapshot())
}

export function createOpenAiCompatibleProvider(settings: SettingsState): LlmProvider {
  const config = (): LlmRequestConfig => {
    const { baseUrl, apiKey, model } = readApiConfig(settings)
    return { baseUrl, apiKey, model }
  }
  return {
    providerId: 'openai-compatible',
    configured() {
      const { baseUrl, model } = config()
      return !!baseUrl && !!model
    },
    async stream(messages, options) {
      const resolved = config()
      const override = options.model?.trim()
      // Session-level override (M4-g3): the model name swaps, the active
      // profile keeps supplying the endpoint and key.
      return streamChatCompletion(override ? { ...resolved, model: override } : resolved, messages, options)
    },
    async complete(messages, options) {
      const resolved = config()
      const override = options.model?.trim()
      return completeChatCompletion(
        override ? { ...resolved, model: override } : resolved,
        messages,
        { signal: options.signal },
      )
    },
  }
}
