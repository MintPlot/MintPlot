/**
 * worldinfo plugin entry (M3-u) — the management surface of the worldbook
 * system: tools-area entry row + enable toggle (M3-h shape), card-domain
 * only (`sessions: ['card']`).
 *
 * Deliberately no service, same shape as the variables plugin (M3-q2): the
 * activation/budget/injection engine and the per-entry toggle store live
 * kernel-side (src/kernel/worldinfo/) because the request pipeline
 * (ChatSessionView) consumes them there and the red line forbids
 * kernel→plugin imports. Disabling this plugin flips the runtime state to
 * 'registered'; the chat page reads that state on mount and the whole
 * worldbook layer goes dormant — no scanning, no injection, no panel entry.
 * The card's verbatim book data is never touched.
 */

import { definePlugin } from '@contracts'
import manifest from './manifest.json'
import type { PluginManifest } from '@contracts'

const pluginManifest = manifest as PluginManifest

export default definePlugin({
  manifest: pluginManifest,
  activate() {
    // Nothing to mount: the engine is kernel infra; the toggle is the feature.
  },
})
