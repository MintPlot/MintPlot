/**
 * provider-presets — cloud TTS provider preset table (ported from the
 * decoupling-line tts organ; originally migrated out of RP useApiConfig.mjs:
 * TTS domain data travels with the plugin). 'custom' is the generic escape
 * hatch: the user fills baseUrl / model / voice (relay stations,
 * fish-speech OpenAI mode, LAN gateways). Presets only prefill once; every
 * field stays user-overridable.
 */

export interface TtsProviderPreset {
  id: string
  name: string
  baseUrl: string
  models: string[]
  voices: string[]
}

export const ttsProviderOptions: readonly TtsProviderPreset[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    models: ['tts-1', 'tts-1-hd', 'gpt-4o-mini-tts'],
    voices: ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'onyx', 'nova', 'sage', 'shimmer'],
  },
  {
    id: 'custom',
    name: '自定义（OpenAI 兼容）',
    baseUrl: '',
    models: [],
    voices: [],
  },
]

export const getTtsProviderById = (id: string): TtsProviderPreset | undefined =>
  ttsProviderOptions.find((provider) => provider.id === id)
