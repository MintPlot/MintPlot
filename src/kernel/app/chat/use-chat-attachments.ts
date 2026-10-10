/**
 * Chat image attachments (M4-d): the pending strip, the photo-picker
 * handler and the hybrid-vision capability lookups. Extracted from
 * ChatSessionView (2026-10 cleanup) — pure move, behavior unchanged.
 */
import { computed, ref } from 'vue'
import type { SettingsState } from '@/kernel/settings/settings-state'
import {
  CHAT_IMAGE_MAX_BYTES,
  MAX_CHAT_IMAGES,
  compressImageFile,
  describeImage,
  type PendingChatImage,
} from '@/kernel/llm/vision'
import { resolveApiConfig } from '@/kernel/llm/api-profiles'
import { uiService } from '@/kernel/ui/toasts'

export interface ChatAttachmentsOptions {
  settingsState: SettingsState | null
  /** New picks are refused while a reply streams (the strip clears on send). */
  isStreaming: () => boolean
}

/** D1 hybrid vision: the ACTIVE profile's capability declaration decides
 * direct parts vs the vision-model description fallback. */
export function useChatAttachments(options: ChatAttachmentsOptions) {
  const { settingsState, isStreaming } = options

  const pendingImages = ref<PendingChatImage[]>([])
  const imageInputEl = ref<HTMLInputElement | null>(null)
  const viewerImage = ref('')

  const activeVisionCapable = (): boolean =>
    resolveApiConfig(settingsState?.snapshot() ?? {}).visionCapable === true
  const readVisionModel = (): string => {
    const scope = settingsState?.scope(['visionModel'])
    return String(scope?.visionModel ?? '')
  }
  const pendingImagesNotReady = computed(() => pendingImages.value.some((image) => image.status !== 'ready'))

  const removePendingImage = (id: string): void => {
    pendingImages.value = pendingImages.value.filter((image) => image.id !== id)
  }

  const onChatImageSelected = async (event: Event): Promise<void> => {
    const input = event.target as HTMLInputElement
    const files = Array.from(input.files ?? [])
    // NOTE: input.value stays until every file is READ — Android WebView
    // invalidates photo-picker File handles the moment the input resets
    // ("图片读取失败" on-device). Cleared at the end of the read loop.
    if (files.length === 0 || isStreaming()) { input.value = ''; return }
    if (!activeVisionCapable() && !readVisionModel()) {
      uiService.toast('shell', '请先配置识图模型,或在 API 档案声明「支持看图」', { tone: 'error' })
      return
    }
    const room = MAX_CHAT_IMAGES - pendingImages.value.length
    const accepted = files.slice(0, Math.max(0, room))
    if (accepted.length === 0) {
      uiService.toast('shell', `每条消息最多 ${MAX_CHAT_IMAGES} 张图片`, { tone: 'error' })
      return
    }
    // Size-copy derives from the constant so the two can never drift (cleanup
    // C11: the literal "20MB" used to go stale if the constant moved).
    const maxMb = Math.max(1, Math.round(CHAT_IMAGE_MAX_BYTES / 1048576))
    for (const file of accepted) {
      if (file.size > CHAT_IMAGE_MAX_BYTES) {
        uiService.toast('shell', `单张图片不能超过 ${maxMb}MB`, { tone: 'error' })
        continue
      }
      const id = `img-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
      const pending: PendingChatImage = { id, dataUrl: '', description: '', status: 'analyzing' }
      pendingImages.value = [...pendingImages.value, pending]
      // Compress + (description mode) recognize in the background; failures are
      // per-image and never block the others.
      void (async () => {
        // patchInto = write through a fresh array — the pending object itself is
        // captured UNREACTIVE in this closure (plain object inside the ref), so
        // in-place mutation would never re-render the strip.
        const patchInto = (patch: Partial<PendingChatImage>): void => {
          pendingImages.value = pendingImages.value.map((image) => image.id === id ? { ...image, ...patch } : image)
        }
        try {
          // Capture the compressed dataUrl locally — `pending` is the ORIGINAL
          // object (patchInto replaces array slots with copies), so reading
          // pending.dataUrl here would always send an empty image to the
          // vision model (description mode never worked).
          const dataUrl = await compressImageFile(file)
          patchInto({ dataUrl })
          if (activeVisionCapable()) {
            patchInto({ status: 'ready' })
            return
          }
          const config = resolveApiConfig(settingsState?.snapshot() ?? {})
          const description = await describeImage(
            { baseUrl: config.baseUrl, apiKey: config.apiKey, visionModel: readVisionModel() },
            dataUrl,
          )
          patchInto({ description, status: 'ready' })
        } catch (error) {
          patchInto({ status: 'error', error: error instanceof Error ? error.message : String(error) })
        }
      })()
    }
    // All reads dispatched — now safe to reset the input for the next pick.
    input.value = ''
  }

  return {
    pendingImages,
    pendingImagesNotReady,
    removePendingImage,
    onChatImageSelected,
    imageInputEl,
    viewerImage,
    activeVisionCapable,
    readVisionModel,
  }
}
