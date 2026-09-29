/**
 * tts service instance — activate-time singleton (ported pattern from the
 * decoupling-line organ): TtsSettings and the chat UI share this instance;
 * fetching while inactive returns null so components fail soft.
 */

import type { TtsService } from './service'

let activeService: TtsService | null = null

export function setTtsService(service: TtsService | null): void {
  activeService = service
}

export function getTtsService(): TtsService | null {
  return activeService
}
