import { describe, expect, it, vi } from 'vitest'
import { closeConversation, openConversation, useChatRoute } from '@/kernel/app/chat-router'

describe('kernel/app · chat-router history integration (M3-f/M3-i)', () => {
  it('open pushes a flagged history entry; popstate closes the chat (gesture back)', () => {
    const route = useChatRoute()
    openConversation('cb-1')

    expect(route.value).toEqual({ view: 'chat', kind: 'chatbox', conversationId: 'cb-1' })
    expect((window.history.state as { mpChat?: unknown }).mpChat).toEqual({ kind: 'chatbox', id: 'cb-1' })

    window.dispatchEvent(new PopStateEvent('popstate', { state: null }))
    expect(route.value).toEqual({ view: 'list' })
  })

  it('card-domain opens carry the card kind through history state', () => {
    const route = useChatRoute()
    openConversation('cc-9', 'card')

    expect(route.value).toEqual({ view: 'chat', kind: 'card', conversationId: 'cc-9' })
    expect((window.history.state as { mpChat?: unknown }).mpChat).toEqual({ kind: 'card', id: 'cc-9' })

    window.dispatchEvent(new PopStateEvent('popstate', { state: null }))
    expect(route.value).toEqual({ view: 'list' })
  })

  it('legacy plain-string history state restores as chatbox', () => {
    window.history.replaceState({ mpChat: 'cb-legacy' }, '')
    window.dispatchEvent(new PopStateEvent('popstate', { state: { mpChat: 'cb-legacy' } }))
    expect(useChatRoute().value).toEqual({ view: 'chat', kind: 'chatbox', conversationId: 'cb-legacy' })
    window.dispatchEvent(new PopStateEvent('popstate', { state: null }))
  })

  it('close resets the route directly and clears the history flag (WebView back is dead on Android 15)', () => {
    const route = useChatRoute()
    openConversation('cb-2')
    const backSpy = vi.spyOn(window.history, 'back')
    try {
      closeConversation()
      // No history.back() dependency — the Android back button is driven by
      // the Capacitor backButton event calling this; the stale entry stays
      // in the stack but its mpChat flag is cleared via replaceState.
      expect(backSpy).not.toHaveBeenCalled()
      expect(route.value).toEqual({ view: 'list' })
      expect((window.history.state as { mpChat?: unknown }).mpChat).toBeUndefined()
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
    // A different kind targeting the same id is a distinct destination.
    openConversation('cb-3', 'card')
    expect(window.history.state).not.toBe(stateInFlight)
    window.dispatchEvent(new PopStateEvent('popstate', { state: null }))
  })

  it('residual chat entries are skipped: back onto a stacked mpChat entry keeps stepping back (M3-v regression)', () => {
    const route = useChatRoute()
    // Simulate the real-device pile-up: open card A (entry kept), return to
    // the list WITHOUT consuming history (as the system back bug did), then
    // open card B — the stack now holds two mpChat entries.
    window.history.pushState({ mpChat: { kind: 'card', id: 'cc-A' } }, '')
    window.dispatchEvent(new PopStateEvent('popstate', { state: { mpChat: { kind: 'card', id: 'cc-A' } } }))
    openConversation('cc-B', 'card')
    expect(route.value).toEqual({ view: 'chat', kind: 'card', conversationId: 'cc-B' })

    // System back: the first popstate lands on cc-A's residual entry — the
    // router must NOT stay silent: it issues another history.back() (the
    // browser then delivers the next popstate asynchronously; state=null on
    // the list entry closes the chat — covered by the first case above).
    const backSpy = vi.spyOn(window.history, 'back')
    try {
      window.dispatchEvent(new PopStateEvent('popstate', { state: { mpChat: { kind: 'card', id: 'cc-A' } } }))
      expect(backSpy).toHaveBeenCalledOnce()
      // Route unchanged while stepping (still in the chat domain).
      expect(route.value).toEqual({ view: 'chat', kind: 'card', conversationId: 'cc-B' })
    } finally {
      backSpy.mockRestore()
    }
  })
})
