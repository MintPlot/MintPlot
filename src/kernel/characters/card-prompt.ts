/**
 * Card-session prompt assembly (M3-i, native new-write) — the RP minimal form
 * internalized (reference: decoupled repo useMessageSender.mjs:509-546 +
 * app.mjs buildUserInfoPrompt; behavior source, not a code port):
 *   - the [Character] block carries name + personality, mes_example appended
 *     only when non-empty; description/scenario never enter the prompt —
 *     description is the user-facing blurb, personality the AI-facing
 *     definition (RP field semantics, card-utils mapping);
 *   - the [User Info] block moves to the end of the system prompt.
 * Pure functions; the result streams through the llm.provider seam exactly
 * like the chatbox path.
 */

import type { CharacterCard } from '@/kernel/characters/character-card'

export interface CardUserInfo {
  /** mp_settings userName (设置页 · 用户设定 · 昵称). */
  name: string
  /** mp_settings userPersona (设置页 · 用户设定 · 人设简介). */
  persona: string
}

type CardPromptSource = Pick<CharacterCard, 'name' | 'personality' | 'mesExample'>

export interface GreetingFloorRef {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export function buildCardSystemPrompt(card: CardPromptSource, userInfo: CardUserInfo): string {
  const characterParts = ['[Character]', `Name: ${card.name}\nPersonality: ${card.personality}`]
  if (card.mesExample && card.mesExample.trim()) characterParts.push(card.mesExample)
  const userInfoPrompt = ['[User Info]', `Name: ${userInfo.name || ''}`, `Description: ${userInfo.persona || ''}`].join('\n')
  return [characterParts.join('\n\n'), userInfoPrompt].join('\n\n')
}

/**
 * Greeting insurance (RP useMessageSender.mjs:615-629, internalized): the
 * greeting leads the history; when the first floor is missing or no longer
 * the greeting verbatim, the OUTGOING request re-injects it ahead of the
 * floors — the stored history itself is never rewritten. An empty greeting
 * has nothing to inject.
 */
export function greetingFloorMissing(messages: readonly GreetingFloorRef[], firstMes: string): boolean {
  if (!firstMes) return false
  const first = messages[0]
  return !(first && first.role === 'assistant' && first.content === firstMes)
}
