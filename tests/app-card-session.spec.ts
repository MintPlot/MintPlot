import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import App from '../src/App.vue'
import {
  CARD_SESSION_STORE_KEY,
  CHATBOX_STORE_KEY,
  CHARACTER_STORE_KEY,
  SEAM_REGISTRY_KEY,
  SESSION_PROJECTION_KEY,
  SETTINGS_STATE_KEY,
  USAGE_RECORDER_KEY,
} from '@/kernel/app/chat-keys'
import { createSessionProjection } from '@/kernel/sessions/session-projection'
import { createChatboxStore } from '@/kernel/sessions/chatbox-store'
import { createCardSessionStore } from '@/kernel/sessions/card-session-store'
import { createCharacterStore } from '@/kernel/characters/character-store'
import { createSettingsState } from '@/kernel/settings/settings-state'
import { createSeamRegistry } from '@/kernel/runtime/seam-registry'
import { createStorageRepository } from '@/kernel/store/storage-repository'
import { createMemoryEngine } from '@/kernel/store/kv-store'
import type { LlmProvider } from '@/kernel/llm/llm-provider'
import type { CharacterCard } from '@/kernel/characters/character-card'

const CARD: Omit<CharacterCard, 'id' | 'importedAt'> = {
  name: '星澜',
  description: '给用户看的简介',
  personality: '温柔而坚定',
  scenario: '',
  firstMes: '你好，旅人。',
  mesExample: '',
  systemPrompt: '',
  postHistoryInstructions: '',
  alternateGreetings: [],
  tags: [],
  creator: '',
  characterVersion: '',
  creatorNotes: '',
  spec: 'v1',
}

/** A provider that answers instantly — the seam is what the page streams through. */
const fakeProvider: LlmProvider = {
  providerId: 'openai-compatible',
  configured: () => true,
  stream: async () => ({
    content: '（测试回复）',
    usage: { inputTokens: 30, outputTokens: 7, totalTokens: 37, cacheReadTokens: null },
    model: 'test-model',
  }),
}

type UsageCall = { usage: unknown; meta: Record<string, string> }

function mountApp() {
  const chatboxStore = createChatboxStore(createStorageRepository(createMemoryEngine()))
  const cardSessionStore = createCardSessionStore(createStorageRepository(createMemoryEngine()))
  const characterStore = createCharacterStore(createStorageRepository(createMemoryEngine()))
  const projection = createSessionProjection()
  const settings = createSettingsState(createStorageRepository(createMemoryEngine()))
  const seams = createSeamRegistry(() => undefined)
  seams.register('kernel', 'llm.provider', fakeProvider)
  const usageCalls: UsageCall[] = []

  const wrapper = mount(App, {
    global: {
      provide: {
        [CHATBOX_STORE_KEY as symbol]: chatboxStore,
        [CARD_SESSION_STORE_KEY as symbol]: cardSessionStore,
        [CHARACTER_STORE_KEY as symbol]: characterStore,
        [SEAM_REGISTRY_KEY as symbol]: seams,
        [SESSION_PROJECTION_KEY as symbol]: projection,
        [SETTINGS_STATE_KEY as symbol]: settings,
        [USAGE_RECORDER_KEY as symbol]: (usage: unknown, meta: Record<string, string>) => {
          usageCalls.push({ usage, meta })
        },
      },
    },
  })
  return { wrapper, chatboxStore, cardSessionStore, characterStore, projection, usageCalls }
}

describe('M3-i · 角色 tab 进卡闭环', () => {
  beforeEach(() => {
    // Reset the module-level chat route between tests.
    window.history.replaceState({}, '')
    window.dispatchEvent(new PopStateEvent('popstate', { state: null }))
  })

  it('点卡直进会话:标题为卡名、开场白种为首楼、发送可回复、投影卡名生效', async () => {
    const { wrapper, cardSessionStore, chatboxStore, characterStore, projection, usageCalls } = mountApp()
    const stored = await characterStore.import(CARD)
    await flushPromises()

    // 角色 tab:封面网格露出卡名(M3-m 网格化后简介不再进列表)。
    const tabs = wrapper.findAll('nav button')
    await tabs[1]!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('星澜')
    expect(wrapper.find('button[aria-label="进入「星澜」的对话"]').exists()).toBe(true)

    // 点卡 → 直接进入该卡会话(D2)。
    await wrapper.find('button[aria-label="进入「星澜」的对话"]').trigger('click')
    await flushPromises()
    await nextTick()

    // 标题 = 卡名;首楼 = 开场白(assistant)。
    expect(wrapper.findAll('h1').map((heading) => heading.text())).toContain('星澜')
    expect(wrapper.text()).toContain('你好，旅人。')

    // 投影真实化:卡会话在场,卡名与楼层可被 TTS 类消费者读到。
    expect(projection.getCharacterName()).toBe('星澜')
    expect(projection.getCharacterVoice()).toBe('')
    expect(projection.getMessageAt(0)).toMatchObject({ content: '你好，旅人。' })

    // 发送一轮:seam 流式回复落为新楼层,chatbox 列表始终为空(域隔离)。
    const textarea = wrapper.find('textarea')
    await textarea.setValue('最近可好?')
    const sendButton = wrapper.findAll('button').find((button) => button.text() === '发送')!
    await sendButton.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('（测试回复）')
    const session = (await cardSessionStore.get(stored.id))!
    expect(session.messages.map((message) => message.role)).toEqual(['assistant', 'user', 'assistant'])
    expect(session.messages[2]).toMatchObject({ content: '（测试回复）' })
    expect(await chatboxStore.list()).toEqual([])

    // 用量归属(M3-j/l):卡域 type='card' 记卡名,模型名来自 provider 应答。
    expect(usageCalls).toHaveLength(1)
    expect(usageCalls[0]!.meta).toEqual({ type: 'card', model: 'test-model', characterName: '星澜' })
    expect(usageCalls[0]!.usage).toMatchObject({ inputTokens: 30, outputTokens: 7 })

    // 清空重开:取消不动,确认后回到仅剩开场白首楼(D3)。
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await wrapper.findAll('button').find((button) => button.text() === '清空重开')!.trigger('click')
    await flushPromises()
    expect((await cardSessionStore.get(stored.id))!.messages).toHaveLength(3)

    confirmSpy.mockReturnValue(true)
    await wrapper.findAll('button').find((button) => button.text() === '清空重开')!.trigger('click')
    await flushPromises()
    const restarted = (await cardSessionStore.get(stored.id))!
    expect(restarted.messages).toHaveLength(1)
    expect(restarted.messages[0]).toMatchObject({ role: 'assistant', content: '你好，旅人。' })
    expect(wrapper.findAll('button').find((button) => button.text() === '发送')!.attributes('disabled')).toBeDefined()

    confirmSpy.mockRestore()
    wrapper.unmount()
    // 卸载即撤投影:回到 chatbox 域读空。
    expect(projection.getCharacterName()).toBe('')
  })

  it('chatbox 发送的用量记录归属会话标题(M3-j)', async () => {
    const { wrapper, usageCalls } = mountApp()
    await flushPromises()

    // 对话 tab:新建对话即进入聊天页。
    await wrapper.find('button[aria-label="新建对话"]').trigger('click')
    await flushPromises()

    const textarea = wrapper.find('textarea')
    await textarea.setValue('天空为什么是蓝的?')
    await wrapper.findAll('button').find((button) => button.text() === '发送')!.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('（测试回复）')
    // 首句成题发生在记录之前 —— detail 携带会话标题,不带卡名。
    expect(usageCalls).toHaveLength(1)
    expect(usageCalls[0]!.meta).toEqual({ type: 'chat', model: 'test-model', detail: '天空为什么是蓝的?' })
    wrapper.unmount()
  })

  it('删除角色卡连带清掉其会话', async () => {
    const { wrapper, cardSessionStore, characterStore } = mountApp()
    const stored = await characterStore.import(CARD)
    await cardSessionStore.create({ id: stored.id, name: stored.name, firstMes: stored.firstMes })
    await flushPromises()

    const tabs = wrapper.findAll('nav button')
    await tabs[1]!.trigger('click')
    await flushPromises()

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    // M3-m 网格:删除收进封面格右上角 ✕ 角标(aria-label 携带卡名)。
    await wrapper.find('button[aria-label="删除角色卡「星澜」"]').trigger('click')
    await flushPromises()
    confirmSpy.mockRestore()

    expect(await characterStore.get(stored.id)).toBeNull()
    expect(await cardSessionStore.get(stored.id)).toBeNull()
    wrapper.unmount()
  })
})
