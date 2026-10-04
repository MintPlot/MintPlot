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
    // M3-h IA:工具页两大折叠区(独立挂载下无插件运行时 → 展开插件区显示未接入)。
    expect(wrapper.text()).toContain('插件')
    expect(wrapper.text()).not.toContain('用量统计')
    await wrapper.findAll('button').find((button) => button.text().includes('插件'))!.trigger('click')
    expect(wrapper.text()).toContain('插件运行时未接入')

    await tabButtons[3]!.trigger('click')
    // M3-f IA:设置页 = 用户设定 / API 连接与服务 / 通用设置 / 诊断(M3-err2)
    // (变量分析/提示词预设 收进各自插件条目——用户拍板 M3-t/M3-w followup;
    // 关于与更新随 update-checker 激活入驻,独立挂载下不在场)。
    const sectionTitles = wrapper.findAll('h2').map((title) => title.text())
    expect(sectionTitles).toEqual(['用户设定', 'API 连接与服务', '通用设置', '诊断'])

    wrapper.unmount()
  })
})
