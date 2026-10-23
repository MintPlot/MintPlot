/**
 * Chatbox conversation store (M3, native) — the chatbox domain's persistence
 * over the kind-scoped storage repository. Two key families (ADR-003 domain
 * partitioning):
 *   - `chat:chatbox:<id>`   message ROWS ONLY — per-row incremental writes
 *     through the ported chat-persistence organ (baseline → upserts/deletes),
 *     exactly the shape MPStorage.applyChatChanges expects;
 *   - `chatmeta:chatbox:<id>` the conversation envelope (title/systemPrompt/
 *     model/updatedTs) plus the list preview, written per save.
 * The id index rides `chatbox:index`.
 */

import type { SessionScope, StorageRepository } from '@/kernel/store/storage-repository'
import { advanceBaseline, captureChatRows, createBaseline, createCapturedChanges, readCapturedChatRow, recoverInterruptedDraft } from '@/kernel/store/chat-persistence'
import type { CapturedChatRow } from '@/kernel/store/chat-persistence'
import type { StoredMessage } from '@/kernel/store/chat-persistence'
import { createSessionTaskQueue } from '@/kernel/store/session-task-queue'
import { cloneJson } from '@/kernel/secrets/secret-channel'

export const INDEX_KEY = 'chatbox:index'

export interface ChatboxMessage extends StoredMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  ts: number
  /** Swipe candidates (M4-c): regenerate appends; `content` always mirrors
   *  the active candidate. Absent = single-candidate legacy floor. */
  candidates?: string[]
  activeIndex?: number
  /** User-attached images (M4-c/M4-d): the dataUrl persists with the floor;
   *  `description` is the vision-model text (empty in direct-vision mode). */
  imageAttachments?: Array<{ dataUrl: string; description: string }>
  /** Native thinking text (M4-f) — reasoning_content-family stream fields,
   *  persisted per floor. Tag-based <think>/<cot> stays inside `content`
   *  (verbatim-storage discipline); this field is the wire-only channel. */
  reasoning?: string
  /** Thinking-card open state (M4-f), persisted per floor; absent = default
   *  (open while the floor is streaming, collapsed once finished). */
  cotOpen?: boolean
  /** Native reasoning per swipe candidate (M4-f), index-aligned with
   *  `candidates`. Absent/legacy floors = no per-candidate thinking. */
  candidateReasoning?: string[]
}

export interface ChatboxConversation {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  /** Session-level system prompt (spec §02: editable per conversation). */
  systemPrompt: string
  /** Session-level model override; empty = the provider default. */
  model: string
  messages: ChatboxMessage[]
  /** Pinned-to-top flag (1.0.x list management); absent/legacy = not pinned. */
  pinned?: boolean
}

interface ConversationMeta {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  systemPrompt: string
  model: string
  preview: string
  pinned?: boolean
}

export interface ChatboxConversationSummary {
  id: string
  title: string
  updatedAt: number
  preview: string
  pinned?: boolean
}

export interface ChatboxStore {
  list(): Promise<ChatboxConversationSummary[]>
  get(id: string): Promise<ChatboxConversation | null>
  create(title?: string): Promise<ChatboxConversation>
  /** Persists message rows incrementally + the envelope meta. */
  save(conversation: ChatboxConversation): Promise<void>
  remove(id: string): Promise<void>
  /** Envelope-only pin toggle (1.0.x): message rows are never touched. */
  setPinned(id: string, pinned: boolean): Promise<void>
}

const metaKeyOf = (id: string): string => `chatmeta:chatbox:${id}`
const scopeOf = (id: string): SessionScope => ({ kind: 'chatbox', id })

const serialize = <M extends ChatboxMessage>(message: M): M => JSON.parse(JSON.stringify(message)) as M

type ChatboxSaveSnapshot = Omit<ChatboxConversation, 'messages'> & { rows: readonly CapturedChatRow[]; preview: string }

export function createChatboxStore(repository: StorageRepository): ChatboxStore {
  const baselines = new Map<string, Map<string, string>>()
  const run = createSessionTaskQueue()

  const captureConversation = (conversation: ChatboxConversation): ChatboxSaveSnapshot => {
    const { messages, ...meta } = conversation
    const rows = captureChatRows(messages, baselines.get(conversation.id))
    const last = rows[rows.length - 1]
    return { ...cloneJson(meta), rows, preview: last ? readCapturedChatRow<ChatboxMessage>(last).content.slice(0, 60) : '' }
  }
  const saveSnapshot = async (conversation: ChatboxSaveSnapshot): Promise<void> => {
    const previous = baselines.get(conversation.id)
    const baseline = previous ?? new Map<string, string>()
    const changes = createCapturedChanges<ChatboxMessage>(conversation.rows, baseline)
    if (!previous && conversation.rows.length === 0) await repository.replaceChat(scopeOf(conversation.id), [])
    else await repository.applyChatChanges(scopeOf(conversation.id), changes.upserts, changes.deletes)
    baselines.set(conversation.id, advanceBaseline(baseline, changes))
    const meta: ConversationMeta = {
      id: conversation.id, title: conversation.title, createdAt: conversation.createdAt, updatedAt: conversation.updatedAt,
      systemPrompt: conversation.systemPrompt, model: conversation.model, preview: conversation.preview, pinned: conversation.pinned,
    }
    await repository.set(metaKeyOf(conversation.id), meta)
    const ids = (await repository.get<string[]>(INDEX_KEY)) ?? []
    if (!ids.includes(conversation.id)) {
      ids.unshift(conversation.id)
      await repository.set(INDEX_KEY, ids)
    }
  }

  return {
    async list(): Promise<ChatboxConversationSummary[]> {
      const ids = (await repository.get<string[]>(INDEX_KEY)) ?? []
      const summaries: ChatboxConversationSummary[] = []
      for (const id of ids) {
        const meta = await repository.get<ConversationMeta>(metaKeyOf(id))
        if (meta) {
          summaries.push({ id: meta.id, title: meta.title, updatedAt: meta.updatedAt, preview: meta.preview, pinned: meta.pinned })
        }
      }
      // Pinned group first, most recent within each group (spec §02 + 1.0.x pinning).
      return summaries.sort((a, b) => {
        if ((b.pinned ? 1 : 0) !== (a.pinned ? 1 : 0)) return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)
        return b.updatedAt - a.updatedAt
      })
    },

    async get(id) {
      return run(id, async () => {
        const meta = await repository.get<ConversationMeta>(metaKeyOf(id))
        if (!meta) return null
        const messages = await repository.loadChat<ChatboxMessage>(scopeOf(id))
        baselines.set(id, createBaseline(messages, serialize))
        return {
          id: meta.id,
          title: meta.title,
          createdAt: meta.createdAt,
          updatedAt: meta.updatedAt,
          systemPrompt: meta.systemPrompt,
          model: meta.model,
          messages,
          pinned: meta.pinned,
        }
      })
    },

    async create(title) {
      const now = Date.now()
      const conversation: ChatboxConversation = {
        id: `cb-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        title: title ?? '新的对话',
        createdAt: now,
        updatedAt: now,
        systemPrompt: '',
        model: '',
        messages: [],
      }
      const ids = (await repository.get<string[]>(INDEX_KEY)) ?? []
      ids.unshift(conversation.id)
      await repository.set(INDEX_KEY, ids)
      await this.save(conversation)
      return conversation
    },

    async save(conversation) {
      conversation.updatedAt = Date.now()
      const snapshot = captureConversation(conversation)
      await run(conversation.id, () => saveSnapshot(snapshot))
    },

    async remove(id) {
      await run(id, async () => {
        await repository.deleteChat(scopeOf(id))
        baselines.delete(id)
        await repository.remove(metaKeyOf(id))
        const ids = (await repository.get<string[]>(INDEX_KEY)) ?? []
        await repository.set(INDEX_KEY, ids.filter((entry) => entry !== id))
      })
    },

    async setPinned(id, pinned) {
      await run(id, async () => {
        const meta = await repository.get<ConversationMeta>(metaKeyOf(id))
        if (!meta) return
        await repository.set(metaKeyOf(id), { ...meta, pinned })
      })
    },
  }
}

/** Interrupted-stream recovery: mark a dangling draft floor final. */
export function recoverStreamingFloor(message: ChatboxMessage | null | undefined, marker: string): boolean {
  return recoverInterruptedDraft(message, marker)
}
