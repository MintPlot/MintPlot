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
  /** Swipe-candidate attribution (M4-c): which candidate of the attributed
   *  floor produced the update; absent = primary content (legacy). */
  candidateIndex?: number
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
  /** M4-c floor deletion (连带其后): drops every event attributed to any of
   *  the removed floors. User floors carry no events; later AI floors' events
   *  still must go. */
  rollbackFloors(cardId: string, messageIds: readonly string[]): Promise<VariableSnapshot>
  /** M4-c regenerate: retags the floor's untagged events to the active
   *  candidate index so per-candidate replay stays disjoint. */
  retagUntaggedEvents(cardId: string, messageId: string, candidateIndex: number): Promise<VariableSnapshot>
}

/**
 * Candidate-aware event filter (M4-c): events carrying a candidateIndex only
 * count toward a floor whose active candidate matches — switching swipes must
 * not mix sibling candidates' variables. Untagged events (legacy, manual,
 * plain floors) always count; floors without candidates never filter.
 */
export function filterCandidateEvents(
  events: readonly VariableSetEvent[],
  candidateIndexOf: (messageId: string) => number | undefined,
): VariableSetEvent[] {
  return events.filter((event) => {
    if (event.candidateIndex === undefined) return true
    const active = candidateIndexOf(event.messageId ?? '')
    return active === undefined || event.candidateIndex === active
  })
}

/**
 * Events strictly BEFORE the first event attributed to `messageId` (M4-c):
 * the pre-floor ledger segment a regeneration request must see. Floors with
 * no events return the whole stream unchanged.
 */
export function eventsBeforeFloor(
  events: readonly VariableSetEvent[],
  messageId: string,
): VariableSetEvent[] {
  const index = events.findIndex((event) => event.messageId === messageId)
  return index >= 0 ? events.slice(0, index) : [...events]
}

const toSnapshot = (cardId: string, record: VariableRecord): VariableSnapshot => ({
  cardId,
  seed: record.seed,
  events: record.events,
  state: replayVariableState(record.seed, record.events),
})

/** Floor-attributed state replay (M3-s 逐楼快照): the panel state AS OF a
 *  given chat floor, folded from the seed plus the events attributed to
 *  floors at or before it. RP stores an interpolated snapshot per message;
 *  MP re-derives it at render time from the same ledger — zero storage
 *  duplication, and swipe/deletion semantics come free once floors can move.
 *
 *  Attribution: an AI event sits at its own floor (messageId → index via the
 *  resolver; unknown ids sit at Infinity, i.e. affect no historical floor);
 *  events without a messageId (manual edits, legacy rows) inherit the floor
 *  of the nearest preceding AI event, defaulting to the greeting (0). */
export function replayTemplateStateAtFloor(
  events: readonly VariableSetEvent[],
  name: string,
  initialValue: VariableValue,
  floorIndexOf: (messageId: string) => number,
  targetFloor: number,
): VariableValue {
  let current = cloneTemplateValue(initialValue)
  let inheritedFloor = 0
  for (const event of events) {
    if (event.name !== name) continue
    let floor: number
    if (event.messageId) {
      const resolved = floorIndexOf(event.messageId)
      floor = Number.isInteger(resolved) && resolved >= 0 ? resolved : Number.POSITIVE_INFINITY
    } else {
      floor = inheritedFloor
    }
    inheritedFloor = Number.isFinite(floor) ? floor : inheritedFloor
    if (floor > targetFloor) continue
    if (event.after !== null) current = cloneTemplateValue(event.after)
  }
  return current
}

const cloneTemplateValue = <T>(value: T): T =>
  value === undefined ? (undefined as T) : (JSON.parse(JSON.stringify(value)) as T)

const newEventId = (): string => `ev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

const sameValue = (a: VariableValue, b: VariableValue): boolean =>
  a === b || JSON.stringify(a) === JSON.stringify(b)

export function createVariableStore(repository: StorageRepository): VariableStore {
  const clampEventValue = (value: VariableValue): VariableValue =>
    typeof value === 'string' && value.length > VARIABLE_VALUE_MAX_LENGTH
      ? value.slice(0, VARIABLE_VALUE_MAX_LENGTH)
      : value
  // Serializes apply() read-modify-write pairs (errors isolated per call —
  // a failed apply must not poison the chain for the next one).
  let applyChain: Promise<unknown> = Promise.resolve()

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
      // Serialized read-modify-write: two overlapping applies (AI reply vs a
      // manual sheet save) each read the same record and the last write would
      // silently drop the loser's ledger events — one IDB transaction per
      // operation gives no atomicity across the pair.
      // Delta semantics (M4-c contract): deltas resolve against the FULL
      // ledger — the new candidate CONTINUES the live state; candidate
      // isolation happens at replay time (filterCandidateEvents in the view).
      const run = applyChain.then(async () => {
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
              ...(options.candidateIndex !== undefined ? { candidateIndex: options.candidateIndex } : {}),
            }
            record.events.push(event)
            if (event.after === null) delete state[update.name]
            else state[update.name] = { value: event.after, updatedAt: event.ts, sourceEventId: event.id }
          }
          await repository.set(keyOf(cardId), record)
        }
        return toSnapshot(cardId, record)
      })
      applyChain = run.then(() => undefined, () => undefined)
      return run
    },

    async rollbackFloors(cardId, messageIds) {
      const record =
        (await repository.get<VariableRecord>(keyOf(cardId))) ?? { seed: [], events: [] }
      const removed = new Set(messageIds)
      const filtered = record.events.filter((event) => !removed.has(event.messageId ?? ''))
      if (filtered.length !== record.events.length) {
        record.events = filtered
        await repository.set(keyOf(cardId), record)
      }
      return toSnapshot(cardId, record)
    },

    async retagUntaggedEvents(cardId, messageId, candidateIndex) {
      const record =
        (await repository.get<VariableRecord>(keyOf(cardId))) ?? { seed: [], events: [] }
      let changed = false
      for (const event of record.events) {
        if (event.messageId === messageId && event.candidateIndex === undefined) {
          event.candidateIndex = candidateIndex
          changed = true
        }
      }
      if (changed) await repository.set(keyOf(cardId), record)
      return toSnapshot(cardId, record)
    },
  }
}
