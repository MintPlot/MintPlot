/**
 * Chat persistence (ported from RP `src/modules/chat-persistence.mjs`,
 * baseline 4fedffd, direct port) — baseline/change computation for
 * per-row chat writes plus interrupted-draft recovery. Pure functions; the
 * storage side is MPStorage.applyChatChanges (kind-scoped).
 *
 * Ported lessons kept in place:
 *  - signatures include the row position, so reordering counts as a change;
 *  - draft recovery rejects non-string content instead of coercing it to
 *    '[object Object]' (content may become structured one day);
 *  - recovery appends the streaming marker exactly once.
 */

export interface StoredMessage {
  id: string
  content: unknown
  storageStatus?: 'draft' | 'final'
  [key: string]: unknown
}

export interface ChatRowUpsert<M> {
  position: number
  message: M
  signature: string
}

export interface ChatChanges<M> {
  upserts: ChatRowUpsert<M>[]
  deletes: string[]
}

type Serialize<M> = (message: M) => M

/** The serialized shape persistence works with — must carry a stable id. */
export interface SerializedMessage {
  id: string
  [key: string]: unknown
}

function signature(message: unknown, position: number): string {
  return `${position}\n${JSON.stringify(message)}`
}

export function createBaseline<M extends SerializedMessage>(messages: M[], serialize: Serialize<M>): Map<string, string> {
  const baseline = new Map<string, string>()
  ;(messages ?? []).forEach((message, position) => {
    const serialized = serialize(message)
    baseline.set(serialized.id, signature(serialized, position))
  })
  return baseline
}

export function createChanges<M extends SerializedMessage>(messages: M[], baseline: Map<string, string>, serialize: Serialize<M>): ChatChanges<M> {
  const currentIds = new Set<string>()
  const upserts: ChatRowUpsert<M>[] = []
  ;(messages ?? []).forEach((message, position) => {
    const serialized = serialize(message)
    currentIds.add(serialized.id)
    const nextSignature = signature(serialized, position)
    if (baseline.get(serialized.id) !== nextSignature) {
      upserts.push({ position, message: serialized, signature: nextSignature })
    }
  })
  const deletes = [...baseline.keys()].filter((id) => !currentIds.has(id))
  return { upserts, deletes }
}

/** Advance only after a successful write, using the exact serialized snapshot
 * that was submitted. Live messages may change while storage is awaiting I/O. */
export function advanceBaseline<M extends SerializedMessage>(baseline: Map<string, string>, changes: ChatChanges<M>): Map<string, string> {
  const next = new Map(baseline)
  for (const id of changes.deletes) next.delete(id)
  for (const { message, signature } of changes.upserts) {
    next.set(message.id, signature)
  }
  return next
}

/**
 * Marks an interrupted draft final: trims trailing whitespace and makes sure
 * the streaming marker appears exactly once. Returns whether the message was
 * recovered (callers persist it).
 */
export function recoverInterruptedDraft<M extends StoredMessage>(message: M | null | undefined, marker: string): boolean {
  if (!message || message.storageStatus !== 'draft') return false
  // Non-string content must not be coerced to '[object Object]'; leave it
  // untouched for the caller (ported).
  if (typeof message.content !== 'string') return false
  const content = message.content.trimEnd()
  message.content = marker && !content.includes(marker)
    ? [content, marker].filter(Boolean).join('\n\n')
    : content
  message.storageStatus = 'final'
  return true
}
