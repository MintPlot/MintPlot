/**
 * Text output mode (文本输出形式) — app-level chat preference read live at
 * turn time from the mp_settings store: 'stream' (default, typewriter deltas
 * through the stream publication) vs 'whole' (reply published in one piece
 * after completion). Persisted under `uiTextOutputMode`; anything other than
 * 'whole' — including the unset key — reads as 'stream', so existing installs
 * keep today's behavior.
 */

import type { SettingsState } from '@/kernel/settings/settings-state'

export type TextOutputMode = 'stream' | 'whole'

export const TEXT_OUTPUT_MODE_KEY = 'uiTextOutputMode'

export function readTextOutputMode(settings: SettingsState | null): TextOutputMode {
  if (!settings) return 'stream'
  const scope = settings.scope([TEXT_OUTPUT_MODE_KEY])
  return scope[TEXT_OUTPUT_MODE_KEY] === 'whole' ? 'whole' : 'stream'
}
