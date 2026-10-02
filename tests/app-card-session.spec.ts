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
import { createWorldbookStore } from '@/kernel/worldinfo/worldbook-store'
import { createPresetStore } from '@/kernel/presets/preset-store'
import { WORLDBOOK_STORE_KEY, PRESET_STORE_KEY } from '@/kernel/app/chat-keys'
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
import { HTML_FLOOR_OMISSION_MARKER } from '@/kernel/regex/regex-engine'

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
  const worldbookStore = createWorldbookStore(createStorageRepository(createMemoryEngine()))
  const presetStore = createPresetStore(createStorageRepository(createMemoryEngine()))
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
        [WORLDBOOK_STORE_KEY as symbol]: worldbookStore,
        [PRESET_STORE_KEY as symbol]: presetStore,
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
  return { wrapper, chatboxStore, cardSessionStore, characterStore, variableStore, worldbookStore, presetStore, projection, usageCalls, seams, settings }
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

    // 请求侧(M3-s):模板指令改挂请求最末一条 system 消息(RP "Instructions
    // for next message" 位置——最后指令生效),随行当前状态/schema 载荷。
    nextReply = '<ui_template_updates>{"hp": 95, "stats": {"physique": {"val": 12}}}</ui_template_updates>'
    await wrapper.find('textarea').setValue('打坐修炼')
    await wrapper.findAll('button').find((button) => button.text() === '发送')!.trigger('click')
    await flushPromises()

    const request = streamCalls.at(-1)!
    const lastMessage = request.at(-1)!
    expect(lastMessage.role).toBe('system')
    expect(lastMessage.content).toContain('[Instructions for next message]')
    expect(lastMessage.content).toContain('[UI模板变量更新]')
    expect(lastMessage.content).toContain('<ui_template_updates>')
    expect(lastMessage.content).toContain('天书蛊匣')
    expect(lastMessage.content).toContain('"hp": 10')
    expect(lastMessage.content).toContain('hp: 数值')

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

  it('面板渲染(M3-s):逐楼快照上屏、按楼层回放、chatbox 域与流式楼不挂', async () => {
    const { wrapper, characterStore, cardSessionStore } = mountApp()
    await characterStore.import({
      ...CARD,
      uiTemplates: [
        {
          id: 'tpl-1',
          name: '状态栏',
          enabled: true,
          scope: 'character',
          order: 100,
          placement: 'bottom',
          htmlTemplate: '<section class="panel"><span class="hp">{{hp}}</span><em>{{location}}</em></section>',
          initialVariableState: { hp: 10, location: '青茅山' },
          variableSchema: '',
        },
      ],
    })
    await flushPromises()
    const tabs = wrapper.findAll('nav button')
    await tabs[1]!.trigger('click')
    await flushPromises()
    await wrapper.find('button[aria-label="进入「星澜」的对话"]').trigger('click')
    await flushPromises()
    await nextTick()

    // 开场白楼挂 seed 态面板:插值产物在沙箱 iframe srcdoc 里。
    let panels = wrapper.findAll('iframe.executable-html-frame')
    expect(panels).toHaveLength(1)
    expect(panels[0]!.attributes('srcdoc')).toContain('<section class="panel">')
    expect(panels[0]!.attributes('srcdoc')).toContain('10')
    expect(panels[0]!.attributes('srcdoc')).toContain('青茅山')

    // 第一轮:回复带更新块 → 本楼面板按「该楼事件后」状态渲染(95/中洲)。
    nextReply = '修炼一番<ui_template_updates>{"hp": 95, "location": "中洲"}</ui_template_updates>'
    await wrapper.find('textarea').setValue('打坐')
    await wrapper.findAll('button').find((button) => button.text() === '发送')!.trigger('click')
    await flushPromises()
    await nextTick()

    panels = wrapper.findAll('iframe.executable-html-frame')
    expect(panels).toHaveLength(2)
    // 逐楼快照:开场白楼保持 seed(10/青茅山),新楼显示更新后状态。
    expect(panels[0]!.attributes('srcdoc')).toContain('青茅山')
    expect(panels[1]!.attributes('srcdoc')).toContain('95')
    expect(panels[1]!.attributes('srcdoc')).toContain('中洲')

    // 第二轮无变量变化:两楼面板沿用各自状态(共用插值缓存),楼层事件为空。
    nextReply = '（无变化回复）'
    await wrapper.find('textarea').setValue('继续')
    await wrapper.findAll('button').find((button) => button.text() === '发送')!.trigger('click')
    await flushPromises()
    await nextTick()
    panels = wrapper.findAll('iframe.executable-html-frame')
    expect(panels).toHaveLength(3)
    expect(panels[2]!.attributes('srcdoc')).toContain('95')

    // 逐楼回放投影正确性直接对账本验证。
    const session = (await cardSessionStore.get((await characterStore.list())[0]!.id))!
    expect(session.messages).toHaveLength(5)
    wrapper.unmount()
  })

  it('面板渲染(M3-s):placement top 在正文之上,含脚本标签走风险检测纯函数', async () => {
    const { analyzeTemplateScriptRisk } = await import('@/kernel/render/template-interp')
    const { wrapper, characterStore } = mountApp()
    await characterStore.import({
      ...CARD,
      uiTemplates: [
        {
          id: 'tpl-top',
          name: '顶栏',
          enabled: true,
          scope: 'character',
          order: 200,
          placement: 'top',
          htmlTemplate: '<header>{{realm}}</header>',
          initialVariableState: { realm: '一转' },
          variableSchema: '',
        },
      ],
    })
    await flushPromises()
    const tabs = wrapper.findAll('nav button')
    await tabs[1]!.trigger('click')
    await flushPromises()
    await wrapper.find('button[aria-label="进入「星澜」的对话"]').trigger('click')
    await flushPromises()
    await nextTick()

    // top 面板 = 楼层正文上方:iframe 在 markdown 楼层内容之前的插槽里。
    const bubble = wrapper.findAll('iframe.executable-html-frame')
    expect(bubble).toHaveLength(1)
    expect(bubble[0]!.attributes('srcdoc')).toContain('一转')
    // 风险检测是纯函数(轻管理面「含脚本」标签的数据源)。
    expect(analyzeTemplateScriptRisk('<header>{{realm}}</header>').risky).toBe(false)
    wrapper.unmount()
  })

  it('清空重开回种模板树(M3-s 修复):账本回到完整 seed', async () => {
    const { wrapper, characterStore, variableStore, cardSessionStore } = mountApp()
    const stored = await characterStore.import({
      ...CARD,
      uiTemplates: [
        {
          id: 'tpl-1',
          name: '状态栏',
          enabled: true,
          scope: 'character',
          order: 100,
          placement: 'bottom',
          htmlTemplate: '<b>{{hp}}</b>',
          initialVariableState: { hp: 10 },
          variableSchema: '',
        },
      ],
    })
    await flushPromises()
    const tabs = wrapper.findAll('nav button')
    await tabs[1]!.trigger('click')
    await flushPromises()
    await wrapper.find('button[aria-label="进入「星澜」的对话"]').trigger('click')
    await flushPromises()

    nextReply = '<ui_template_updates>{"hp": 95}</ui_template_updates>'
    await wrapper.find('textarea').setValue('修炼')
    await wrapper.findAll('button').find((button) => button.text() === '发送')!.trigger('click')
    await flushPromises()
    expect((await variableStore.get(stored.id))!.state['tpl-1']).toMatchObject({ value: { hp: 95 } })

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    await wrapper.findAll('button').find((button) => button.text() === '清空重开')!.trigger('click')
    await flushPromises()
    confirmSpy.mockRestore()

    // M3-s 修复前:reset 只回种扁平默认,模板树从账本消失(靠 fallback 遮住)。
    const restarted = (await variableStore.get(stored.id))!
    expect(restarted.events).toEqual([])
    expect(restarted.state['tpl-1']).toMatchObject({ value: { hp: 10 }, sourceEventId: 'seed' })
    expect((await cardSessionStore.get(stored.id))!.messages).toHaveLength(1)
    wrapper.unmount()
  })

  it('面板按钮 triggerSlash 桥(M3-t):替用户发话,流式中拒绝,草稿不受扰', async () => {
    const { getExecutableFrameSlashHandler } = await import('@/kernel/render/html-frame')
    const { wrapper, characterStore, cardSessionStore, seams } = mountApp()
    // Deferred provider: the stream stays open until the test releases it,
    // creating a real streaming window to probe the reject branch.
    let resolveStream: (value: { content: string; usage: { inputTokens: number; outputTokens: number; totalTokens: number; cacheReadTokens: number | null }; model: string }) => void = () => {}
    const gatedProvider: LlmProvider = {
      providerId: 'openai-compatible',
      configured: () => true,
      stream: async (messages, options) => {
        streamCalls.push(messages)
        void options
        return await new Promise((resolve) => { resolveStream = resolve })
      },
    }
    seams.register('kernel', 'llm.provider', gatedProvider)
    await characterStore.import(CARD)
    await flushPromises()
    const tabs = wrapper.findAll('nav button')
    await tabs[1]!.trigger('click')
    await flushPromises()
    await wrapper.find('button[aria-label="进入「星澜」的对话"]').trigger('click')
    await flushPromises()

    // 组件挂载即注册桥 handler。
    const handler = getExecutableFrameSlashHandler()
    expect(handler).toBeTypeOf('function')

    // 空闲触发:命令文本直接成为用户楼层,输入草稿不动。
    await wrapper.find('textarea').setValue('草稿内容')
    await handler!('我环顾四周')
    await flushPromises()
    expect(wrapper.text()).toContain('我环顾四周')
    expect(wrapper.find('textarea').element.value).toBe('草稿内容')

    // 流式中触发:拒绝（不追加楼层）。此刻上一触发仍在流式窗口内。
    const midCount = wrapper.findAll('.markdown-body').length
    await handler!('流式中的触发应被拒')
    await flushPromises()
    expect(wrapper.findAll('.markdown-body').length).toBe(midCount)
    expect(wrapper.text()).not.toContain('流式中的触发应被拒')

    // 放行流式,回复落地;卸载后桥解绑（不串到下一个视图）。
    resolveStream({ content: '回复中', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, cacheReadTokens: null }, model: 'test-model' })
    await flushPromises()
    const session = (await cardSessionStore.get((await characterStore.list())[0]!.id))!
    expect(session.messages.filter((message) => message.content === '我环顾四周')).toHaveLength(1)
    wrapper.unmount()
    expect(getExecutableFrameSlashHandler()).toBeNull()
  })

  it('副模型降级(M3-t):主模型漏块自动补分析请求,更新落账并重渲染面板', async () => {
    const { wrapper, characterStore, variableStore, settings } = mountApp()
    const analysisScope = settings.scope(['uiTemplateModel', 'apiBaseUrl'])
    analysisScope.uiTemplateModel = 'analysis-model'
    analysisScope.apiBaseUrl = 'http://analysis-endpoint/v1'
    await characterStore.import({
      ...CARD,
      uiTemplates: [
        {
          id: 'tpl-1',
          name: '状态栏',
          enabled: true,
          scope: 'character',
          order: 100,
          placement: 'bottom',
          htmlTemplate: '<b>{{hp}}</b>',
          initialVariableState: { hp: 10 },
          variableSchema: 'hp: 数字',
        },
      ],
    })
    await flushPromises()
    const tabs = wrapper.findAll('nav button')
    await tabs[1]!.trigger('click')
    await flushPromises()
    await wrapper.find('button[aria-label="进入「星澜」的对话"]').trigger('click')
    await flushPromises()

    // 分析请求走独立 fetch：主模型回复是 seam fake（不走 fetch），
    // 所以被捕获的每个 fetch 都是分析请求。
    const fetchCalls: Array<{ url: string; body: string }> = []
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const body = String(init?.body ?? '')
      fetchCalls.push({ url, body })
      return new Response(JSON.stringify({
        model: 'analysis-model',
        choices: [{ message: { content: '{"variables":{"hp":88},"reason":"回复后状态"}' } }],
        usage: { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })

    // 主模型回复不带任何协议块 → 降级链应自动发起分析请求。
    nextReply = '（普通回复，没有变量块）'
    await wrapper.find('textarea').setValue('出发')
    await wrapper.findAll('button').find((button) => button.text() === '发送')!.trigger('click')
    await flushPromises()
    await flushPromises()

    const analysisCall = fetchCalls.find((call) => call.body.includes('"stream":false'))
    expect(analysisCall).toBeDefined()
    expect(analysisCall!.body).toContain('"model":"analysis-model"')
    // 单模板模式：当前状态与卡自带 schema 内嵌在 system 指令里（RP 同构）；
    // 内层 JSON 在请求体里是转义形态，用无引号子串断言。
    expect(analysisCall!.body).toContain('当前变量JSON如下')
    expect(analysisCall!.body).toContain('hp: 数字')
    expect(analysisCall!.body).toContain('"temperature":0.2')
    expect(analysisCall!.body).toContain('你好，旅人。')

    // 分析结果落账（AI 事件）并驱动面板。
    const snapshot = (await variableStore.get((await characterStore.list())[0]!.id))!
    expect(snapshot.state['tpl-1']).toMatchObject({ value: { hp: 88 } })
    expect(snapshot.events.at(-1)).toMatchObject({ name: 'tpl-1', source: 'ai' })
    vi.unstubAllGlobals()
    wrapper.unmount()
  })

  it('世界书(M3-u):蓝灯进系统提示词、绿灯按深度 splice、启停覆盖生效、无书卡零注入', async () => {
    const { wrapper, characterStore, worldbookStore } = mountApp()
    const stored = await characterStore.import({
      ...CARD,
      book: {
        entries: [
          { uid: 0, comment: '蓝灯', content: '世界书常驻设定内容', constant: true, insertion_order: 10, position: 'global_note' },
          { uid: 1, comment: '绿灯', content: '中洲深度知识', keys: ['中洲'], insertion_order: 5, position: 4, depth: 1 },
          { uid: 2, comment: '不触发', content: '永不出现的内容', keys: ['绝对不存在的词'], insertion_order: 1 },
        ],
      },
    })
    await flushPromises()
    const tabs = wrapper.findAll('nav button')
    await tabs[1]!.trigger('click')
    await flushPromises()
    await wrapper.find('button[aria-label="进入「星澜」的对话"]').trigger('click')
    await flushPromises()

    // 顶栏入口出现(有书才有)。
    expect(wrapper.findAll('button').some((button) => button.text() === '世界书')).toBe(true)

    nextReply = '（回复）'
    await wrapper.find('textarea').setValue('出发去中洲')
    await wrapper.findAll('button').find((button) => button.text() === '发送')!.trigger('click')
    await flushPromises()

    const request = streamCalls.at(-1)!
    // 蓝灯 global_note → 系统提示词内。
    const systemMessage = request.find((message) => message.role === 'system')!
    expect(systemMessage.content).toContain('[蓝灯]')
    expect(systemMessage.content).toContain('世界书常驻设定内容')
    // 绿灯 at_depth=1 → 以 system 消息 splice 在最后一条用户楼层之前。
    const depthMessage = request.find((message) => message.role === 'system' && message.content === '[绿灯]\n中洲深度知识')
    expect(depthMessage).toBeDefined()
    // 未触发条目不进请求。
    expect(request.some((message) => message.content.includes('永不出现的内容'))).toBe(false)

    // 启停覆盖:关掉蓝灯后,同应用内返回再重进(ChatSessionView 重挂载重读
    // 覆盖层)——蓝灯消失、绿灯仍在。
    await worldbookStore.setDisabled(stored.id, new Set([0]))
    await wrapper.find('button[aria-label="返回对话列表"]').trigger('click')
    await flushPromises()
    await nextTick()
    await flushPromises()
    await wrapper.find('button[aria-label="进入「星澜」的对话"]').trigger('click')
    await flushPromises()
    await nextTick()
    await flushPromises()
    await wrapper.find('textarea').setValue('再出发去中洲')
    await wrapper.findAll('button').find((button) => button.text() === '发送')!.trigger('click')
    await flushPromises()
    const secondRequest = streamCalls.at(-1)!
    expect(secondRequest.some((message) => message.content.includes('世界书常驻设定内容'))).toBe(false)
    // 绿灯未关,仍触发。
    expect(secondRequest.some((message) => message.content.includes('中洲深度知识'))).toBe(true)
    wrapper.unmount()
  })

  it('正则(M3-v):显示面美化上屏、提示词面改写、HTML 楼层省略开关、落库纪律', async () => {
    const { wrapper, characterStore, cardSessionStore, settings } = mountApp()
    settings.scope(['promptOmitHtmlFloors']).promptOmitHtmlFloors = true
    await characterStore.import({
      ...CARD,
      firstMes: '<html><body><p>（心理）开场白文档</p></body></html>',
      extensions: {
        regex_scripts: [
          // 美化(全 false=仅显示):（）→ span 心理块
          { name: '心理', regex: '（([^）]*?)）', flags: 'gi', replacement: '<span class="psy">$1</span>', placement: [1, 2] },
          // 提示词剥离(带尖括号,raw 跑):删掉开场的残留标记
          { name: '剥离', regex: '<html>', flags: 'gi', replacement: '', promptOnly: true, placement: [2] },
        ],
      },
    })
    await flushPromises()
    const tabs = wrapper.findAll('nav button')
    await tabs[1]!.trigger('click')
    await flushPromises()
    await wrapper.find('button[aria-label="进入「星澜」的对话"]').trigger('click')
    await flushPromises()
    await nextTick()

    // 顶栏入口出现。
    expect(wrapper.findAll('button').some((button) => button.text() === '正则')).toBe(true)

    // 显示面:开场白是完整 HTML 文档 → 走 M3-n iframe 文档路径,美化不套;
    // 但省略开关只影响提示词,显示保持文档渲染。
    nextReply = '（紧张）回复正文'
    await wrapper.find('textarea').setValue('你好')
    await wrapper.findAll('button').find((button) => button.text() === '发送')!.trigger('click')
    await flushPromises()
    await nextTick()

    // 显示面:用户楼层「你好」无括号不动;AI 楼层（紧张）→ 心理块 span。
    const html = wrapper.html()
    expect(html).toContain('<span class="psy">紧张</span>')
    // 提示词面:开场白 HTML 文档被省略标记替换(默认开);promptOnly 剥离跑过。
    const request = streamCalls.at(-1)!
    const greetingMessage = request.find((message) => message.role === 'assistant' && message.content.includes(HTML_FLOOR_OMISSION_MARKER))!
    expect(greetingMessage.content).not.toContain('<html>')
    // 落库纪律:存储楼层保持原样(协议/正则/省略都只是投影)。
    const stored = (await cardSessionStore.get((await characterStore.list())[0]!.id))!
    expect(stored.messages[0]!.content).toContain('<html>')
    wrapper.unmount()
  })

  it('预设(M3-w):system 条目前置、预注入消息、宏展开、停用即回到原装配', async () => {
    const { wrapper, characterStore, presetStore } = mountApp()
    await presetStore.ensure()
    // 启用「防重复」(system 角色,默认组)并新建一条 user 预注入。
    const seedEntries = (await presetStore.get()).entries
    await presetStore.setEntryEnabled(seedEntries.find((entry) => entry.name === '防重复')!.id, true)
    await presetStore.addEntry({ name: '测试预注入', content: '{{user}}的预注入', role: 'user' })
    await characterStore.import({ ...CARD })
    await flushPromises()
    const tabs = wrapper.findAll('nav button')
    await tabs[1]!.trigger('click')
    await flushPromises()
    await wrapper.find('button[aria-label="进入「星澜」的对话"]').trigger('click')
    await flushPromises()

    nextReply = '（回复）'
    await wrapper.find('textarea').setValue('出发')
    await wrapper.findAll('button').find((button) => button.text() === '发送')!.trigger('click')
    await flushPromises()

    const request = streamCalls.at(-1)!
    // system 条目带名字包装,置顶于系统提示词(数组序,默认组多条启用)。
    const systemMessage = request.find((message) => message.role === 'system')!
    expect(systemMessage.content).toContain('[防重复]')
    // 预注入 user 消息紧跟系统消息,宏已展开({{user}}→用户名,空则消失)。
    const prefill = request[1]!
    expect(prefill.role).toBe('user')
    expect(prefill.content).toContain('的预注入')
    expect(prefill.content).not.toContain('{{user}}')
    wrapper.unmount()
  })

  it('请求侧双剥(M3-s):历史楼层协议块不进请求,存储保持原样', async () => {
    const { wrapper, characterStore, cardSessionStore } = mountApp()
    await characterStore.import({
      ...CARD,
      extensions: { mp_variables: [{ name: '好感度', value: 10 }] },
    })
    await flushPromises()
    const tabs = wrapper.findAll('nav button')
    await tabs[1]!.trigger('click')
    await flushPromises()
    await wrapper.find('button[aria-label="进入「星澜」的对话"]').trigger('click')
    await flushPromises()

    nextReply = '好的<setvars>{ "好感度": "+5" }</setvars>'
    await wrapper.find('textarea').setValue('第一句')
    await wrapper.findAll('button').find((button) => button.text() === '发送')!.trigger('click')
    await flushPromises()

    // 下一轮:历史楼层里的 setvars 块剥除,正文保留;存储不改写。
    nextReply = '（第二条回复）'
    await wrapper.find('textarea').setValue('第二句')
    await wrapper.findAll('button').find((button) => button.text() === '发送')!.trigger('click')
    await flushPromises()

    const request = streamCalls.at(-1)!
    const firstUserFloor = request.find((message) => message.role === 'user' && message.content === '第一句')!
    expect(firstUserFloor).toBeDefined()
    request.forEach((message) => {
      expect(message.content).not.toContain('<setvars>')
    })
    expect((await cardSessionStore.get((await characterStore.list())[0]!.id))!.messages.some((message) => message.content.includes('<setvars>'))).toBe(true)
    wrapper.unmount()
  })
})
