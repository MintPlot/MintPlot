import { describe, expect, it, vi } from 'vitest'
import { closeConversation, openConversation, useChatRoute } from '@/kernel/app/chat-router'

describe('kernel/app · chat-router history integration (M3-f)', () => {
  it('open pushes a flagged history entry; popstate closes the chat (gesture back)', () => {
    const route = useChatRoute()
    openConversation('cb-1')

    expect(route.value).toEqual({ view: 'chat', conversationId: 'cb-1' })
    expect((window.history.state as { mpChat?: string }).mpChat).toBe('cb-1')

    window.dispatchEvent(new PopStateEvent('popstate', { state: null }))
    expect(route.value).toEqual({ view: 'list' })
  })

  it('close consumes the pushed entry through history.back (button stays on one stack)', () => {
    openConversation('cb-2')
    const backSpy = vi.spyOn(window.history, 'back')
    try {
      closeConversation()
      expect(backSpy).toHaveBeenCalledOnce()
    } finally {
      backSpy.mockRestore()
    }
  })

  it('close falls back to a direct reset when the current entry is not ours', () => {
    window.history.replaceState({}, '')
    const route = useChatRoute()
    closeConversation()
    expect(route.value).toEqual({ view: 'list' })
  })

  it('re-opening the conversation in flight does not push a second entry', () => {
    openConversation('cb-3')
    const stateInFlight = window.history.state
    openConversation('cb-3')
    expect(window.history.state).toBe(stateInFlight)
  })
})
