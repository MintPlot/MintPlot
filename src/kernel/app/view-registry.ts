import { computed, markRaw, ref } from 'vue'
import type { Component } from 'vue'

/**
 * The tab bar projects registered views in order. Component definitions stay
 * raw while descriptor metadata and forwarded props remain reactive.
 */

export interface TabViewDescriptor {
  /** Stable id; duplicates are programming errors. */
  id: string
  /** Tab label. */
  title: string
  /** Tab icon using stroke currentColor. */
  icon: Component
  /** Registered page component. */
  component: Component
  /** Optional forwarded view props. */
  props?: Record<string, unknown>
  /** Ascending order; ties retain registration order. */
  order: number
}

const tabs = ref<TabViewDescriptor[]>([])

/** Register a tab and return its reversible disposer. */
export function registerTab(descriptor: TabViewDescriptor): () => void {
  if (tabs.value.some((tab) => tab.id === descriptor.id)) {
    throw new Error(`[view-registry] 重复注册 tab id: ${descriptor.id}`)
  }
  tabs.value = [...tabs.value, {
    ...descriptor, component: markRaw(descriptor.component), icon: markRaw(descriptor.icon),
  }]
  return () => unregisterTab(descriptor.id)
}

export function unregisterTab(id: string): void {
  tabs.value = tabs.value.filter((tab) => tab.id !== id)
}

export function getRegisteredTab(id: string): TabViewDescriptor | undefined {
  return tabs.value.find((tab) => tab.id === id)
}

/** Sorted projection that tracks registry changes. */
export function useTabProjection() {
  return computed(() => [...tabs.value].sort((a, b) => a.order - b.order))
}
