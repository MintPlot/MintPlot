import { computed, ref } from 'vue'
import type { Component } from 'vue'

/**
 * 视图注册表雏形(M0-d)—— M1 契约包的前哨。
 * tab 栏 = 注册表投影,而非硬编码;M2+ 起插件视图经同一条路入驻,
 * 届时与 contracts/ 的 manifest/生命周期契约合并演进。
 */

export interface TabViewDescriptor {
  /** 稳定 id,重复注册视为编程错误 */
  id: string
  /** tab 栏展示名 */
  title: string
  /** tab 栏图标(线性白线语言,stroke currentColor) */
  icon: Component
  /** 该 tab 的落地视图组件 */
  component: Component
  /** 视图透传 props(占位视图用;自包含插件视图可省) */
  props?: Record<string, unknown>
  /** 投影排序键,升序;同值按注册次序(稳定排序) */
  order: number
}

const tabs = ref<TabViewDescriptor[]>([])

/** 注册一个 tab 视图;返回反注册 disposer —— 一切注册皆可逆。 */
export function registerTab(descriptor: TabViewDescriptor): () => void {
  if (tabs.value.some((tab) => tab.id === descriptor.id)) {
    throw new Error(`[view-registry] 重复注册 tab id: ${descriptor.id}`)
  }
  tabs.value = [...tabs.value, descriptor]
  return () => unregisterTab(descriptor.id)
}

export function unregisterTab(id: string): void {
  tabs.value = tabs.value.filter((tab) => tab.id !== id)
}

export function getRegisteredTab(id: string): TabViewDescriptor | undefined {
  return tabs.value.find((tab) => tab.id === id)
}

/** tab 栏投影:order 升序的只读快照;注册表变化自动跟随。 */
export function useTabProjection() {
  return computed(() => [...tabs.value].sort((a, b) => a.order - b.order))
}
