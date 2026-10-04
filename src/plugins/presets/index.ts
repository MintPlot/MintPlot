/**
 * presets plugin entry (M3-w) — the management surface of the prompt preset
 * system: settings-area section + tools-area toggle. Unlike the card-domain
 * organs (variables/worldinfo/regex), presets are APP-LEVEL configuration
 * (`sessions: []`): they shape the request assembly for every domain.
 *
 * Deliberately no service: the group/entry store and the seed-sync live
 * kernel-side (src/kernel/presets/) because the request pipeline
 * (ChatSessionView) consumes them there and the red line forbids
 * kernel→plugin imports. Disabling this plugin flips the runtime state to
 * 'registered'; the chat page reads that state and skips the preset layer
 * entirely — the request assembles exactly as before M3-w.
 */

import { definePlugin } from '@contracts'
import manifest from './manifest.json'
import type { PluginManifest } from '@contracts'

const pluginManifest = manifest as PluginManifest

export default definePlugin({
  manifest: pluginManifest,
  activate() {
    // Nothing to mount: the store is kernel infra; the toggle is the feature.
    // The preset panel is REGISTERED BY THE HOST (App.vue) with placement
    // 'plugin' under this plugin's id — the section component lives
    // kernel-side and plugins must not import kernel modules (red line
    // §3.5.4).
  },
})
