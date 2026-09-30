import { describe, expect, it } from 'vitest'
import { createStorageRepository } from '@/kernel/store/storage-repository'
import { createMemoryEngine } from '@/kernel/store/kv-store'
import { createCardSessionStore } from '@/kernel/sessions/card-session-store'
import { createChatboxStore } from '@/kernel/sessions/chatbox-store'

const SEED = { id: 'cc-1', name: '星澜', firstMes: '你好，旅人。' }

describe('card session store · one session per card (chat:card keys)', () => {
  it('create seeds the greeting floor; get/save/remove round-trips incrementally', async () => {
    const engine = createMemoryEngine()
    const store = createCardSessionStore(createStorageRepository(engine))

    const session = await store.create(SEED)
    expect(session).toMatchObject({ cardId: 'cc-1', title: '星澜' })
    expect(session.messages).toHaveLength(1)
    expect(session.messages[0]).toMatchObject({ role: 'assistant', content: '你好，旅人。' })
    // At rest the record lives under the card-domain partition key.
    expect(await engine.get('chat:card:cc-1')).not.toBeNull()
    expect(await engine.get('chatmeta:card:cc-1')).not.toBeNull()

    session.messages.push({ id: 'u1', role: 'user', content: '我来了', ts: 2 })
    await store.save(session)
    const reloaded = (await store.get('cc-1'))!
    expect(reloaded.messages.map((message) => message.id)).toEqual([session.messages[0]!.id, 'u1'])

    // Incremental edits: append + delete one row.
    reloaded.messages.push({ id: 'a2', role: 'assistant', content: '欢迎', ts: 3 })
    reloaded.messages.shift()
    await store.save(reloaded)
    const after = (await store.get('cc-1'))!
    expect(after.messages.map((message) => message.id)).toEqual(['u1', 'a2'])

    await store.remove('cc-1')
    expect(await store.get('cc-1')).toBeNull()
    expect(await engine.get('chat:card:cc-1')).toBeNull()
    expect(await engine.get('chatmeta:card:cc-1')).toBeNull()
  })

  it('a card without a greeting opens floorless', async () => {
    const store = createCardSessionStore(createStorageRepository(createMemoryEngine()))
    const session = await store.create({ id: 'cc-2', name: '无开场白', firstMes: '' })
    expect(session.messages).toEqual([])
  })

  it('reset drops every floor and reseeds the greeting (D3 清空重开)', async () => {
    const store = createCardSessionStore(createStorageRepository(createMemoryEngine()))
    await store.create(SEED)
    const session = (await store.get('cc-1'))!
    session.messages.push({ id: 'u1', role: 'user', content: '一段历史', ts: 2 })
    session.messages.push({ id: 'a2', role: 'assistant', content: '一段回复', ts: 3 })
    await store.save(session)

    const restarted = await store.reset(SEED)
    expect(restarted.messages).toHaveLength(1)
    expect(restarted.messages[0]).toMatchObject({ role: 'assistant', content: SEED.firstMes })
    expect((await store.get('cc-1'))!.messages).toHaveLength(1)
  })

  it('card keys never leak into the chatbox domain, and vice versa', async () => {
    const engine = createMemoryEngine()
    const cardStore = createCardSessionStore(createStorageRepository(engine))
    const chatboxStore = createChatboxStore(createStorageRepository(engine))

    await cardStore.create(SEED)
    const conversation = await chatboxStore.create()
    conversation.messages.push({ id: 'c1', role: 'user', content: 'chatbox 楼层', ts: 1 })
    await chatboxStore.save(conversation)

    expect(JSON.parse((await engine.get('chatbox:index'))!)).toEqual([conversation.id])
    expect(await engine.get('chat:card:cc-1')).not.toBeNull()
    expect(await engine.get('chat:chatbox:' + conversation.id)).not.toBeNull()

    // The chatbox list never sees the card session…
    expect((await chatboxStore.list()).map((entry) => entry.id)).toEqual([conversation.id])
    // …and removing the card leaves chatbox data alone.
    await cardStore.remove('cc-1')
    expect((await chatboxStore.list()).map((entry) => entry.id)).toEqual([conversation.id])
    expect(await engine.get('chat:chatbox:' + conversation.id)).not.toBeNull()
  })
})
