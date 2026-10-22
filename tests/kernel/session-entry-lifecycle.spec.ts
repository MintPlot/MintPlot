import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, Transition } from 'vue'
import ChatSessionView from '@/kernel/app/views/ChatSessionView.vue'
import { CARD_SESSION_STORE_KEY, CHARACTER_STORE_KEY, SESSION_PROJECTION_KEY, WORLDBOOK_STORE_KEY } from '@/kernel/app/chat-keys'
import { createCharacterStore } from '@/kernel/characters/character-store'
import { createCardSessionStore } from '@/kernel/sessions/card-session-store'
import { createSessionProjection } from '@/kernel/sessions/session-projection'
import { createStorageRepository } from '@/kernel/store/storage-repository'
import { createMemoryEngine } from '@/kernel/store/kv-store'
import { createWorldbookStore } from '@/kernel/worldinfo/worldbook-store'
import { getExecutableFrameSlashHandler, setExecutableFrameSlashHandler } from '@/kernel/render/html-frame'
import { errorHub } from '@/kernel/diagnostics/error-hub'
import App from '@/App.vue'
import { closeConversation, openConversation } from '@/kernel/app/chat-router'
import { ControlledTransition, completeSessionLeave } from '../helpers/controlled-transition'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

const wrappers: VueWrapper[] = []
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount())
  setExecutableFrameSlashHandler(null)
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  closeConversation()
})

async function fixture() {
  const repo = () => createStorageRepository(createMemoryEngine())
  const characters = createCharacterStore(repo())
  const sessions = createCardSessionStore(repo())
  const worldbook = createWorldbookStore(repo())
  const projection = createSessionProjection()
  const add = (name: string) => characters.import({
    name, description: '', personality: '', scenario: '', firstMes: 'Greeting',
    mesExample: '', systemPrompt: '', postHistoryInstructions: '', alternateGreetings: [],
    tags: [], creator: '', characterVersion: '', creatorNotes: '', spec: 'v1',
  })
  const a = await add('Entry A')
  const b = await add('Entry B')
  const provide = {
        [CHARACTER_STORE_KEY as symbol]: characters,
        [CARD_SESSION_STORE_KEY as symbol]: sessions,
        [WORLDBOOK_STORE_KEY as symbol]: worldbook,
        [SESSION_PROJECTION_KEY as symbol]: projection,
  }
  const shell = () => {
    const wrapper = mount(App, { global: { provide, stubs: { transition: ControlledTransition } } })
    wrappers.push(wrapper)
    return wrapper
  }
  const open = (id: string, transition = false, hosted = false) => {
    const wrapper = transition
      ? mount(defineComponent({ setup: () => () => h(Transition, { name: 'mp-mo-push' },
        () => h(ChatSessionView, { domain: 'card', conversationId: id })) }),
      { global: { provide, stubs: { transition: false } } })
      : mount(ChatSessionView, { props: { domain: 'card', conversationId: id, hosted, presented: !hosted }, global: { provide } })
    wrappers.push(wrapper)
    return wrapper
  }
  return { characters, sessions, worldbook, projection, a, b, open, shell }
}

describe('session entry lifetime', () => {
  it('prepares a hosted page without mounting content or activating its global entry while hidden', async () => {
    const f = await fixture()
    const page = f.open(f.a.id, false, true)
    await flushPromises()
    expect(page.emitted('ready')).toHaveLength(1)
    expect(page.find('textarea').exists()).toBe(false)
    expect(page.find('iframe').exists()).toBe(false)
    expect(f.projection.getCharacterName()).toBe('')
    expect(getExecutableFrameSlashHandler()).toBeNull()
    await page.setProps({ presented: true })
    await flushPromises()
    expect(page.find('textarea').exists()).toBe(true)
    expect(f.projection.getCharacterName()).toBe(f.a.name)
    expect(getExecutableFrameSlashHandler()).not.toBeNull()
  })
  it('keeps the page and global send entry closed until session configuration is ready', async () => {
    const f = await fixture()
    const disabled = deferred<ReadonlySet<number>>()
    vi.spyOn(f.worldbook, 'getDisabled').mockReturnValue(disabled.promise)
    const page = f.open(f.a.id)
    await flushPromises()
    expect(page.find('textarea').exists()).toBe(false)
    expect(f.projection.getCharacterName()).toBe('')
    expect(getExecutableFrameSlashHandler()).toBeNull()
    disabled.resolve(new Set([3]))
    await flushPromises()
    expect(page.find('textarea').exists()).toBe(true)
    expect(f.projection.getCharacterName()).toBe(f.a.name)
  })

  it('does not create a session after a cancelled read resolves empty', async () => {
    const f = await fixture()
    const pending = deferred<Awaited<ReturnType<typeof f.sessions.get>>>()
    vi.spyOn(f.sessions, 'get').mockReturnValue(pending.promise)
    const create = vi.spyOn(f.sessions, 'create')
    const page = f.open(f.a.id)
    await flushPromises()
    page.unmount()
    pending.resolve(null)
    await flushPromises()
    expect(create).not.toHaveBeenCalled()
    expect(f.projection.getCharacterName()).toBe('')
  })

  it('ignores an old character result after another entry has become active', async () => {
    const f = await fixture()
    const pending = deferred<typeof f.a | null>()
    vi.spyOn(f.characters, 'get').mockImplementation((id) => Promise.resolve(id === f.a.id ? pending.promise : f.b))
    const old = f.open(f.a.id)
    await flushPromises()
    old.unmount()
    f.open(f.b.id)
    await flushPromises()
    pending.resolve(f.a)
    await flushPromises()
    expect(f.projection.getCharacterName()).toBe(f.b.name)
    expect(await f.sessions.get(f.a.id)).toBeNull()
  })

  it('does not let a leaving page clear the new page projection or frame handler', async () => {
    const f = await fixture()
    const old = f.open(f.a.id)
    await flushPromises()
    f.open(f.b.id)
    await flushPromises()
    const handler = getExecutableFrameSlashHandler()
    expect(handler).not.toBeNull()
    old.unmount()
    expect(f.projection.getCharacterName()).toBe(f.b.name)
    expect(getExecutableFrameSlashHandler()).toBe(handler)
  })

  it('starts the real push transition when the prepared root appears', async () => {
    const f = await fixture()
    const pending = deferred<ReadonlySet<number>>()
    vi.spyOn(f.worldbook, 'getDisabled').mockReturnValue(pending.promise)
    const page = f.open(f.a.id, true)
    await flushPromises()
    expect(page.find('.mp-mo-push-enter-active').exists()).toBe(false)
    pending.resolve(new Set())
    await flushPromises()
    expect(page.find('.mp-mo-push-enter-active').exists()).toBe(true)
    expect(page.find('textarea').exists()).toBe(true)
  })

  it('presents the cover with the first page render, after decoding finishes', async () => {
    const f = await fixture()
    const decoded = deferred<void>()
    vi.spyOn(f.characters, 'getCover').mockResolvedValue('data:image/png;base64,fixture')
    vi.stubGlobal('Image', class { src = ''; decode = () => decoded.promise; removeAttribute() {} })
    const page = f.open(f.a.id)
    await flushPromises()
    expect(page.find('textarea').exists()).toBe(false)
    expect(f.projection.getCharacterName()).toBe('')
    decoded.resolve()
    await flushPromises()
    const cover = page.find('[aria-hidden="true"] img')
    expect(cover.attributes('src')).toBe('data:image/png;base64,fixture')
    expect(page.find('textarea').exists()).toBe(true)
  })

  it('does not show or decode a disabled cover before applying its saved settings', async () => {
    const f = await fixture()
    const session = await f.sessions.create(f.a)
    session.bg = { enabled: false, blur: 7, dim: 13 }
    await f.sessions.save(session)
    vi.spyOn(f.characters, 'getCover').mockResolvedValue('data:image/png;base64,fixture')
    const decode = vi.fn()
    vi.stubGlobal('Image', class { decode = decode })
    const page = f.open(f.a.id)
    await flushPromises()
    expect(page.find('textarea').exists()).toBe(true)
    expect(page.find('[aria-hidden="true"] img').exists()).toBe(false)
    expect(decode).not.toHaveBeenCalled()
  })

  it('invalidates a cancelled cover decode and releases its source', async () => {
    const f = await fixture()
    const decoded = deferred<void>()
    const release = vi.fn()
    vi.spyOn(f.characters, 'getCover').mockResolvedValue('data:image/png;base64,fixture')
    vi.stubGlobal('Image', class { src = ''; decode = () => decoded.promise; removeAttribute = release })
    const page = f.open(f.a.id)
    await flushPromises()
    page.unmount()
    decoded.resolve()
    await flushPromises()
    expect(f.projection.getCharacterName()).toBe('')
    expect(getExecutableFrameSlashHandler()).toBeNull()
    expect(page.emitted('ready')).toBeUndefined()
    expect(release).toHaveBeenCalledWith('src')
  })

  it('falls back to the theme on decode failure while keeping chat usable', async () => {
    const f = await fixture()
    vi.spyOn(f.characters, 'getCover').mockResolvedValue('data:image/png;base64,broken')
    vi.stubGlobal('Image', class { src = ''; decode = () => Promise.reject(Error('bad image')); removeAttribute() {} })
    const page = f.open(f.a.id)
    await flushPromises()
    expect(page.find('textarea').exists()).toBe(true)
    expect(page.find('[aria-hidden="true"] img').exists()).toBe(false)
    expect(page.emitted('ready')).toHaveLength(1)
  })

  it('settles a rejected initialization with a returnable error page and private diagnostics', async () => {
    const f = await fixture()
    errorHub.clear()
    vi.spyOn(f.worldbook, 'getDisabled').mockRejectedValue(Error('private fixture payload'))
    const page = f.open(f.a.id)
    await flushPromises()
    expect(page.text()).toContain('会话加载失败，请返回后重试')
    expect(page.find('[aria-label="返回对话列表"]').exists()).toBe(true)
    expect(page.find('textarea').exists()).toBe(false)
    expect(page.emitted('ready')).toHaveLength(1)
    expect(f.projection.getCharacterName()).toBe('')
    expect(JSON.stringify(errorHub.all())).not.toContain('private fixture payload')
  })

  it('gives immediate cancellable feedback in the shell and does not reopen after cancellation', async () => {
    const f = await fixture()
    const pending = deferred<typeof f.a | null>()
    vi.spyOn(f.characters, 'get').mockReturnValue(pending.promise)
    const shell = f.shell()
    openConversation(f.a.id, 'card')
    await flushPromises()
    expect(shell.find('[role="status"]').text()).toBe('正在打开…')
    expect(shell.find('[inert]').exists()).toBe(true)
    await shell.findAll('button').find((button) => button.text() === '取消')!.trigger('click')
    pending.resolve(f.a)
    await flushPromises()
    expect(shell.find('[aria-busy]').exists()).toBe(false)
    expect(shell.find('[inert]').exists()).toBe(false)
    expect(shell.find('[aria-label="返回对话列表"]').exists()).toBe(false)
    expect(await f.sessions.get(f.a.id)).toBeNull()
  })

  it('clears pending feedback when a complete page is ready, and returns to the same tab', async () => {
    const f = await fixture()
    const shell = f.shell()
    const tabs = shell.find('nav[aria-label="主导航"]')
    await tabs.findAll('button').find((button) => button.text() === '角色')!.trigger('click')
    openConversation(f.a.id, 'card')
    await flushPromises()
    expect(shell.find('[aria-busy]').exists()).toBe(false)
    expect(shell.find('textarea').exists()).toBe(true)
    await shell.find('[aria-label="返回对话列表"]').trigger('click')
    await flushPromises()
    expect(shell.find('[data-session-viewport][inert]').exists()).toBe(true)
    completeSessionLeave(shell)
    await flushPromises()
    expect(shell.find('[aria-label="返回对话列表"]').exists()).toBe(false)
    expect(tabs.find('[aria-current="page"]').text()).toBe('角色')
  })

  it('revokes the leaving route before its page instance is unmounted', async () => {
    const f = await fixture()
    openConversation(f.a.id, 'card')
    const page = f.open(f.a.id)
    await flushPromises()
    expect(getExecutableFrameSlashHandler()).not.toBeNull()
    closeConversation()
    // A CSS leave can retain this already prepared page. It must no longer
    // own the global entry even before the render/unmount cycle finishes.
    expect(f.projection.getCharacterName()).toBe('')
    expect(getExecutableFrameSlashHandler()).toBeNull()
    await flushPromises()
    expect(page.find('textarea').exists()).toBe(true)
    expect(page.find('[aria-label="发送"]').attributes('disabled')).toBeDefined()
  })
})
