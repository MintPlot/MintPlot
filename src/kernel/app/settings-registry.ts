/**
 * Settings registry (kernel/app) — the settings page is a projection of
 * registered sections, never a hardcoded list. Kernel-owned sections register
 * with source 'kernel'; plugin sections arrive through the runtime's
 * settings sink and are namespaced `<pluginId>:<id>`. Everything registered
 * is reversible (deactivate removes the section).
 *
 * Each section carries a placement (M3-f IA): 'settings' (default) renders on
 * the settings tab, 'tools' renders on the tools tab's plugin territory —
 * plugin feature surfaces register 'tools' so the settings page stays
 * user-configuration only.
 */

import { computed, ref } from 'vue'
import type { ComputedRef } from 'vue'
import type { SettingsSectionPlacement, SettingsSectionSpec } from '@contracts'
import type { SettingsSink } from '@/kernel/runtime/context'

export interface SettingsSectionDescriptor {
  /** Namespaced: `<source>:<spec.id>` — stable projection key. */
  readonly id: string
  readonly title: string
  readonly component: SettingsSectionSpec['component']
  /** Tab the section surfaces on (spec.placement, default 'settings'). */
  readonly placement: SettingsSectionPlacement
  /** Sort key, ascending; ties keep registration order. */
  readonly order: number
  readonly source: string
}

const sections = ref<SettingsSectionDescriptor[]>([])

export function registerSettingsSection(source: string, spec: SettingsSectionSpec, order = 50): () => void {
  const id = `${source}:${spec.id}`
  if (sections.value.some((section) => section.id === id)) {
    throw new Error(`[settings-registry] duplicate section id: ${id}`)
  }
  sections.value = [
    ...sections.value,
    { id, title: spec.title, component: spec.component, placement: spec.placement ?? 'settings', order, source },
  ]
  return () => {
    sections.value = sections.value.filter((section) => section.id !== id)
  }
}

/** Runtime-facing sink: plugin sections register under their plugin id. */
export const settingsSink: SettingsSink = {
  registerSection: (pluginId, spec) => registerSettingsSection(pluginId, spec),
}

const byPlacement = (placement: SettingsSectionPlacement): ComputedRef<SettingsSectionDescriptor[]> =>
  computed(() => sections.value.filter((section) => section.placement === placement).sort((a, b) => a.order - b.order))

/** Settings-page projection: placement 'settings', order ascending, stable on ties. */
export function useSettingsProjection(): ComputedRef<SettingsSectionDescriptor[]> {
  return byPlacement('settings')
}

/** Tools-page projection for plugin feature sections (M3-f). */
export function useToolsSectionProjection(): ComputedRef<SettingsSectionDescriptor[]> {
  return byPlacement('tools')
}

/** Registry observation for tests and diagnostics. */
export function getRegisteredSettingsSections(): readonly SettingsSectionDescriptor[] {
  return sections.value
}
