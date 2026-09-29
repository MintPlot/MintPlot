/**
 * LLM provider seam default (R-09: the kernel owns the interface and the
 * default implementation) — an OpenAI-compatible provider whose config comes
 * from the host settings store (`apiBaseUrl` / `apiKey` / `apiModel`; the
 * key is restored by the trusted repository read). Plugins override via
 * ctx.registerSeamProvider('llm.provider', …); consumers resolve through
 * ctx.seams or the registry.
 */

import type { LlmChatMessage, LlmRequestConfig, LlmUsage } from '@/kernel/llm/chat-completions'
import { streamChatCompletion } from '@/kernel/llm/chat-completions'
import type { SettingsState } from '@/kernel/settings/settings-state'

export const API_SETTINGS_KEYS = ['apiBaseUrl', 'apiKey', 'apiModel'] as const

export interface LlmProvider {
  readonly providerId: 'openai-compatible'
  stream(
    messages: readonly LlmChatMessage[],
    options: {
      signal?: AbortSignal
      onDelta?: (delta: string) => void
    },
  ): Promise<{ content: string; usage: LlmUsage | null }>
  configured(): boolean
}

export interface ApiConfigSnapshot {
  baseUrl: string
  apiKey: string
  model: string
}

export function readApiConfig(settings: SettingsState): ApiConfigSnapshot {
  const snapshot = settings.snapshot()
  return {
    baseUrl: String(snapshot.apiBaseUrl ?? ''),
    apiKey: String(snapshot.apiKey ?? ''),
    model: String(snapshot.apiModel ?? ''),
  }
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
