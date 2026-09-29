/**
 * Settings registry (kernel/app) — the settings page is a projection of
 * registered sections, never a hardcoded list. Kernel-owned sections register
 * with source 'kernel'; plugin sections arrive through the runtime's
 * settings sink and are namespaced `<pluginId>:<id>`. Everything registered
 * is reversible (deactivate removes the section).
 */

import { computed, ref } from 'vue'
import type { ComputedRef } from 'vue'
import type { SettingsSectionSpec } from '@contracts'
import type { SettingsSink } from '@/kernel/runtime/context'

export interface SettingsSectionDescriptor {
  /** Namespaced: `<source>:<spec.id>` — stable projection key. */
  readonly id: string
  readonly title: string
  readonly component: SettingsSectionSpec['component']
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
    { id, title: spec.title, component: spec.component, order, source },
  ]
  return () => {
    sections.value = sections.value.filter((section) => section.id !== id)
  }
}

/** Runtime-facing sink: plugin sections register under their plugin id. */
export const settingsSink: SettingsSink = {
  registerSection: (pluginId, spec) => registerSettingsSection(pluginId, spec),
}

/** Settings-page projection: order ascending, stable on ties. */
export function useSettingsProjection(): ComputedRef<SettingsSectionDescriptor[]> {
  return computed(() => [...sections.value].sort((a, b) => a.order - b.order))
}

/** Registry observation for tests and diagnostics. */
export function getRegisteredSettingsSections(): readonly SettingsSectionDescriptor[] {
  return sections.value
}
