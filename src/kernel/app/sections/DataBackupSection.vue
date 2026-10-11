<script setup lang="ts">
// 数据与备份分区(M4-g1 plan D4 / M4-g2):MP 自有全量导出 / 恢复(全量
// 替换 + reload)+ 统一导入面板(RP 备份 / 酒馆备份 / 散装资产)。秘密通道
// 键不随备份走(AndroidKeyStore 绑设备,同 RP apiKey 不入备份的推理);
// 诊断日志易逝不导出(plan D5)。恢复覆盖范围在确认模态里列明。
import { ref } from 'vue'
import { getBackupServiceInstance } from '@/kernel/dataio/backup-service-instance'
import { BackupEnvelopeError } from '@/kernel/dataio/backup-envelope'
import { uiService } from '@/kernel/ui/toasts'
import ImportPanel from '@/kernel/app/sections/ImportPanel.vue'

const busy = ref(false)

const exportBackup = async (): Promise<void> => {
  const service = getBackupServiceInstance()
  if (!service || busy.value) return
  busy.value = true
  try {
    const saved = await service.exportBackup()
    if (saved) uiService.toast('shell', '备份已保存', { tone: 'success' })
    // cancelled (picker dismissed) stays silent — RP same UX.
  } catch (error) {
    uiService.toast('shell', `备份失败:${(error as Error)?.message || '未知错误'}`, { tone: 'error', durationMs: 5000 })
  } finally {
    busy.value = false
  }
}

const restoreBackup = async (): Promise<void> => {
  const service = getBackupServiceInstance()
  if (!service || busy.value) return
  busy.value = true
  let summary: string
  let envelope: Awaited<ReturnType<typeof service.readBackupFile>>
  try {
    envelope = await service.readBackupFile()
    summary = service.describeBackup(envelope)
  } catch (error) {
    if ((error as { cancelled?: boolean })?.cancelled) {
      busy.value = false
      return
    }
    const message = error instanceof BackupEnvelopeError ? error.message : `读取备份失败:${(error as Error)?.message || '未知错误'}`
    uiService.toast('shell', message, { tone: 'error', durationMs: 5000 })
    busy.value = false
    return
  }
  const confirmed = await uiService.confirm('shell', {
    title: '恢复备份',
    message: `将用备份(${summary})替换当前全部数据:两域会话、角色卡、插件数据与设置。API 密钥不随备份走,不受影响。此操作不可撤销。`,
    confirmLabel: '立即恢复',
    cancelLabel: '取消恢复',
  })
  if (!confirmed) {
    busy.value = false
    return
  }
  try {
    // Replaces everything, then reloads — control never returns.
    await service.restoreBackup(envelope)
    busy.value = false
  } catch (error) {
    busy.value = false
    uiService.toast('shell', `恢复失败,当前数据未被替换:${(error as Error)?.message || '未知错误'}`, { tone: 'error', durationMs: 6000 })
  }
}
</script>

<template>
  <div class="space-y-2 p-3">
    <ImportPanel />
    <button
      type="button"
      class="flex w-full items-center justify-between rounded-input border border-line bg-card px-3 py-2.5 text-left text-sm text-ink transition-colors hover:bg-bg active:bg-bg"
      :disabled="busy"
      @click="exportBackup"
    >
      <span>导出备份</span>
      <span class="text-xs text-ink-3">{{ busy ? '处理中…' : '导出全部数据' }}</span>
    </button>
    <button
      type="button"
      class="flex w-full items-center justify-between rounded-input border border-line bg-card px-3 py-2.5 text-left text-sm text-ink transition-colors hover:bg-bg active:bg-bg"
      :disabled="busy"
      @click="restoreBackup"
    >
      <span>恢复备份</span>
      <span class="text-xs text-ink-3">{{ busy ? '处理中…' : '从备份文件替换' }}</span>
    </button>
  </div>
</template>
