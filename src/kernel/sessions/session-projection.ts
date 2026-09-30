/**
 * Session projection host implementation (ADR-004) — card-domain values are
 * real as of M3-i: the card session page activates its card (name + live
 * floors) on mount and clears it on unmount, so TTS-style consumers see the
 * character being played. Chatbox sessions activate nothing (no character
 * concept) and keep reading empties.
 */

import type { PluginSession, SessionMessageRef } from '@contracts'

/** What the card session page projects while it is on screen. */
export interface ActiveCardSessionProjection {
  readonly cardId: string
  readonly cardName: string
  /** Live floor list — reads at call time see streaming content. */
  readonly messages: readonly { readonly id: string; readonly content: string }[]
}

/** The host face: PluginSession plus the activation switch the shell owns. */
export interface HostSessionProjection extends PluginSession {
  setActiveCardSession(active: ActiveCardSessionProjection | null): void
}

export function createSessionProjection(): HostSessionProjection {
  let active: ActiveCardSessionProjection | null = null
  return {
    setActiveCardSession(next) {
      active = next
    },
    getCharacterName: () => active?.cardName ?? '',
    // Cards carry no voice field — TTS falls back to its configured default.
    getCharacterVoice: () => '',
    getMessageAt(index: number): SessionMessageRef | null {
      const message = active?.messages[index]
      return message ? { id: message.id, content: message.content } : null
    },
  }
}
