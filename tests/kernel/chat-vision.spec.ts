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
import { LlmRequestError } from '@/kernel/llm/chat-completions'
import type { LlmChatMessage } from '@/kernel/llm/chat-completions'
import { uiService } from '@/kernel/ui/toasts'
import type { LlmProvider } from '@/kernel/llm/llm-provider'
import { createSeamRegistry } from '@/kernel/runtime/seam-registry'
import { createSessionProjection } from '@/kernel/sessions/session-projection'
import { createChatboxStore } from '@/kernel/sessions/chatbox-store'
import { createSettingsState } from '@/kernel/settings/settings-state'
import type { SettingsState } from '@/kernel/settings/settings-state'
import { createStorageRepository } from '@/kernel/store/storage-repository'
import { createMemoryEngine } from '@/kernel/store/kv-store'

const jsonResponse = (body: unknown, ok = true, status = 200) => ({
  ok,
  status,
  json: async () => body,
})

const streamCalls: Array<readonly LlmChatMessage[]> = []

function makeProvider(): LlmProvider {
  return {
    providerId: 'openai-compatible',
    configured: () => true,
    stream: async (messages) => {
      streamCalls.push(messages)
      return { content: '（测试回复）', usage: null, model: 'test-model' }
    },
  }
}

async function mountSession(applySettings?: (settings: SettingsState) => void) {
  const chatboxStore = createChatboxStore(createStorageRepository(createMemoryEngine()))
  const settings = createSettingsState(createStorageRepository(createMemoryEngine()))
  applySettings?.(settings)
  const seams = createSeamRegistry(() => undefined)
  seams.register('kernel', 'llm.provider', makeProvider())
  const wrapper = mount(ChatSessionView, {
    props: { conversationId: (await chatboxStore.create()).id, domain: 'chatbox' },
    global: {
      provide: {
        [CHATBOX_STORE_KEY as symbol]: chatboxStore,
        [SEAM_REGISTRY_KEY as symbol]: seams,
        [SESSION_PROJECTION_KEY as symbol]: createSessionProjection(),
        [SETTINGS_STATE_KEY as symbol]: settings,
        [USAGE_RECORDER_KEY as symbol]: () => {},
      },
    },
  })
  await flushPromises()
  return { wrapper, chatboxStore, settings }
}

async function attachImages(wrapper: Awaited<ReturnType<typeof mountSession>>['wrapper'], count: number): Promise<void> {
  const input = wrapper.find('input[type="file"]')
  const files = Array.from({ length: count }, (_, index) => new File([`img-${index}`], `pic-${index}.png`, { type: 'image/png' }))
  Object.defineProperty(input.element, 'files', { value: files, configurable: true })
  await input.trigger('change')
  // jsdom FileReader / compression settle on macrotasks, not microtasks —
  // poll until the strip leaves the 读取中/识别中 states (or fails visibly).
  for (let round = 0; round < 12; round += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50))
    await flushPromises()
    const strip = wrapper.text()
    if (!strip.includes('读取中') && !strip.includes('识别中…')) break
  }
}

const lastUserFloor = (messages: readonly LlmChatMessage[]): LlmChatMessage =>
  messages.filter((message) => message.role === 'user').at(-1)!

describe('M4-d · 图片附件与混合识图', () => {
  beforeEach(() => {
    streamCalls.length = 0
    vi.restoreAllMocks()
  })

  it('未配置识图且档案未声明看图:选图被阻断并提示', async () => {
    const toastSpy = vi.spyOn(uiService, 'toast')
    const { wrapper } = await mountSession()
    await attachImages(wrapper, 1)
    expect(toastSpy).toHaveBeenCalledWith('shell', expect.stringContaining('请先配置识图模型'), expect.objectContaining({ tone: 'error' }))
    expect(wrapper.text()).not.toContain('识别中…')
    toastSpy.mockRestore()
    wrapper.unmount()
  })

  it('描述式:选图即识图,描述以 <user_image_context> 随楼层进请求并入库存档', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      choices: [{ message: { content: '图片中是一只薄荷绿的猫' } }],
    }))
    vi.stubGlobal('fetch', fetchMock)
    const { wrapper, chatboxStore } = await mountSession((settings) => {
      settings.scope(['visionModel']).visionModel = 'glm-4v'; const ps = settings.scope(['apiProfiles', 'apiActiveProfileId']); ps.apiProfiles = { p: { name: 'P', baseUrl: 'https://api.example.com/v1', model: 'test-model', apiKey: 'k' } }; ps.apiActiveProfileId = 'p'
    })

    await attachImages(wrapper, 1)
    await flushPromises()
    // 识图请求:独立模型 + parts 载荷。
    const visionCall = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(String(visionCall[0])).toContain('/chat/completions')
    const visionBody = JSON.parse(String(visionCall[1]?.body))
    expect(visionBody.model).toBe('glm-4v')
    expect(visionBody.messages[0].content[0].text).toContain('客观、详细')
    expect(visionBody.messages[0].content[1].image_url.detail).toBe('high')
    // 就绪前发送被禁。
    const send = wrapper.findAll('button').find((button) => button.attributes('aria-label') === '发送')!
    expect(send.attributes('disabled')).toBeDefined()

    await wrapper.find('textarea').setValue('看这张图')
    await send.trigger('click')
    await flushPromises()

    // 主请求:用户楼层文本尾部带描述块。
    const request = streamCalls.at(-1)!
    const userFloor = lastUserFloor(request)
    expect(String(userFloor.content)).toContain('<user_image_context>')
    expect(String(userFloor.content)).toContain('图片 1：图片中是一只薄荷绿的猫')
    // 楼层持久化:dataUrl 与描述都在行上。
    const stored = (await chatboxStore.list())[0]!
    const row = (await chatboxStore.get(stored.id))!.messages.find((message) => message.role === 'user')!
    expect(row.imageAttachments).toHaveLength(1)
    expect(row.imageAttachments?.[0]?.description).toBe('图片中是一只薄荷绿的猫')
    // 气泡缩略图渲染。
    expect(wrapper.findAll('img[alt="附件图片 1"]').length).toBe(1)
    vi.unstubAllGlobals()
    wrapper.unmount()
  })

  it('直连:档案声明看图 → 当前轮用户楼 content 变 parts,识图模型不参与', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { wrapper } = await mountSession((settings) => {
      const scope = settings.scope(['apiProfiles', 'apiActiveProfileId'])
      scope.apiProfiles = {
        v: { name: 'V', baseUrl: 'https://v.example.com/v1', model: 'gpt-4o', apiKey: 'k', visionCapable: true },
      }
      scope.apiActiveProfileId = 'v'
    })

    await attachImages(wrapper, 1)
    await flushPromises()
    expect(fetchMock).not.toHaveBeenCalled() // 直连模式不发起识图请求
    await wrapper.find('textarea').setValue('看图说话')
    await wrapper.findAll('button').find((button) => button.attributes('aria-label') === '发送')!.trigger('click')
    await flushPromises()

    const request = streamCalls.at(-1)!
    const userFloor = lastUserFloor(request)
    expect(Array.isArray(userFloor.content)).toBe(true)
    const parts = userFloor.content as never as Array<{ type: string; text?: string; image_url?: { url: string } }>
    expect(parts[0]).toMatchObject({ type: 'text', text: '看图说话' })
    expect(parts[1]?.type).toBe('image_url')
    expect(parts[1]?.image_url?.url).toContain('data:')
    vi.unstubAllGlobals()
    wrapper.unmount()
  })

  it('描述式历史楼层:描述永久随楼层,直连仅当前轮', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      choices: [{ message: { content: '一只猫' } }],
    }))
    vi.stubGlobal('fetch', fetchMock)
    const { wrapper } = await mountSession((settings) => {
      settings.scope(['visionModel']).visionModel = 'glm-4v'; const ps = settings.scope(['apiProfiles', 'apiActiveProfileId']); ps.apiProfiles = { p: { name: 'P', baseUrl: 'https://api.example.com/v1', model: 'test-model', apiKey: 'k' } }; ps.apiActiveProfileId = 'p'
    })
    await attachImages(wrapper, 1)
    await flushPromises()
    await wrapper.find('textarea').setValue('第一轮')
    await wrapper.findAll('button').find((button) => button.attributes('aria-label') === '发送')!.trigger('click')
    await flushPromises()

    // 第二轮无图:第一轮楼层的描述仍随历史进请求。
    await wrapper.find('textarea').setValue('第二轮')
    await wrapper.findAll('button').find((button) => button.attributes('aria-label') === '发送')!.trigger('click')
    await flushPromises()
    const historyUserFloor = streamCalls.at(-1)!.filter((message) => message.role === 'user')[0]!
    expect(String(historyUserFloor.content)).toContain('<user_image_context>')
    vi.unstubAllGlobals()
    wrapper.unmount()
  })
})

describe('M4-d · 单次指令(D3)', () => {
  beforeEach(() => {
    streamCalls.length = 0
    vi.restoreAllMocks()
  })

  it('单次指令只 ride 一次请求,发完即清', async () => {
    const { wrapper } = await mountSession()

    await wrapper.find('button[aria-label="单次指令"]').trigger('click')
    await wrapper.find('[aria-label="单次指令"] + div textarea, div textarea[placeholder*="轻快"]').setValue('这段用更轻快的语气写')
    await wrapper.findAll('button').find((button) => button.text() === '完成')!.trigger('click')
    await wrapper.find('textarea').setValue('第一轮')
    await wrapper.findAll('button').find((button) => button.attributes('aria-label') === '发送')!.trigger('click')
    await flushPromises()

    expect(streamCalls.at(-1)!.some((message) => String(message.content).includes('[单次指令]'))).toBe(true)
    expect(streamCalls.at(-1)!.some((message) => String(message.content).includes('更轻快的语气'))).toBe(true)

    // 第二轮:指令已消费。
    await wrapper.find('textarea').setValue('第二轮')
    await wrapper.findAll('button').find((button) => button.attributes('aria-label') === '发送')!.trigger('click')
    await flushPromises()
    expect(streamCalls.at(-1)!.some((message) => String(message.content).includes('[单次指令]'))).toBe(false)
    wrapper.unmount()
  })

  it('识图请求失败:附件标记错误,发送保持禁用,可移除恢复', async () => {
    const failFetch = vi.fn().mockRejectedValue(new LlmRequestError('HTTP 500', 500))
    vi.stubGlobal('fetch', failFetch)
    const { wrapper } = await mountSession((settings) => {
      settings.scope(['visionModel']).visionModel = 'glm-4v'; const ps = settings.scope(['apiProfiles', 'apiActiveProfileId']); ps.apiProfiles = { p: { name: 'P', baseUrl: 'https://api.example.com/v1', model: 'test-model', apiKey: 'k' } }; ps.apiActiveProfileId = 'p'
    })
    await attachImages(wrapper, 1)
    for (let round = 0; round < 12; round += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50))
      await flushPromises()
      if (wrapper.text().includes('识别失败')) break
    }
    expect(wrapper.text()).toContain('识别失败')
    const send = wrapper.findAll('button').find((button) => button.attributes('aria-label') === '发送')!
    expect(send.attributes('disabled')).toBeDefined()

    await wrapper.find('button[aria-label^="移除待发送图片"]').trigger('click')
    expect(wrapper.text()).not.toContain('识别失败')
    // 移除后仅剩空文本的禁用;填入草稿后发送恢复可用。
    await wrapper.find('textarea').setValue('发文字')
    expect(wrapper.findAll('button').find((button) => button.attributes('aria-label') === '发送')!.attributes('disabled')).toBeUndefined()
    vi.unstubAllGlobals()
    wrapper.unmount()
  })
})
