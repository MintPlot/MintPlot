/**
 * Session kinds (spec v1.2 §03) — the architectural seam of the dual-domain
 * product: pure AI chat (chatbox, baseline) and character-card play (card,
 * core). The two domains are independent and never mix storage or lists;
 * they share the kernel LLM pipeline, secrets vault and chat-page skeleton.
 *
 * MP contract addition over ADR-001: every session record carries a kind, and
 * kind-scoped subscription is a first-class contract surface — pipeline hooks,
 * persistent session events and input actions can all be scoped by kind, and
 * core plugins declare card-only mounting in their manifest (`sessions`) and
 * in code (hook/filter options).
 */

export const SESSION_KINDS = ['chatbox', 'card'] as const

export type SessionKind = (typeof SESSION_KINDS)[number]
