import { flushPromises } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'

export async function openCardTool(wrapper: VueWrapper, label: string): Promise<void> {
  await wrapper.get('button[aria-label="卡片工具"]').trigger('click')
  await wrapper.get(`button[aria-label="打开${label}"]`).trigger('click')
  await flushPromises()
}

export async function hasCardTool(wrapper: VueWrapper, label: string): Promise<boolean> {
  const trigger = wrapper.find('button[aria-label="卡片工具"]')
  if (!trigger.exists()) return false
  await trigger.trigger('click')
  const exists = wrapper.find(`button[aria-label="打开${label}"]`).exists()
  await trigger.trigger('click')
  return exists
}
