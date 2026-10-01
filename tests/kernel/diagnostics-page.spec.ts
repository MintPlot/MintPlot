import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import DiagnosticsSection from '@/kernel/app/sections/DiagnosticsSection.vue'
import { errorHub } from '@/kernel/diagnostics/error-hub'

const clipboardWrite = vi.fn().mockResolvedValue(undefined)

beforeEach(() => {
  errorHub.clear()
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: clipboardWrite }, configurable: true })
  clipboardWrite.mockClear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('M3-err2 · 设置页诊断分区', () => {
  it('概览计数与最近条目上屏,致命/错误计数显红', async () => {
    errorHub.record({ severity: 'fatal', category: 'storage', action: 'idb_degraded', code: 'MP-STORE-001', message: '存储降级了' })
    errorHub.record({ severity: 'error', category: 'chat', action: 'request_failed', code: 'MP-NET-002', message: 'HTTP 500' })
    errorHub.record({ severity: 'info', category: 'tts', action: 'system_speak', message: 'tts/系统朗读' })

    const wrapper = mount(DiagnosticsSection)
    await flushPromises()

    expect(wrapper.text()).toContain('共 3 条')
    expect(wrapper.text()).toContain('致命 1')
    expect(wrapper.text()).toContain('错误 1')
    expect(wrapper.text()).toContain('存储降级了')
    expect(wrapper.text()).toContain('MP-STORE-001')
    expect(wrapper.text()).toContain('IndexedDB 不可用')
    // Newest first.
    const messages = wrapper.findAll('li span span').map((node) => node.text())
    expect(messages[0]).toContain('tts/系统朗读')
  })

  it('复制摘要 / 复制日志走剪贴板,失败有 toast 兜底', async () => {
    errorHub.record({ severity: 'error', category: 'chat', action: 'request_failed', code: 'MP-NET-002', message: 'HTTP 500' })
    const wrapper = mount(DiagnosticsSection)
    await flushPromises()

    const summaryButton = wrapper.findAll('button').find((button) => button.text() === '复制摘要')!
    await summaryButton.trigger('click')
    await flushPromises()
    expect(clipboardWrite).toHaveBeenLastCalledWith(expect.stringContaining('MP 诊断摘要'))

    const exportButton = wrapper.findAll('button').find((button) => button.text() === '复制日志')!
    await exportButton.trigger('click')
    await flushPromises()
    const payload = JSON.parse(clipboardWrite.mock.lastCall![0] as string)
    expect(payload.schema).toBe('mp-error-journal/1')
    expect(payload.count).toBe(1)
    expect(payload.records[0]).toMatchObject({ code: 'MP-NET-002', message: 'HTTP 500' })

    // Clipboard unavailable → error toast, no throw.
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    await summaryButton.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('复制失败')
  })

  it('清空需确认:确认后环与视图同空,取消不动', async () => {
    errorHub.record({ severity: 'warn', category: 'runtime', action: 'x', message: '待清理' })
    const wrapper = mount(DiagnosticsSection)
    await flushPromises()
    const clearButton = wrapper.findAll('button').find((button) => button.text() === '清空')!

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await clearButton.trigger('click')
    await flushPromises()
    expect(errorHub.all()).toHaveLength(1)

    confirmSpy.mockReturnValue(true)
    await clearButton.trigger('click')
    await flushPromises()
    expect(errorHub.all()).toHaveLength(0)
    expect(wrapper.text()).toContain('暂无错误记录')
  })
})
