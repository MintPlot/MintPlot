/**
 * Card macro substitution (M3-n, native) — the RP minimal equivalent of the
 * default "Auto Replace {{user}}" regex script (reference: decoupled repo
 * app.mjs DEFAULT_USER_REGEX_NAME; behavior source, not a code port). RP's
 * default script runs with markdownOnly:false / promptOnly:false — macros
 * resolve on BOTH the display and the outgoing-request paths, so we do too.
 * Stored history is never rewritten; replacement happens at read time only.
 */

export interface CardMacroContext {
  /** The character card name (card domain); chatbox has no char and keeps the literal. */
  charName: string
  /** mp_settings userName (设置页 · 用户设定 · 昵称). */
  userName: string
}

/** `{{char}}` and `{{user}}`, case-insensitive and global (RP flags 'gi'). */
export function replaceCardMacros(text: string, context: CardMacroContext): string {
  if (!text) return text
  let result = text.replace(/\{\{user\}\}/gi, context.userName)
  if (context.charName) result = result.replace(/\{\{char\}\}/gi, context.charName)
  return result
}
