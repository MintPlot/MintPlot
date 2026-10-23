/**
 * UI affordances (M2 minimal) — toast host state plus the per-plugin PluginUi
 * the runtime issues. confirm() renders the in-app ConfirmDialogHost modal
 * since the M4-a shared-UI upgrade (was the window.confirm fallback);
 * progress upgrade to kernel base components remains with the shared UI batch
 * (ADR-001 §02 duty 6). Toasts issued by a plugin are disposed with its
 * activation bag.
 */

import { ref } from 'vue'
import { errorHub } from '@/kernel/diagnostics/error-hub'
import { requestConfirm } from '@/kernel/ui/confirm-dialog'
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
    const tone = options?.tone ?? 'info'
    push(owner, message, tone, options?.durationMs ?? (tone === 'error' ? 4000 : 1000))
    // Mirror (D6): every error toast leaves a journal trace — existing call
    // sites start recording with zero changes. Mirror records carry no code;
    // code-bearing failures record explicitly at their throw/wiring site.
    if (options?.tone === 'error') {
      errorHub.record({
        severity: 'error',
        category: owner === 'shell' ? 'runtime' : 'plugin',
        action: 'toast_error',
        message,
        pluginId: owner === 'shell' ? undefined : owner,
      })
    }
  },
  confirm(owner, options) {
    return requestConfirm(owner, options)
  },
  progress(owner) {
    const dismiss = push(owner, '处理中…', 'info', 0)
    return { close: dismiss }
  },
}

export function useToasts() {
  return toasts
}
