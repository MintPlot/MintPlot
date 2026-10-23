import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { hasCardTool, openCardTool } from './helpers/card-tools'
import App from '../src/App.vue'
import {
  CARD_SESSION_STORE_KEY,
  CHARACTER_STORE_KEY,
  MEMORY_STORE_KEY,
  SEAM_REGISTRY_KEY,
  SESSION_PROJECTION_KEY,
  SETTINGS_STATE_KEY,
  USAGE_RECORDER_KEY,
} from '@/kernel/app/chat-keys'
import { createSessionProjection } from '@/kernel/sessions/session-projection'
import { createCardSessionStore } from '@/kernel/sessions/card-session-store'
import { createCharacterStore } from '@/kernel/characters/character-store'
import { createMemoryStore } from '@/kernel/memory/memory-store'
import { createEmptyMemoryState } from '@/kernel/memory/memory-engine'
import { createSeamRegistry } from '@/kernel/runtime/seam-registry'
import { createStorageRepository } from '@/kernel/store/storage-repository'
import { createMemoryEngine } from '@/kernel/store/kv-store'
import { createSettingsState } from '@/kernel/settings/settings-state'
import { uiService } from '@/kernel/ui/toasts'
import { PLUGIN_RUNTIME_KEY } from '@/kernel/app/runtime-key'
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

function mountApp(options: { runtime?: object } = {}) {
  const cardSessionStore = createCardSessionStore(createStorageRepository(createMemoryEngine()))
  const characterStore = createCharacterStore(createStorageRepository(createMemoryEngine()))
  const memoryStore = createMemoryStore(createStorageRepository(createMemoryEngine()))
  const projection = createSessionProjection()
  const settings = createSettingsState(createStorageRepository(createMemoryEngine()))
  const seams = createSeamRegistry(() => undefined)
  seams.register('kernel', 'llm.provider', fakeProvider)
  const usageCalls: UsageCall[] = []

  const wrapper = mount(App, {
    global: {
      provide: {
        [CARD_SESSION_STORE_KEY as symbol]: cardSessionStore,
        [CHARACTER_STORE_KEY as symbol]: characterStore,
        [MEMORY_STORE_KEY as symbol]: memoryStore,
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
  return { wrapper, cardSessionStore, characterStore, memoryStore, projection, usageCalls, settings }
}

/** Seed a card session with the greeting + `count` extra floors. */
async function seedFloors(cardSessionStore: ReturnType<typeof createCardSessionStore>, cardId: string, name: string, firstMes: string, count: number): Promise<void> {
  const session = await cardSessionStore.create({ id: cardId, name, firstMes })
  for (let index = 0; index < count; index += 1) {
    session.messages.push({
      id: `old-${index}`,
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `旧楼 ${index}`,
      ts: Date.now() + index,
    })
  }
  await cardSessionStore.save(session)
}

async function openCardChat(wrapper: ReturnType<typeof mount>): Promise<void> {
  const tabs = wrapper.findAll('nav button')
  await tabs[1]!.trigger('click')
  await flushPromises()
  await wrapper.find('button[aria-label="进入「星澜」的对话"]').trigger('click')
  await flushPromises()
  await nextTick()
}

const text = (message: LlmChatMessage): string =>
  typeof message.content === 'string' ? message.content : ''

describe('M4-e · 记忆系统视图接线(仅卡域)', () => {
  beforeEach(() => {
    window.history.replaceState({}, '')
    window.dispatchEvent(new PopStateEvent('popstate', { state: null }))
    streamCalls.length = 0
    nextReply = '（测试回复）'
    vi.unstubAllGlobals()
  })

  it('摘要就绪:请求带 <role_memory> 固定前缀(prefill 后首楼前)且窗口外旧楼被裁剪', async () => {
    const { wrapper, characterStore, cardSessionStore, memoryStore } = mountApp()
    const stored = await characterStore.import(CARD)
    await seedFloors(cardSessionStore, stored.id, stored.name, stored.firstMes, 19)
    await memoryStore.save({ kind: 'card', id: stored.id }, {
      ...createEmptyMemoryState(),
      short: '旧事摘要',
      profile: { characters: [{ name: '星澜', status: '闭关' }], relations: [], openPlots: [] },
      batches: [{ from: 0, to: 4, status: 'done', at: 1 }],
      anchor: 4,
      updatedAt: 1,
    })
    await flushPromises()
    await openCardChat(wrapper)

    const textarea = wrapper.find('textarea')
    await textarea.setValue('现在如何?')
    await wrapper.findAll('button').find((button) => button.attributes('aria-label') === '发送')!.trigger('click')
    await flushPromises()

    expect(streamCalls.length).toBeGreaterThan(0)
    const request = [...streamCalls[streamCalls.length - 1]!]
    expect(request[0]!.role).toBe('system')
    const memoryIndex = request.findIndex((message) => text(message).includes('<role_memory>'))
    expect(memoryIndex).toBeGreaterThan(0)
    expect(request[memoryIndex]!.role).toBe('user')
    expect(text(request[memoryIndex]!)).toContain('旧事摘要')
    expect(text(request[memoryIndex]!)).toContain('星澜：闭关')
    // Everything before the block is the system prompt / preset prefills only.
    expect(request.slice(0, memoryIndex).every((message) => message.role === 'system' || message.role === 'user' || message.role === 'assistant')).toBe(true)
    // Pruning: at request time the pipeline has already pushed the empty
    // assistant placeholder (22 floors) − keep 16 → trailing 16 ride.
    const history = request.slice(memoryIndex + 1)
    expect(history).toHaveLength(16)
    expect(history.some((message) => text(message).includes('旧楼 5'))).toBe(true)
    expect(history.some((message) => text(message).includes('旧楼 4'))).toBe(false)
    expect(history[history.length - 2]).toMatchObject({ role: 'user', content: '现在如何?' })
    // The greeting floor sits before the window — pruned without a fake reseed.
    expect(request.some((message) => text(message).includes('你好，旅人。'))).toBe(false)
    wrapper.unmount()
  })

  it('插件停用:记忆层整体休眠——无注入、无裁剪,账本数据不动', async () => {
    const runtimeStub = {
      stateOf: (id: string) => (id === 'memory' ? 'registered' : 'active'),
      emit: () => undefined,
    }
    const { wrapper, characterStore, cardSessionStore, memoryStore } = mountApp({ runtime: runtimeStub })
    const stored = await characterStore.import(CARD)
    await seedFloors(cardSessionStore, stored.id, stored.name, stored.firstMes, 19)
    await memoryStore.save({ kind: 'card', id: stored.id }, { ...createEmptyMemoryState(), short: '旧事摘要', anchor: 4, updatedAt: 1 })
    await flushPromises()
    await openCardChat(wrapper)

    // Top-bar entry hidden while the plugin is registered-only.
    expect(await hasCardTool(wrapper, '记忆')).toBe(false)

    const textarea = wrapper.find('textarea')
    await textarea.setValue('现在如何?')
    await wrapper.findAll('button').find((button) => button.attributes('aria-label') === '发送')!.trigger('click')
    await flushPromises()

    const request = [...streamCalls[streamCalls.length - 1]!]
    expect(request.some((message) => text(message).includes('<role_memory>'))).toBe(false)
    // No pruning: the greeting and every old floor stay in the request.
    expect(request.some((message) => text(message).includes('你好，旅人。'))).toBe(true)
    expect(request.some((message) => text(message).includes('旧楼 2'))).toBe(true)
    // The ledger is untouched.
    expect((await memoryStore.get({ kind: 'card', id: stored.id }))?.short).toBe('旧事摘要')
    wrapper.unmount()
  })

  it('清空重开连带清零记忆账本(D7)', async () => {
    const { wrapper, characterStore, cardSessionStore, memoryStore } = mountApp()
    const stored = await characterStore.import(CARD)
    await seedFloors(cardSessionStore, stored.id, stored.name, stored.firstMes, 19)
    await memoryStore.save({ kind: 'card', id: stored.id }, { ...createEmptyMemoryState(), short: '旧事摘要', anchor: 4, updatedAt: 1 })
    await flushPromises()
    await openCardChat(wrapper)

    const confirmSpy = vi.spyOn(uiService, 'confirm').mockResolvedValue(true)
    await wrapper.findAll('button').find((button) => button.attributes('aria-label') === '清空重开')!.trigger('click')
    await flushPromises()
    confirmSpy.mockRestore()

    expect(await memoryStore.get({ kind: 'card', id: stored.id })).toBeNull()

    const textarea = wrapper.find('textarea')
    await textarea.setValue('重新开始')
    await wrapper.findAll('button').find((button) => button.attributes('aria-label') === '发送')!.trigger('click')
    await flushPromises()
    expect(streamCalls[streamCalls.length - 1]!.some((message) => text(message).includes('<role_memory>'))).toBe(false)
    wrapper.unmount()
  })

  it('立即总结:记账「记忆系统」、锚点前移、下轮请求带回摘要(回调回流)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        model: 'sum-model',
        choices: [{ message: { content: '{"short":"新摘要内容","profile":{"characters":[{"name":"星澜","status":"出关"}]}}' } }],
        usage: { prompt_tokens: 9, completion_tokens: 3, total_tokens: 12 },
      }),
    })))
    const { wrapper, characterStore, cardSessionStore, memoryStore, usageCalls, settings } = mountApp()
    // The summary request rides the ACTIVE profile (legacy trio resolves fine).
    const apiScope = settings.scope(['apiBaseUrl', 'apiModel'])
    apiScope.apiBaseUrl = 'http://x/v1'
    apiScope.apiModel = 'chat-model'

    const stored = await characterStore.import(CARD)
    await seedFloors(cardSessionStore, stored.id, stored.name, stored.firstMes, 19)
    await flushPromises()
    await openCardChat(wrapper)

    await openCardTool(wrapper, '记忆')
    await flushPromises()
    await wrapper.findAll('button').find((button) => button.text() === '立即总结')!.trigger('click')
    await flushPromises()

    const summaryUsage = usageCalls.find((call) => call.meta.type === 'summary')
    expect(summaryUsage).toBeDefined()
    expect(summaryUsage!.meta.model).toBe('sum-model')
    expect(summaryUsage!.meta.detail).toContain('滚动摘要')
    expect(summaryUsage!.usage).toMatchObject({ inputTokens: 9 })
    const saved = await memoryStore.get({ kind: 'card', id: stored.id })
    expect(saved?.short).toBe('新摘要内容')
    expect(saved?.anchor).toBe(4)

    // Reflow: the next chat request carries the fresh summary block.
    const textarea = wrapper.find('textarea')
    await textarea.setValue('现在如何?')
    await wrapper.findAll('button').find((button) => button.attributes('aria-label') === '发送')!.trigger('click')
    await flushPromises()
    const request = [...streamCalls[streamCalls.length - 1]!]
    const memoryMessage = request.find((message) => text(message).includes('<role_memory>'))
    expect(memoryMessage).toBeDefined()
    expect(text(memoryMessage!)).toContain('新摘要内容')
    expect(text(memoryMessage!)).toContain('星澜：出关')
    wrapper.unmount()
  })
})
