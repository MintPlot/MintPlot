/**
 * regex plugin entry (M3-v) — the management surface of the card-regex
 * system: tools-area entry row + enable toggle (M3-h shape), card-domain
 * only (`sessions: ['card']`).
 *
 * Deliberately no service, same shape as variables (M3-q2) and worldinfo
 * (M3-u): the projection/flag-matrix/protection-shield engine and the
 * per-script toggle store live kernel-side (src/kernel/regex/) because the
 * render and request pipelines (ChatSessionView) consume them there and the
 * red line forbids kernel→plugin imports. Disabling this plugin flips the
 * runtime state to 'registered'; the chat page reads that state and the
 * whole regex layer goes dormant — no display rewrite, no prompt rewrite,
 * no panel entry. The card's verbatim regex data is never touched.
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
