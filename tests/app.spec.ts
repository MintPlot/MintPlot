import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import App from '../src/App.vue'

describe('M0-a 冒烟:根组件挂载', () => {
  it('App 可挂载并渲染品牌名', () => {
    const wrapper = mount(App)
    expect(wrapper.text()).toContain('MintPlot')
    wrapper.unmount()
  })
})
