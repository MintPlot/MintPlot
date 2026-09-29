/**
 * Session projection host implementation (ADR-004 minimal absorption) —
 * card-domain values until the card-workshop port lands: chatbox sessions
 * have no character concept, so the stubs return empty/null. ADR-004 marks
 * this surface temporary; the real implementation reads the active card
 * session's character and messages.
 */

import type { PluginSession } from '@contracts'

export function createSessionProjection(): PluginSession {
  return {
    getCharacterName: () => '',
    getCharacterVoice: () => '',
    getMessageAt: () => null,
  }
}
