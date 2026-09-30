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
  VARIABLE_STORE_KEY,
} from '@/kernel/app/chat-keys'
import { createSessionProjection } from '@/kernel/sessions/session-projection'
import { createChatboxStore } from '@/kernel/sessions/chatbox-store'
import { createCardSessionStore } from '@/kernel/sessions/card-session-store'
import { createCharacterStore } from '@/kernel/characters/character-store'
import { createVariableStore } from '@/kernel/variables/variable-store'
import { createSettingsState } from '@/kernel/settings/settings-state'
import { createSeamRegistry } from '@/kernel/runtime/seam-registry'
import { createStorageRepository } from '@/kernel/store/storage-repository'
import { createMemoryEngine } from '@/kernel/store/kv-store'
import { PLUGIN_RUNTIME_KEY } from '@/kernel/app/runtime-key'
import { createTransientBus } from '@/kernel/runtime/event-bus'
import { createSeamRegistry as makeRuntimeSeams } from '@/kernel/runtime/seam-registry'
import { createHookRegistry } from '@/kernel/runtime/hooks'
import { createSessionLedger } from '@/kernel/sessions/session-ledger'
import { createSecretsVault } from '@/kernel/secrets/vault'
import { createPlatformCapability } from '@/kernel/app/platform'
import { uiService } from '@/kernel/ui/toasts'
import { pluginViewsSink } from '@/kernel/app/plugin-views'
import { settingsSink } from '@/kernel/app/settings-registry'
import { createKvStore, createPrefixedEngine, MP_STORAGE_PREFIX } from '@/kernel/store/kv-store'
import { createMemorySettingsState } from './helpers/memory-settings'
import VariablesPlugin from '@/plugins/variables'
import { createPluginRuntime } from '@/kernel/runtime/runtime'
import type { LlmChatMessage } from '@/kernel/llm/chat-completions'
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

/** A provider that answers instantly — the seam is what the page streams
 *  through; requests are captured and the reply text is settable per test. */
const streamCalls: Array<readonly LlmChatMessage[]> = []
let nextReply = '（测试回复）'

const fakeProvider: LlmProvider = {
  providerId: 'openai-compatible',
  configured: () => true,
  stream: async (messages) => {
    streamCalls.push(messages)
    return {
      content: nextReply,
      usage: { inputTokens: 30, outputTokens: 7, totalTokens: 37, cacheReadTokens: null },
      model: 'test-model',
    }
  },
}

type UsageCall = { usage: unknown; meta: Record<string, string> }

/** Runtime services bundle mirroring the bootstrap wiring (plugin toggle tests). */
function makeRuntimeServices() {
  const bus = createTransientBus()
  const seams = makeRuntimeSeams((seamId, providerPluginId) => {
    bus.emit('seam.provider.changed', { seamId, providerPluginId })
  })
  return {
    storage: createKvStore(createPrefixedEngine(createMemoryEngine(), MP_STORAGE_PREFIX)),
    settings: createMemorySettingsState(),
    session: { getCharacterName: () => '', getCharacterVoice: () => '', getMessageAt: () => null, setActiveCardSession: () => undefined },
    ledger: createSessionLedger(),
    bus,
    seams,
    hooks: createHookRegistry(),
    secrets: createSecretsVault(),
    platform: createPlatformCapability(),
    ui: uiService,
    views: pluginViewsSink,
    settingsSink,
    inputActions: { registerAction: () => () => {} },
    cardPanels: { registerSection: () => () => {} },
  }
}

function mountApp(options: { runtime?: ReturnType<typeof createPluginRuntime> } = {}) {
  const chatboxStore = createChatboxStore(createStorageRepository(createMemoryEngine()))
  const cardSessionStore = createCardSessionStore(createStorageRepository(createMemoryEngine()))
  const characterStore = createCharacterStore(createStorageRepository(createMemoryEngine()))
  const variableStore = createVariableStore(createStorageRepository(createMemoryEngine()))
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
        [VARIABLE_STORE_KEY as symbol]: variableStore,
        [SEAM_REGISTRY_KEY as symbol]: seams,
        [SESSION_PROJECTION_KEY as symbol]: projection,
        [SETTINGS_STATE_KEY as symbol]: settings,
        [USAGE_RECORDER_KEY as symbol]: (usage: unknown, meta: Record<string, string>) => {
          usageCalls.push({ usage, meta })
        },
        ...(options.runtime ? { [PLUGIN_RUNTIME_KEY as symbol]: options.runtime } : {}),
      },
    },
  })
  return { wrapper, chatboxStore, cardSessionStore, characterStore, variableStore, projection, usageCalls }
}

describe('M3-i · 角色 tab 进卡闭环', () => {
  beforeEach(() => {
    // Reset the module-level chat route between tests.
    window.history.replaceState({}, '')
    window.dispatchEvent(new PopStateEvent('popstate', { state: null }))
    // Reset the captured provider traffic between tests.
    streamCalls.length = 0
    nextReply = '（测试回复）'
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

  it('变量系统(M3-q):卡默认值播种、setvars 落账、胶囊与 [Variables] 分区、getvar 请求侧展开', async () => {
    const { wrapper, characterStore, variableStore, cardSessionStore } = mountApp()
    const stored = await characterStore.import({
      ...CARD,
      extensions: { mp_variables: [{ name: '好感度', value: 10 }] },
    })
    await flushPromises()

    const tabs = wrapper.findAll('nav button')
    await tabs[1]!.trigger('click')
    await flushPromises()
    await wrapper.find('button[aria-label="进入「星澜」的对话"]').trigger('click')
    await flushPromises()

    // 卡默认值建档播种(extensions.mp_variables)。
    let snapshot = (await variableStore.get(stored.id))!
    expect(snapshot.state['好感度']).toMatchObject({ value: 10, sourceEventId: 'seed' })

    // AI 回复带 setvars 块:楼层原文落库不改写,变量落账(AI 事件、±增量)。
    nextReply = '前文<setvars>{ "好感度": "+15", "时间": "黄昏" }</setvars>'
    const textarea = wrapper.find('textarea')
    await textarea.setValue('最近如何?')
    await wrapper.findAll('button').find((button) => button.text() === '发送')!.trigger('click')
    await flushPromises()

    snapshot = (await variableStore.get(stored.id))!
    expect(snapshot.state['好感度']).toMatchObject({ value: 25 })
    expect(snapshot.state['时间']).toMatchObject({ value: '黄昏' })
    expect(snapshot.events.find((event) => event.name === '好感度')).toMatchObject({
      source: 'ai',
      name: '好感度',
      before: 10,
      after: 25,
    })
    expect((await cardSessionStore.get(stored.id))!.messages.at(-1)!.content).toContain('<setvars>')

    // 显示投影:块被剥离;胶囊账本驱动(扁平 2 事件),点开看明细。
    expect(wrapper.text()).not.toContain('<setvars>')
    expect(wrapper.text()).toContain('⚙ 变量 ×2')
    await wrapper.findAll('button').find((button) => button.text().includes('⚙ 变量'))!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('好感度')
    expect(wrapper.text()).toContain('25')

    // 下一轮请求:系统提示词尾带 [Variables] 紧凑行分区。
    nextReply = '好的'
    await textarea.setValue('继续')
    await wrapper.findAll('button').find((button) => button.text() === '发送')!.trigger('click')
    await flushPromises()
    const systemRequest = streamCalls.at(-1)!.find((message) => message.role === 'system')!
    expect(systemRequest.content).toContain('[Variables]')
    expect(systemRequest.content).toContain('当前状态: 好感度 25 ｜ 时间 黄昏')

    // getvar 请求侧展开:宏解析为当前值,存储楼层保持字面量。
    // (请求末尾的空 assistant 楼层是 M3-i 预填充占位,断言按内容定位。)
    await textarea.setValue('{{getvar::好感度}}点好感')
    await wrapper.findAll('button').find((button) => button.text() === '发送')!.trigger('click')
    await flushPromises()
    const expandedUserFloor = streamCalls.at(-1)!.find((message) => message.content === '25点好感')
    expect(expandedUserFloor).toMatchObject({ role: 'user' })
    const storedFloors = (await cardSessionStore.get(stored.id))!.messages
    expect(storedFloors.find((message) => message.content === '{{getvar::好感度}}点好感')).toMatchObject({ role: 'user' })
    wrapper.unmount()
  })

  it('变量系统(M3-q):StatData 流派标签同样落账', async () => {
    const { wrapper, characterStore, variableStore } = mountApp()
    const stored = await characterStore.import(CARD)
    await flushPromises()
    const tabs = wrapper.findAll('nav button')
    await tabs[1]!.trigger('click')
    await flushPromises()
    await wrapper.find('button[aria-label="进入「星澜」的对话"]').trigger('click')
    await flushPromises()

    nextReply = '状态<StatData>{"金币": 3}</StatData>'
    await wrapper.find('textarea').setValue('看看状态')
    await wrapper.findAll('button').find((button) => button.text() === '发送')!.trigger('click')
    await flushPromises()
    expect((await variableStore.get(stored.id))!.state['金币']).toMatchObject({ value: 3 })
    wrapper.unmount()
  })

  it('变量系统(M3-q):chatbox 域不展开 getvar —— 变量不进对话域(评审 Q4)', async () => {
    const { wrapper } = mountApp()
    await flushPromises()
    await wrapper.find('button[aria-label="新建对话"]').trigger('click')
    await flushPromises()

    await wrapper.find('textarea').setValue('{{getvar::金币}}')
    await wrapper.findAll('button').find((button) => button.text() === '发送')!.trigger('click')
    await flushPromises()
    const literalFloor = streamCalls.at(-1)!.find((message) => message.content === '{{getvar::金币}}')
    expect(literalFloor).toMatchObject({ role: 'user' })
    wrapper.unmount()
  })

  it('UI模板变量(M3-r):播种状态树、schema 注入、ui_template_updates 落账、胶囊', async () => {
    const { wrapper, characterStore, variableStore } = mountApp()
    const stored = await characterStore.import({
      ...CARD,
      uiTemplates: [
        {
          id: 'tpl-1',
          name: '天书蛊匣',
          enabled: true,
          scope: 'character',
          order: 100,
          placement: 'bottom',
          htmlTemplate: '<div>{{hp}}</div>',
          initialVariableState: { hp: 10, stats: { physique: { val: 5 }, strength: { val: 8 } } },
          variableSchema: 'hp: 数值',
        },
      ],
    })
    await flushPromises()

    const tabs = wrapper.findAll('nav button')
    await tabs[1]!.trigger('click')
    await flushPromises()
    await wrapper.find('button[aria-label="进入「星澜」的对话"]').trigger('click')
    await flushPromises()

    // 模板初始树按模板 id 播种。
    const seeded = (await variableStore.get(stored.id))!
    expect(seeded.state['tpl-1']).toMatchObject({ value: { hp: 10 }, sourceEventId: 'seed' })

    // 请求侧:模板指令 + 当前状态/schema 注入系统提示词尾。
    nextReply = '<ui_template_updates>{"hp": 95, "stats": {"physique": {"val": 12}}}</ui_template_updates>'
    await wrapper.find('textarea').setValue('打坐修炼')
    await wrapper.findAll('button').find((button) => button.text() === '发送')!.trigger('click')
    await flushPromises()

    const systemRequest = streamCalls.at(-1)!.find((message) => message.role === 'system')!
    expect(systemRequest.content).toContain('[UI模板变量更新]')
    expect(systemRequest.content).toContain('<ui_template_updates>')
    expect(systemRequest.content).toContain('天书蛊匣')
    expect(systemRequest.content).toContain('"hp": 10')
    expect(systemRequest.content).toContain('hp: 数值')

    // 嵌套合并落账:hp 更新、strength 原值保留(深合并);同值不重复。
    const after = (await variableStore.get(stored.id))!
    expect(after.state['tpl-1']!.value).toMatchObject({
      hp: 95,
      stats: { physique: { val: 12 }, strength: { val: 8 } },
    })
    expect(after.events.at(-1)).toMatchObject({ name: 'tpl-1', source: 'ai' })

    // 显示投影:块被剥离;胶囊账本驱动 —— 模板整树一条事件,明细一行。
    expect(wrapper.text()).not.toContain('ui_template_updates')
    expect(wrapper.text()).toContain('⚙ 变量 ×1')
    await wrapper.findAll('button').find((button) => button.text().includes('⚙ 变量'))!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('面板·天书蛊匣 → 已更新')
    wrapper.unmount()
  })

  it('变量系统插件停用(M3-q2):进卡无变量入口,getvar 保持字面量,不落账', async () => {
    const runtime = createPluginRuntime(makeRuntimeServices())
    runtime.load(VariablesPlugin) // loaded but NOT activated → toggle off semantics
    const { wrapper, characterStore, variableStore } = mountApp({ runtime })
    const stored = await characterStore.import({
      ...CARD,
      extensions: { mp_variables: [{ name: '好感度', value: 10 }] },
    })
    await flushPromises()

    const tabs = wrapper.findAll('nav button')
    await tabs[1]!.trigger('click')
    await flushPromises()
    await wrapper.find('button[aria-label="进入「星澜」的对话"]').trigger('click')
    await flushPromises()

    // 停用:顶栏无「变量」入口。
    expect(wrapper.findAll('button').some((button) => button.text() === '变量')).toBe(false)

    // 请求侧:getvar 不展开(字面量直达),系统提示词无 [Variables] 分区。
    nextReply = '好的<setvars>{ "好感度": "+5" }</setvars>'
    await wrapper.find('textarea').setValue('{{getvar::好感度}}还好吗')
    await wrapper.findAll('button').find((button) => button.text() === '发送')!.trigger('click')
    await flushPromises()

    const request = streamCalls.at(-1)!
    expect(request.find((message) => message.content === '{{getvar::好感度}}还好吗')).toMatchObject({ role: 'user' })
    expect(request.some((message) => message.content.includes('[Variables]'))).toBe(false)

    // 停用期间不解析不落账,账本保持未建档。
    expect(await variableStore.get(stored.id)).toBeNull()
    wrapper.unmount()
  })
})
