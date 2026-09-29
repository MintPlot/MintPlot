/**
 * Chat route (M3) — the conversation page is a full-screen overlay: entering
 * any chat page hides the tab bar (spec §02 进聊天页全屏沉浸). Module-level
 * route; the shell renders the overlay above the tab bar.
 */

import { ref } from 'vue'
import type { Ref } from 'vue'

export type ChatRoute = { view: 'list' } | { view: 'chat'; conversationId: string }

const route = ref<ChatRoute>({ view: 'list' })

export function useChatRoute(): Ref<ChatRoute> {
  return route
}

export function openConversation(conversationId: string): void {
  route.value = { view: 'chat', conversationId }
}

export function closeConversation(): void {
  route.value = { view: 'list' }
}
