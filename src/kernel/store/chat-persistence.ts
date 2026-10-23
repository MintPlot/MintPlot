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

/** Ephemeral, immutable JSON signature captured before a save enters its queue.
 * The id is a hint: toJSON may normalize it, so changed rows resolve it on read. */
export interface CapturedChatRow {
  readonly id: string
  readonly position: number
  readonly signature: string
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
  function* rows() {
    for (const [position, message] of (messages ?? []).entries()) {
      const serialized = serialize(message)
      yield { id: serialized.id, position, signature: signature(serialized, position), message: serialized }
    }
  }
  return changesFromRows(rows(), baseline, row => row.message)
}

/** Reuse committed signatures for unchanged rows rather than retain another
 * historical object graph per queued save. There is no new resident cache. */
export function captureChatRows<M extends SerializedMessage>(messages: M[], baseline?: ReadonlyMap<string, string>): readonly CapturedChatRow[] {
  return (messages ?? []).map((message, position) => {
    const nextSignature = signature(message, position)
    const previous = baseline?.get(message.id)
    return { id: message.id, position, signature: previous === nextSignature ? previous : nextSignature }
  })
}

export function readCapturedChatRow<M extends SerializedMessage>(row: CapturedChatRow): M {
  return JSON.parse(row.signature.slice(String(row.position).length + 1)) as M
}

export function createCapturedChanges<M extends SerializedMessage>(rows: readonly CapturedChatRow[], baseline: Map<string, string>): ChatChanges<M> {
  return changesFromRows(rows, baseline, row => readCapturedChatRow<M>(row))
}

/** One diff algorithm for legacy serialized objects and queued JSON snapshots. */
function changesFromRows<M extends SerializedMessage, R extends CapturedChatRow>(rows: Iterable<R>, baseline: Map<string, string>, read: (row: R) => M): ChatChanges<M> {
  const currentIds = new Set<string>()
  const upserts: ChatRowUpsert<M>[] = []
  for (const row of rows) {
    if (baseline.get(row.id) === row.signature) {
      currentIds.add(row.id)
      continue
    }
    const message = read(row)
    currentIds.add(message.id)
    if (baseline.get(message.id) !== row.signature) upserts.push({ position: row.position, message, signature: row.signature })
  }
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
