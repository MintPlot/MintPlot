import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, nextTick, onMounted, onUnmounted } from 'vue'
import App from '@/App.vue'
import { closeConversation, openConversation } from '@/kernel/app/chat-router'
import { CHATBOX_STORE_KEY, SEAM_REGISTRY_KEY } from '@/kernel/app/chat-keys'
import { createChatboxStore } from '@/kernel/sessions/chatbox-store'
import { createStorageRepository } from '@/kernel/store/storage-repository'
import { createMemoryEngine } from '@/kernel/store/kv-store'
import { createSeamRegistry } from '@/kernel/runtime/seam-registry'
import type { LlmProvider } from '@/kernel/llm/llm-provider'
import ChatFloorList from '@/kernel/app/chat/ChatFloorList.vue'
import { uiService } from '@/kernel/ui/toasts'

const key = 'mp_session_shell_prototype'
const emptyListKey = 'mp_empty_session_list_trial'
const pendingUiKey = 'mp_session_pending_feedback_trial'
const pages: Array<{ id: string; ready: () => void; background: (cover: string) => void }> = []
const disposed: string[] = []
let autoReady = true
let wrapper: VueWrapper | undefined
const ControlledTransition = defineComponent({
  props: { name: { type: String, default: '' } }, emits: ['after-leave', 'after-enter'],
  setup: (_props, { slots }) => () => slots.default?.(),
})
const Page = defineComponent({
  props: { conversationId: { type: String, required: true }, hosted: Boolean, presented: { type: Boolean, default: true } },
  emits: ['ready', 'backdrop'],
  setup(props, { emit }) {
    const id = props.conversationId!
    const ready = () => emit('ready', `chatbox:${id}`)
    const background = (cover: string) => emit('backdrop', { cover, backdrop: { enabled: true, blur: 7, dim: 13 } })
    onMounted(() => { pages.push({ id, ready, background }); if (autoReady) ready() })
    onUnmounted(() => disposed.push(id))
    return () => !props.hosted || props.presented ? h('div', { 'data-test-page': id }, id) : null
  },
})

async function setup() {
  localStorage.setItem(key, '1')
  wrapper = mount(App, { global: { stubs: { ChatSessionView: Page, transition: ControlledTransition } } })
  await flushPromises()
  return wrapper
}
function completeLeave() {
  const transition = wrapper!.findAllComponents(ControlledTransition).find(component => component.props('name') === 'mp-mo-push')!
  transition.vm.$emit('after-leave')
}
afterEach(() => {
  wrapper?.unmount(); wrapper = undefined
  closeConversation()
  localStorage.removeItem(key)
  localStorage.removeItem(emptyListKey)
  localStorage.removeItem(pendingUiKey)
  vi.restoreAllMocks()
  pages.length = 0; disposed.length = 0; autoReady = true
})

describe('stable session page host', () => {
  it.each([null, '0', '1'])('uses one hosted entry regardless of a retired shell flag: %s', async (legacyFlag) => {
    if (legacyFlag !== null) localStorage.setItem(key, legacyFlag)
    wrapper = mount(App, { global: { stubs: { ChatSessionView: Page, transition: ControlledTransition } } })
    openConversation('single-entry'); await flushPromises()
    expect(wrapper.find('[data-session-viewport] [data-test-page="single-entry"]').exists()).toBe(true)
    closeConversation(); await nextTick()
    expect(disposed).toEqual([])
    completeLeave(); await flushPromises()
    expect(disposed).toEqual(['single-entry'])
    expect(wrapper.find('[inert]').exists()).toBe(false)
  })

  it('does not mount pending feedback while keeping preparation inert and cancellable', async () => {
    localStorage.setItem(pendingUiKey, '1')
    autoReady = false
    const app = await setup()
    openConversation('pending'); await flushPromises()
    expect(app.find('[aria-busy="true"]').exists()).toBe(false)
    expect(app.find('[role="status"]').exists()).toBe(false)
    expect(app.text()).not.toContain('正在打开…')
    expect(app.find('[inert]').exists()).toBe(true)
    expect(app.find('[data-test-page]').exists()).toBe(false)
    const old = pages[0]!
    closeConversation(); await flushPromises()
    old.ready(); await flushPromises()
    expect(app.find('[inert]').exists()).toBe(false)
    expect(app.find('[data-test-page]').exists()).toBe(false)
    expect(disposed).toEqual(['pending'])
  })

  it('keeps entry, queued reentry and leave cleanup working without pending feedback', async () => {
    localStorage.setItem(pendingUiKey, '1')
    const app = await setup()
    openConversation('a'); await flushPromises()
    expect(app.find('[data-test-page="a"]').exists()).toBe(true)
    closeConversation(); await nextTick()
    openConversation('b'); await nextTick()
    expect(app.find('[aria-busy="true"]').exists()).toBe(false)
    expect(app.find('[role="status"]').exists()).toBe(false)
    expect(app.find('[inert]').exists()).toBe(true)
    completeLeave(); await flushPromises()
    expect(app.find('[data-test-page="b"]').exists()).toBe(true)
    closeConversation(); await nextTick()
    completeLeave(); await flushPromises()
    expect(app.find('[data-test-page]').exists()).toBe(false)
    expect(app.find('[inert]').exists()).toBe(false)
  })

  it('retains pending feedback by default for an immediate local rollback', async () => {
    autoReady = false
    const app = await setup()
    openConversation('pending'); await flushPromises()
    expect(app.find('[aria-busy="true"]').exists()).toBe(true)
    expect(app.find('[role="status"]').text()).toBe('正在打开…')
    expect(app.findAll('button').some(b => b.text() === '取消')).toBe(true)
  })
  it('keeps the bounded list across first send and deletion despite a retired local flag', async () => {
    localStorage.setItem(key, '1')
    localStorage.setItem(emptyListKey, '1')
    const store = createChatboxStore(createStorageRepository(createMemoryEngine()))
    const conversation = await store.create()
    const seams = createSeamRegistry(() => {})
    seams.register('test', 'llm.provider', {
      providerId: 'openai-compatible', configured: () => true,
      stream: async () => ({ content: 'Synthetic reply', usage: null }),
    } satisfies LlmProvider)
    wrapper = mount(App, { global: { stubs: { transition: ControlledTransition }, provide: {
      [CHATBOX_STORE_KEY as symbol]: store, [SEAM_REGISTRY_KEY as symbol]: seams,
    } } })
    openConversation(conversation.id)
    await flushPromises()
    expect(wrapper.find('textarea').exists()).toBe(true)
    expect(wrapper.text()).toContain('发送第一条消息开始对话')
    expect(wrapper.findComponent(ChatFloorList).exists()).toBe(true)
    const initiallyEmptyList = wrapper.findComponent(ChatFloorList).vm.$.uid
    const backdrop = wrapper.find('[data-session-viewport] .mp-aurora').element
    await wrapper.get('textarea').setValue('Synthetic request')
    await wrapper.get('[aria-label="发送"]').trigger('click')
    await flushPromises()
    expect((await store.get(conversation.id))!.messages.map(message => message.content)).toEqual(['Synthetic request', 'Synthetic reply'])
    expect(wrapper.findComponent(ChatFloorList).exists()).toBe(true)
    expect(wrapper.findComponent(ChatFloorList).vm.$.uid).toBe(initiallyEmptyList)
    expect(wrapper.find('[data-empty-session-placeholder]').exists()).toBe(false)
    closeConversation(); await nextTick()
    expect(wrapper.text()).toContain('Synthetic reply')
    completeLeave(); await flushPromises()
    expect(wrapper.find('textarea').exists()).toBe(false)
    openConversation(conversation.id); await flushPromises()
    expect(wrapper.text()).toContain('Synthetic reply')
    expect(wrapper.find('[data-session-viewport] .mp-aurora').element).toBe(backdrop)
    const populatedList = wrapper.findComponent(ChatFloorList).vm.$.uid
    // Last-floor removal keeps the same virtual list alive; it must drop old
    // rows and render the next first reply through its existing observer.
    vi.spyOn(uiService, 'confirm').mockResolvedValue(true)
    wrapper.findComponent(ChatFloorList).vm.$emit('remove', (await store.get(conversation.id))!.messages[0]!)
    await flushPromises()
    expect((await store.get(conversation.id))!.messages).toEqual([])
    expect(wrapper.findComponent(ChatFloorList).exists()).toBe(true)
    expect(wrapper.findComponent(ChatFloorList).vm.$.uid).toBe(populatedList)
    expect(wrapper.find('[data-empty-session-placeholder]').exists()).toBe(false)
    expect(wrapper.text()).toContain('发送第一条消息开始对话')
    await wrapper.get('textarea').setValue('Synthetic second request')
    await wrapper.get('[aria-label="发送"]').trigger('click')
    await flushPromises()
    expect(wrapper.findComponent(ChatFloorList).exists()).toBe(true)
    expect(wrapper.findComponent(ChatFloorList).vm.$.uid).toBe(populatedList)
    expect((await store.get(conversation.id))!.messages.map(message => message.content)).toEqual(['Synthetic second request', 'Synthetic reply'])
  })
  it('mounts the bounded list for an empty session without a retired local flag', async () => {
    localStorage.setItem(key, '1')
    const store = createChatboxStore(createStorageRepository(createMemoryEngine()))
    const conversation = await store.create()
    wrapper = mount(App, { global: { stubs: { transition: ControlledTransition }, provide: {
      [CHATBOX_STORE_KEY as symbol]: store,
    } } })
    openConversation(conversation.id); await flushPromises()
    expect(wrapper.findComponent(ChatFloorList).exists()).toBe(true)
    expect(wrapper.find('[data-empty-session-placeholder]').exists()).toBe(false)
    expect(wrapper.text()).toContain('发送第一条消息开始对话')
  })
  it('keeps the leaving view alive until the transition reports completion', async () => {
    const app = await setup()
    openConversation('a')
    await flushPromises()
    expect(app.find('[data-test-page="a"]').exists()).toBe(true)
    closeConversation()
    await nextTick()
    expect(disposed).toEqual([])
    expect(app.find('[data-test-page="a"]').exists()).toBe(true)
    completeLeave()
    await flushPromises()
    expect(disposed).toEqual(['a'])
    expect(app.find('[data-test-page]').exists()).toBe(false)
  })

  it('aborts immediately on return and persists partial text while visual teardown is deferred', async () => {
    localStorage.setItem(key, '1')
    const store = createChatboxStore(createStorageRepository(createMemoryEngine()))
    const conversation = await store.create()
    const seams = createSeamRegistry(() => {})
    let callbacks!: Parameters<LlmProvider['stream']>[1]
    let finish!: (result: Awaited<ReturnType<LlmProvider['stream']>>) => void
    seams.register('test', 'llm.provider', {
      providerId: 'openai-compatible', configured: () => true,
      stream: (_messages, options) => { callbacks = options; return new Promise(resolve => { finish = resolve }) },
    } satisfies LlmProvider)
    wrapper = mount(App, { global: { stubs: { transition: ControlledTransition }, provide: {
      [CHATBOX_STORE_KEY as symbol]: store, [SEAM_REGISTRY_KEY as symbol]: seams,
    } } })
    openConversation(conversation.id); await flushPromises()
    await wrapper.get('textarea').setValue('Synthetic pending request')
    await wrapper.get('[aria-label="发送"]').trigger('click'); await flushPromises()
    callbacks.onDelta?.('Partial reply')
    closeConversation()
    expect(callbacks.signal?.aborted).toBe(true)
    await nextTick()
    expect(wrapper.find('[data-session-viewport][inert]').exists()).toBe(true)
    expect(wrapper.find('textarea').exists()).toBe(true)
    callbacks.onDelta?.(' ignored late delta')
    finish({ content: 'ignored late final', usage: null })
    await flushPromises()
    expect((await store.get(conversation.id))!.messages.at(-1)!.content).toBe('Partial reply')
    completeLeave(); await flushPromises()
    expect(wrapper.find('textarea').exists()).toBe(false)
  })

  it('queues only the latest requested page while an old page is leaving', async () => {
    await setup()
    openConversation('a'); await flushPromises()
    closeConversation(); await nextTick()
    openConversation('b'); await nextTick()
    openConversation('c'); await nextTick()
    expect(pages.map(page => page.id)).toEqual(['a'])
    completeLeave(); await flushPromises()
    expect(pages.map(page => page.id)).toEqual(['a', 'c'])
    expect(disposed).toEqual(['a'])
    expect(wrapper!.find('[data-test-page="c"]').exists()).toBe(true)
  })

  it('rejects readiness from a cancelled preparation', async () => {
    autoReady = false
    const app = await setup()
    openConversation('a'); await flushPromises()
    const old = pages[0]!
    closeConversation(); await flushPromises()
    old.ready(); old.background('old-cover')
    await flushPromises()
    expect(disposed).toEqual(['a'])
    expect(app.find('[data-test-page]').exists()).toBe(false)
    expect(app.find('[aria-busy]').exists()).toBe(false)
    expect(app.find('[src="old-cover"]').exists()).toBe(false)
  })

  it('retains one backdrop instance and rejects late old-page artwork', async () => {
    const app = await setup()
    openConversation('a'); await flushPromises()
    const backdrop = app.find('[data-session-viewport] .mp-aurora').element
    const old = pages[0]!
    old.background('a-cover'); await nextTick()
    expect(app.find('[data-session-viewport] img').attributes('src')).toBe('a-cover')
    closeConversation(); await nextTick()
    old.background('stale-cover'); await nextTick()
    expect(app.find('[data-session-viewport] img').attributes('src')).toBe('a-cover')
    completeLeave(); await flushPromises()
    expect(app.find('[data-session-viewport] .mp-aurora').element).toBe(backdrop)
    expect(app.find('[data-session-viewport] img').exists()).toBe(false)
    openConversation('b'); await flushPromises()
    old.ready(); old.background('stale-cover'); await nextTick()
    expect(app.find('[data-session-viewport] .mp-aurora').element).toBe(backdrop)
    expect(app.find('[src="stale-cover"]').exists()).toBe(false)
  })
})
