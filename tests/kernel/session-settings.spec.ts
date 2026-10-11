import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import SessionSettingsSheet from '@/kernel/app/sections/SessionSettingsSheet.vue'
import { createSettingsState } from '@/kernel/settings/settings-state'
import { createStorageRepository } from '@/kernel/store/storage-repository'
import { createMemoryEngine } from '@/kernel/store/kv-store'
import { createOpenAiCompatibleProvider } from '@/kernel/llm/llm-provider'
import { streamChatCompletion } from '@/kernel/llm/chat-completions'
import { createMemorySettingsState as makeSettings } from '../helpers/memory-settings'
import { vi as viCore } from 'vitest'

describe('M4-g3 · 会话设置面板', () => {
  it('chatbox 域:保存交回标题、systemPrompt 与模型草稿', async () => {
    const settings = createSettingsState(createStorageRepository(createMemoryEngine()))
    const conversation = { id: 'c1', title: '旧标题', createdAt: 1, updatedAt: 1, systemPrompt: '', model: '', messages: [] } as never
    const wrapper = mount(SessionSettingsSheet, {
      props: { domain: 'chatbox', conversation, cardSession: null, settingsState: settings },
    })
    const titleInput = wrapper.findAll('input').find((input) => input.attributes('list') === undefined)!
    await titleInput.setValue('海边的守望者')
    await wrapper.find('textarea').setValue('你是海边的守望者。')
    await wrapper.find('input[list]').setValue('qwen3.5-72b')
    await wrapper.findAll('button').find((button) => button.text() === '保存')!.trigger('click')
    const saved = wrapper.emitted('saved')![0]![0] as { title: string; systemPrompt: string; model: string }
    expect(saved).toEqual({ title: '海边的守望者', systemPrompt: '你是海边的守望者。', model: 'qwen3.5-72b' })
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('chatbox 域:标题清空后交回空串,由落点侧保持原标题', async () => {
    const settings = createSettingsState(createStorageRepository(createMemoryEngine()))
    const conversation = { id: 'c1', title: '旧标题', createdAt: 1, updatedAt: 1, systemPrompt: '', model: '', messages: [] } as never
    const wrapper = mount(SessionSettingsSheet, {
      props: { domain: 'chatbox', conversation, cardSession: null, settingsState: settings },
    })
    const titleInput = wrapper.findAll('input').find((input) => input.attributes('list') === undefined)!
    await titleInput.setValue('')
    await wrapper.findAll('button').find((button) => button.text() === '保存')!.trigger('click')
    expect(wrapper.emitted('saved')![0]![0]).toEqual({ title: '', systemPrompt: '', model: '' })
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('卡域:只交回模型草稿(system prompt 归卡定义与预设组装)', async () => {
    const settings = createSettingsState(createStorageRepository(createMemoryEngine()))
    const cardSession = { cardId: 'k', title: '卡', createdAt: 1, updatedAt: 1, messages: [], model: '' } as never
    const wrapper = mount(SessionSettingsSheet, {
      props: { domain: 'card', conversation: null, cardSession, settingsState: settings },
    })
    expect(wrapper.find('textarea').exists()).toBe(false)
    // No title input in the card domain — the card name is the sheet title.
    expect(wrapper.findAll('input').filter((input) => input.attributes('list') === undefined)).toHaveLength(0)
    await wrapper.find('input[list]').setValue('deepseek-r1')
    await wrapper.findAll('button').find((button) => button.text() === '保存')!.trigger('click')
    expect(wrapper.emitted('saved')![0]![0]).toEqual({ title: '', systemPrompt: '', model: 'deepseek-r1' })
  })

  it('卡域有封面:背景调节区上屏,保存交回 bg 参数草稿', async () => {
    const settings = createSettingsState(createStorageRepository(createMemoryEngine()))
    // Envelope carries no bg yet → the sheet pre-fills the shipped defaults.
    const cardSession = { cardId: 'k', title: '卡', createdAt: 1, updatedAt: 1, messages: [] } as never
    const wrapper = mount(SessionSettingsSheet, {
      props: { domain: 'card', conversation: null, cardSession, settingsState: settings, cardCover: 'data:image/png;base64,x' },
    })
    expect(wrapper.text()).toContain('卡图背景')
    const ranges = wrapper.findAll('input[type="range"]')
    expect(ranges).toHaveLength(2)
    await ranges[0]!.setValue('12')
    await ranges[1]!.setValue('60')
    await wrapper.findAll('button').find((button) => button.text() === '保存')!.trigger('click')
    const saved = wrapper.emitted('saved')![0]![0] as { bg?: { enabled: boolean; blur: number; dim: number } }
    expect(saved.bg).toEqual({ enabled: true, blur: 12, dim: 60 })
  })

  it('卡域有封面且信封带 bg:草稿吃信封值,关开关后 bg.enabled=false 交回', async () => {
    const settings = createSettingsState(createStorageRepository(createMemoryEngine()))
    const cardSession = { cardId: 'k', title: '卡', createdAt: 1, updatedAt: 1, messages: [], bg: { enabled: true, blur: 8, dim: 30 } } as never
    const wrapper = mount(SessionSettingsSheet, {
      props: { domain: 'card', conversation: null, cardSession, settingsState: settings, cardCover: 'data:image/png;base64,x' },
    })
    const ranges = wrapper.findAll('input[type="range"]')
    expect((ranges[0]!.element as HTMLInputElement).value).toBe('8')
    expect((ranges[1]!.element as HTMLInputElement).value).toBe('30')
    await wrapper.find('input[type="checkbox"]').setValue(false)
    await wrapper.findAll('button').find((button) => button.text() === '保存')!.trigger('click')
    const saved = wrapper.emitted('saved')![0]![0] as { bg?: { enabled: boolean } }
    expect(saved.bg!.enabled).toBe(false)
  })

  it('卡域无封面或 chatbox 域:不出背景调节区', async () => {
    const settings = createSettingsState(createStorageRepository(createMemoryEngine()))
    const cardSession = { cardId: 'k', title: '卡', createdAt: 1, updatedAt: 1, messages: [] } as never
    const noCover = mount(SessionSettingsSheet, {
      props: { domain: 'card', conversation: null, cardSession, settingsState: settings },
    })
    expect(noCover.text()).not.toContain('卡图背景')
    const chatbox = mount(SessionSettingsSheet, {
      props: { domain: 'chatbox', conversation: null, cardSession: null, settingsState: settings, cardCover: 'data:image/png;base64,x' },
    })
    expect(chatbox.text()).not.toContain('卡图背景')
  })

  it('拉取模型填充 datalist 选项', async () => {
    const settings = createSettingsState(createStorageRepository(createMemoryEngine()))
    // scope() projections carry setters into the reactive store (same write
    // path the config section uses).
    Object.assign(settings.scope(['apiProfiles', 'apiActiveProfileId']), {
      apiProfiles: { 'p1': { name: '档', baseUrl: 'https://api.example.com/v1', model: 'm1', apiKey: 'k' } },
      apiActiveProfileId: 'p1',
    })
    vi.spyOn(await import('@/kernel/llm/api-profiles'), 'fetchModelList').mockResolvedValue(['model-a', 'model-b'])
    const wrapper = mount(SessionSettingsSheet, {
      props: { domain: 'chatbox', conversation: null, cardSession: null, settingsState: settings },
    })
    await wrapper.findAll('button').find((button) => button.text() === '拉取模型')!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('获取到 2 个模型')
  })
})

describe('M4-g3 · 会话级模型覆盖 (seam)', () => {
  afterEach(() => {
    viCore.restoreAllMocks()
  })

  it('stream options.model 覆盖请求体里的模型名,端点与密钥仍走档案', async () => {
    const settings = makeSettings()
    Object.assign(settings.scope(['apiProfiles', 'apiActiveProfileId']), {
      apiProfiles: { 'p1': { name: '档', baseUrl: 'https://api.example.com/v1', model: 'profile-model', apiKey: 'sk-test' } },
      apiActiveProfileId: 'p1',
    })
    const bodies: string[] = []
    const auths: string[] = []
    viCore.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      bodies.push(String(init?.body ?? ''))
      auths.push(String((init?.headers as Record<string, string>)?.Authorization ?? ''))
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: 'x' } }] })}\n\ndata: [DONE]\n\n`))
          controller.close()
        },
      })
      return new Response(stream, { status: 200 })
    })
    const provider = createOpenAiCompatibleProvider(settings)
    await provider.stream([{ role: 'user', content: 'hi' }], { model: 'session-override-model' })
    expect(bodies[0]).toContain('"model":"session-override-model"')
    expect(auths[0]).toBe('Bearer sk-test')
    // No override → the profile model.
    await provider.stream([{ role: 'user', content: 'hi' }], {})
    expect(bodies[1]).toContain('"model":"profile-model"')
    void streamChatCompletion
  })
})
