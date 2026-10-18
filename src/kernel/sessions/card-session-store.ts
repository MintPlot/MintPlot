/**
 * Card-session store (M3-i, native) — the card domain's one-session-per-card
 * persistence, mirroring the chatbox store's key families (ADR-003 domain
 * partitioning):
 *   - `chat:card:<cardId>`     message ROWS ONLY — per-row incremental writes
 *     through the ported chat-persistence organ, exactly the shape
 *     MPStorage.applyChatChanges expects;
 *   - `chatmeta:card:<cardId>` the conversation envelope (card id/title/
 *     timestamps/preview), written per save.
 * The session id IS the card id (RP scope discipline: the character record is
 * the storage scope), so there is no index key — the card library is the
 * session list, and card sessions never enter `chatbox:index` (spec §03
 * domain isolation).
 */

import type { SessionScope, StorageRepository } from '@/kernel/store/storage-repository'
import { advanceBaseline, createBaseline, createChanges } from '@/kernel/store/chat-persistence'
import type { ChatboxMessage } from '@/kernel/sessions/chatbox-store'
import type { CardStyleSelection } from '@/kernel/presets/style-assembly'

/** The card fields a session needs at creation (from the character store). */
export interface CardSessionSeed {
  id: string
  name: string
  firstMes: string
}

/** Card-cover backdrop tuning (1.0.x): per-card, rides the envelope.
 *  Absent = the defaults the view applies (enabled, blur 40px, dim 45%). */
export interface CardBackdrop {
  enabled: boolean
  /** Blur radius in px (0–40). */
  blur: number
  /** Dim overlay opacity in % (0–80). */
  dim: number
}

export interface CardSession {
  cardId: string
  /** Card name at creation; the live name renders from the character store. */
  title: string
  createdAt: number
  updatedAt: number
  /** Same floor shape as the chatbox domain (role/content/ts/id). */
  messages: ChatboxMessage[]
  /** Session-level model override (M4-g3 parity): empty = the active
   *  profile's model. Endpoint/key still come from the active profile. */
  model?: string
  bg?: CardBackdrop
  /** Per-card style-dimension selection (style-dimension-presets-plan S3):
   *  absent or followGlobal=true = the global active-group combination. */
  style?: CardStyleSelection
}

interface CardSessionMeta {
  cardId: string
  title: string
  createdAt: number
  updatedAt: number
  preview: string
  model?: string
  bg?: CardBackdrop
  style?: CardStyleSelection
}

export interface CardSessionStore {
  get(cardId: string): Promise<CardSession | null>
  /** Creates the card's session; a non-empty first_mes seeds the greeting floor. */
  create(card: CardSessionSeed): Promise<CardSession>
  /** Persists message rows incrementally + the envelope meta. */
  save(session: CardSession): Promise<void>
  remove(cardId: string): Promise<void>
  /** D3 清空重开: drop every floor, reseed the greeting. */
  reset(card: CardSessionSeed): Promise<CardSession>
}

const metaKeyOf = (cardId: string): string => `chatmeta:card:${cardId}`
const scopeOf = (cardId: string): SessionScope => ({ kind: 'card', id: cardId })

const serialize = (message: ChatboxMessage): ChatboxMessage => JSON.parse(JSON.stringify(message)) as ChatboxMessage

const previewOf = (messages: ChatboxMessage[]): string => {
  const last = messages[messages.length - 1]
  return last ? last.content.slice(0, 60) : ''
}

export function createCardSessionStore(repository: StorageRepository): CardSessionStore {
  const baselines = new Map<string, Map<string, string>>()

  const seedMessages = (card: CardSessionSeed): ChatboxMessage[] =>
    card.firstMes
      ? [{ id: `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, role: 'assistant', content: card.firstMes, ts: Date.now() }]
      : []

  return {
    async get(cardId) {
      const meta = await repository.get<CardSessionMeta>(metaKeyOf(cardId))
      if (!meta) return null
      const messages = await repository.loadChat<ChatboxMessage>(scopeOf(cardId))
      baselines.set(cardId, createBaseline(messages, serialize))
      return {
        cardId: meta.cardId,
        title: meta.title,
        createdAt: meta.createdAt,
        updatedAt: meta.updatedAt,
        messages,
        ...(meta.model ? { model: meta.model } : {}),
        ...(meta.bg ? { bg: meta.bg } : {}),
        ...(meta.style ? { style: meta.style } : {}),
      }
    },

    async create(card) {
      const now = Date.now()
      const session: CardSession = {
        cardId: card.id,
        title: card.name,
        createdAt: now,
        updatedAt: now,
        messages: seedMessages(card),
      }
      await this.save(session)
      return session
    },

    async save(session) {
      session.updatedAt = Date.now()
      // Message rows: incremental per-row writes (ported organ semantics).
      const baseline = baselines.get(session.cardId) ?? createBaseline([], serialize)
      const changes = createChanges(session.messages, baseline, serialize)
      await repository.applyChatChanges(scopeOf(session.cardId), changes.upserts, changes.deletes)
      baselines.set(session.cardId, advanceBaseline(baseline, changes))

      // Envelope: meta write (no index — the card library is the list).
      const meta: CardSessionMeta = {
        cardId: session.cardId,
        title: session.title,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        preview: previewOf(session.messages),
        ...(session.model ? { model: session.model } : {}),
        ...(session.bg ? { bg: session.bg } : {}),
        ...(session.style ? { style: session.style } : {}),
      }
      await repository.set(metaKeyOf(session.cardId), meta)
    },

    async remove(cardId) {
      await repository.deleteChat(scopeOf(cardId))
      await repository.remove(metaKeyOf(cardId))
      // M4-e: the card's memory ledger is session-scoped data — it dies with
      // the session (card removal and 清空重开 alike; idempotent there, the
      // view resets memory through the same repository contract).
      await repository.deleteMemoryFragments(scopeOf(cardId))
      baselines.delete(cardId)
    },

    async reset(card) {
      await this.remove(card.id)
      return this.create(card)
    },
  }
}
