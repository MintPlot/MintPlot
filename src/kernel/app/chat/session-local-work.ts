import { ref } from 'vue'

/** Join already-started local writes at page handoff. This owns no storage
 * queue or snapshots; repositories remain the sole persistence executors.
 * Network work gets a revocable generation and is never part of the join. */
export function createSessionLocalWork(onFailure: () => void = () => {} ) {
  let controller = new AbortController()
  const writes = new Set<Promise<unknown>>()
  const failed = ref(false)
  const track = <T>(write: Promise<T>): Promise<T> => {
    writes.add(write)
    void write.then(() => writes.delete(write), () => {
      writes.delete(write)
      if (!failed.value) { failed.value = true; onFailure() }
    })
    return write
  }
  return {
    signal: () => controller.signal,
    cancel: () => { controller.abort(); controller = new AbortController() },
    retire: () => controller.abort(),
    track,
    hasPending: () => writes.size > 0,
    failed: () => failed.value,
    async drain(): Promise<void> {
      await Promise.allSettled([...writes])
      if (failed.value) throw new Error('session_local_write_failed')
    },
  }
}

export interface SessionLocalWorkOptions {
  sessionSignal?: () => AbortSignal
  trackLocalWrite?: <T>(write: Promise<T>) => Promise<T>
}
