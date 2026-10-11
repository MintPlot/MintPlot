import { beforeEach, describe, expect, it, afterEach } from 'vitest'
import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import App from '../src/App.vue'
import {
  CARD_SESSION_STORE_KEY,
  CHARACTER_STORE_KEY,
  PRESET_STORE_KEY,
  SEAM_REGISTRY_KEY,
  SESSION_PROJECTION_KEY,
  SETTINGS_STATE_KEY,
  USAGE_RECORDER_KEY,
} from '@/kernel/app/chat-keys'
import { createSessionProjection } from '@/kernel/sessions/session-projection'
import { createCardSessionStore } from '@/kernel/sessions/card-session-store'
import { createCharacterStore } from '@/kernel/characters/character-store'
import { createPresetStore } from '@/kernel/presets/preset-store'
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
import CotPlugin from '@/plugins/cot'
import TtsPlugin from '@/plugins/tts'
import PresetsPlugin from '@/plugins/presets'
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

/** Provider with settable reply + optional native reasoning (M4-f). */
const streamCalls: Array<readonly LlmChatMessage[]> = []
let nextReply = '（测试回复）'
let nextReasoning = ''

const fakeProvider: LlmProvider = {
  providerId: 'openai-compatible',
  configured: () => true,
  stream: async (messages, options) => {
    streamCalls.push(messages)
    if (nextReasoning) options.onReasoningDelta?.(nextReasoning)
    return {
      content: nextReply,
      reasoning: nextReasoning,
      usage: { inputTokens: 30, outputTokens: 7, totalTokens: 37, cacheReadTokens: null },
      model: 'test-model',
    }
  },
}

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
  const cardSessionStore = createCardSessionStore(createStorageRepository(createMemoryEngine()))
  const characterStore = createCharacterStore(createStorageRepository(createMemoryEngine()))
  const presetStore = createPresetStore(createStorageRepository(createMemoryEngine()))
  const projection = createSessionProjection()
  const settings = createSettingsState(createStorageRepository(createMemoryEngine()))
  const seams = createSeamRegistry(() => undefined)
  seams.register('kernel', 'llm.provider', fakeProvider)

  const wrapper = mount(App, {
    global: {
      provide: {
        [CARD_SESSION_STORE_KEY as symbol]: cardSessionStore,
        [CHARACTER_STORE_KEY as symbol]: characterStore,
        [PRESET_STORE_KEY as symbol]: presetStore,
        [SEAM_REGISTRY_KEY as symbol]: seams,
        [SESSION_PROJECTION_KEY as symbol]: projection,
        [SETTINGS_STATE_KEY as symbol]: settings,
        [USAGE_RECORDER_KEY as symbol]: () => undefined,
        ...(options.runtime ? { [PLUGIN_RUNTIME_KEY as symbol]: options.runtime } : {}),
      },
    },
  })
  return { wrapper, cardSessionStore, characterStore, presetStore, projection, seams, settings }
}

const enterCard = async (app: ReturnType<typeof mountApp>) => {
  const stored = await app.characterStore.import(CARD)
  await flushPromises()
  const tabs = app.wrapper.findAll('nav button')
  await tabs[1]!.trigger('click')
  await flushPromises()
  await app.wrapper.find('button[aria-label="进入「星澜」的对话"]').trigger('click')
  await flushPromises()
  return stored
}

const sendTurn = async (wrapper: ReturnType<typeof mountApp>['wrapper'], text: string) => {
  await wrapper.find('textarea').setValue(text)
  await wrapper.findAll('button').find((button) => button.attributes('aria-label') === '发送')!.trigger('click')
  await flushPromises()
}

describe('M4-f · CoT 视图接线', () => {
  // App.vue registers tabs in setup and unregisters on unmount — the module-
  // level view registry requires every mounted wrapper to unmount between tests.
  enableAutoUnmount(afterEach)

  beforeEach(() => {
    window.history.replaceState({}, '')
    window.dispatchEvent(new PopStateEvent('popstate', { state: null }))
    streamCalls.length = 0
    nextReply = '（测试回复）'
    nextReasoning = ''
  })

  it('请求侧剥离:思考块不进历史请求,COT 预设随发送同步进预设仓', async () => {
    const app = mountApp()
    await enterCard(app)

    // 首轮:回复带思考标签 → 楼层存原文(落库纪律)。
    nextReply = '<cot>内部推演绝密</cot>（测试回复）'
    await sendTurn(app.wrapper, '你好')

    // 第二轮请求:首轮 assistant 楼层只见正文,思考已剥离。
    nextReply = '第二轮回复'
    await sendTurn(app.wrapper, '继续')
    const secondCall = streamCalls[1]!
    const serialized = JSON.stringify(secondCall)
    expect(serialized).not.toContain('内部推演绝密')
    expect(serialized).toContain('（测试回复）')
    // COT 预设随发送幂等同步(managed entry)。
    const snapshot = await app.presetStore.get()
    const cot = snapshot.entries.find((entry) => entry.name === 'COT')
    expect(cot).toMatchObject({ enabled: true, role: 'system' })
    expect(cot!.content).toContain('<thinking_protocol>')
  })

  it('原生 reasoning 落楼层,思考卡可展开收起且开合状态落库', async () => {
    const app = mountApp()
    const { cardSessionStore } = app
    const stored = await enterCard(app)

    nextReply = '（测试回复）'
    nextReasoning = '内心推演过程'
    await sendTurn(app.wrapper, '你好')
    const session = (await cardSessionStore.get(stored.id))!
    expect(session.messages[2]).toMatchObject({ reasoning: '内心推演过程' })

    // 折叠卡默认收起(已完成楼层);点开后展示两节原生思考标题与内容。
    const cardButton = app.wrapper.findAll('button').find((button) => button.text().includes('思考'))!
    expect(cardButton.exists()).toBe(true)
    expect(app.wrapper.text()).not.toContain('内心推演过程')
    await cardButton.trigger('click')
    await flushPromises()
    await nextTick()
    expect(app.wrapper.text()).toContain('原生思考')
    expect(app.wrapper.text()).toContain('内心推演过程')
    expect((await cardSessionStore.get(stored.id))!.messages[2]).toMatchObject({ cotOpen: true })
  })

  it('朗读读剥离后正文,不念思考(D4)', async () => {
    const services = makeRuntimeServices()
    const runtime = createPluginRuntime(services)
    runtime.load(TtsPlugin)
    runtime.load(CotPlugin)
    await runtime.activate('tts')
    await runtime.activate('cot')
    const spoken: Array<{ text: string }> = []
    services.bus.on('tts.speak.requested', (payload: { text: string }) => {
      spoken.push(payload)
    })
    const app = mountApp({ runtime })
    await enterCard(app)

    nextReply = '<think>不该念出来的</think>（测试回复）'
    await sendTurn(app.wrapper, '你好')
    expect(app.wrapper.text()).toContain('思考')

    await app.wrapper.find('button[aria-label="朗读第 3 楼"]').trigger('click')
    await flushPromises()
    expect(spoken).toHaveLength(1)
    expect(spoken[0]!.text).toBe('（测试回复）')
  })

  it('插件停用:思考卡消失、请求透传标签原文、COT 预设不注入', async () => {
    const runtime = createPluginRuntime(makeRuntimeServices())
    runtime.load(CotPlugin) // loaded but NOT activated → toggle off semantics
    const app = mountApp({ runtime })
    await enterCard(app)

    nextReply = '<cot>停用下的思考</cot>（测试回复）'
    await sendTurn(app.wrapper, '你好')
    // No thinking card rendered; the reply floor keeps the raw tags (no card,
    // no display strip — 整层休眠, raw passthrough).
    expect(app.wrapper.findAll('button').find((button) => button.text().includes('思考'))).toBeUndefined()

    // Second turn: history keeps the raw tags (no request-side strip either).
    nextReply = '第二轮回复'
    await sendTurn(app.wrapper, '继续')
    expect(JSON.stringify(streamCalls[1])).toContain('停用下的思考')
    const snapshot = await app.presetStore.get()
    expect(snapshot.entries.find((entry) => entry.name === 'COT')).toBeUndefined()
  })

  it('预设活而 cot 停用:COT 条目不装配进请求,预注入预填块退回种子', async () => {
    const runtime = createPluginRuntime(makeRuntimeServices())
    runtime.load(PresetsPlugin)
    runtime.load(CotPlugin) // NOT activated
    await runtime.activate('presets')
    const app = mountApp({ runtime })
    // Simulate a prior active sync: managed COT entry + a rewritten prefill.
    await app.presetStore.syncManagedEntry({ name: 'COT', content: '<thinking_protocol>引导</thinking_protocol>', role: 'system' })
    const snapshot = await app.presetStore.get()
    const prefill1 = snapshot.entries.find((entry) => entry.name === '破限预注入 · AI 1')!
    await app.presetStore.setEntryEnabled(prefill1.id, true)
    await app.presetStore.syncManagedEntry({ name: '破限预注入 · AI 1', content: '<cot>预填块</cot>我会克服这些困难', role: 'assistant' })
    await enterCard(app)

    nextReply = '（测试回复）'
    await sendTurn(app.wrapper, '你好')

    const request = JSON.stringify(streamCalls[0])
    expect(request).not.toContain('<thinking_protocol>')
    expect(request).not.toContain('<cot>预填块</cot>')
    // The dormant send reverted the prefill rewrite to its seed content.
    const after = await app.presetStore.get()
    const reverted = after.entries.find((entry) => entry.name === '破限预注入 · AI 1')!
    expect(reverted.content.startsWith('<cot>')).toBe(false)
    expect(reverted.content).toContain('我会克服这些困难')
    // The managed entry survives in the store (re-activation re-syncs it).
    expect((await app.presetStore.get()).entries.find((entry) => entry.name === 'COT')).toBeDefined()
  })
})
