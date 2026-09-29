/**
 * usage-stats service — ported from the decoupling line organ
 * (D:\AI\MintPlot\app src/plugins/usage-stats, baseline main 81ef0b8,
 * originally extracted from RP app.mjs). Typed port; MP adaptations per
 * ADR-004:
 *  - shared formatters come from the @contracts barrel (token-format);
 *  - ui.confirm takes an options object; ui.toast takes {tone};
 *  - the shell projection (toggleMobileMenu) is NOT absorbed — MP's
 *    four-tab shell has no mobile menu, the header menu button is dropped;
 *  - record type via session projection (card-domain stub returns '').
 */

import { computed, ref, watch } from 'vue'
import type { ComputedRef, Ref } from 'vue'
import type { PluginContext } from '@contracts'
import { formatLatestTokenCount, getTokenUsageCategory, normalizeApiUsage, readUsageNumber } from '@contracts'
import type { NormalizedApiUsage } from '@contracts'

const HISTORY_KEY = 'token_usage_history'
const LIST_PAGE_SIZE = 10

export interface TokenUsageRecord extends NormalizedApiUsage {
  id: string
  timestamp: number
  type: string
  model: string
  detail: string
  characterName: string
}

export interface TokenUsageStats {
  inputTokens: number
  inputTokensReports: number
  outputTokens: number
  outputTokensReports: number
  cacheReadTokens: number
  cacheReadTokensReports: number
}

export interface UsageStatsService {
  readonly tokenUsageHistory: Ref<TokenUsageRecord[]>
  readonly tokenUsagePage: Ref<number>
  readonly tokenUsagePageCount: ComputedRef<number>
  readonly tokenUsageFilter: Ref<string>
  readonly tokenUsageTimeFilter: Ref<string>
  readonly showTokenUsageTimeFilter: Ref<boolean>
  readonly tokenUsageTimeFilterOptions: readonly { value: string; label: string }[]
  readonly tokenUsageTimeFilterLabel: ComputedRef<string>
  readonly filteredTokenUsageHistory: ComputedRef<TokenUsageRecord[]>
  readonly tokenUsageStats: ComputedRef<TokenUsageStats>
  readonly displayedTokenUsageHistory: ComputedRef<TokenUsageRecord[]>
  readonly settingsHelpTopic: Ref<string>
  readonly latestMainTokenUsage: ComputedRef<TokenUsageRecord | null>
  readonly latestMainTokenCountLabel: ComputedRef<string>
  recordApiUsage(usage: unknown, meta?: Record<string, string>): void
  getTokenUsageTypeLabel(type: string): string
  clearTokenUsageHistory(): void
}

export function createUsageStatsService(ctx: PluginContext): UsageStatsService {
  // --- Ledger and display state (ported from RP app.mjs / useUiState) ---
  const tokenUsageHistory = ref<TokenUsageRecord[]>([])
  const tokenUsagePage = ref(1)
  const tokenUsageFilter = ref('all')
  const tokenUsageTimeFilter = ref('all')
  const showTokenUsageTimeFilter = ref(false)
  const settingsHelpTopic = ref('')
  const tokenUsageTimeFilterOptions = [
    { value: 'all', label: '全部' },
    { value: '24h', label: '24小时' },
    { value: '7d', label: '7天' },
    { value: '30d', label: '30天' },
  ] as const
  const tokenUsageTimeFilterLabel = computed(
    () => tokenUsageTimeFilterOptions.find((option) => option.value === tokenUsageTimeFilter.value)?.label ?? '全部',
  )

  // Startup hydration: the plugin-namespaced key.
  void ctx.storage.get<TokenUsageRecord[]>(HISTORY_KEY).then((saved) => {
    if (Array.isArray(saved)) tokenUsageHistory.value = saved
  }).catch((error) => console.error('[usage-stats] history load failed:', error))

  let saveQueue = Promise.resolve()
  const saveTokenUsageHistoryNow = (): Promise<void> => {
    const snapshot = JSON.parse(JSON.stringify(tokenUsageHistory.value)) as TokenUsageRecord[]
    const task = async () => {
      await ctx.storage.set(HISTORY_KEY, snapshot)
    }
    saveQueue = saveQueue.then(task, task)
    return saveQueue
  }

  const recordApiUsage = (usage: unknown, meta: Record<string, string> = {}): void => {
    const normalized = normalizeApiUsage(usage)
    tokenUsageHistory.value.unshift({
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      type: meta.type || 'chat',
      model: String(meta.model || ''),
      detail: String(meta.detail || ''),
      characterName: ctx.session.getCharacterName(),
      ...normalized,
    })
    saveTokenUsageHistoryNow().catch((error) => console.error('[usage-stats] history save failed:', error))
  }

  // --- Filter / aggregate / pagination ---
  const tokenUsageTimeRanges: Record<string, number> = {
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000,
  }
  const filteredTokenUsageHistory = computed(() => {
    const timeRange = tokenUsageTimeRanges[tokenUsageTimeFilter.value]
    const cutoff = timeRange ? Date.now() - timeRange : 0
    return tokenUsageHistory.value.filter((record) => {
      const matchesType = tokenUsageFilter.value === 'all'
        || getTokenUsageCategory(record.type) === tokenUsageFilter.value
      if (!matchesType || !timeRange) return matchesType
      const timestamp = Number(record.timestamp)
      return Number.isFinite(timestamp) && timestamp >= cutoff
    })
  })
  const tokenUsageStats = computed<TokenUsageStats>(() =>
    filteredTokenUsageHistory.value.reduce(
      (stats, record) => {
        for (const key of ['inputTokens', 'outputTokens', 'cacheReadTokens'] as const) {
          if (!Number.isFinite(record[key])) continue
          stats[key] += record[key] ?? 0
          stats[`${key}Reports`]++
        }
        return stats
      },
      {
        inputTokens: 0,
        inputTokensReports: 0,
        outputTokens: 0,
        outputTokensReports: 0,
        cacheReadTokens: 0,
        cacheReadTokensReports: 0,
      },
    ),
  )
  const tokenUsagePageCount = computed(() => Math.max(1, Math.ceil(filteredTokenUsageHistory.value.length / LIST_PAGE_SIZE)))
  const displayedTokenUsageHistory = computed(() => {
    const start = (tokenUsagePage.value - 1) * LIST_PAGE_SIZE
    return filteredTokenUsageHistory.value.slice(start, start + LIST_PAGE_SIZE)
  })
  watch([tokenUsageFilter, tokenUsageTimeFilter], () => {
    tokenUsagePage.value = 1
  })
  watch(tokenUsagePageCount, (pageCount) => {
    tokenUsagePage.value = Math.min(tokenUsagePage.value, pageCount)
  })

  const getTokenUsageTypeLabel = (type: string): string => ({
    chat: '主对话',
    memory: '记忆系统',
    variables: '变量分析',
  })[getTokenUsageCategory(type)] ?? '主对话'

  // Inline control panel "latest usage" bar: the most recent main-chat
  // request (tool continuations, summary/embedding/ui-template excluded).
  const latestMainTokenUsage = computed(() =>
    tokenUsageHistory.value.find((entry) => entry.type === 'chat') ?? null,
  )
  const latestMainTokenCountLabel = computed(() =>
    formatLatestTokenCount(readUsageNumber(latestMainTokenUsage.value?.totalTokens) ?? 0),
  )

  const clearTokenUsageHistory = (): void => {
    void ctx.ui.confirm({
      title: '清空确认',
      message: '确定要清空全部 Token 用量记录吗？此操作无法撤销。',
    }).then((confirmed) => {
      if (!confirmed) return
      tokenUsageHistory.value = []
      tokenUsagePage.value = 1
      void saveTokenUsageHistoryNow()
      ctx.ui.toast('Token 用量记录已清空', { tone: 'success' })
    })
  }

  return {
    tokenUsageHistory,
    tokenUsagePage,
    tokenUsagePageCount,
    tokenUsageFilter,
    tokenUsageTimeFilter,
    showTokenUsageTimeFilter,
    tokenUsageTimeFilterOptions,
    tokenUsageTimeFilterLabel,
    filteredTokenUsageHistory,
    tokenUsageStats,
    displayedTokenUsageHistory,
    settingsHelpTopic,
    latestMainTokenUsage,
    latestMainTokenCountLabel,
    recordApiUsage,
    getTokenUsageTypeLabel,
    clearTokenUsageHistory,
  }
}
