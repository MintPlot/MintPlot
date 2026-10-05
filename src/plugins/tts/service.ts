/**
 * tts service — ported from the decoupling-line tts organ (baseline main
 * 81ef0b8; originally the RP app.mjs "TTS 语音朗读" section, the ADR-001
 * Phase 1 pilot). State, engine listeners, cloud config sync, speak actions
 * and the system-voice fallback. The host supplies capabilities only via
 * PluginContext; no TTS module leaks to the shell.
 *
 * Secret flow (R-11 step one, loan-based):
 *  - the settings input binds the user's key field through the settings
 *    scope (the user's own config flow, persisted via the secret channel);
 *  - engine configuration goes through ctx.secrets.use single-shot loans —
 *    the plaintext only enters this configure call; the service keeps no
 *    reference, persists nothing, logs nothing.
 */

import { computed, ref, watch } from 'vue'
import type { ComputedRef, Ref } from 'vue'
import type { PluginContext } from '@contracts'
import textModule from './tts-text'
import { getTtsProviderById, ttsProviderOptions } from './provider-presets'
import type { TtsProviderPreset } from './provider-presets'

/** Whitelist keys (mirrors manifest.json extensionPoints.settingsScope). */
const TTS_SETTING_KEYS = [
  'ttsEnabled', 'ttsAutoPlay', 'ttsService', 'ttsVoice',
  'ttsCloudProviderId', 'ttsCloudBaseUrl', 'ttsCloudModel', 'ttsCloudVoice', 'ttsCloudApiKey', 'ttsCloudSpeed',
  'ttsRate', 'ttsPitch', 'ttsDialogueOnly', 'ttsSkipActions', 'ttsMaxChars',
] as const

type TtsSettingsFields = Record<(typeof TTS_SETTING_KEYS)[number], unknown>

export interface TtsEngineStatus {
  available: boolean
  engineLabel: string
  state: string
  error: string
  checked: boolean
}

export interface TtsEngineFacade {
  getStatus(): TtsEngineStatus & { currentUtteranceId?: string | null }
  refreshStatus(): Promise<Partial<TtsEngineStatus> & { available?: boolean }>
  speak(args: { text: string; voice?: string; rate?: number; pitch?: number; speed?: number }): Promise<string>
  stop(): Promise<void>
  onState(cb: (payload: { state: string }) => void): () => boolean
  isAvailable?(): boolean
  configure?(cfg: { baseUrl: string; apiKey: string; model: string; format?: string }): unknown
}

export interface TtsMessageRef {
  id: string
  content: string
}

export interface TtsService {
  readonly settings: TtsSettingsFields
  readonly ttsStatus: Ref<TtsEngineStatus>
  readonly ttsStatusLabel: ComputedRef<string>
  readonly ttsPlayingMessageId: Ref<string | null>
  readonly ttsSettingsExpanded: Ref<boolean>
  readonly ttsServiceOptions: readonly { id: string; name: string; desc: string; available: boolean }[]
  readonly ttsReadMode: ComputedRef<string>
  readonly ttsCloudProviderOptions: readonly TtsProviderPreset[]
  readonly ttsCloudVoiceOptions: ComputedRef<string[]>
  readonly ttsCloudModelOptions: ComputedRef<string[]>
  selectTtsService(id: string): void
  refreshTtsStatus(): Promise<boolean>
  testTtsVoice(): Promise<void>
  ttsSpeakTextFor(msg: { id?: string; content?: string } | null | undefined): string
  toggleSpeakMessage(index: number): Promise<void>
  /** M4-c: bus-driven floor speak (kernel emits tts.speak.requested). */
  toggleSpeakContent(msg: { id?: string; content?: string } | null | undefined): Promise<void>
  stopSpeaking(): Promise<void>
  onTtsCloudProviderChange(): void
}

export function createTtsService(ctx: PluginContext): TtsService {
  const settings = ctx.settings.scope(TTS_SETTING_KEYS) as unknown as TtsSettingsFields

  // Seam resolution: both engines register first in the activation order of
  // index.ts; the service picks them up by providerId.
  const systemEngine = ctx.seams.resolve<TtsEngineFacade>('tts.engine', 'system')?.implementation
  const cloudEngine = ctx.seams.resolve<TtsEngineFacade>('tts.engine', 'cloud')?.implementation

  const ttsStatus = ref<TtsEngineStatus>({ available: false, engineLabel: '', state: 'idle', error: '', checked: false })
  const ttsPlayingMessageId = ref<string | null>(null)
  const ttsSettingsExpanded = ref(false)
  const ttsServiceOptions = [
    { id: 'system', name: '系统语音', desc: 'Android 系统引擎，无需下载', available: true },
    { id: 'cloud', name: '云端 API', desc: 'OpenAI 兼容接口，按量计费', available: true },
  ] as const
  let ttsStateListener: ((payload: { state: string }) => void) | null = null
  let cloudStateListener: ((payload: { state: string }) => void) | null = null

  // ONE closure shared by both engines — ensureTtsEngineListeners can run on
  // every status refresh / speak, and the cloud engine's listener set does
  // not dedupe: a fresh closure per call accumulated unboundedly.
  const handleEngineEnd = (payload: { state: string }): void => {
    if (payload && (payload.state === 'done' || payload.state === 'error' || payload.state === 'stop')) {
      if (ttsPlayingMessageId.value !== null) ttsPlayingMessageId.value = null
    }
  }

  const ensureTtsEngineListeners = (): void => {
    if (!ttsStateListener && systemEngine?.onState) {
      ttsStateListener = handleEngineEnd
      systemEngine.onState(ttsStateListener)
    }
    if (!cloudStateListener && cloudEngine?.onState) {
      cloudStateListener = handleEngineEnd
      cloudEngine.onState(cloudStateListener)
    }
  }

  // Push the persisted cloud provider fields into the engine. The API key
  // is borrowed once per sync via the vault (R-11); it only ever rides the
  // runtime request header.
  const syncCloudTtsConfig = (): boolean => {
    if (!cloudEngine?.configure) return false
    // MP adaptation: secrets.use is async here (RP's was sync) — a missing
    // loan must not leave an unhandled rejection; the engine simply stays
    // unconfigured.
    ctx.secrets.use('ttsCloudApiKey', (apiKey) => {
      cloudEngine.configure!({
        baseUrl: String(settings.ttsCloudBaseUrl ?? ''),
        apiKey: String(apiKey ?? ''),
        model: String(settings.ttsCloudModel ?? ''),
        format: 'mp3',
      })
    }).catch(() => {
      // secret not provisioned yet; cloud tts stays unavailable
    })
    return !!cloudEngine.isAvailable?.()
  }

  // Provider preset switching prefills baseUrl/model/voice once; the user
  // can then override any field freely.
  const onTtsCloudProviderChange = (): void => {
    const provider = getTtsProviderById(String(settings.ttsCloudProviderId ?? ''))
    if (!provider) return
    settings.ttsCloudBaseUrl = provider.baseUrl || ''
    settings.ttsCloudModel = provider.models?.[0] || ''
    settings.ttsCloudVoice = provider.voices?.[0] || ''
  }

  const ttsCloudVoiceOptions = computed(() => getTtsProviderById(String(settings.ttsCloudProviderId ?? ''))?.voices ?? [])
  const ttsCloudModelOptions = computed(() => getTtsProviderById(String(settings.ttsCloudProviderId ?? ''))?.models ?? [])

  // Keep the engine's provider snapshot and the settings status line in
  // step while the user edits cloud fields. The watcher handle is disposed
  // on deactivation — activate() runs outside any effect scope, so without
  // an explicit stop the deactivated plugin kept reacting to setting edits.
  const stopSettingsWatch = watch(() => [settings.ttsCloudBaseUrl, settings.ttsCloudApiKey, settings.ttsCloudModel, settings.ttsCloudProviderId], () => {
    if (settings.ttsService === 'cloud') void refreshTtsStatus()
  })

  const refreshSystemTtsStatus = async (): Promise<boolean> => {
    const engine = systemEngine
    if (!engine) return false
    try {
      const info = await engine.refreshStatus()
      ttsStatus.value = {
        available: !!info.available,
        engineLabel: info.engineLabel ?? '',
        state: info.state ?? 'idle',
        error: info.error ?? '',
        checked: info.checked ?? true,
      }
      ensureTtsEngineListeners()
      return !!info.available
    } catch (error) {
      console.warn('[tts] refresh status failed:', error)
      return false
    }
  }

  const refreshTtsStatus = async (): Promise<boolean> => {
    if (settings.ttsService === 'cloud') {
      const available = syncCloudTtsConfig()
      ttsStatus.value = {
        available,
        engineLabel: '云端 API',
        state: cloudEngine?.getStatus().state ?? 'idle',
        error: available ? '' : '未配置 Base URL',
        checked: true,
      }
      return available
    }
    const engine = systemEngine
    if (!engine) {
      ttsStatus.value = { available: false, engineLabel: '', state: 'idle', error: '', checked: true }
      return false
    }
    const ready = await refreshSystemTtsStatus()
    if (!ready) {
      ttsStatus.value = { available: false, engineLabel: '', state: 'idle', error: ttsStatus.value?.error || '', checked: true }
    }
    return ready
  }

  const ttsStatusLabel = computed(() => {
    const info = ttsStatus.value
    if (settings.ttsService === 'cloud') {
      if (!info.available) return '云端语音未配置（需填写 Base URL）'
      if (info.state === 'speaking') return '正在朗读…'
      return '云端语音引擎已就绪'
    }
    if (!info.checked && !info.available) return '语音引擎检测中…'
    if (!info.available) return '系统语音引擎不可用（仅 Android 设备支持）'
    if (info.state === 'speaking') return '正在朗读…'
    return '系统语音引擎已就绪'
  })

  const selectTtsService = (id: string): void => {
    const service = ttsServiceOptions.find((option) => option.id === id)
    if (!service || !service.available || settings.ttsService === id) return
    void stopSpeaking()
    settings.ttsService = id
    if (id === 'cloud') {
      syncCloudTtsConfig()
      void refreshTtsStatus()
    }
  }

  const ttsReadMode = computed<string>({
    get: () => (settings.ttsDialogueOnly ? 'dialogue' : 'full'),
    set: (value: string) => {
      settings.ttsDialogueOnly = value === 'dialogue'
    },
  })

  const ttsSpeakTextFor = (msg: { id?: string; content?: string } | null | undefined): string => {
    if (!msg || !textModule) return ''
    try {
      return textModule.extractSpeakText(msg.content || '', {
        dialogueOnly: !!settings.ttsDialogueOnly,
        skipActions: !!settings.ttsSkipActions,
        maxChars: Number(settings.ttsMaxChars) || 2000,
      })
    } catch {
      return ''
    }
  }

  const getCurrentTtsVoice = (): string => {
    const characterVoice = ctx.session.getCharacterVoice()
    return characterVoice || (String(settings.ttsVoice ?? ''))
  }

  const speakTtsTextViaSystem = async (text: string): Promise<boolean> => {
    const engine = systemEngine
    if (!engine) throw new Error('语音引擎不可用')
    const ready = await refreshSystemTtsStatus()
    if (!ready) throw new Error('系统语音引擎不可用')
    await engine.speak({
      text,
      voice: getCurrentTtsVoice(),
      rate: Number(settings.ttsRate) || 1,
      pitch: Number(settings.ttsPitch) || 1,
    })
    return true
  }

  const speakTtsTextViaCloud = async (text: string): Promise<boolean> => {
    if (!syncCloudTtsConfig()) throw new Error('云端语音未配置 Base URL')
    const voice = getCurrentTtsVoice()
    await cloudEngine!.speak({
      text,
      voice,
      speed: Number(settings.ttsCloudSpeed) || 1,
    })
    return true
  }

  const speakTtsText = async (text: string): Promise<boolean> => {
    if (settings.ttsService === 'cloud') {
      try {
        return await speakTtsTextViaCloud(text)
      } catch (error) {
        console.warn('[tts] cloud engine failed, falling back to system tts:', error)
        ctx.ui.toast('云端语音失败，改用系统语音朗读', { tone: 'info' })
      }
    }
    return speakTtsTextViaSystem(text)
  }

  const toggleSpeakMessage = async (index: number): Promise<void> => {
    await toggleSpeakContent(ctx.session.getMessageAt(index))
  }

  /** M4-c floor speak button: the kernel emits tts.speak.requested with the
   *  floor text — projection-index free, content rides the event. */
  const toggleSpeakContent = async (msg: { id?: string; content?: string } | null | undefined): Promise<void> => {
    if (!msg?.id) return
    if (ttsPlayingMessageId.value === msg.id) {
      await stopSpeaking()
      return
    }
    if (ttsPlayingMessageId.value !== null) await stopSpeaking()
    if (!settings.ttsEnabled) {
      ctx.ui.toast('请先在「工具 → 插件 → 语音朗读」开启语音朗读', { tone: 'info' })
      return
    }
    const text = ttsSpeakTextFor(msg)
    if (!text) {
      ctx.ui.toast('这条回复没有可朗读的正文', { tone: 'info' })
      return
    }
    try {
      // Mark the playing floor BEFORE awaiting — the cloud engine's speak()
      // resolves only after the whole chunked playback, so a post-await
      // assignment landed after the done event and stuck forever (stop taps
      // started a second overlapping synthesis instead of stopping).
      ttsPlayingMessageId.value = msg.id
      await speakTtsText(text)
    } catch (error) {
      if (ttsPlayingMessageId.value === msg.id) ttsPlayingMessageId.value = null
      console.warn('[tts] speak failed:', error)
      ctx.ui.toast(`朗读失败: ${String((error as Error)?.message || error)}`, { tone: 'error' })
    }
  }

  const stopSpeaking = async (): Promise<void> => {
    ttsPlayingMessageId.value = null
    const engine = systemEngine
    if (engine) {
      try {
        await engine.stop()
      } catch {
        // ignore stop errors
      }
    }
    if (cloudEngine) {
      try {
        await cloudEngine.stop()
      } catch {
        // ignore stop errors
      }
    }
  }

  const testTtsVoice = async (): Promise<void> => {
    if (!settings.ttsEnabled) {
      ctx.ui.toast('请先开启语音朗读', { tone: 'info' })
      return
    }
    try {
      await speakTtsText('你好，这里是语音朗读测试。')
      ctx.ui.toast('正在测试朗读…', { tone: 'info' })
    } catch (error) {
      console.warn('[tts] test speak failed:', error)
      ctx.ui.toast(`朗读失败: ${String((error as Error)?.message || error)}`, { tone: 'error' })
    }
  }

  // Deactivation must stop playback and release reactive work: the engines
  // are module-level singletons holding a live Audio element / utterance —
  // without this, toggling the plugin off left the audio playing with the
  // speak handler already unsubscribed (no way to stop it).
  ctx.onDeactivate(() => {
    stopSettingsWatch()
    void stopSpeaking()
  })

  // Resolve the engine status eagerly — the status line otherwise reads
  // 「语音引擎检测中…」 until the first speak happens to run a refresh.
  void refreshTtsStatus()

  return {
    // Settings whitelist projection (TtsSettings template v-model binds
    // directly; writes land in the host settings store through the scope).
    settings,
    // Status and labels (the chat UI consumes these through the service
    // singleton; names match the pre-port surface).
    ttsStatus,
    ttsStatusLabel,
    ttsPlayingMessageId,
    ttsSettingsExpanded,
    ttsServiceOptions: [...ttsServiceOptions],
    ttsReadMode,
    // Actions
    selectTtsService,
    refreshTtsStatus,
    testTtsVoice,
    ttsSpeakTextFor,
    toggleSpeakMessage,
    toggleSpeakContent,
    stopSpeaking,
    // Cloud settings
    ttsCloudProviderOptions: ttsProviderOptions,
    ttsCloudVoiceOptions,
    ttsCloudModelOptions,
    onTtsCloudProviderChange,
  }
}
