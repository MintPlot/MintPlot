/**
 * Variable store (M3-q, native) — the card-session variables ledger, one key
 * `variables:card:<cardId>` holding `{seed, events}` (D5): the state table is
 * a deterministic replay projection (seed ⊕ variable.set events, engine
 * {@link replayVariableState}), so floor-positioned replay for future
 * branches / swipe rollback is a fold over the same facts. Event shape = the
 * contract `VariableSetEvent` (pluginId 'variables', sessionKind 'card') —
 * a later migration into the shared session ledger stays shape-compatible.
 *
 * Key partitioning mirrors the card-session store (ADR-003 domain keys):
 * the session id IS the card id, card domain only — variables never enter
 * the chatbox domain (review Q4 两域独立纪律).
 */

import type { VariableSetEvent, VariableState, VariableValue } from '@contracts'
import type { StorageRepository } from '@/kernel/store/storage-repository'
import {
  replayVariableState,
  resolveUpdateValue,
  VARIABLE_VALUE_MAX_LENGTH,
} from '@/kernel/variables/variable-engine'
import type { CardVariableDefault, ParsedVariableUpdate } from '@/kernel/variables/variable-engine'

const keyOf = (cardId: string): string => `variables:card:${cardId}`

interface VariableRecord {
  seed: CardVariableDefault[]
  events: VariableSetEvent[]
}

export interface VariableSnapshot {
  cardId: string
  seed: readonly CardVariableDefault[]
  events: readonly VariableSetEvent[]
  state: Record<string, VariableState>
}

export interface VariableApplyOptions {
  source: VariableSetEvent['source']
  /** AI-side updates: the floor the tag block was parsed from. */
  messageId?: string
}

export interface VariableStore {
  /** Loads the session's variables, seeding card defaults on first touch. */
  ensure(cardId: string, defaults: CardVariableDefault[]): Promise<VariableSnapshot>
  /** 清空重开: fresh seed snapshot, empty event stream. */
  reset(cardId: string, defaults: CardVariableDefault[]): Promise<VariableSnapshot>
  get(cardId: string): Promise<VariableSnapshot | null>
  /** Resolves updates against the current state (delta semantics), appends
   *  one event per name (no-op updates are skipped), replays, persists. */
  apply(cardId: string, updates: ParsedVariableUpdate[], options: VariableApplyOptions): Promise<VariableSnapshot>
}

const toSnapshot = (cardId: string, record: VariableRecord): VariableSnapshot => ({
  cardId,
  seed: record.seed,
  events: record.events,
  state: replayVariableState(record.seed, record.events),
})

const newEventId = (): string => `ev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

const sameValue = (a: VariableValue, b: VariableValue): boolean =>
  a === b || JSON.stringify(a) === JSON.stringify(b)

export function createVariableStore(repository: StorageRepository): VariableStore {
  const clampEventValue = (value: VariableValue): VariableValue =>
    typeof value === 'string' && value.length > VARIABLE_VALUE_MAX_LENGTH
      ? value.slice(0, VARIABLE_VALUE_MAX_LENGTH)
      : value

  return {
    async ensure(cardId, defaults) {
      const existing = await repository.get<VariableRecord>(keyOf(cardId))
      if (existing) return toSnapshot(cardId, existing)
      const record: VariableRecord = { seed: defaults, events: [] }
      await repository.set(keyOf(cardId), record)
      return toSnapshot(cardId, record)
    },

    async reset(cardId, defaults) {
      const record: VariableRecord = { seed: defaults, events: [] }
      await repository.set(keyOf(cardId), record)
      return toSnapshot(cardId, record)
    },

    async get(cardId) {
      const record = await repository.get<VariableRecord>(keyOf(cardId))
      return record ? toSnapshot(cardId, record) : null
    },

    async apply(cardId, updates, options) {
      const record =
        (await repository.get<VariableRecord>(keyOf(cardId))) ?? { seed: [], events: [] }
      if (updates.length > 0) {
        const state = replayVariableState(record.seed, record.events)
        for (const update of updates) {
          const before = state[update.name]?.value ?? null
          const resolved = resolveUpdateValue(update.raw, before)
          // Deleting an absent variable and rewriting the same value are not
          // facts worth a ledger row (structural equality for trees).
          if (resolved === null ? before === null : (before !== null && sameValue(before, resolved))) continue
          const event: VariableSetEvent = {
            id: newEventId(),
            ts: Date.now(),
            kind: 'variable.set',
            pluginId: 'variables',
            sessionId: cardId,
            sessionKind: 'card',
            name: update.name,
            before,
            after: resolved === null ? null : clampEventValue(resolved),
            source: options.source,
            ...(options.messageId ? { messageId: options.messageId } : {}),
          }
          record.events.push(event)
          if (event.after === null) delete state[update.name]
          else state[update.name] = { value: event.after, updatedAt: event.ts, sourceEventId: event.id }
        }
        await repository.set(keyOf(cardId), record)
      }
      return toSnapshot(cardId, record)
    },
  }
}
