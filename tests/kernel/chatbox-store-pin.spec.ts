// Chatbox conversation pinning (1.0.x list management): the pinned flag rides
// the envelope meta (absent/legacy = not pinned, zero migration), toggles
// envelope-only, and re-orders the list projection pinned-first.
import { describe, expect, it } from 'vitest'
import { createChatboxStore } from '@/kernel/sessions/chatbox-store'
import { createStorageRepository } from '@/kernel/store/storage-repository'
import { createMemoryEngine } from '@/kernel/store/kv-store'

describe('chatbox-store · pinned conversations', () => {
  it('setPinned 只写信封,列表置顶组优先、组内按最近排序', async () => {
    const store = createChatboxStore(createStorageRepository(createMemoryEngine()))
    const first = await store.create('旧对话')
    // Ensure "first" is the older one; second becomes the most recent.
    first.updatedAt = 1000
    await store.save(first)
    const second = await store.create('新对话')

    await store.setPinned(first.id, true)

    const summaries = await store.list()
    expect(summaries[0]!.id).toBe(first.id)
    expect(summaries[0]!.pinned).toBe(true)
    expect(summaries[1]!.id).toBe(second.id)
    expect(summaries[1]!.pinned).toBeFalsy()
  })

  it('save 往返保留 pinned 标记(聊天页保存不丢置顶)', async () => {
    const store = createChatboxStore(createStorageRepository(createMemoryEngine()))
    const conversation = await store.create('会话')
    await store.setPinned(conversation.id, true)

    const loaded = await store.get(conversation.id)
    expect(loaded!.pinned).toBe(true)
    await store.save(loaded!)
    expect((await store.get(conversation.id))!.pinned).toBe(true)
  })

  it('对不存在的会话 setPinned 静默无操作', async () => {
    const store = createChatboxStore(createStorageRepository(createMemoryEngine()))
    await expect(store.setPinned('cb-missing', true)).resolves.toBeUndefined()
    expect(await store.list()).toHaveLength(0)
  })
})
