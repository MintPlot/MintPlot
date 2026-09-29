import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import App from '../src/App.vue'

describe('M0-d 壳骨架', () => {
  it('tab 栏 = 注册表投影:四 tab 可导航,对话 tab 落 chatbox 空态', async () => {
    const wrapper = mount(App)

    const tabButtons = wrapper.findAll('nav button')
    expect(tabButtons.map((button) => button.text())).toEqual(['对话', '角色', '工具', '设置'])

    // 默认落对话 tab = 纯 AI 对话域空态(spec v1.1 §02)
    expect(wrapper.text()).toContain('开始第一段对话')

    await tabButtons[1]!.trigger('click')
    expect(wrapper.text()).toContain('导入角色卡')

    await tabButtons[2]!.trigger('click')
    expect(wrapper.text()).toContain('插件')

    await tabButtons[3]!.trigger('click')
    // M3-f IA:设置页 = 用户设定 / API 连接与服务 / 通用设置(关于与更新随
    // update-checker 激活入驻,独立挂载下不在场)。
    const sectionTitles = wrapper.findAll('h2').map((title) => title.text())
    expect(sectionTitles).toEqual(['用户设定', 'API 连接与服务', '通用设置'])

    wrapper.unmount()
  })
})
