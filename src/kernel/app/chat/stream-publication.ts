import { limits } from '@/kernel/runtime/runtime-policy'

export interface StreamText {
  content: string
  reasoning: string
}

/** Receive every delta, but publish at most once per interval. Terminal
 * paths drain synchronously so hidden-page timer throttling cannot lose text. */
export function createStreamPublication(publish: (text: StreamText) => void, interval = limits.streamFlushMs) {
  let text: StreamText = { content: '', reasoning: '' }
  let timer: ReturnType<typeof setTimeout> | undefined
  let dirty = false
  let closed = false
  let lastPublished = -Infinity

  const flush = (): void => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
    if (!dirty) return
    dirty = false
    lastPublished = Date.now()
    publish({ ...text })
  }
  const schedule = (): void => {
    dirty = true
    const remaining = interval - (Date.now() - lastPublished)
    if (remaining <= 0) flush()
    else if (timer === undefined) timer = setTimeout(flush, remaining)
  }
  return {
    append(field: keyof StreamText, delta: string): void {
      if (closed || !delta) return
      text[field] += delta
      schedule()
    },
    flush,
    finish(final?: StreamText): void {
      if (closed) return
      if (final && (text.content !== final.content || text.reasoning !== final.reasoning)) {
        text = { ...final }
        dirty = true
      }
      flush()
      closed = true
    },
  }
}
