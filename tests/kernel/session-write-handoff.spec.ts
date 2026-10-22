import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent } from 'vue'
import App from '@/App.vue'
import { closeConversation, openConversation } from '@/kernel/app/chat-router'
import { CARD_SESSION_STORE_KEY, CHARACTER_STORE_KEY, CHATBOX_STORE_KEY, SEAM_REGISTRY_KEY, VARIABLE_STORE_KEY, MEMORY_STORE_KEY } from '@/kernel/app/chat-keys'
import { createChatboxStore } from '@/kernel/sessions/chatbox-store'
import { createCardSessionStore } from '@/kernel/sessions/card-session-store'
import { createStorageRepository } from '@/kernel/store/storage-repository'
import { createMemoryEngine } from '@/kernel/store/kv-store'
import { createSeamRegistry } from '@/kernel/runtime/seam-registry'
import type { LlmProvider } from '@/kernel/llm/llm-provider'
import { uiService } from '@/kernel/ui/toasts'
import { createVariableStore } from '@/kernel/variables/variable-store'
import { createMemoryStore } from '@/kernel/memory/memory-store'
import { createEmptyMemoryState } from '@/kernel/memory/memory-engine'
import { beginSessionWriteHandoff } from '@/kernel/app/chat/session-write-handoff'

const Transition = defineComponent({ props: { name: String, mode: String, persisted: Boolean }, emits: ['after-leave', 'after-enter'], setup: (_, { slots }) => () => slots.default?.() })
let wrapper: VueWrapper | undefined
afterEach(() => { wrapper?.unmount(); wrapper = undefined; closeConversation(); localStorage.clear(); vi.restoreAllMocks() })

async function fixture(domain: 'chatbox' | 'card', shell: boolean) {
  localStorage.setItem('mp_session_shell_prototype', shell ? '1' : '0')
  const repository = createStorageRepository(createMemoryEngine())
  const chatbox = createChatboxStore(repository)
  const cards = createCardSessionStore(repository)
  const variables = createVariableStore(repository), memory = createMemoryStore(repository)
  const card = { id: 'handoff-card', name: 'Synthetic', firstMes: 'greeting' }
  const id = domain === 'card' ? (await cards.create(card)).cardId : (await chatbox.create()).id
  const seams = createSeamRegistry(() => {})
  const calls: Array<{ options: Parameters<LlmProvider['stream']>[1]; resolve: (value: Awaited<ReturnType<LlmProvider['stream']>>) => void; reject: (error: Error) => void }> = []
  seams.register('test', 'llm.provider', { providerId: 'openai-compatible', configured: () => true,
    stream: (_messages, options) => new Promise((resolve, reject) => { calls.push({ options, resolve, reject }) }),
  } satisfies LlmProvider)
  wrapper = mount(App, { global: { stubs: { transition: Transition }, provide: {
    [CHATBOX_STORE_KEY as symbol]: chatbox, [CARD_SESSION_STORE_KEY as symbol]: cards,
    [CHARACTER_STORE_KEY as symbol]: { get: async () => card, getCover: async () => null },
    [SEAM_REGISTRY_KEY as symbol]: seams,
    [VARIABLE_STORE_KEY as symbol]: variables, [MEMORY_STORE_KEY as symbol]: memory,
  } } })
  const enter = async () => { openConversation(id, domain); await flushPromises() }
  const leave = async () => {
    closeConversation(); await flushPromises()
    wrapper!.findAllComponents(Transition).find(t => t.props('name') === 'mp-mo-push')!.vm.$emit('after-leave')
    await flushPromises()
  }
  const send = async (text: string) => {
    await wrapper!.get('textarea').setValue(text)
    await wrapper!.get('[aria-label="发送"]').trigger('click'); await flushPromises()
  }
  const settleOld = async (reject: boolean) => {
    if (reject) calls[0]!.reject(new Error('late provider failure'))
    else calls[0]!.resolve({ content: 'late old reply', usage: null })
    await flushPromises()
  }
  return { id, repository, variables, memory, chatbox, cards, calls, enter, leave, send, settleOld, read: () => domain === 'card' ? cards.get(id) : chatbox.get(id) }
}

describe('session write handoff', () => {
  const cases = (['chatbox', 'card'] as const).flatMap(domain => [true, false].flatMap(shell => [true, false].map(reject => ({ domain, shell, reject }))))
  it.each(cases)('preserves new messages after late settlement: $domain legacy-shell-flag=$shell reject=$reject', async ({domain, shell, reject}) => {
    const f = await fixture(domain, shell)
    await f.enter(); await f.send('old request')
    f.calls[0]!.options.onDelta?.('old partial')
    f.calls[0]!.options.onReasoningDelta?.('partial reasoning')
    await f.leave()
    expect(f.calls[0]!.options.signal?.aborted).toBe(true)
    await f.enter(); await f.send('new request')
    f.calls[1]!.resolve({ content: 'new reply', usage: null }); await flushPromises()
    await f.settleOld(reject)
    const stored = await f.read()
    expect(stored!.messages.map(m => m.content)).toContain('new request')
    expect(stored!.messages.map(m => m.content)).toContain('new reply')
    expect(stored!.messages).toContainEqual(expect.objectContaining({ content: 'old partial', reasoning: 'partial reasoning' }))
  })
  it.each(cases)('does not resurrect a removed session: $domain legacy-shell-flag=$shell reject=$reject', async ({domain, shell, reject}) => {
    const f = await fixture(domain, shell)
    await f.enter(); await f.send('old request')
    f.calls[0]!.options.onDelta?.('old partial')
    await f.leave()
    if (domain === 'card') await f.cards.remove(f.id)
    else await f.chatbox.remove(f.id)
    await f.settleOld(reject)
    expect(await f.read()).toBeNull()
  })
  it.each(cases)('hands off candidate restoration before reading the next page: $domain legacy-shell-flag=$shell reject=$reject', async ({domain, shell, reject}) => {
    const f = await fixture(domain, shell)
    await f.enter(); await f.send('initial request')
    f.calls[0]!.resolve({content:'original candidate',usage:null}); await flushPromises()
    f.calls.splice(0)
    await wrapper!.get('[aria-label="重新生成(追加候选)"]').trigger('click'); await flushPromises()
    f.calls[0]!.options.onDelta?.('cancelled candidate')
    await f.leave()
    await f.enter()
    const restored = (await f.read())!.messages.at(-1)!
    expect(restored).toMatchObject({ content: 'original candidate', candidates: ['original candidate'], candidateReasoning: [''], activeIndex: 0 })
    await f.send('new request')
    f.calls[1]!.resolve({content:'new reply',usage:null}); await flushPromises()
    const before = await f.read()
    await f.settleOld(reject)
    expect(await f.read()).toEqual(before)
  })
  it.each([true,false])('does not overwrite a card reset after departure: reject=%s', async reject => {
    const f = await fixture('card', true)
    await f.enter(); await f.send('old request')
    f.calls[0]!.options.onDelta?.('old partial'); await f.leave(); await f.enter()
    vi.spyOn(uiService, 'confirm').mockResolvedValue(true)
    await wrapper!.get('[aria-label="清空重开"]').trigger('click'); await flushPromises()
    await f.settleOld(reject)
    expect((await f.read())!.messages.map(m => m.content)).toEqual(['greeting'])
  })
  it.each(['chatbox','card'] as const)('waits for local %s persistence before the new read without waiting for provider completion', async domain => {
    const f = await fixture(domain, true)
    await f.enter(); await f.send('old request')
    f.calls[0]!.options.onDelta?.('partial')
    const apply = f.repository.applyChatChanges.bind(f.repository)
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    vi.spyOn(f.repository, 'applyChatChanges').mockImplementationOnce(async (...args) => { await gate; await apply(...args) })
    await f.leave()
    const get = vi.spyOn(domain === 'card' ? f.cards : f.chatbox, 'get')
    await f.enter()
    expect(get).not.toHaveBeenCalled()
    expect(wrapper!.find('textarea').exists()).toBe(false)
    release(); await flushPromises()
    expect(wrapper!.find('textarea').exists()).toBe(true)
    expect((await f.read())!.messages.at(-1)!.content).toBe('partial')
    await f.settleOld(true)
  })
  it.each(['chatbox','card'] as const)('surfaces failed %s handoff and blocks that entry from sending', async domain => {
    const f = await fixture(domain, true)
    await f.enter(); await f.send('old request')
    f.calls[0]!.options.onDelta?.('partial')
    vi.spyOn(f.repository, 'applyChatChanges').mockRejectedValueOnce(new Error('synthetic storage failure'))
    const toast = vi.spyOn(uiService, 'toast')
    await f.leave(); await f.enter()
    expect(toast).toHaveBeenCalledWith('shell', '会话保存失败，请返回后重试', {tone:'error'})
    expect(wrapper!.text()).toContain('会话加载失败，请返回后重试')
    expect(wrapper!.find('textarea').exists()).toBe(false)
    expect(f.calls).toHaveLength(1)
    await f.settleOld(true)
  })
  it('waits for the complete local reset chain before rereading variables and memory', async () => {
    const f = await fixture('card', true)
    await f.enter()
    await f.variables.apply(f.id, [{ name:'old', raw:1 }], {source:'manual'})
    await f.memory.save({kind:'card',id:f.id}, {...createEmptyMemoryState(),short:'old summary'})
    const reset = f.cards.reset.bind(f.cards)
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    vi.spyOn(f.cards, 'reset').mockImplementationOnce(async card => { await gate; return reset(card) })
    vi.spyOn(uiService,'confirm').mockResolvedValue(true)
    await wrapper!.get('[aria-label="清空重开"]').trigger('click'); await flushPromises()
    await f.leave()
    const ensureVariables = vi.spyOn(f.variables,'ensure'), ensureMemory = vi.spyOn(f.memory,'ensure')
    await f.enter()
    expect(ensureVariables).not.toHaveBeenCalled()
    expect(ensureMemory).not.toHaveBeenCalled()
    expect(wrapper!.find('textarea').exists()).toBe(false)
    release(); await flushPromises()
    expect(wrapper!.find('textarea').exists()).toBe(true)
    expect((await f.variables.get(f.id))!.events).toEqual([])
    expect(await f.memory.get({kind:'card',id:f.id})).toBeNull()
    expect((await f.read())!.messages.map(m=>m.content)).toEqual(['greeting'])
  })
  it('retains a completed candidate together with its pending local ledger commit', async () => {
    const f = await fixture('card', true)
    await f.enter(); await f.send('initial request')
    f.calls[0]!.resolve({content:'original candidate',usage:null}); await flushPromises()
    f.calls.splice(0)
    await wrapper!.get('[aria-label="重新生成(追加候选)"]').trigger('click'); await flushPromises()
    const set = f.repository.set.bind(f.repository)
    let release!: () => void, entered!: () => void
    const gate = new Promise<void>(resolve => { release=resolve }), started = new Promise<void>(resolve=>{entered=resolve})
    vi.spyOn(f.repository,'set').mockImplementation(async (key,value) => {
      if (key===`variables:card:${f.id}`) { entered(); await gate }
      return set(key,value)
    })
    const reply = 'completed candidate <setvars>{"mood":"committed"}</setvars>'
    f.calls[0]!.resolve({content:reply,usage:null}); await started
    await f.leave(); await f.enter()
    expect(wrapper!.find('textarea').exists()).toBe(false)
    release(); await flushPromises()
    expect((await f.read())!.messages.at(-1)).toMatchObject({content:reply,candidates:['original candidate',reply],activeIndex:1})
    expect((await f.variables.get(f.id))!.events).toContainEqual(expect.objectContaining({name:'mood',after:'committed',candidateIndex:1}))
  })
  it('completes an accepted local floor deletion before handing off messages and ledger', async () => {
    const f = await fixture('card',true)
    await f.enter()
    const floor = (await f.read())!.messages[0]!
    await f.variables.apply(f.id,[{name:'mood',raw:'old'}],{source:'ai',messageId:floor.id})
    const rollback = f.variables.rollbackFloors.bind(f.variables)
    let release!: () => void
    const gate = new Promise<void>(resolve=>{release=resolve})
    vi.spyOn(f.variables,'rollbackFloors').mockImplementationOnce(async(...args)=>{await gate;return rollback(...args)})
    vi.spyOn(uiService,'confirm').mockResolvedValue(true)
    await wrapper!.get('[aria-label="删除第 1 楼及其后"]').trigger('click'); await flushPromises()
    await f.leave(); await f.enter()
    expect(wrapper!.find('textarea').exists()).toBe(false)
    release(); await flushPromises()
    expect((await f.read())!.messages).toEqual([])
    expect((await f.variables.get(f.id))!.events).toEqual([])
  })
  it('waits for the final handoff save before deleting from the source list', async () => {
    const f = await fixture('chatbox',true)
    const conversation = (await f.chatbox.get(f.id))!
    let release!: () => void
    const gate = new Promise<void>(resolve=>{release=resolve})
    const pending = beginSessionWriteHandoff(f.chatbox,f.id,async()=>{await gate;await f.chatbox.save(conversation)})
    await flushPromises()
    vi.spyOn(uiService,'confirm').mockResolvedValue(true)
    const remove = vi.spyOn(f.chatbox,'remove')
    const row = wrapper!.get('section li > button')
    for (const [type,x] of [['pointerdown',200],['pointermove',50],['pointerup',50]] as const) {
      const event = new Event(type,{bubbles:true})
      for (const [key,value] of Object.entries({clientX:x,clientY:20,pointerId:1})) Object.defineProperty(event,key,{value})
      row.element.dispatchEvent(event)
    }
    await flushPromises()
    expect(remove).not.toHaveBeenCalled()
    expect(await f.read()).not.toBeNull()
    release(); await pending; await flushPromises()
    expect(await f.read()).toBeNull()
  })
  it('blocks another send after a failed initial save', async () => {
    const f = await fixture('chatbox',true)
    await f.enter()
    vi.spyOn(f.repository,'applyChatChanges').mockRejectedValueOnce(new Error('synthetic write failure'))
    await f.send('unsaved user request')
    expect(f.calls).toHaveLength(0)
    expect(wrapper!.text()).toContain('会话保存失败，请返回后重试')
    expect(wrapper!.get('[aria-label="发送"]').attributes('disabled')).toBeDefined()
  })
  it('releases the global stream listener before an uncooperative provider settles', async () => {
    const added = vi.spyOn(document,'addEventListener'), removed = vi.spyOn(document,'removeEventListener')
    const f = await fixture('chatbox',true)
    await f.enter(); await f.send('pending')
    const listener = added.mock.calls.find(([type])=>type==='visibilitychange')![1]
    await f.leave()
    expect(removed.mock.calls.some(([type,callback])=>type==='visibilitychange'&&callback===listener)).toBe(true)
    await f.settleOld(true)
  })
})
