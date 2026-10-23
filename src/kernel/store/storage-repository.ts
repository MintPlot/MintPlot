/**
 * MPStorage — the storage repository (ported from RP
 * `src/modules/storage-repository.mjs` KV + chat half, baseline 4fedffd).
 * JSON guards, secret extraction and the chat-change application semantics
 * are ported; the storage backend is MP's engine seam ({@link KvEngine},
 * ADR-003 bare idb lands behind it) instead of RP's native plugin bridge.
 *
 * Kind-ization (spec v1.2 §03, measured in M2): every session-scoped API
 * carries an explicit {@link SessionScope} — kind (chatbox | card) plus the
 * session id — and persistence keys are domain-partitioned
 * (`chat:<kind>:<id>`), so the two domains never mix records at rest. RP's
 * organs were character-scoped only; the retrofit cost is measured in
 * documents/planning/mp-m2-kind-retrofit-measurement.html.
 *
 * Deferred to the M3 native batch: media data-URL channel, full backup and
 * restore (they need the Capacitor native shell), and the fragment store
 * beyond deletion (memory extraction engine arrives with the memory plugin).
 */

import type { SessionKind } from '@contracts'
import type { KvEngine } from '@/kernel/store/kv-store'
import {
  createMemorySecretChannel,
  extractSecrets,
  isSecretBearingKey,
  restoreSecrets,
} from '@/kernel/secrets/secret-channel'
import type { SecretChannel } from '@/kernel/secrets/secret-channel'

/** Domain-partitioned scope for every session-scoped record. */
export interface SessionScope {
  kind: SessionKind
  /** Session id within the domain (card-scoped session, chatbox conversation). */
  id: string
}

/** A per-row chat upsert as the persistence contract expects it. */
export interface ChatRowUpsert<M> {
  position: number
  message: M
}

export interface StorageRepository {
  get<T>(key: string): Promise<T | undefined>
  set(key: string, value: unknown): Promise<void>
  remove(key: string): Promise<void>

  loadChat<M>(scope: SessionScope): Promise<M[]>
  applyChatChanges<M>(scope: SessionScope, upserts: ChatRowUpsert<M>[], deletes: string[]): Promise<void>
  replaceChat<M>(scope: SessionScope, messages: M[]): Promise<void>
  deleteChat(scope: SessionScope): Promise<void>
  /** Card-domain memory fragments removal (fragment store itself lands M3+). */
  deleteMemoryFragments(scope: SessionScope): Promise<void>
}

export const chatStorageKey = (scope: SessionScope): string => `chat:${scope.kind}:${scope.id}`
export const memoryStorageKey = (scope: SessionScope): string => `memory:${scope.kind}:${scope.id}`

/** Corrupt-JSON reads degrade loudly, never silently (ported lesson). */
function parseJsonGuarded(json: string | null | undefined, fallback: unknown, key: string): unknown {
  if (json === null || json === undefined || json === '') return fallback
  try {
    return JSON.parse(json) as unknown
  } catch (error) {
    console.error(
      `[mp-storage] corrupt JSON for "${key}" (length=${String(json).length}), falling back:`,
      error instanceof Error ? error.message : error,
    )
    return fallback
  }
}

export function createStorageRepository(engine: KvEngine, secretChannel: SecretChannel = createMemorySecretChannel()): StorageRepository {
  const repository: StorageRepository = {
    async get<T>(key: string): Promise<T | undefined> {
      const json = await engine.get(key)
      const value = parseJsonGuarded(json, undefined, key)
      if (value === undefined || !isSecretBearingKey(key)) return value as T | undefined
      const secrets = parseJsonGuarded(await secretChannel.getSecret(`config:${key}`), {}, `secrets:${key}`) as Record<string, unknown>
      if (Object.keys(secrets).length === 0) {
        // Public data with an empty secret store: two-phase write crash or a
        // lost channel — leave a trace ("API key vanished" debugging).
        console.warn(`[mp-storage] "${key}" has public data but an empty secret store; keys may have been lost`)
      }
      return restoreSecrets(value, secrets) as T | undefined
    },

    async set(key, value): Promise<void> {
      if (value === undefined) {
        // JSON.stringify(undefined) is undefined; catch it here with an exact
        // error instead of a misleading backend message (ported).
        throw new Error(`[mp-storage] set("${key}") rejected: value is undefined`)
      }
      let storedValue: unknown = value
      if (isSecretBearingKey(key)) {
        // Extraction already snapshots JSON before separating secrets.
        let extracted: ReturnType<typeof extractSecrets>
        try {
          extracted = extractSecrets(value)
        } catch {
          // Do not reserialize secrets merely to validate them, or expose
          // input fragments from JSON parsing errors in diagnostics.
          throw new Error(`[mp-storage] set("${key}") rejected: value is not JSON serializable`)
        }
        storedValue = extracted.publicValue
        await secretChannel.setSecret(`config:${key}`, JSON.stringify(extracted.secrets))
      }
      const json = JSON.stringify(storedValue)
      if (json === undefined) throw new Error(`[mp-storage] set("${key}") rejected: value is not JSON serializable`)
      await engine.set(key, json)
    },

    async remove(key): Promise<void> {
      await engine.remove(key)
      if (isSecretBearingKey(key)) await secretChannel.removeSecret(`config:${key}`)
    },

    async loadChat<M>(scope: SessionScope): Promise<M[]> {
      const key = chatStorageKey(scope)
      const json = await engine.get(key)
      const value = parseJsonGuarded(json, [], key)
      // Shape guard: legal JSON with a non-array body (schema residue, bugs)
      // degrades to empty instead of exploding downstream (ported).
      if (!Array.isArray(value)) {
        console.error(`[mp-storage] chat "${key}" has non-array shape (${typeof value}); returning empty`)
        return []
      }
      return value as M[]
    },

    async applyChatChanges<M>(scope: SessionScope, upserts: ChatRowUpsert<M>[], deletes: string[]): Promise<void> {
      // Metadata-only saves must not hydrate and rewrite the entire chat.
      if (upserts.length === 0 && deletes.length === 0) return
      const key = chatStorageKey(scope)
      const current = parseJsonGuarded(await engine.get(key), [], key) as M[]
      const byId = new Map(current.map((message, position) => [(message as { id: string }).id, { message, position }]))
      for (const id of deletes) byId.delete(id)
      for (const item of upserts) byId.set((item.message as { id: string }).id, item)
      const messages = [...byId.values()]
        .sort((a, b) => a.position - b.position)
        .map((item) => item.message)
      await engine.set(key, JSON.stringify(messages))
    },

    async replaceChat<M>(scope: SessionScope, messages: M[]): Promise<void> {
      // Serialization snapshots the value before yielding to the engine.
      await engine.set(chatStorageKey(scope), JSON.stringify(messages ?? []))
    },

    async deleteChat(scope: SessionScope): Promise<void> {
      await engine.remove(chatStorageKey(scope))
    },

    async deleteMemoryFragments(scope: SessionScope): Promise<void> {
      await engine.remove(memoryStorageKey(scope))
    },
  }
  return repository
}
