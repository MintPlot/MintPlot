import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import ChatSessionView from '@/kernel/app/views/ChatSessionView.vue'
import {
  CHATBOX_STORE_KEY,
  SEAM_REGISTRY_KEY,
  SESSION_PROJECTION_KEY,
  SETTINGS_STATE_KEY,
  USAGE_RECORDER_KEY,
} from '@/kernel/app/chat-keys'
import { errorHub } from '@/kernel/diagnostics/error-hub'
import { LlmRequestError } from '@/kernel/llm/chat-completions'
import type { LlmProvider } from '@/kernel/llm/llm-provider'
import { createSeamRegistry } from '@/kernel/runtime/seam-registry'
import { createSessionProjection } from '@/kernel/sessions/session-projection'
import { createChatboxStore } from '@/kernel/sessions/chatbox-store'
import { createSettingsState } from '@/kernel/settings/settings-state'
import { createStorageRepository } from '@/kernel/store/storage-repository'
import { createMemoryEngine } from '@/kernel/store/kv-store'

async function mountSession(stream: LlmProvider['stream']) {
  const chatboxStore = createChatboxStore(createStorageRepository(createMemoryEngine()))
  const conversation = await chatboxStore.create()
  const seams = createSeamRegistry(() => undefined)
  seams.register('kernel', 'llm.provider', { providerId: 'openai-compatible', configured: () => true, stream })
  const wrapper = mount(ChatSessionView, {
    props: { conversationId: conversation.id, domain: 'chatbox' },
    global: {
      provide: {
        [CHATBOX_STORE_KEY as symbol]: chatboxStore,
        [SEAM_REGISTRY_KEY as symbol]: seams,
        [SESSION_PROJECTION_KEY as symbol]: createSessionProjection(),
        [SETTINGS_STATE_KEY as symbol]: createSettingsState(createStorageRepository(createMemoryEngine())),
        [USAGE_RECORDER_KEY as symbol]: () => {},
      },
    },
  })
  await flushPromises()
  return { wrapper, chatboxStore, conversationId: conversation.id }
}

async function sendDraft(wrapper: Awaited<ReturnType<typeof mountSession>>['wrapper'], text: string): Promise<void> {
  await wrapper.find('textarea').setValue(text)
  const send = wrapper.findAll('button').find((button) => button.attributes('aria-label') === '发送')!
  await send.trigger('click')
  await flushPromises()
}

describe('M3-err1 · 聊天页错误条(D3:错误不写历史)', () => {
  beforeEach(() => {
    errorHub.clear()
  })

  it('请求失败:错误条出现、楼层不落错误、枢纽带码入账', async () => {
    const stream = vi.fn().mockRejectedValue(new LlmRequestError('HTTP 500', 500, 'MP-NET-002'))
    const { wrapper, chatboxStore, conversationId } = await mountSession(stream)

    await sendDraft(wrapper, '你好')

    // 错误条可见,含原错误消息。
    expect(wrapper.text()).toContain('请求失败:HTTP 500')
    // 楼层 = 仅用户一条;历史与持久化里没有错误文本(D3)。
    const stored = await chatboxStore.get(conversationId)
    expect(stored!.messages).toHaveLength(1)
    expect(stored!.messages[0]!.role).toBe('user')
    expect(JSON.stringify(stored!.messages)).not.toContain('请求失败')
    // 枢纽入账:throw-site 统一代码 + 域归属。
    const record = errorHub.all().at(-1)!
    expect(record.code).toBe('MP-NET-002')
    expect(record.category).toBe('chat')
    expect(record.action).toBe('request_failed')
    expect(record.context).toMatchObject({ domain: 'chatbox' })
  })

  it('重试复用已持久化的用户楼层重发,成功后错误条消失', async () => {
    const stream = vi
      .fn()
      .mockRejectedValueOnce(new LlmRequestError('HTTP 500', 500, 'MP-NET-002'))
      .mockResolvedValueOnce({ content: '回复好了', usage: null, model: 'test-model' })
    const { wrapper, chatboxStore, conversationId } = await mountSession(stream)

    await sendDraft(wrapper, '你好')
    const retry = wrapper.findAll('button').find((button) => button.text() === '重试')!
    await retry.trigger('click')
    await flushPromises()

    // 第二次流式成功:助手楼层补上,错误条关闭,用户楼层未重复。
    expect(wrapper.text()).toContain('回复好了')
    expect(wrapper.text()).not.toContain('请求失败:')
    const stored = await chatboxStore.get(conversationId)
    expect(stored!.messages).toHaveLength(2)
    expect(stored!.messages[0]!.role).toBe('user')
    expect(stored!.messages[1]).toMatchObject({ role: 'assistant', content: '回复好了' })
    expect(stream).toHaveBeenCalledTimes(2)
  })

  it('中止不触发错误条(现状语义保持)', async () => {
    // Real abort path: the pending stream rejects with AbortError when the
    // view's stop button aborts the controller (signal.aborted = true).
    const stream = vi.fn().mockImplementation(
      (_messages, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        }),
    )
    const { wrapper } = await mountSession(stream)

    await sendDraft(wrapper, '你好')
    // 中止按钮在流式中出现;点击走真实 abortController.abort()。
    const stop = wrapper.findAll('button').find((button) => button.attributes('aria-label') === '中止')!
    await stop.trigger('click')
    await flushPromises()

    expect(wrapper.text()).not.toContain('请求失败:')
    expect(errorHub.all().filter((record) => record.action === 'request_failed')).toHaveLength(0)
  })
})

describe('M4-e follow-up · 空回复守卫(MP-CHAT-003)', () => {
  beforeEach(() => {
    errorHub.clear()
  })

  it('干净结束但零内容的流按失败呈现:错误条出现、空楼不落库、枢纽带码入账', async () => {
    // 本地思考引擎只吐 reasoning 或旧版吞掉的上游错误帧 → content 为空;
    // 静默无楼层曾经是唯一表现,现在必须是一条可见错误。
    const stream = vi.fn().mockResolvedValue({ content: '', usage: null, model: 'thinking-model' })
    const { wrapper, chatboxStore, conversationId } = await mountSession(stream)

    await sendDraft(wrapper, '你好')

    expect(wrapper.text()).toContain('请求失败:模型返回了空回复')
    const stored = await chatboxStore.get(conversationId)
    expect(stored!.messages).toHaveLength(1)
    expect(stored!.messages[0]!.role).toBe('user')
    const record = errorHub.all().at(-1)!
    expect(record.code).toBe('MP-CHAT-003')
    expect(record.category).toBe('chat')
  })
})
