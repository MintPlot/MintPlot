/**
 * Chat route (M3) — the conversation page is a full-screen overlay: entering
 * any chat page hides the tab bar (spec §02 进聊天页全屏沉浸). Module-level
 * route; the shell renders the overlay above the tab bar. M3-i: the route
 * carries the session kind (chatbox | card) so the shell mounts the same
 * session page skeleton in either domain.
 *
 * History integration (M3-f): opening a conversation pushes a history entry,
 * so the Android system back (gesture or button) drives the WebView one entry
 * back — Capacitor's bridge calls webView.goBack() whenever it canGoBack() —
 * and popstate closes the chat instead of leaving the app. The in-page back
 * button routes through history.back() to stay one stack with the gesture.
 */

import { ref } from 'vue'
import type { Ref } from 'vue'
import type { SessionKind } from '@contracts'

export type ChatRoute = { view: 'list' } | { view: 'chat'; kind: SessionKind; conversationId: string }

const route = ref<ChatRoute>({ view: 'list' })

export function useChatRoute(): Ref<ChatRoute> {
  return route
}

const HISTORY_KEY = 'mpChat'

function routeFromHistoryState(state: unknown): ChatRoute {
  const flagged = state as { [HISTORY_KEY]?: unknown } | null
  const entry = flagged?.[HISTORY_KEY]
  // Current shape: { kind, id }; legacy plain-string ids restore as chatbox.
  if (typeof entry === 'string' && entry !== '') {
    return { view: 'chat', kind: 'chatbox', conversationId: entry }
  }
  if (typeof entry === 'object' && entry !== null) {
    const record = entry as { kind?: unknown; id?: unknown }
    if (typeof record.id === 'string' && record.id !== '' && (record.kind === 'chatbox' || record.kind === 'card')) {
      return { view: 'chat', kind: record.kind, conversationId: record.id }
    }
  }
  return { view: 'list' }
}

const hasHistoryApi = typeof window !== 'undefined' && typeof window.history !== 'undefined'

if (hasHistoryApi) {
  // Reload mid-chat: the browser restores the pushed entry's state.
  route.value = routeFromHistoryState(window.history.state)
  window.addEventListener('popstate', (event) => {
    route.value = routeFromHistoryState(event.state)
  })
}

export function openConversation(conversationId: string, kind: SessionKind = 'chatbox'): void {
  if (route.value.view === 'chat' && route.value.kind === kind && route.value.conversationId === conversationId) return
  route.value = { view: 'chat', kind, conversationId }
  if (hasHistoryApi) window.history.pushState({ [HISTORY_KEY]: { kind, id: conversationId } }, '')
}

export function closeConversation(): void {
  if (hasHistoryApi && routeFromHistoryState(window.history.state).view === 'chat') {
    // Consume the pushed entry so gesture-back and the button stay one stack.
    window.history.back()
    return
  }
  route.value = { view: 'list' }
}
