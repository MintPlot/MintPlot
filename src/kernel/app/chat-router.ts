/**
 * Chat route (M3) — the conversation page is a full-screen overlay: entering
 * any chat page hides the tab bar (spec §02 进聊天页全屏沉浸). Module-level
 * route; the shell renders the overlay above the tab bar.
 *
 * History integration (M3-f): opening a conversation pushes a history entry,
 * so the Android system back (gesture or button) drives the WebView one entry
 * back — Capacitor's bridge calls webView.goBack() whenever it canGoBack() —
 * and popstate closes the chat instead of leaving the app. The in-page back
 * button routes through history.back() to stay one stack with the gesture.
 */

import { ref } from 'vue'
import type { Ref } from 'vue'

export type ChatRoute = { view: 'list' } | { view: 'chat'; conversationId: string }

const route = ref<ChatRoute>({ view: 'list' })

export function useChatRoute(): Ref<ChatRoute> {
  return route
}

const HISTORY_KEY = 'mpChat'

function routeFromHistoryState(state: unknown): ChatRoute {
  const flagged = state as { [HISTORY_KEY]?: unknown } | null
  const id = flagged?.[HISTORY_KEY]
  return typeof id === 'string' && id !== '' ? { view: 'chat', conversationId: id } : { view: 'list' }
}

const hasHistoryApi = typeof window !== 'undefined' && typeof window.history !== 'undefined'

if (hasHistoryApi) {
  // Reload mid-chat: the browser restores the pushed entry's state.
  route.value = routeFromHistoryState(window.history.state)
  window.addEventListener('popstate', (event) => {
    route.value = routeFromHistoryState(event.state)
  })
}

export function openConversation(conversationId: string): void {
  if (route.value.view === 'chat' && route.value.conversationId === conversationId) return
  route.value = { view: 'chat', conversationId }
  if (hasHistoryApi) window.history.pushState({ [HISTORY_KEY]: conversationId }, '')
}

export function closeConversation(): void {
  if (hasHistoryApi && routeFromHistoryState(window.history.state).view === 'chat') {
    // Consume the pushed entry so gesture-back and the button stay one stack.
    window.history.back()
    return
  }
  route.value = { view: 'list' }
}
