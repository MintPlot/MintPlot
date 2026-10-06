import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import DataBackupSection from '@/kernel/app/sections/DataBackupSection.vue'
import { setBackupServiceInstance } from '@/kernel/dataio/backup-service-instance'
import type { BackupService } from '@/kernel/dataio/backup-service'
import { createBackupEnvelope } from '@/kernel/dataio/backup-envelope'
import { uiService } from '@/kernel/ui/toasts'

const toastSpy = vi.fn()
const confirmSpy = vi.fn()

beforeEach(() => {
  toastSpy.mockClear()
  confirmSpy.mockReset()
  vi.spyOn(uiService, 'toast').mockImplementation(toastSpy as never)
  vi.spyOn(uiService, 'confirm').mockImplementation(confirmSpy as never)
  setBackupServiceInstance(null)
})

afterEach(() => {
  vi.restoreAllMocks()
  setBackupServiceInstance(null)
})

type ServiceOverrides = { [K in keyof BackupService]?: BackupService[K] }

const makeService = (overrides: ServiceOverrides = {}): BackupService & { calls: string[] } => {
  const calls: string[] = []
  const base: BackupService & { calls: string[] } = {
    calls,
    async exportBackup() {
      calls.push('export')
      return true
    },
    async readBackupFile() {
      calls.push('read')
      return createBackupEnvelope({ 'chat:card:x': '[]' }, {}, '1.0.0')
    },
    async restoreBackup() {
      calls.push('restore')
      await Promise.resolve()
    },
    describeBackup(envelope) {
      return `${Object.keys(envelope.kv).length} 项`
    },
  }
  return Object.assign(base, overrides)
}

describe('M4-g1 · 设置页数据与备份分区', () => {
  it('导出与恢复两个动作上屏并走 service,取消选择器静默', async () => {
    const service = makeService({
      async exportBackup() {
      service.calls.push('export')
      return false
    },
    async readBackupFile() {
      service.calls.push('read')
      throw Object.assign(new Error('cancelled'), { cancelled: true })
    },
    })
    setBackupServiceInstance(service)
    const wrapper = mount(DataBackupSection)

    const buttons = wrapper.findAll('button')
    expect(buttons.map((button) => button.text())).toEqual(['导出备份导出全部数据', '恢复备份从备份文件替换'])

    await buttons[0]!.trigger('click')
    await flushPromises()
    expect(service.calls).toEqual(['export'])
    expect(toastSpy).not.toHaveBeenCalled() // picker cancel stays silent

    await buttons[1]!.trigger('click')
    await flushPromises()
    expect(service.calls).toEqual(['export', 'read'])
    expect(confirmSpy).not.toHaveBeenCalled() // read-cancelled before the modal
  })

  it('恢复走确认模态,确认后替换;坏文件报错不弹模态', async () => {
    const service = makeService()
    setBackupServiceInstance(service)
    const wrapper = mount(DataBackupSection)
    confirmSpy.mockResolvedValue(true)

    await wrapper.findAll('button')[1]!.trigger('click')
    await flushPromises()
    expect(confirmSpy).toHaveBeenCalledTimes(1)
    expect(confirmSpy.mock.calls[0]![1]).toMatchObject({ title: '恢复备份', confirmLabel: '立即恢复' })
    expect(String(confirmSpy.mock.calls[0]![1]?.message)).toContain('1 项')
    expect(service.calls).toEqual(['read', 'restore'])

    // Malformed file: the service throws BackupEnvelopeError → toast, no modal.
    const badService = makeService({
      async readBackupFile() {
        throw new (await import('@/kernel/dataio/backup-envelope')).BackupEnvelopeError('不是 MintPlot 备份文件')
      },
    })
    setBackupServiceInstance(badService)
    await wrapper.findAll('button')[1]!.trigger('click')
    await flushPromises()
    expect(confirmSpy).toHaveBeenCalledTimes(1) // unchanged
    expect(toastSpy.mock.calls[0]).toEqual(['shell', '不是 MintPlot 备份文件', expect.objectContaining({ tone: 'error' })])
  })

  it('无 service(未接线)时动作不动', async () => {
    setBackupServiceInstance(null)
    const wrapper = mount(DataBackupSection)
    await wrapper.findAll('button')[0]!.trigger('click')
    await flushPromises()
    expect(toastSpy).not.toHaveBeenCalled()
    expect(confirmSpy).not.toHaveBeenCalled()
  })
})
