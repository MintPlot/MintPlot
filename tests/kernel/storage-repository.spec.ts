import { describe, expect, it, vi } from 'vitest'
import type { KvEngine } from '@/kernel/store/kv-store'
import {
  chatStorageKey,
  createStorageRepository,
  memoryStorageKey,
} from '@/kernel/store/storage-repository'
import type { SecretChannel } from '@/kernel/secrets/secret-channel'

/**
 * Ported from RP tests/storage-repository.test.mjs (baseline 4fedffd): the
 * native-plugin harness becomes a recording engine + secret channel, the
 * assertions stay behavioral, and the chat cases gain the MP kind scope.
 */
function makeHarness() {
  const kv = new Map<string, string>()
  const secrets = new Map<string, string>()
  const engine: KvEngine = {
    async get(key) {
      return kv.get(key) ?? null
    },
    async set(key, json) {
      kv.set(key, json)
    },
    async remove(key) {
      kv.delete(key)
    },
    async keys() {
      return [...kv.keys()]
    },
  }
  const secretChannel: SecretChannel = {
    async setSecret(key, value) {
      secrets.set(key, value)
    },
    async getSecret(key) {
      return secrets.get(key) ?? null
    },
    async removeSecret(key) {
      secrets.delete(key)
    },
  }
  const repository = createStorageRepository(engine, secretChannel)
  return { repository, kv, secrets }
}

describe('mp-storage · secret extraction (ported)', () => {
  it('settings secrets are excluded from plain persistence and restored on read', async () => {
    const { repository, kv, secrets } = makeHarness()
    const settings = {
      model: 'example',
      apiKey: 'chat-secret',
      imageGenKey: 'image-secret',
      apiProviderKeys: { primary: 'provider-secret' },
    }

    await repository.set('mp_settings', settings)
    const persisted = JSON.parse(kv.get('mp_settings')!)
    expect(persisted.apiKey).toBe('')
    expect(persisted.imageGenKey).toBe('')
    expect(persisted.apiProviderKeys).toEqual({})
    expect(kv.get('mp_settings')!.includes('chat-secret')).toBe(false)
    expect(kv.get('mp_settings')!.includes('provider-secret')).toBe(false)
    expect(secrets.size).toBe(1)
    expect(secrets.has('config:mp_settings')).toBe(true)

    const restored = await repository.get<typeof settings>('mp_settings')
    expect(restored?.apiKey).toBe('chat-secret')
    expect(restored?.imageGenKey).toBe('image-secret')
    expect(restored?.apiProviderKeys.primary).toBe('provider-secret')
  })

  it('non-whitelisted keys stay plain even when they contain apiKey fields', async () => {
    const { repository, kv, secrets } = makeHarness()
    await repository.set('mp_other', { apiKey: 'visible' })
    expect(kv.get('mp_other')).toContain('visible')
    expect(secrets.size).toBe(0)
  })

  it('rejects undefined values with an exact error (ported guard)', async () => {
    const { repository } = makeHarness()
    await expect(repository.set('mp_settings', undefined)).rejects.toThrow(
      '[mp-storage] set("mp_settings") rejected: value is undefined',
    )
  })

  it('corrupt JSON degrades loudly instead of silently wiping (ported lesson)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const corruptRead = createStorageRepository({
      async get() {
        return '{not json'
      },
      async set() {},
      async remove() {},
      async keys() {
        return []
      },
    })
    const value = await corruptRead.get<{ ok: boolean }>('mp_broken')
    expect(value).toBeUndefined()
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('corrupt JSON for "mp_broken"'),
      expect.anything(),
    )
    errorSpy.mockRestore()
  })
})

describe('mp-storage · kind-scoped chat records (spec v1.2 §03 retrofit)', () => {
  it('applies per-row upserts and deletes (ported behavior)', async () => {
    const { repository } = makeHarness()
    const cardScope = { kind: 'card' as const, id: 'character-1' }

    await repository.applyChatChanges(cardScope, [
      { position: 0, message: { id: 'a', content: 'A' } },
      { position: 1, message: { id: 'b', content: 'B' } },
    ], [])
    await repository.applyChatChanges(cardScope, [
      { position: 0, message: { id: 'b', content: 'edited' } },
    ], ['a'])

    const messages = await repository.loadChat<{ id: string; content: string }>(cardScope)
    expect(messages).toEqual([{ id: 'b', content: 'edited' }])
  })

  it('partitions the two domains at rest: chatbox records never leak into card scope', async () => {
    const { repository, kv } = makeHarness()
    await repository.replaceChat({ kind: 'card', id: 's1' }, [{ id: 'm', content: 'card line' }])
    await repository.replaceChat({ kind: 'chatbox', id: 's1' }, [{ id: 'm', content: 'chatbox line' }])

    // Domain-partitioned keys — the kind retrofit's storage-side landing.
    expect(kv.has('chat:card:s1')).toBe(true)
    expect(kv.has('chat:chatbox:s1')).toBe(true)

    const cardView = await repository.loadChat<{ content: string }>({ kind: 'card', id: 's1' })
    const chatboxView = await repository.loadChat<{ content: string }>({ kind: 'chatbox', id: 's1' })
    expect(cardView[0]?.content).toBe('card line')
    expect(chatboxView[0]?.content).toBe('chatbox line')
  })

  it('same scope id across domains stays isolated; same id inside one domain overwrites', async () => {
    const { repository } = makeHarness()
    await repository.replaceChat({ kind: 'chatbox', id: 'same' }, [{ id: '1', content: 'v1' }])
    await repository.replaceChat({ kind: 'chatbox', id: 'same' }, [{ id: '2', content: 'v2' }])

    const view = await repository.loadChat<{ id: string }>({ kind: 'chatbox', id: 'same' })
    expect(view.map((message) => message.id)).toEqual(['2'])
    const cardView = await repository.loadChat<{ id: string }>({ kind: 'card', id: 'same' })
    expect(cardView).toEqual([])
  })

  it('non-array chat payloads degrade to empty with a trace (ported shape guard)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const repository = createStorageRepository({
      async get(key) {
        return key === chatStorageKey({ kind: 'card', id: 's' }) ? '"a string"' : null
      },
      async set() {},
      async remove() {},
      async keys() {
        return []
      },
    })
    const messages = await repository.loadChat({ kind: 'card', id: 's' })
    expect(messages).toEqual([])
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('deleteChat and deleteMemoryFragments remove only their own domain keys', async () => {
    const { repository, kv } = makeHarness()
    await repository.replaceChat({ kind: 'card', id: 's1' }, [{ id: '1' }])
    await repository.replaceChat({ kind: 'card', id: 's2' }, [{ id: '2' }])

    await repository.deleteChat({ kind: 'card', id: 's1' })
    expect(kv.has(chatStorageKey({ kind: 'card', id: 's1' }))).toBe(false)
    expect(kv.has(chatStorageKey({ kind: 'card', id: 's2' }))).toBe(true)

    await repository.deleteMemoryFragments({ kind: 'card', id: 's2' })
    expect(kv.has(memoryStorageKey({ kind: 'card', id: 's2' }))).toBe(false)
  })
})
