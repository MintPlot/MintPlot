/**
 * UI affordances (M2 minimal) — toast host state plus the per-plugin PluginUi
 * the runtime issues. confirm() falls back to the platform dialog for now;
 * confirm/progress upgrade to kernel base components with the shared UI batch
 * (ADR-001 §02 duty 6). Toasts issued by a plugin are disposed with its
 * activation bag — pending dialogs close on deactivate.
 */

import { ref } from 'vue'
import type { UiService } from '@/kernel/runtime/context'

export interface MpToast {
  readonly id: number
  readonly owner: string
  readonly message: string
  readonly tone: 'info' | 'success' | 'error'
  /** Sticky toasts (progress) persist until their handle closes them. */
  readonly sticky: boolean
}

const toasts = ref<MpToast[]>([])
let sequence = 0

function push(owner: string, message: string, tone: MpToast['tone'], durationMs: number): () => void {
  const id = (sequence += 1)
  const sticky = durationMs <= 0
  toasts.value = [...toasts.value, { id, owner, message, tone, sticky }]
  let timer: ReturnType<typeof setTimeout> | undefined
  const dismiss = () => {
    if (timer !== undefined) clearTimeout(timer)
    toasts.value = toasts.value.filter((toast) => toast.id !== id)
  }
  if (!sticky) timer = setTimeout(dismiss, durationMs)
  return dismiss
}

export const uiService: UiService = {
  toast(owner, message, options) {
    push(owner, message, options?.tone ?? 'info', options?.durationMs ?? 3000)
  },
  async confirm(_owner, options) {
    const prompt = [options.title, options.message].filter(Boolean).join('\n\n')
    const label = options.confirmLabel ?? '确定'
    return window.confirm(`${prompt}\n\n(${label})`)
  },
  progress(owner) {
    const dismiss = push(owner, '处理中…', 'info', 0)
    return { close: dismiss }
  },
}

export function useToasts() {
  return toasts
}
