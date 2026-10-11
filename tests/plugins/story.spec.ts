/**
 * Story engine plugin (M4-e) — integration: with the story plugin ACTIVE and
 * the settings keys populated, card-domain requests carry the 【故事引擎】
 * block (principles + stage table with the ledger's current stage + the
 * bookkeeping instruction); chatbox requests carry principles only; plugin
 * DISABLED (registered, not activated) injects nothing.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import App from '../../src/App.vue'
import {
  CARD_SESSION_STORE_KEY,
  CHARACTER_STORE_KEY,
  SEAM_REGISTRY_KEY,
  SESSION_PROJECTION_KEY,
  SETTINGS_STATE_KEY,
  VARIABLE_STORE_KEY,
} from '@/kernel/app/chat-keys'
import { createSessionProjection } from '@/kernel/sessions/session-projection'
import { createCardSessionStore } from '@/kernel/sessions/card-session-store'
import { createCharacterStore } from '@/kernel/characters/character-store'
import { createVariableStore } from '@/kernel/variables/variable-store'
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
import type { LlmChatMessage } from '@/kernel/llm/chat-completions'
import type { LlmProvider } from '@/kernel/llm/llm-provider'
import type { CharacterCard } from '@/kernel/characters/character-card'
import VariablesPlugin from '../../src/plugins/variables'
import StoryPlugin from '../../src/plugins/story'

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
  extensions: {
    mp_variables: [{ name: 'story.stage', value: '初识' }],
  },
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

async function mountWithRuntime() {
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
  runtime.load(StoryPlugin)
  await runtime.activate('variables')
  await runtime.activate('story')

  const cardSessionStore = createCardSessionStore(createStorageRepository(createMemoryEngine()))
  const characterStore = createCharacterStore(createStorageRepository(createMemoryEngine()))
  const variableStore = createVariableStore(createStorageRepository(createMemoryEngine()))
  const settings = createSettingsState(createStorageRepository(createMemoryEngine()))
  const viewSeams = createSeamRegistry(() => undefined)
  viewSeams.register('kernel', 'llm.provider', fakeProvider)

  const wrapper = mount(App, {
    global: {
      provide: {
        [CARD_SESSION_STORE_KEY as symbol]: cardSessionStore,
        [CHARACTER_STORE_KEY as symbol]: characterStore,
        [VARIABLE_STORE_KEY as symbol]: variableStore,
        [SEAM_REGISTRY_KEY as symbol]: viewSeams,
        [SESSION_PROJECTION_KEY as symbol]: createSessionProjection(),
        [SETTINGS_STATE_KEY as symbol]: settings,
        ...(runtime ? { [RUNTIME_KEY as symbol]: runtime } : {}),
      },
    },
  })
  return { wrapper, characterStore, cardSessionStore, variableStore, settings, runtime }
}

type Harness = Awaited<ReturnType<typeof mountWithRuntime>>

const enterCard = async (harness: Harness): Promise<string> => {
  const stored = await harness.characterStore.import(CARD)
  await flushPromises()
  const tabs = harness.wrapper.findAll('nav button')
  await tabs[1]!.trigger('click')
  await flushPromises()
  await harness.wrapper.find('button[aria-label="进入「星澜」的对话"]').trigger('click')
  await flushPromises()
  return stored.id
}

const send = async (wrapper: Harness['wrapper'], text: string): Promise<void> => {
  await wrapper.find('textarea').setValue(text)
  await wrapper.findAll('button').find((button: { text: () => string }) => button.text() === '发送')!.trigger('click')
  await flushPromises()
}

describe('故事引擎插件(M4-e)', () => {
  beforeEach(() => {
    window.history.replaceState({}, '')
    window.dispatchEvent(new PopStateEvent('popstate', { state: null }))
    streamCalls.length = 0
    nextReply = '（测试回复）'
    vi.restoreAllMocks()
  })

  it('卡域请求注入叙事原则 + 阶段表(当前阶段读账本) + 记账指令', async () => {
    const harness = await mountWithRuntime()
    harness.settings.scope(['storyPrinciples']).storyPrinciples = '自定义叙事原则。'
    await harness.settings.flush()
    const cardId = await enterCard(harness)
    // AI 首轮带阶段记账:stage 跃迁落账,下一轮请求的当前阶段跟着变。
    nextReply = '好。<setvars>{ "story.stage": "熟悉" }</setvars>'
    await send(harness.wrapper, '你好')
    await flushPromises()

    const systemPrompt = streamCalls[0]!.find((message) => message.role === 'system')!.content
    expect(systemPrompt).toContain('【叙事原则】')
    expect(systemPrompt).toContain('自定义叙事原则。')
    expect(systemPrompt).toContain('【关系阶段】当前阶段：初识')
    expect(systemPrompt).toContain('- 初识（当前）')
    expect(systemPrompt).toContain('【阶段记账】')
    expect(streamCalls.length).toBe(1)

    // 第二轮:账本 stage=熟悉 → 阶段表当前标注切换。
    await send(harness.wrapper, '继续')
    await flushPromises()
    const secondPrompt = streamCalls[1]!.find((message) => message.role === 'system')!.content
    expect(secondPrompt).toContain('当前阶段：熟悉')
    expect(secondPrompt).toContain('- 熟悉（当前）')
    expect((await harness.variableStore.get(cardId))!.state['story.stage']).toMatchObject({ value: '熟悉' })
    harness.wrapper.unmount()
  })

  it('用户清空阶段表(持久化 "[]")后阶段系统休眠,原则照常注入', async () => {
    const harness = await mountWithRuntime()
    harness.settings.scope(['storyStages']).storyStages = '[]'
    await enterCard(harness)
    await send(harness.wrapper, '你好')
    await flushPromises()
    const systemPrompt = streamCalls[0]!.find((message) => message.role === 'system')!.content
    expect(systemPrompt).not.toContain('【关系阶段】')
    expect(systemPrompt).not.toContain('【阶段记账】')
    expect(systemPrompt).toContain('【叙事原则】')
    harness.wrapper.unmount()
  })

  it('阶段变量名与卡片模板 id 相撞时阶段系统让位,避免账本互写', async () => {
    const harness = await mountWithRuntime()
    await harness.characterStore.import({
      ...CARD,
      uiTemplates: [{
        id: 'story.stage',
        name: '同名模板',
        enabled: true,
        scope: 'character',
        order: 1,
        placement: 'bottom',
        htmlTemplate: '<div>面板</div>',
        initialVariableState: {},
        variableSchema: '',
      }],
    })
    await flushPromises()
    const tabs = harness.wrapper.findAll('nav button')
    await tabs[1]!.trigger('click')
    await flushPromises()
    await harness.wrapper.find('button[aria-label="进入「星澜」的对话"]').trigger('click')
    await flushPromises()
    await send(harness.wrapper, '你好')
    await flushPromises()
    const systemPrompt = streamCalls[0]!.find((message) => message.role === 'system')!.content
    expect(systemPrompt).not.toContain('【关系阶段】')
    expect(systemPrompt).not.toContain('【阶段记账】')
    harness.wrapper.unmount()
  })

  it('插件停用(仅注册未激活)时请求不含故事块', async () => {
    const harness = await mountWithRuntime()
    // Deactivate both: the page sees 'registered' state and skips the block.
    await harness.runtime.deactivate('variables')
    await harness.runtime.deactivate('story')
    await enterCard(harness)
    await send(harness.wrapper, '你好')
    await flushPromises()
    const systemPrompt = streamCalls[0]!.find((message) => message.role === 'system')!.content
    expect(systemPrompt).not.toContain('【叙事原则】')
    expect(systemPrompt).not.toContain('【关系阶段】')
    harness.wrapper.unmount()
  })
})
