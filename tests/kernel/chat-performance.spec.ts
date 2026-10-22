import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import DOMPurify from 'dompurify'
import ChatSessionView from '@/kernel/app/views/ChatSessionView.vue'
import { CARD_SESSION_STORE_KEY, CHARACTER_STORE_KEY, CHATBOX_STORE_KEY, SEAM_REGISTRY_KEY, SETTINGS_STATE_KEY, USAGE_RECORDER_KEY } from '@/kernel/app/chat-keys'
import type { LlmProvider } from '@/kernel/llm/llm-provider'
import { createSeamRegistry } from '@/kernel/runtime/seam-registry'
import { createChatboxStore } from '@/kernel/sessions/chatbox-store'
import { createSettingsState } from '@/kernel/settings/settings-state'
import { createStorageRepository } from '@/kernel/store/storage-repository'
import { createMemoryEngine } from '@/kernel/store/kv-store'
import { createCardSessionStore } from '@/kernel/sessions/card-session-store'
import { uiService } from '@/kernel/ui/toasts'

async function fixture(count = 20) {
  const store = createChatboxStore(createStorageRepository(createMemoryEngine()))
  const conversation = await store.create()
  conversation.messages = Array.from({ length: count }, (_, index) => ({
    id: `history-${index}`, role: index % 2 ? 'assistant' as const : 'user' as const,
    content: `Unique historical message ${index} for performance testing`, ts: index,
  }))
  await store.save(conversation)
  let callbacks!: Parameters<LlmProvider['stream']>[1]
  let resolve!: (result: Awaited<ReturnType<LlmProvider['stream']>>) => void
  let reject!: (error: Error) => void
  let requested: Parameters<LlmProvider['stream']>[0] = []
  const seams = createSeamRegistry(() => undefined)
  seams.register('test', 'llm.provider', {
    providerId: 'openai-compatible', configured: () => true,
    stream: (_messages, options) => {
      requested = _messages
      callbacks = options
      return new Promise((yes, no) => { resolve = yes; reject = no })
    },
  } satisfies LlmProvider)
  const usage = vi.fn()
  const wrapper = mount(ChatSessionView, {
    props: { conversationId: conversation.id },
    global: { provide: {
      [CHATBOX_STORE_KEY as symbol]: store,
      [SEAM_REGISTRY_KEY as symbol]: seams,
      [SETTINGS_STATE_KEY as symbol]: createSettingsState(createStorageRepository(createMemoryEngine())),
      [USAGE_RECORDER_KEY as symbol]: usage,
    } },
  })
  await flushPromises()
  const send = async () => {
    await wrapper.get('textarea').setValue('new request')
    await wrapper.get('button[aria-label="发送"]').trigger('click')
    await flushPromises()
  }
  return { wrapper, store, conversation, send, usage, requested: () => requested, callbacks: () => callbacks, finish: () => resolve, fail: () => reject }
}

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('chat update boundaries', () => {
  it('does not persist an aborted old turn over a reset that is awaiting storage', async () => {
    const repository = createStorageRepository(createMemoryEngine())
    const store = createCardSessionStore(repository)
    await store.create({ id: 'reset-race', name: 'Synthetic', firstMes: 'old greeting' })
    const seams = createSeamRegistry(() => undefined)
    let callbacks!: Parameters<LlmProvider['stream']>[1]
    let reject!: (error: Error) => void
    seams.register('test', 'llm.provider', {
      configured: () => true,
      stream: (_messages: unknown, options: Parameters<LlmProvider['stream']>[1]) => {
        callbacks = options
        return new Promise((_resolve, no) => {
          reject = no
          options.signal?.addEventListener('abort', () => no(new Error('aborted')), { once: true })
        })
      },
    })
    const wrapper = mount(ChatSessionView, { props: { conversationId: 'reset-race', domain: 'card' }, global: { provide: {
      [CARD_SESSION_STORE_KEY as symbol]: store,
      [CHARACTER_STORE_KEY as symbol]: { get: async () => ({ id: 'reset-race', name: 'Synthetic', firstMes: 'fresh greeting' }), getCover: async () => null },
      [SEAM_REGISTRY_KEY as symbol]: seams,
    } } })
    await flushPromises()
    await wrapper.get('textarea').setValue('Synthetic reset request')
    await wrapper.get('button[aria-label="发送"]').trigger('click')
    await flushPromises()
    callbacks.onDelta?.('partial old reply')
    let release!: () => void, entered!: () => void
    const gate = new Promise<void>(r => { release = r }), started = new Promise<void>(r => { entered = r })
    const remove = repository.deleteChat.bind(repository)
    vi.spyOn(repository, 'deleteChat').mockImplementationOnce(async scope => { entered(); await gate; await remove(scope) })
    vi.spyOn(uiService, 'confirm').mockResolvedValueOnce(true)
    await wrapper.get('button[aria-label="清空重开"]').trigger('click')
    await started
    await flushPromises()
    release()
    await flushPromises()
    expect(wrapper.findAll('.markdown-body').at(-1)!.text()).toBe('fresh greeting')
    expect((await store.get('reset-race'))!.messages.map(m => m.content)).toEqual(['fresh greeting'])
    wrapper.unmount()
    void reject
  })
  it('keeps following on a floor tap and resumes following for explicit regeneration', async () => {
    const f = await fixture()
    const stream = f.wrapper.get('.mp-overlay-flow-top')
    const pointer = async (type: string, y: number) => {
      const event = new Event(type, { bubbles: true })
      for (const [key, value] of Object.entries({ clientX: 10, clientY: y, pointerId: 1 })) Object.defineProperty(event, key, { value })
      stream.element.dispatchEvent(event)
      await nextTick()
    }
    await pointer('pointerdown', 10)
    await pointer('pointerup', 10)
    expect(f.wrapper.text()).not.toContain('回到最新')
    await pointer('pointerdown', 200)
    await pointer('pointermove', 100)
    expect(f.wrapper.text()).toContain('回到最新')
    await pointer('pointerup', 100)
    await f.wrapper.get('button[aria-label="重新生成(追加候选)"]').trigger('click')
    await flushPromises()
    expect(f.wrapper.text()).not.toContain('回到最新')
    f.callbacks().onDelta?.('regenerated text')
    await nextTick()
    expect(f.wrapper.findAll('.markdown-body').at(-1)!.text()).toBe('regenerated text')
    await stream.trigger('wheel', { deltaY: -100 })
    expect(f.wrapper.text()).toContain('回到最新')
    f.finish()({ content: 'done', usage: null })
    await flushPromises()
    f.wrapper.unmount()
  })
  it('does not let an already queued end-scroll override a new reading gesture', async () => {
    const f = await fixture()
    const element = f.wrapper.get('.mp-overlay-flow-top')
    Object.defineProperties(element.element, { scrollHeight: { value: 1000 }, clientHeight: { value: 500 } })
    element.element.scrollTop = 500
    await element.trigger('wheel', { deltaY: -100 })
    await element.trigger('scroll')
    expect(f.wrapper.text()).toContain('回到最新')
    element.element.scrollTop = 100
    await element.trigger('scroll')
    element.element.scrollTop = 500
    await element.trigger('scroll')
    expect(f.wrapper.text()).not.toContain('回到最新')
    f.wrapper.unmount()
  })
  it('bounds initial DOM without truncating stored history or model context', async () => {
    const f = await fixture(1000)
    expect(f.wrapper.findAll('[data-message-id]').length).toBeLessThanOrEqual(20)
    expect(f.wrapper.text()).toContain('Unique historical message 999')
    await f.send()
    expect(f.requested().some((message) => String(message.content).includes('Unique historical message 0 '))).toBe(true)
    expect(f.requested().some((message) => String(message.content).includes('Unique historical message 999 '))).toBe(true)
    f.finish()({ content: 'done', usage: null })
    await flushPromises()
    expect((await f.store.get(f.conversation.id))!.messages).toHaveLength(1002)
    f.wrapper.unmount()
  })
  it('shows fresh deltas before completion without cleaning stable history on every flush', async () => {
    const f = await fixture(101)
    await f.send()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    f.callbacks().onReasoningDelta?.('native reasoning')
    f.callbacks().onDelta?.('first chunk')
    await vi.advanceTimersByTimeAsync(50)
    await nextTick()
    expect(f.wrapper.findAll('.markdown-body').at(-1)!.text()).toBe('first chunk')
    const sanitize = vi.spyOn(DOMPurify, 'sanitize')
    f.callbacks().onDelta?.(' next chunk')
    await vi.advanceTimersByTimeAsync(50)
    await nextTick()
    const historical = sanitize.mock.calls.filter(([input]) => String(input).includes('Unique historical message'))
    expect(historical).toHaveLength(0)
    f.finish()({ content: 'authoritative final', reasoning: 'native reasoning', usage: null })
    await flushPromises()
    expect(f.wrapper.findAll('.markdown-body').at(-1)!.text()).toBe('authoritative final')
    expect((await f.store.get(f.conversation.id))!.messages.at(-1)).toMatchObject({
      content: 'authoritative final', reasoning: 'native reasoning',
    })
    f.wrapper.unmount()
  })

  it('drains pending partial text on an error and persists it once', async () => {
    const f = await fixture()
    await f.send()
    f.callbacks().onDelta?.('partial')
    f.callbacks().onDelta?.(' tail')
    f.fail()(new Error('disconnected'))
    await flushPromises()
    expect(f.wrapper.text()).toContain('请求失败:disconnected')
    expect((await f.store.get(f.conversation.id))!.messages.at(-1)?.content).toBe('partial tail')
    f.wrapper.unmount()
  })

  it('streams regeneration from an empty buffer and restores the prior candidate on cancellation', async () => {
    const f = await fixture()
    const previous = f.conversation.messages.at(-1)!.content
    await f.wrapper.get('button[aria-label="重新生成(追加候选)"]').trigger('click')
    await flushPromises()
    f.callbacks().onDelta?.('new candidate')
    await nextTick()
    expect(f.wrapper.findAll('.markdown-body').at(-1)!.text()).toBe('new candidate')
    await f.wrapper.get('button[aria-label="中止"]').trigger('click')
    f.finish()({ content: 'partial candidate', usage: null })
    await flushPromises()
    const stored = (await f.store.get(f.conversation.id))!.messages.at(-1)!
    expect(stored.content).toBe(previous)
    expect(stored.candidates).toEqual([previous])
    expect(stored.activeIndex).toBe(0)
    f.wrapper.unmount()
  })

  it('ignores late text after stopping while preserving reported request usage', async () => {
    const f = await fixture()
    await f.send()
    f.callbacks().onDelta?.('partial')
    f.callbacks().onDelta?.(' tail')
    await f.wrapper.get('button[aria-label="中止"]').trigger('click')
    f.callbacks().onDelta?.(' ignored')
    f.finish()({ content: 'ignored final', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, cacheReadTokens: null } })
    await flushPromises()
    expect(f.usage).toHaveBeenCalledTimes(1)
    expect((await f.store.get(f.conversation.id))!.messages.at(-1)?.content).toBe('partial tail')
    f.wrapper.unmount()
  })

  it('aborts an unmounted session and ignores its provider after a different view is mounted', async () => {
    const f = await fixture()
    await f.send()
    f.callbacks().onDelta?.('old partial')
    f.wrapper.unmount()
    expect(f.callbacks().signal?.aborted).toBe(true)
    const next = await fixture()
    f.callbacks().onDelta?.(' late')
    f.finish()({ content: 'late final', usage: null })
    await flushPromises()
    expect(next.wrapper.text()).not.toContain('old partial')
    expect((await f.store.get(f.conversation.id))!.messages.at(-1)?.content).toBe('old partial')
    next.wrapper.unmount()
  })
})
