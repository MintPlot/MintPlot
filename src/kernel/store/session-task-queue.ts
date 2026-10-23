/** Serialize one session's operations in invocation order. Rejections reach
 * their caller without poisoning later work; settled tails are released. */
export function createSessionTaskQueue() {
  const tails = new Map<string, Promise<void>>()
  return <T>(key: string, operation: () => Promise<T>): Promise<T> => {
    const result = (tails.get(key) ?? Promise.resolve()).then(operation)
    const tail = result.then(() => undefined, () => undefined)
    tails.set(key, tail)
    void tail.then(() => { if (tails.get(key) === tail) tails.delete(key) })
    return result
  }
}
