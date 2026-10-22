import { describe, expect, it, vi } from 'vitest'
import { useChatScroll } from '@/kernel/app/chat/use-chat-scroll'

function fixture() {
  const element = document.createElement('div')
  let height = 800
  Object.defineProperties(element, { scrollHeight: { get: () => height }, clientHeight: { value: 400 } })
  element.scrollTop = 400
  const list = { scrollToEnd: vi.fn(async () => true), cancelScroll: vi.fn() }
  return { element, list, scroll: useChatScroll(() => element, () => list), grow: () => { height += 1000 } }
}

describe('chat reader intent', () => {
  it('keeps following when measured growth emits scroll without reader input', async () => {
    const f = fixture()
    f.grow()
    f.scroll.onMessageScroll()
    expect(f.scroll.followingOutput.value).toBe(true)
    expect(f.list.cancelScroll).not.toHaveBeenCalled()
    await f.scroll.followOutput()
    expect(f.list.scrollToEnd).toHaveBeenCalledOnce()
  })
  it('accepts scrollbar and assistive upward scrolling without pointer input', () => {
    const f = fixture()
    f.element.scrollTop = 150
    f.scroll.onMessageScroll()
    expect(f.scroll.followingOutput.value).toBe(false)
    expect(f.list.cancelScroll).toHaveBeenCalledOnce()
    f.element.scrollTop = 400
    f.scroll.onMessageScroll()
    expect(f.scroll.followingOutput.value).toBe(true)
  })
  it('ignores horizontal wheel and editable keys, but accepts vertical wheel and navigation keys', () => {
    const f = fixture()
    f.scroll.onReaderWheel(new WheelEvent('wheel', { deltaX: 100, deltaY: 1 }))
    expect(f.scroll.followingOutput.value).toBe(true)
    const textarea = document.createElement('textarea')
    const key = new KeyboardEvent('keydown', { key: 'ArrowUp' })
    Object.defineProperty(key, 'target', { value: textarea })
    f.scroll.onReaderKeyDown(key)
    expect(f.scroll.followingOutput.value).toBe(true)
    f.scroll.onReaderKeyDown(new KeyboardEvent('keydown', { key: 'PageUp' }))
    expect(f.scroll.followingOutput.value).toBe(false)
    const other = fixture()
    other.scroll.onReaderWheel(new WheelEvent('wheel', { deltaY: -100 }))
    expect(other.scroll.followingOutput.value).toBe(false)
  })
  it('revokes queued commands on a reading gesture and on departure', async () => {
    const f = fixture()
    const queued = f.scroll.followOutput()
    f.scroll.interruptFollow()
    await queued
    expect(f.list.scrollToEnd).not.toHaveBeenCalled()
    const latest = f.scroll.scrollToBottom()
    f.scroll.disposeScroll()
    await latest
    await f.scroll.scrollToBottom()
    expect(f.list.scrollToEnd).not.toHaveBeenCalled()
  })
})
