/**
 * tts cloud engine — ported from the decoupling-line tts organ (baseline
 * main 81ef0b8, originally src/modules/tts-cloud-engine.mjs). Speaks through
 * an OpenAI-compatible POST {baseUrl}/audio/speech endpoint; pure web layer
 * (fetch → mp3 blobs → HTMLAudioElement), long text split into
 * sentence-bounded chunks synthesized and played sequentially with one-chunk
 * prefetch. Typed port, logic unchanged; diagnostics journal resolves
 * window.MPRequestDiagnostics (lengths only, never the text).
 */

import ttsText from './tts-text'

const FETCH_TIMEOUT_MS = 30000
const DEFAULT_CHUNK_CHARS = 200
const PREFETCH_AHEAD = 1

interface JournalRecord {
  input?(entry: Record<string, unknown>): void
  behavior?(entry: Record<string, unknown>): void
  complete?(): void
  fail?(error: unknown): void
}

type DiagnosticsHost = { MPRequestDiagnostics?: { begin?: (args: { category: string; action: string }) => JournalRecord | undefined } }

interface CloudProviderConfig {
  baseUrl: string
  apiKey: string
  model: string
  format: string
}

interface EngineState {
  status: 'idle' | 'speaking'
  checked: boolean
  available: boolean
  engineLabel: string
  error: string
  currentUtteranceId: string | null
  provider: CloudProviderConfig
}

const state: EngineState = {
  status: 'idle',
  checked: true,
  available: false,
  engineLabel: '云端 API',
  error: '',
  currentUtteranceId: null,
  provider: { baseUrl: '', apiKey: '', model: '', format: 'mp3' },
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

export interface EngineStatus {
  available: boolean
  engineLabel: string
  state: string
  currentUtteranceId: string | null
  error: string
  checked: boolean
}

const getStatus = (): EngineStatus => ({
  available: state.available,
  engineLabel: state.engineLabel,
  state: state.status,
  currentUtteranceId: state.currentUtteranceId,
  error: state.error,
  checked: state.checked,
})

const isAvailable = (): boolean => state.available

export interface ConfigureArgs {
  baseUrl: string
  apiKey: string
  model: string
  format?: string
}

const configure = (config?: Partial<ConfigureArgs>): EngineStatus => {
  state.provider.baseUrl = String(config?.baseUrl || '').trim().replace(/\/+$/, '')
  state.provider.apiKey = String(config?.apiKey || '')
  state.provider.model = String(config?.model || '').trim()
  state.provider.format = String(config?.format || 'mp3').trim() || 'mp3'
  state.available = !!state.provider.baseUrl
  return getStatus()
}

const refreshStatus = async (): Promise<EngineStatus> => getStatus()

const activeControllers = new Set<AbortController>()
let activeAudio: HTMLAudioElement | null = null
const liveObjectUrls = new Set<string>()

const releaseUrl = (url: string): void => {
  if (!url || !liveObjectUrls.has(url)) return
  liveObjectUrls.delete(url)
  try {
    URL.revokeObjectURL(url)
  } catch {
    // ignore
  }
}

const teardownPlayback = (): void => {
  activeControllers.forEach((controller) => {
    try {
      controller.abort()
    } catch {
      // ignore
    }
  })
  activeControllers.clear()
  if (activeAudio) {
    try {
      activeAudio.pause()
    } catch {
      // ignore
    }
    activeAudio.removeAttribute('src')
    activeAudio = null
  }
  liveObjectUrls.forEach((url) => {
    try {
      URL.revokeObjectURL(url)
    } catch {
      // ignore
    }
  })
  liveObjectUrls.clear()
}

const requestChunkAudio = async (chunk: string, voice: string, speed: number): Promise<string> => {
  const { baseUrl, apiKey, model, format } = state.provider
  const controller = new AbortController()
  activeControllers.add(controller)
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(`${baseUrl}/audio/speech`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: model || 'tts-1',
        input: chunk,
        voice: voice || 'alloy',
        speed: Number(speed) || 1,
        response_format: format,
      }),
      signal: controller.signal,
    })
    if (!response.ok) {
      let detail = ''
      try {
        detail = (await response.text()).slice(0, 200)
      } catch {
        // ignore
      }
      throw new Error(`HTTP ${response.status}${detail ? `: ${detail}` : ''}`)
    }
    const blob = await response.blob()
    if (!blob.size) throw new Error('Empty audio response')
    const url = URL.createObjectURL(blob)
    liveObjectUrls.add(url)
    return url
  } finally {
    clearTimeout(timeout)
    activeControllers.delete(controller)
  }
}

const playAudioUrl = (url: string, utteranceId: string): Promise<void> => new Promise((resolve, reject) => {
  const audio = new Audio(url)
  activeAudio = audio
  const cleanup = (): void => {
    audio.removeEventListener('ended', onEnded)
    audio.removeEventListener('error', onError)
    if (activeAudio === audio) activeAudio = null
  }
  const onEnded = (): void => {
    cleanup()
    releaseUrl(url)
    resolve()
  }
  const onError = (): void => {
    cleanup()
    releaseUrl(url)
    reject(new Error('Audio playback failed'))
  }
  audio.addEventListener('ended', onEnded)
  audio.addEventListener('error', onError)
  // A stop() between chunk generations surfaces as an aborted fetch or a
  // paused element; treat a paused element without error as a clean stop.
  audio.play().then(() => {
    if (state.currentUtteranceId !== utteranceId) {
      audio.pause()
    }
  }).catch((error) => {
    cleanup()
    releaseUrl(url)
    reject(error)
  })
})

export interface CloudSpeakArgs {
  text: string
  voice?: string
  speed?: number
  utteranceId?: string
  chunkChars?: number
}

const speak = async ({ text, voice = '', speed = 1, utteranceId = '', chunkChars = DEFAULT_CHUNK_CHARS }: CloudSpeakArgs): Promise<string> => {
  if (!state.provider.baseUrl) throw new Error('云端 API 未配置 Base URL')
  const safeText = String(text || '').trim()
  if (!safeText) throw new Error('没有可朗读的文本')
  const chunks = ttsText.splitSpeechChunks(safeText, chunkChars)
  if (!chunks.length) throw new Error('没有可朗读的文本')
  const id = utteranceId || `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`

  state.currentUtteranceId = id
  state.status = 'speaking'
  state.error = ''
  emit({ utteranceId: id, state: 'start' })

  const prefetches = new Map<number, Promise<string>>()
  // Journal: chunk/text counts only, never the text itself.
  const journal = (globalThis as typeof globalThis & DiagnosticsHost).MPRequestDiagnostics?.begin?.({ category: 'tts', action: 'cloud_speech' })
  journal?.input?.({ kind: 'speak_text', chars: safeText.length })
  journal?.behavior?.({ name: 'cloud_tts_chunking', result: 'ok', meta: { chunks: chunks.length } })
  const startPrefetch = (index: number): void => {
    if (index >= chunks.length || prefetches.has(index)) return
    prefetches.set(index, requestChunkAudio(chunks[index]!, voice, speed))
  }

  try {
    startPrefetch(0)
    for (let index = 0; index < chunks.length; index += 1) {
      if (state.currentUtteranceId !== id) {
        journal?.fail?.({ name: 'AbortError', message: 'stopped by user' })
        return id
      } // stopped
      startPrefetch(index + PREFETCH_AHEAD)
      const url = await prefetches.get(index)!
      prefetches.delete(index)
      await playAudioUrl(url, id)
    }
    if (state.currentUtteranceId === id) {
      state.status = 'idle'
      state.currentUtteranceId = null
      emit({ utteranceId: id, state: 'done' })
    }
    journal?.complete?.()
  } catch (error) {
    teardownPlayback()
    prefetches.clear()
    const aborted = state.currentUtteranceId !== id
    state.status = 'idle'
    state.currentUtteranceId = null
    if (aborted) {
      // stop() already tore playback down and emitted the stop event.
      journal?.fail?.({ name: 'AbortError', message: 'stopped by user' })
    } else {
      state.error = String((error as Error)?.message || error)
      journal?.fail?.(error)
      emit({ utteranceId: id, state: 'error', error: state.error })
      throw error
    }
  }
  return id
}

const stop = async (): Promise<void> => {
  const id = state.currentUtteranceId
  teardownPlayback()
  state.currentUtteranceId = null
  state.status = 'idle'
  if (id) emit({ utteranceId: id, state: 'stop' })
}

const exports = Object.freeze({
  getStatus,
  refreshStatus,
  configure,
  isAvailable,
  speak,
  stop,
  onState: (callback: StateListener): (() => boolean) => {
    listeners.add(callback)
    return () => listeners.delete(callback)
  },
})

export default exports
