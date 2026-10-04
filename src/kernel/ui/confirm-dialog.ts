/**
 * In-app confirm dialog state (M4-a shared-UI upgrade) — replaces the
 * window.confirm fallback, whose native buttons were English and outside the
 * design language. Promise-based queue: callers `await uiService.confirm(...)`
 * as before; requests resolve in order through ConfirmDialogHost (App.vue).
 */

import { ref } from 'vue'

export interface ConfirmRequest {
  readonly id: number
  readonly owner: string
  readonly title: string
  readonly message?: string
  readonly confirmLabel: string
  readonly cancelLabel: string
}

export interface ConfirmOptions {
  title: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string
}

const queue = ref<ConfirmRequest[]>([])
let sequence = 0
const resolvers = new Map<number, (value: boolean) => void>()

export function requestConfirm(owner: string, options: ConfirmOptions): Promise<boolean> {
  const id = (sequence += 1)
  queue.value = [
    ...queue.value,
    {
      id,
      owner,
      title: options.title,
      message: options.message,
      confirmLabel: options.confirmLabel ?? '确定',
      cancelLabel: options.cancelLabel ?? '取消',
    },
  ]
  return new Promise((resolve) => {
    resolvers.set(id, resolve)
  })
}

export function resolveConfirm(id: number, value: boolean): void {
  const resolve = resolvers.get(id)
  if (!resolve) return
  resolvers.delete(id)
  queue.value = queue.value.filter((request) => request.id !== id)
  resolve(value)
}

/** Projection for the host component (App.vue). */
export function useConfirmDialog() {
  return queue
}
