/**
 * Story engine / nstyle integration (M4-nstyle) — requests carry the
 * 【叙事风格】 block; scope resolution: session-temp > card override >
 * global; plugin disabled injects nothing.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import App from '../../src/App.vue'
import {
  CARD_SESSION_STORE_KEY,
  CHARACTER_STORE_KEY,
  NSTYLE_STORE_KEY,
  SEAM_REGISTRY_KEY,
  SESSION_PROJECTION_KEY,
  SETTINGS_STATE_KEY,
  VARIABLE_STORE_KEY,
} from '@/kernel/app/chat-keys'
import { createSessionProjection } from '@/kernel/sessions/session-projection'
import { createCardSessionStore } from '@/kernel/sessions/card-session-store'
import { createCharacterStore } from '@/kernel/characters/character-store'
import { createVariableStore } from '@/kernel/variables/variable-store'
import { createNstyleStore, setTempOverride } from '../../src/kernel/nstyle/nstyle-store'
import type { LlmChatMessage } from '@/kernel/llm/chat-completions'
import type { NstyleConfig } from '../../src/kernel/nstyle/types'
import { DEFAULT_STORY_CONFIG } from '../../src/kernel/nstyle/types'
import { createSettingsState } from '@/kernel/settings/settings-state'
import { createSeamRegistry } from '@/kernel/runtime/seam-registry'
import { createStorageRepository } from '@/kernel/store/storage-repository'
import { createMemoryEngine } from '@/kernel/store/kv-store'
import { PLUGIN_RUNTIME_KEY as RUNTIME_KEY } from '@/kernel/app/runtime-key'
import { createTransientBus } from '@/kernel/runtime/event-bus'
import { createHookRegistry } from '@/kernel/runtime/hooks'
import { createSessionLedger } from '@/kernel/sessions/session-ledger'
import { createSecretsVault } from '@/kernel/secrets/vault'
import { createPlatformCapability } from '@/kernel/app/platform'
import { uiService } from '@/kernel/ui/toasts'
import { pluginViewsSink } from '@/kernel/app/plugin-views'
import { settingsSink } from '@/kernel/app/settings-registry'
import { createKvStore, createPrefixedEngine, MP_STORAGE_PREFIX } from '@/kernel/store/kv-store'
import { createPluginRuntime } from '@/kernel/runtime/runtime'
import type { LlmProvider } from '@/kernel/llm/llm-provider'
import type { CharacterCard } from '@/kernel/characters/character-card'
import VariablesPlugin from '../../src/plugins/variables'
import NstylePlugin from '../../src/plugins/nstyle'


const CARD_STYLE_BASE: NstyleConfig = JSON.parse(JSON.stringify(DEFAULT_STORY_CONFIG)) as NstyleConfig

const CARD: Omit<CharacterCard, 'id' | 'importedAt'> = {
  name: '星澜',
  description: '',
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
  extensions: {},
  spec: 'v1',
}

const streamCalls: Array<readonly LlmChatMessage[]> = []
let nextReply = '（测试回复）'

const fakeProvider: LlmProvider = {
  providerId: 'openai-compatible',
  configured: () => true,
  stream: async (messages) => {
    streamCalls.push(messages)
    return {
      content: nextReply,
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, cacheReadTokens: null },
      model: 'test-model',
    }
  },
}

function mountWithRuntime() {
  const bus = createTransientBus()
  const runtimeSeams = createSeamRegistry((seamId, providerPluginId) => {
    bus.emit('seam.provider.changed', { seamId, providerPluginId })
  })
  runtimeSeams.register('kernel', 'llm.provider', fakeProvider)
  const services = {
    storage: createKvStore(createPrefixedEngine(createMemoryEngine(), MP_STORAGE_PREFIX)),
    settings: createSettingsState(createStorageRepository(createMemoryEngine())),
    session: { getCharacterName: () => '', getCharacterVoice: () => '', getMessageAt: () => null, setActiveCardSession: () => undefined },
    ledger: createSessionLedger(),
    bus,
    seams: runtimeSeams,
    hooks: createHookRegistry(),
    secrets: createSecretsVault(),
    platform: createPlatformCapability(),
    ui: uiService,
    views: pluginViewsSink,
    settingsSink,
    inputActions: { registerAction: () => () => {} },
    cardPanels: { registerSection: () => () => {} },
  }
  const runtime = createPluginRuntime(services as never)
  runtime.load(VariablesPlugin)
  runtime.load(NstylePlugin)
  void runtime.activate('variables')
  void runtime.activate('nstyle')

  const cardSessionStore = createCardSessionStore(createStorageRepository(createMemoryEngine()))
  const characterStore = createCharacterStore(createStorageRepository(createMemoryEngine()))
  const variableStore = createVariableStore(createStorageRepository(createMemoryEngine()))
  const nstyleStore = createNstyleStore(createStorageRepository(createMemoryEngine()))
  const settings = createSettingsState(createStorageRepository(createMemoryEngine()))
  const viewSeams = createSeamRegistry(() => undefined)
  viewSeams.register('kernel', 'llm.provider', fakeProvider)

  const wrapper = mount(App, {
    global: {
      provide: {
        [CARD_SESSION_STORE_KEY as symbol]: cardSessionStore,
        [CHARACTER_STORE_KEY as symbol]: characterStore,
        [VARIABLE_STORE_KEY as symbol]: variableStore,
        [NSTYLE_STORE_KEY as symbol]: nstyleStore,
        [SEAM_REGISTRY_KEY as symbol]: viewSeams,
        [SESSION_PROJECTION_KEY as symbol]: createSessionProjection(),
        [RUNTIME_KEY as symbol]: runtime,
        [SETTINGS_STATE_KEY as symbol]: settings,
      },
    },
  })
  return { wrapper, characterStore, cardSessionStore, nstyleStore, settings, runtime }
}

const enterCard = async (harness: ReturnType<typeof mountWithRuntime>): Promise<string> => {
  const stored = await harness.characterStore.import(CARD)
  await flushPromises()
  const tabs = harness.wrapper.findAll('nav button')
  await tabs[1]!.trigger('click')
  await flushPromises()
  await harness.wrapper.find('button[aria-label="进入「星澜」的对话"]').trigger('click')
  await flushPromises()
  return stored.id
}

const send = async (wrapper: ReturnType<typeof mountWithRuntime>['wrapper'], text: string): Promise<void> => {
  await wrapper.find('textarea').setValue(text)
  await wrapper.findAll('button').find((button: { text: () => string }) => button.text() === '发送')!.trigger('click')
  await flushPromises()
}

describe('叙事风格配置器集成(M4-nstyle)', () => {
  beforeEach(() => {
    window.history.replaceState({}, '')
    window.dispatchEvent(new PopStateEvent('popstate', { state: null }))
    streamCalls.length = 0
    nextReply = '（测试回复）'
    vi.restoreAllMocks()
    setTempOverride(null)
  })

  it('请求系统提示词包含【叙事风格】块,内容随配置变化', async () => {
    const harness = await mountWithRuntime()
    await harness.nstyleStore.setGlobal({
      ...CARD_STYLE_BASE,
      params: { ...CARD_STYLE_BASE.params, dialogue: 90, environment: 10 },
      tags: ['温柔'],
    })
    const cardId = await enterCard(harness)
    await send(harness.wrapper, '你好')

    const systemPrompt = streamCalls[0]!.find((message) => message.role === 'system')!.content
    expect(systemPrompt).toContain('【叙事风格】')
    expect(systemPrompt).toContain('尽量让场景由连续的对话驱动')
    expect(systemPrompt).toContain('只保留理解剧情所必需的最低限度')
    expect(systemPrompt).toContain('整体基调标签：温柔')
    expect(systemPrompt).not.toContain('对话从简')
    expect(cardId).toBeTruthy()
    harness.wrapper.unmount()
  })

  it('作用域优先级:故事级覆盖压过全局;会话临时压过一切', async () => {
    const harness = await mountWithRuntime()
    const cardId = await enterCard(harness)
    await harness.nstyleStore.setGlobal({ ...CARD_STYLE_BASE, params: { ...CARD_STYLE_BASE.params, dialogue: 10 } })
    await harness.nstyleStore.setCardOverride(cardId, { ...CARD_STYLE_BASE, params: { ...CARD_STYLE_BASE.params, dialogue: 80 } })
    await send(harness.wrapper, '第一轮')
    expect(streamCalls.at(-1)!.some((m) => m.role === 'system' && String(m.content).includes('优先以人物对话推进场景'))).toBe(true)

    // 会话临时(内存覆盖最高优先级)
    setTempOverride({ ...CARD_STYLE_BASE, params: { ...CARD_STYLE_BASE.params, dialogue: 20 } })
    await send(harness.wrapper, '第二轮')
    expect(streamCalls.at(-1)!.some((m) => m.role === 'system' && String(m.content).includes('对话从简'))).toBe(true)
    setTempOverride(null)
    harness.wrapper.unmount()
  })

  it('插件停用(仅注册未激活)时请求不含叙事风格块', async () => {
    const harness = await mountWithRuntime()
    await harness.nstyleStore.setGlobal({ ...CARD_STYLE_BASE })
    await harness.runtime.deactivate('nstyle')
    const cardId = await enterCard(harness)
    await send(harness.wrapper, '你好')
    const systemPrompt = streamCalls[0]!.find((message) => message.role === 'system')!.content
    expect(systemPrompt).not.toContain('【叙事风格】')
    expect(cardId).toBeTruthy()
    harness.wrapper.unmount()
  })
})
