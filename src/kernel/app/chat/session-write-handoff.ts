/** Page-local handoff only: stores still own serialization and persistence.
 * Register before the next entry reads. A failed write is observed by that
 * entry before a subsequent explicit retry may reread authoritative storage. */
const pending = new WeakMap<object, Map<string, Promise<void>>>()

export function beginSessionWriteHandoff(store: object, id: string, save: () => Promise<void>): Promise<void> {
  let sessions = pending.get(store)
  if (!sessions) { sessions = new Map(); pending.set(store, sessions) }
  // Invoke immediately: both stores capture rows and enqueue synchronously.
  let result: Promise<void>
  try { result = save() } catch (error) { result = Promise.reject(error) }
  sessions.set(id, result)
  void result.then(() => { if (sessions.get(id) === result) sessions.delete(id) }, () => {})
  return result
}

export async function waitForSessionWriteHandoff(store: object, id: string): Promise<void> {
  const sessions = pending.get(store)
  const result = sessions?.get(id)
  if (!result) return
  try { await result } finally { if (sessions?.get(id) === result) sessions.delete(id) }
}
