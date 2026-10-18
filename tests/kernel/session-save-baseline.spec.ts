import { describe, expect, it, vi } from 'vitest'
import { createCardSessionStore } from '@/kernel/sessions/card-session-store'
import { createChatboxStore } from '@/kernel/sessions/chatbox-store'
import { createMemoryEngine } from '@/kernel/store/kv-store'
import { createStorageRepository } from '@/kernel/store/storage-repository'

describe.each(['card', 'chatbox'] as const)('%s save baseline', (kind) => {
  async function setup() {
    const engine = createMemoryEngine()
    const repository = createStorageRepository(engine)
    const cardStore = createCardSessionStore(repository)
    const chatboxStore = createChatboxStore(repository)
    const session = kind === 'card'
      ? await cardStore.create({ id: 'baseline', name: 'Synthetic', firstMes: '' })
      : await chatboxStore.create('Synthetic')
    const save = () => 'cardId' in session ? cardStore.save(session) : chatboxStore.save(session)
    const id = 'cardId' in session ? session.cardId : session.id
    const scope = { kind, id }
    session.messages.push({ id: 'm', role: 'assistant', content: 'first', ts: 1 })
    await save()
    return { engine, repository, session, save, scope }
  }

  it('retains edits made while the previous snapshot is being persisted', async () => {
    const { repository, session, save, scope } = await setup()
    const apply = repository.applyChatChanges.bind(repository)
    vi.spyOn(repository, 'applyChatChanges').mockImplementationOnce(async (target, upserts, deletes) => {
      session.messages[0]!.content = 'edited during write'
      await apply(target, upserts, deletes)
    })
    session.messages[0]!.content = 'snapshot'
    await save()
    await save()
    expect(await repository.loadChat(scope)).toEqual(session.messages)
  })

  it('retries failed writes and handles reorder, deletion and candidate edits', async () => {
    const { repository, session, save, scope } = await setup()
    session.messages.push({ id: 'b', role: 'assistant', content: 'B', ts: 2 })
    vi.spyOn(repository, 'applyChatChanges').mockRejectedValueOnce(new Error('write failed'))
    await expect(save()).rejects.toThrow('write failed')
    await save()
    session.messages.reverse()
    session.messages[0]!.candidates = ['B', 'C']
    session.messages[0]!.activeIndex = 1
    session.messages[0]!.content = 'C'
    await save()
    expect(await repository.loadChat(scope)).toEqual(session.messages)
    session.messages.pop()
    await save()
    expect(await repository.loadChat(scope)).toEqual(session.messages)
  })

  it('does not read or rewrite the chat body for metadata-only saves', async () => {
    const { engine, session, save, scope } = await setup()
    const read = vi.spyOn(engine, 'get')
    const write = vi.spyOn(engine, 'set')
    session.title = 'Renamed'
    await save()
    const key = `chat:${scope.kind}:${scope.id}`
    expect(read.mock.calls.filter(([target]) => target === key)).toEqual([])
    expect(write.mock.calls.filter(([target]) => target === key)).toEqual([])
    expect(await repositoryMeta()).toMatchObject({ title: 'Renamed' })
    async function repositoryMeta() {
      return JSON.parse((await engine.get(`chatmeta:${scope.kind}:${scope.id}`))!) as unknown
    }
  })
})
