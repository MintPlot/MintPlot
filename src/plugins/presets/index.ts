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
import PresetSection from '@/kernel/app/sections/PresetSection.vue'

const pluginManifest = manifest as PluginManifest

export default definePlugin({
  manifest: pluginManifest,
  activate(ctx) {
    // Management surface (M3-w follow-up, user call): the preset panel folds
    // into the plugin's own tools-area accordion entry (placement 'plugin',
    // M3-h IA) instead of a settings-tab section — presets configure the
    // request pipeline, so they sit with the other pipeline organs.
    ctx.registerSettingsSection({
      id: 'presets',
      title: '预设设置',
      component: PresetSection,
      placement: 'plugin',
    })
  },
})
