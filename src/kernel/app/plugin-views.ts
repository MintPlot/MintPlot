/**
 * Plugin view registry (kernel/app) — plugin-registered views for the tool-tab
 * aggregate (spec v1.2 §02: the tools tab is the plugin aggregate page; the
 * main chat surface is never plugin territory). Ids are namespaced
 * `<pluginId>:<id>`; deactivation revokes the view.
 */

import { computed, ref } from 'vue'
import type { ComputedRef } from 'vue'
import type { ViewSpec } from '@contracts'
import type { ViewSink } from '@/kernel/runtime/context'

export interface PluginViewDescriptor {
  /** Namespaced: `<pluginId>:<spec.id>`. */
  readonly id: string
  readonly pluginId: string
  readonly title: string
  readonly component: ViewSpec['component']
}

const views = ref<PluginViewDescriptor[]>([])

export const pluginViewsSink: ViewSink = {
  registerView(pluginId, spec) {
    const id = `${pluginId}:${spec.id}`
    if (views.value.some((view) => view.id === id)) {
      throw new Error(`[plugin-views] duplicate view id: ${id}`)
    }
    views.value = [
      ...views.value,
      { id, pluginId, title: spec.title, component: spec.component },
    ]
    return () => {
      views.value = views.value.filter((view) => view.id !== id)
    }
  },
}

export function getRegisteredPluginViews(): readonly PluginViewDescriptor[] {
  return views.value
}

/** Reactive projection for the tools-tab aggregate (follows register/revoke). */
export function usePluginViewsProjection(): ComputedRef<PluginViewDescriptor[]> {
  return computed(() => [...views.value])
}
