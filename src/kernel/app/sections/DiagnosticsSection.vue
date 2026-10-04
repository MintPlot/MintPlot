<script setup lang="ts">
// 诊断分区(M3-err2):错误枢纽的排查面 —— 记录概览、最近条目、摘要复制、
// 全量导出(复制/文件)、清空。数据只存设备本地,导出纯手动(plan §7.3)。
import { computed, onUnmounted, ref } from 'vue'
import { errorHub } from '@/kernel/diagnostics/error-hub'
import type { DiagnosticRecord } from '@/kernel/diagnostics/error-hub'
import { errorCodeLabel } from '@/kernel/diagnostics/error-codes'
import { installRequestDiagnostics } from '@/kernel/diagnostics/request-diagnostics'
import { uiService } from '@/kernel/ui/toasts'
import { copyText as copyToClipboard } from '@/kernel/app/ui/clipboard'

// The seam API is idempotent: same window instance, same backing hub.
const journal = installRequestDiagnostics(errorHub)

// Reactivity: hub.onChange drives a local revision counter (the ring itself
// is plain state, not a Vue ref).
const revision = ref(0)
let unsubscribe: (() => void) | null = null
unsubscribe = errorHub.onChange(() => {
  revision.value += 1
})
onUnmounted(() => unsubscribe?.())

const records = computed<readonly DiagnosticRecord[]>(() => {
  void revision.value
  return errorHub.all()
})

const severityCounts = computed(() => {
  void revision.value
  const counts = { fatal: 0, error: 0, warn: 0, info: 0 }
  for (const record of errorHub.all()) counts[record.severity] += 1
  return counts
})

// Newest first, capped — the journal itself stays bounded at 100.
const visible = computed(() => [...records.value].reverse().slice(0, 12))

const severityClass = (severity: DiagnosticRecord['severity']): string =>
  ({
    fatal: 'bg-danger',
    error: 'bg-danger/70',
    warn: 'bg-amber-500',
    info: 'bg-ink-3',
  })[severity]

const formatTime = (ts: number): string => {
  const date = new Date(ts)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

async function copyText(text: string, label: string): Promise<void> {
  const succeeded = await copyToClipboard(text)
  uiService.toast('shell', succeeded ? `已复制${label}` : `复制失败:${label}不可用`, {
    tone: succeeded ? 'success' : 'error',
  })
}

const copySummary = (): void => {
  void copyText(journal.buildShortSummary(), '诊断摘要')
}

const copyExport = (): void => {
  void copyText(JSON.stringify(journal.buildExportPayload(), null, 2), '诊断日志')
}

function downloadExport(): void {
  if (typeof URL?.createObjectURL !== 'function') {
    uiService.toast('shell', '当前环境不支持文件下载,请用「复制日志」', { tone: 'error' })
    return
  }
  const payload = JSON.stringify(journal.buildExportPayload(), null, 2)
  const blob = new Blob([payload], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `mintplot-diagnostics-${new Date().toISOString().slice(0, 19).replaceAll(':', '-')}.json`
  anchor.click()
  URL.revokeObjectURL(url)
}

async function clearJournal(): Promise<void> {
  const confirmed = await uiService.confirm('shell', {
    title: '清空诊断日志',
    message: '清空全部错误记录?清空后无法恢复。',
    confirmLabel: '清空',
  })
  if (!confirmed) return
  errorHub.clear()
  uiService.toast('shell', '诊断日志已清空', { tone: 'success' })
}
</script>

<template>
  <div class="px-4 py-3">
    <p class="text-xs text-ink-3">
      错误只存本机,不会自动上传;出问题时可把「诊断摘要」复制后反馈。
    </p>

    <div class="mt-2 flex items-center gap-3 text-xs text-ink-2">
      <span>共 {{ records.length }} 条</span>
      <span
        v-if="severityCounts.fatal > 0"
        class="text-danger"
      >致命 {{ severityCounts.fatal }}</span>
      <span
        v-if="severityCounts.error > 0"
        class="text-danger/80"
      >错误 {{ severityCounts.error }}</span>
      <span
        v-if="severityCounts.warn > 0"
      >警告 {{ severityCounts.warn }}</span>
    </div>

    <ul
      v-if="visible.length > 0"
      class="mt-2 flex flex-col gap-1.5"
    >
      <li
        v-for="record in visible"
        :key="record.id"
        class="flex items-start gap-2 rounded-input bg-bg px-2 py-1.5 text-xs"
      >
        <span
          class="mt-1 h-2 w-2 flex-shrink-0 rounded-full"
          :class="severityClass(record.severity)"
        />
        <span class="min-w-0 flex-1">
          <span class="block break-words text-ink-2">{{ record.message }}</span>
          <span class="mt-0.5 block font-mono text-[10px] text-ink-3">
            {{ formatTime(record.ts) }} · {{ record.code ?? '--' }} · {{ errorCodeLabel(record.code) || `${record.category}/${record.action}` }}
          </span>
        </span>
      </li>
    </ul>
    <p
      v-else
      class="mt-2 text-xs text-ink-3"
    >
      暂无错误记录
    </p>

    <div class="mt-3 flex flex-wrap gap-2">
      <button
        type="button"
        class="min-h-[36px] rounded-input border border-line-strong bg-card px-3 text-xs text-ink-2"
        @click="copySummary"
      >
        复制摘要
      </button>
      <button
        type="button"
        class="min-h-[36px] rounded-input border border-line-strong bg-card px-3 text-xs text-ink-2"
        @click="copyExport"
      >
        复制日志
      </button>
      <button
        type="button"
        class="min-h-[36px] rounded-input border border-line-strong bg-card px-3 text-xs text-ink-2"
        @click="downloadExport"
      >
        下载文件
      </button>
      <button
        type="button"
        class="min-h-[36px] rounded-input border border-line-strong bg-card px-3 text-xs text-danger"
        :disabled="records.length === 0"
        @click="clearJournal"
      >
        清空
      </button>
    </div>
  </div>
</template>
