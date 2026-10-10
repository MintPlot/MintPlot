/**
 * cot plugin entry (M4-f) — the tools-area entry row + enable toggle for the
 * thinking layer. Deliberately no service and no config panel, same shape as
 * variables (M3-q2) / worldinfo (M3-u) / regex (M3-v) / memory (M4-e): the
 * parser, builder and preset sync live kernel-side (src/kernel/cot/) because
 * the chat page consumes them there and the red line forbids kernel→plugin
 * imports. Disabling flips the runtime state to 'registered'; the chat page
 * reads that state and the whole layer goes dormant — no thinking card, no
 * COT preset sync, no request-side strip (tags pass through raw). Native
 * reasoning still rides the kernel stream capture; it just stays unshown.
 * sessions omitted (M3-q2): the layer serves both chat domains.
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
