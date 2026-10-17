// ChatHomeView swipe-to-delete (1.0.x): flick-and-confirm — dragging left
// reveals the red action visually, releasing past the threshold springs the
// row back AND raises the confirm dialog directly (user-picked over the
// persistent-open pattern). Tap-to-open and drag-suppressed click stay
// regression-guarded here — the gesture handlers rewrite the row's input path.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import ChatHomeView from '@/kernel/app/views/ChatHomeView.vue'
import { CHATBOX_STORE_KEY } from '@/kernel/app/chat-keys'
import { useChatRoute } from '@/kernel/app/chat-router'
import { createChatboxStore } from '@/kernel/sessions/chatbox-store'
import { createStorageRepository } from '@/kernel/store/storage-repository'
import { createMemoryEngine } from '@/kernel/store/kv-store'
import { uiService } from '@/kernel/ui/toasts'

describe('ChatHomeView swipe-to-delete', () => {
  let chatboxStore: ReturnType<typeof createChatboxStore>

  const mountView = async () => {
    const wrapper = mount(ChatHomeView, {
      global: { provide: { [CHATBOX_STORE_KEY as symbol]: chatboxStore } },
    })
    await flushPromises()
    return wrapper
  }

  const rowOf = (wrapper: ReturnType<typeof mount>, title: string) => {
    const row = wrapper.findAll('button').find((button) => button.text().includes(title))
    expect(row, `row ${title} should render`).toBeDefined()
    return row!
  }

  // Reveal zones are always-mounted siblings behind the row (inside the same
  // li); their inline style carries the live translate (round-3 redesign:
  // glued to the row edges, sliding OUT with the drag). Parked = clipped
  // outside the li (+72 delete / -72 pin). Scoped to the dragged row's li —
  // the list sorts by updatedAt, so global findAll could pick another row.
  const revealZonesOf = (row: ReturnType<typeof rowOf>) => {
    const zones = [...(row.element.closest('li')!.querySelectorAll('[aria-hidden="true"]'))]
      .filter((el) => el.textContent?.includes('置顶') || el.textContent?.includes('删除'))
      .map((el) => ({
        pin: el.textContent?.includes('置顶') ?? false,
        delete: el.textContent?.includes('删除') ?? false,
        x: Number(el.getAttribute('style')?.match(/translateX\((-?[\d.]+)px\)/)?.[1] ?? NaN),
      }))
    expect(zones.length).toBeGreaterThan(0)
    return {
      pin: zones.find((zone) => zone.pin) ?? { x: NaN },
      delete: zones.find((zone) => zone.delete) ?? { x: NaN },
    }
  }

  // jsdom has no PointerEvent constructor and MouseEvent.clientX is
  // getter-only, so coordinates ride a plain Event via defineProperty — the
  // component only reads clientX/clientY/pointerId/currentTarget.
  const firePointer = (element: Element, type: string, clientX: number, clientY?: number): void => {
    const event = new Event(type, { bubbles: true })
    Object.defineProperty(event, 'clientX', { value: clientX })
    if (clientY !== undefined) Object.defineProperty(event, 'clientY', { value: clientY })
    Object.defineProperty(event, 'pointerId', { value: 1 })
    element.dispatchEvent(event)
  }

  const swipeRow = async (row: ReturnType<typeof rowOf>, endX: number, startX = 300) => {
    firePointer(row.element, 'pointerdown', startX)
    if (endX !== startX) firePointer(row.element, 'pointermove', endX)
    firePointer(row.element, 'pointerup', endX)
    await nextTick()
    await flushPromises()
  }

  beforeEach(async () => {
    chatboxStore = createChatboxStore(createStorageRepository(createMemoryEngine()))
    await chatboxStore.create('第一个对话')
    await chatboxStore.create('第二个对话')
    useChatRoute().value = { view: 'list' }
  })

  it('左划过阈值松手即弹确认,确认后连消息与信封一起移除、行弹回', async () => {
    const confirmSpy = vi.spyOn(uiService, 'confirm').mockResolvedValue(true)
    const wrapper = await mountView()
    const row = rowOf(wrapper, '第一个对话')

    await swipeRow(row, 300 - 80)

    expect(confirmSpy).toHaveBeenCalledOnce()
    expect(confirmSpy.mock.calls[0]![1].message).toContain('第一个对话')
    // The row springs back while the dialog is up — no persistent open state.
    expect(row.attributes('style')).toContain('translateX(0px)')

    expect(await chatboxStore.list()).toHaveLength(1)
    expect((await chatboxStore.list())[0]!.title).toBe('第二个对话')
    expect(wrapper.text()).not.toContain('第一个对话')
    confirmSpy.mockRestore()
  })

  it('确认模态取消则不删除', async () => {
    const confirmSpy = vi.spyOn(uiService, 'confirm').mockResolvedValue(false)
    const wrapper = await mountView()

    await swipeRow(rowOf(wrapper, '第一个对话'), 220)

    expect(confirmSpy).toHaveBeenCalledOnce()
    expect(await chatboxStore.list()).toHaveLength(2)
    confirmSpy.mockRestore()
  })

  it('滑动未过阈值回弹,不弹确认也不进对话', async () => {
    const confirmSpy = vi.spyOn(uiService, 'confirm')
    const wrapper = await mountView()
    const row = rowOf(wrapper, '第一个对话')

    await swipeRow(row, 300 - 20)

    expect(confirmSpy).not.toHaveBeenCalled()
    expect(row.attributes('style')).toContain('translateX(0px)')
    expect(useChatRoute().value.view).toBe('list')
  })

  it('垂直滚动的横向 slop 不闪出置顶/删除(方向锁,2026-10-17 真机回归)', async () => {
    const wrapper = await mountView()
    const row = rowOf(wrapper, '第一个对话')

    // A vertical flick's opening slop: 12px horizontal drift, 40px down.
    firePointer(row.element, 'pointerdown', 300, 400)
    firePointer(row.element, 'pointermove', 288, 440)
    await nextTick()

    const zones = revealZonesOf(row)
    expect(zones.delete.x).toBe(72)
    expect(zones.pin.x).toBe(-72)
    // Row stays parked — the drift never becomes a drag offset.
    expect(row.attributes('style')).toContain('translateX(0px)')

    // The browser takes over the pan (pointercancel), never a tap-open.
    firePointer(row.element, 'pointercancel', 288, 440)
    await nextTick()
    expect(useChatRoute().value.view).toBe('list')
  })

  it('滑动时按钮跟行滑出:左滑删除区跟进、右滑置顶区跟进(2026-10-17 round-3)', async () => {
    const wrapper = await mountView()
    const row = rowOf(wrapper, '第一个对话')

    // Left swipe 40px: the row slides to -40 and the delete zone rides its
    // edge (-40 + 72 = 32 — inside the revealed gap); the pin side is
    // pushed further out (-40 - 72 = -112).
    firePointer(row.element, 'pointerdown', 300, 400)
    firePointer(row.element, 'pointermove', 260, 402)
    await nextTick()
    const left = revealZonesOf(row)
    expect(row.attributes('style')).toContain('translateX(-40px)')
    expect(left.delete.x).toBe(32)
    expect(left.pin.x).toBe(-112)
    firePointer(row.element, 'pointercancel', 260, 402)

    // Right swipe 40px: mirror — the pin zone rides into the gap.
    firePointer(row.element, 'pointerdown', 300, 400)
    firePointer(row.element, 'pointermove', 340, 402)
    await nextTick()
    const right = revealZonesOf(row)
    expect(right.pin.x).toBe(-32)
    expect(right.delete.x).toBe(112)
    firePointer(row.element, 'pointercancel', 340, 402)
  })

  it('轻点行开对话;拖动过的手势不触发打开(click 被抑制)', async () => {
    const wrapper = await mountView()

    // Tap opens the conversation.
    await swipeRow(rowOf(wrapper, '第一个对话'), 300)
    expect(useChatRoute().value.view).toBe('chat')
    useChatRoute().value = { view: 'list' }

    // Drag past threshold then release: the trailing click must be swallowed.
    const row = rowOf(wrapper, '第二个对话')
    await swipeRow(row, 200)
    expect(useChatRoute().value.view).toBe('list')
    // The synthetic click after pointerup would open without the guard.
    await row.trigger('click')
    expect(useChatRoute().value.view).toBe('list')
  })

  it('右划过阈值置顶:toast 反馈、行弹回、钉标上屏且排到列表首位', async () => {
    const toastSpy = vi.spyOn(uiService, 'toast')
    const wrapper = await mountView()

    // "第二个对话" is the older row? Both seeded in order; pin the first row.
    const row = rowOf(wrapper, '第一个对话')
    await swipeRow(row, 300 + 80)

    expect(toastSpy).toHaveBeenCalledWith('shell', '已置顶', expect.anything())
    expect(row.attributes('style')).toContain('translateX(0px)')
    await flushPromises()
    expect(wrapper.findAll('li')[0]!.text()).toContain('第一个对话')
    // Pin toggle is envelope-only: both conversations survive.
    expect(await chatboxStore.list()).toHaveLength(2)

    // Swipe right again unpins.
    await swipeRow(wrapper.findAll('button').find((button) => button.text().includes('第一个对话'))!, 380)
    expect(toastSpy).toHaveBeenCalledWith('shell', '已取消置顶', expect.anything())
    toastSpy.mockRestore()
  })

  it('右划未过阈值不置顶', async () => {
    const toastSpy = vi.spyOn(uiService, 'toast')
    const wrapper = await mountView()

    await swipeRow(rowOf(wrapper, '第一个对话'), 300 + 20)

    expect(toastSpy).not.toHaveBeenCalled()
    expect((await chatboxStore.list())[0]!.pinned).toBeFalsy()
    toastSpy.mockRestore()
  })

  it('纯按压不露置顶/删除色块(半透明行会透出);拖过起点阈值才跟行滑出', async () => {
    const wrapper = await mountView()
    const row = rowOf(wrapper, '第一个对话')

    // Press and hold without movement: both zones stay parked outside the
    // li (clipped) — press-and-hold is reserved for other uses.
    firePointer(row.element, 'pointerdown', 300)
    await nextTick()
    const pressed = revealZonesOf(row)
    expect(pressed.pin.x).toBe(-72)
    expect(pressed.delete.x).toBe(72)

    // Move past the drag-start threshold (leftward): the delete zone rides
    // the row's edge into the gap.
    firePointer(row.element, 'pointermove', 300 - 12)
    await nextTick()
    const dragged = revealZonesOf(row)
    expect(dragged.delete.x).toBe(60)
    expect(dragged.pin.x).toBe(-84)

    firePointer(row.element, 'pointerup', 300 - 12)
    await nextTick()
    await flushPromises()
  })
})
