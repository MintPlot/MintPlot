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
import { streamChatCompletion } from '@/kernel/llm/chat-completions'
import type { SettingsState } from '@/kernel/settings/settings-state'

export const API_SETTINGS_KEYS = ['apiBaseUrl', 'apiKey', 'apiModel', 'apiProfiles', 'apiActiveProfileId'] as const

export interface LlmProvider {
  readonly providerId: 'openai-compatible'
  stream(
    messages: readonly LlmChatMessage[],
    options: {
      signal?: AbortSignal
      onDelta?: (delta: string) => void
    },
  ): Promise<{ content: string; usage: LlmUsage | null; model?: string }>
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
      return streamChatCompletion(config(), messages, options)
    },
  }
}
