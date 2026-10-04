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
import { createBaseline, createChanges, recoverInterruptedDraft } from '@/kernel/store/chat-persistence'
import type { StoredMessage } from '@/kernel/store/chat-persistence'

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
}

interface ConversationMeta {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  systemPrompt: string
  model: string
  preview: string
}

export interface ChatboxConversationSummary {
  id: string
  title: string
  updatedAt: number
  preview: string
}

export interface ChatboxStore {
  list(): Promise<ChatboxConversationSummary[]>
  get(id: string): Promise<ChatboxConversation | null>
  create(title?: string): Promise<ChatboxConversation>
  /** Persists message rows incrementally + the envelope meta. */
  save(conversation: ChatboxConversation): Promise<void>
  remove(id: string): Promise<void>
}

const metaKeyOf = (id: string): string => `chatmeta:chatbox:${id}`
const scopeOf = (id: string): SessionScope => ({ kind: 'chatbox', id })

const serialize = <M extends ChatboxMessage>(message: M): M => JSON.parse(JSON.stringify(message)) as M

const previewOf = (conversation: ChatboxConversation): string => {
  const last = conversation.messages[conversation.messages.length - 1]
  return last ? last.content.slice(0, 60) : ''
}

export function createChatboxStore(repository: StorageRepository): ChatboxStore {
  const baselines = new Map<string, Map<string, string>>()

  return {
    async list(): Promise<ChatboxConversationSummary[]> {
      const ids = (await repository.get<string[]>(INDEX_KEY)) ?? []
      const summaries: ChatboxConversationSummary[] = []
      for (const id of ids) {
        const meta = await repository.get<ConversationMeta>(metaKeyOf(id))
        if (meta) summaries.push({ id: meta.id, title: meta.title, updatedAt: meta.updatedAt, preview: meta.preview })
      }
      // Most recent first (spec §02).
      return summaries.sort((a, b) => b.updatedAt - a.updatedAt)
    },

    async get(id) {
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
      }
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
      // Message rows: incremental per-row writes (ported organ semantics).
      const baseline = baselines.get(conversation.id) ?? createBaseline([], serialize)
      const changes = createChanges(conversation.messages, baseline, serialize)
      await repository.applyChatChanges(scopeOf(conversation.id), changes.upserts, changes.deletes)
      baselines.set(conversation.id, createBaseline(conversation.messages, serialize))

      // Envelope: meta write + index upsert.
      const meta: ConversationMeta = {
        id: conversation.id,
        title: conversation.title,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        systemPrompt: conversation.systemPrompt,
        model: conversation.model,
        preview: previewOf(conversation),
      }
      await repository.set(metaKeyOf(conversation.id), meta)
      const ids = (await repository.get<string[]>(INDEX_KEY)) ?? []
      if (!ids.includes(conversation.id)) {
        ids.unshift(conversation.id)
        await repository.set(INDEX_KEY, ids)
      }
    },

    async remove(id) {
      await repository.deleteChat(scopeOf(id))
      await repository.remove(metaKeyOf(id))
      const ids = (await repository.get<string[]>(INDEX_KEY)) ?? []
      await repository.set(INDEX_KEY, ids.filter((entry) => entry !== id))
      baselines.delete(id)
    },
  }
}

/** Interrupted-stream recovery: mark a dangling draft floor final. */
export function recoverStreamingFloor(message: ChatboxMessage | null | undefined, marker: string): boolean {
  return recoverInterruptedDraft(message, marker)
}
