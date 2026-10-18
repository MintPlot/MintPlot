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
    const remove = () => kind === 'card' ? cardStore.remove(id) : chatboxStore.remove(id)
    const reload = () => kind === 'card' ? cardStore.get(id) : chatboxStore.get(id)
    return { engine, repository, session, save, scope, remove, reload }
  }

  it('does not let a pending save resurrect a removed session', async () => {
    const { engine, session, save, remove, reload, scope } = await setup()
    let release!: () => void, entered!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const started = new Promise<void>(resolve => { entered = resolve })
    const write = engine.set.bind(engine)
    vi.spyOn(engine, 'set').mockImplementationOnce(async (key, value) => { entered(); await gate; await write(key, value) })
    session.messages[0]!.content = 'pending'
    const saving = save()
    await started
    const removing = remove()
    release()
    await Promise.all([saving, removing])
    expect(await reload()).toBeNull()
    expect(await engine.get(`chat:${scope.kind}:${scope.id}`)).toBeNull()
  })

  it('continues after a failed task and captures queued snapshots at invocation', async () => {
    const { repository, session, save, scope } = await setup()
    vi.spyOn(repository, 'applyChatChanges').mockRejectedValueOnce(new Error('write failed'))
    session.messages[0]!.content = 'first'
    const first = save()
    session.messages[0]!.content = 'second'
    const second = save()
    session.messages[0]!.content = 'unsaved third'
    await expect(first).rejects.toThrow('write failed')
    await second
    expect(await repository.loadChat(scope)).toMatchObject([{ content: 'second' }])
    await save()
    expect(await repository.loadChat(scope)).toEqual(session.messages)
  })

  it('keeps the newest requested snapshot when two saves overlap', async () => {
    const { engine, repository, session, save, scope } = await setup()
    let release!: () => void
    let entered!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const started = new Promise<void>((resolve) => { entered = resolve })
    const write = engine.set.bind(engine)
    vi.spyOn(engine, 'set').mockImplementationOnce(async (key, value) => {
      entered()
      await gate
      await write(key, value)
    })
    session.messages[0]!.content = 'older snapshot'
    const first = save()
    await started
    session.messages[0]!.content = 'newest snapshot'
    session.messages[0]!.storageStatus = 'final'
    const second = save()
    // Let the unprotected second save finish first in the old implementation.
    await new Promise((resolve) => setTimeout(resolve, 0))
    release()
    await Promise.all([first, second])
    expect(await repository.loadChat(scope)).toEqual(session.messages)
  })

  it('submits only the changed row after a successful save', async () => {
    const { repository, session, save } = await setup()
    const patch = vi.spyOn(repository, 'applyChatChanges')
    session.messages[0]!.content = 'edited'
    session.messages.push({ id: 'b', role: 'user', content: 'new', ts: 2 })
    await save()
    patch.mockClear()
    session.messages[1]!.content = 'edited again'
    await save()
    expect(patch.mock.calls[0]![1].map(row => ({ id: (row.message as { id: string }).id, position: row.position }))).toEqual([{ id: 'b', position: 1 }])
    expect(patch.mock.calls[0]![2]).toEqual([])
  })

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
