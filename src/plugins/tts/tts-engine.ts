/**
 * tts system engine — ported from the decoupling-line tts organ (baseline
 * main 81ef0b8, originally src/modules/tts-engine.mjs). Speaks through the
 * Capacitor TTSSpeech native plugin; outside the native shell it reports
 * unavailable. Typed port, logic unchanged; the diagnostics journal resolves
 * window.MPRequestDiagnostics (kernel pipeline seam, M3+) with a no-op
 * fallback. Journal records carry text LENGTHS only, never the text.
 */

interface TtsSpeechPlugin {
  addListener?(eventName: string, callback: (data: unknown) => void): Promise<unknown>
  ttsIsAvailable?(): Promise<{ available?: boolean; engineLabel?: string } | undefined>
  ttsGetVoices?(): Promise<{ voices?: unknown[] } | undefined>
  ttsSpeak?(args: { text: string; voice: string; rate: number; pitch: number; utteranceId: string }): Promise<void>
  ttsStop?(): Promise<void>
}

interface JournalRecord {
  input?(entry: Record<string, unknown>): void
  behavior?(entry: Record<string, unknown>): void
  complete?(): void
  fail?(error: unknown): void
}

type DiagnosticsHost = { MPRequestDiagnostics?: { begin?: (args: { category: string; action: string }) => JournalRecord | undefined } }

const getPlugin = (): TtsSpeechPlugin | null =>
  (globalThis as { Capacitor?: { Plugins?: Record<string, TtsSpeechPlugin> } }).Capacitor?.Plugins?.TTSSpeech ?? null

interface EngineState {
  status: string
  available: boolean
  checked: boolean
  engineLabel: string
  error: string
  currentUtteranceId: string | null
  voices: unknown[]
  voicesLoaded: boolean
}

const state: EngineState = {
  status: 'idle',
  available: false,
  checked: false,
  engineLabel: '',
  error: '',
  currentUtteranceId: null,
  voices: [],
  voicesLoaded: false,
}

type StateListener = (payload: { state: string; utteranceId?: string; error?: string }) => void
const listeners = new Set<StateListener>()

const emit = (payload: { state: string; utteranceId?: string; error?: string }): void => {
  listeners.forEach((callback) => {
    try {
      callback(payload)
    } catch {
      // listener errors must not break the engine
    }
  })
}

let listenerReady: Promise<unknown> | null = null

const ensureListener = (): Promise<unknown> => {
  if (listenerReady) return listenerReady
  listenerReady = (async () => {
    const plugin = getPlugin()
    if (!plugin?.addListener) return
    await plugin.addListener('tts-state', (data) => {
      const payload = (data ?? {}) as { utteranceId?: string; state?: string; error?: string }
      const id = payload.utteranceId
      if (id && state.currentUtteranceId && id !== state.currentUtteranceId) return
      if (payload.state === 'start') {
        state.status = 'speaking'
      } else {
        state.status = 'idle'
        if (id) state.currentUtteranceId = null
      }
      if (payload.state === 'error') state.error = String(payload.error || '朗读失败')
      emit({ utteranceId: id, state: payload.state ?? 'idle', error: payload.error })
    })
  })().catch(() => {
    listenerReady = null
  })
  return listenerReady
}

export interface EngineStatus {
  available: boolean
  engineLabel: string
  state: string
  currentUtteranceId: string | null
  error: string
  checked: boolean
}

const refreshStatus = async (): Promise<EngineStatus> => {
  const plugin = getPlugin()
  if (!plugin?.ttsIsAvailable) {
    state.available = false
    state.engineLabel = ''
    state.checked = true
    return { ...state, state: state.status }
  }
  try {
    const info = await plugin.ttsIsAvailable()
    state.available = !!info?.available
    state.engineLabel = info?.engineLabel || ''
    state.checked = true
    if (state.available) await ensureListener()
  } catch (error) {
    state.available = false
    state.error = String((error as Error)?.message || error)
  }
  return { ...state, state: state.status }
}

const getStatus = (): EngineStatus => ({
  available: state.available,
  engineLabel: state.engineLabel,
  state: state.status,
  currentUtteranceId: state.currentUtteranceId,
  error: state.error,
  checked: state.checked,
})

const getVoices = async (force = false): Promise<unknown[]> => {
  const plugin = getPlugin()
  if (!plugin?.ttsGetVoices) return []
  if (state.voicesLoaded && !force) return state.voices
  const info = await plugin.ttsGetVoices()
  state.voices = Array.isArray(info?.voices) ? info.voices : []
  state.voicesLoaded = true
  return state.voices
}

export interface SpeakArgs {
  text: string
  voice?: string
  rate?: number
  pitch?: number
  speed?: number
}

const speak = async ({ text, voice = '', rate = 1, pitch = 1 }: SpeakArgs): Promise<string> => {
  const plugin = getPlugin()
  if (!plugin?.ttsSpeak) throw new Error('TTS 原生插件不可用')
  const safeText = String(text || '').trim()
  if (!safeText) throw new Error('没有可朗读的文本')
  await ensureListener()
  const utteranceId = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
  state.currentUtteranceId = utteranceId
  state.status = 'speaking'
  // Journal: chars only, never the text itself.
  const journal = (globalThis as typeof globalThis & DiagnosticsHost).MPRequestDiagnostics?.begin?.({ category: 'tts', action: 'system_speak' })
  journal?.input?.({ kind: 'speak_text', chars: safeText.length })
  try {
    await plugin.ttsSpeak({
      text: safeText,
      voice: String(voice || ''),
      rate: Number(rate) || 1,
      pitch: Number(pitch) || 1,
      utteranceId,
    })
  } catch (error) {
    state.status = 'idle'
    state.currentUtteranceId = null
    journal?.fail?.(error)
    throw error
  }
  journal?.complete?.()
  emit({ utteranceId, state: 'start' })
  return utteranceId
}

const stop = async (): Promise<void> => {
  const plugin = getPlugin()
  const id = state.currentUtteranceId
  state.currentUtteranceId = null
  state.status = 'idle'
  if (plugin?.ttsStop) {
    try {
      await plugin.ttsStop()
    } catch {
      // stop failures on a dying utterance are non-actionable
    }
  }
  if (id) emit({ utteranceId: id, state: 'stop' })
}

const exports = Object.freeze({
  getStatus,
  refreshStatus,
  getVoices,
  speak,
  stop,
  onState: (callback: StateListener): (() => boolean) => {
    listeners.add(callback)
    return () => listeners.delete(callback)
  },
  isAvailable: () => state.available,
})

export default exports
