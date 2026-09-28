import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import App from '../src/App.vue'

describe('M0-a 冒烟:根组件挂载', () => {
  it('App 可挂载并渲染壳骨架默认视图(对话 tab 空态)', () => {
    const wrapper = mount(App)
    expect(wrapper.text()).toContain('对话')
    expect(wrapper.text()).toContain('开始第一段对话')
    wrapper.unmount()
  })
})
