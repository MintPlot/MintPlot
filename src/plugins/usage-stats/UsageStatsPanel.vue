<script setup lang="ts">
// 用量统计视图 — ported from the decoupling-line organ's UsageStatsPanel
// (baseline 81ef0b8), restyled to MP mint tokens. State comes straight from
// the plugin service singleton; formatters come from @contracts.
import { computed } from 'vue'
import { formatTokenAggregate, formatTokenCount, formatTokenUsageTime } from '@contracts'
import { getUsageStatsService } from './service-instance'
import type { TokenUsageRecord } from './service'

const service = computed(() => getUsageStatsService())

/** Card name / conversation title carried by the record, if any. */
const attributionLabel = (record: TokenUsageRecord): string =>
  [record.characterName, record.detail].filter(Boolean).join(' · ')
</script>

<template>
  <section
    v-if="service"
    class="flex h-full flex-col"
  >
    <header class="shrink-0 border-b border-line px-4 py-3">
      <div class="flex items-center justify-between py-3">
        <h1 class="text-lg">
          用量统计
        </h1>
        <button
          v-if="service.tokenUsageHistory.value.length > 0"
          type="button"
          class="min-h-[44px] rounded-input border border-line bg-card p-2.5 text-danger transition-colors hover:bg-danger-wash"
          title="清空记录"
          aria-label="清空 Token 用量记录"
          @click="service.clearTokenUsageHistory()"
        >
          <svg
            class="h-5 w-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
            />
          </svg>
        </button>
      </div>
    </header>

    <div class="min-h-0 flex-1 overflow-y-auto px-4 py-4">
      <div class="mx-auto flex max-w-xl flex-col">
        <div class="mb-4 flex items-center gap-2">
          <div class="flex min-w-0 flex-1 rounded-input border border-line bg-card p-1">
            <button
              v-for="category in ['all', 'chat', 'memory', 'variables']"
              :key="category"
              type="button"
              class="min-h-[36px] flex-1 rounded-input text-xs transition-colors"
              :class="service.tokenUsageFilter.value === category
                ? 'bg-primary text-on-primary'
                : 'text-ink-3'"
              @click="service.tokenUsageFilter.value = category"
            >
              {{ { all: '全部', chat: '对话', memory: '记忆系统', variables: '变量分析' }[category] }}
            </button>
          </div>
          <div class="relative flex-none">
            <button
              type="button"
              class="flex h-10 w-10 items-center justify-center rounded-input border shadow-sm transition-colors"
              :class="service.tokenUsageTimeFilter.value === 'all'
                ? 'border-line bg-card text-ink-3'
                : 'border-primary bg-accent-wash text-primary'"
              :title="'时间范围：' + service.tokenUsageTimeFilterLabel.value"
              :aria-expanded="service.showTokenUsageTimeFilter.value"
              @click="service.showTokenUsageTimeFilter.value = !service.showTokenUsageTimeFilter.value"
            >
              <svg
                class="h-4 w-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M4 5h16l-6 7v5l-4 2v-7L4 5z"
                />
              </svg>
            </button>
            <div
              v-if="service.showTokenUsageTimeFilter.value"
              class="absolute right-0 top-full z-30 mt-2 w-36 rounded-card border border-line bg-card p-1.5 shadow-md"
            >
              <button
                v-for="option in service.tokenUsageTimeFilterOptions"
                :key="option.value"
                type="button"
                class="flex w-full items-center justify-between rounded-input px-3 py-2 text-sm transition-colors"
                :class="service.tokenUsageTimeFilter.value === option.value
                  ? 'bg-accent-wash text-primary'
                  : 'text-ink-2'"
                @click="service.tokenUsageTimeFilter.value = option.value; service.showTokenUsageTimeFilter.value = false"
              >
                <span>{{ option.label }}</span>
                <svg
                  v-if="service.tokenUsageTimeFilter.value === option.value"
                  class="h-4 w-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              </button>
            </div>
          </div>
        </div>

        <div class="mb-6 flex items-center gap-5 rounded-card border border-line bg-card px-3.5 py-2.5">
          <span class="flex items-baseline gap-1.5">
            <span class="flex items-center gap-1.5 text-[11px] font-medium text-ink-3">
              <span class="h-1.5 w-1.5 rounded-full bg-primary" />
              输入
            </span>
            <span class="font-mono text-sm font-bold leading-none text-ink">{{ formatTokenAggregate(service.tokenUsageStats.value.inputTokens, service.tokenUsageStats.value.inputTokensReports) }}</span>
            <span
              v-if="service.tokenUsageStats.value.cacheReadTokens > 0"
              class="font-mono text-xs leading-none text-ink-3"
            >{{ formatTokenAggregate(service.tokenUsageStats.value.cacheReadTokens, service.tokenUsageStats.value.cacheReadTokensReports) }}</span>
          </span>
          <span class="flex items-baseline gap-1.5">
            <span class="flex items-center gap-1.5 text-[11px] font-medium text-ink-3">
              <span class="h-1.5 w-1.5 rounded-full bg-primary" />
              输出
            </span>
            <span class="font-mono text-sm font-bold leading-none text-ink">{{ formatTokenAggregate(service.tokenUsageStats.value.outputTokens, service.tokenUsageStats.value.outputTokensReports) }}</span>
          </span>
        </div>

        <div class="mb-3 flex items-center justify-between">
          <h3 class="text-sm font-bold text-ink-2">
            请求日志
          </h3>
          <span class="text-[11px] text-ink-3">共 {{ service.filteredTokenUsageHistory.value.length }} 条</span>
        </div>

        <div
          v-if="service.displayedTokenUsageHistory.value.length > 0"
          class="flex flex-col gap-3"
        >
          <article
            v-for="record in service.displayedTokenUsageHistory.value"
            :key="record.id"
            class="rounded-card border border-line bg-card px-3.5 py-2.5"
          >
            <div class="flex min-w-0 items-center gap-2">
              <span class="flex flex-shrink-0 items-center gap-1.5 text-xs font-semibold text-ink-2">
                <span class="h-1.5 w-1.5 rounded-full bg-primary" />
                {{ service.getTokenUsageTypeLabel(record.type) }}
              </span>
              <span class="min-w-0 flex-1 truncate text-xs text-ink-2">
                {{ attributionLabel(record) }}
              </span>
              <time class="flex-shrink-0 text-[11px] text-ink-3">{{ formatTokenUsageTime(record.timestamp) }}</time>
            </div>
            <div class="mt-1.5 flex min-w-0 items-center gap-3">
              <span class="flex-shrink-0 font-mono text-xs text-ink">
                <span class="mr-1 font-sans text-[11px] text-ink-3">输入</span>{{ formatTokenCount(record.inputTokens) }}
              </span>
              <span class="flex-shrink-0 font-mono text-xs text-ink">
                <span class="mr-1 font-sans text-[11px] text-ink-3">输出</span>{{ formatTokenCount(record.outputTokens) }}
              </span>
              <span
                v-if="(record.cacheReadTokens ?? 0) > 0"
                class="flex-shrink-0 font-mono text-xs text-ink-3"
              >
                <span class="mr-1 font-sans text-[11px]">缓存</span>{{ formatTokenCount(record.cacheReadTokens) }}
              </span>
              <span
                class="min-w-0 flex-1 truncate text-right text-[11px] text-ink-3"
                :title="record.model"
              >{{ record.model || '未知模型' }}</span>
            </div>
          </article>

          <nav
            v-if="service.tokenUsagePageCount.value > 1"
            class="flex items-center justify-center gap-2 pt-1"
            aria-label="Token 记录分页"
          >
            <button
              type="button"
              class="min-h-[44px] rounded-input border border-line bg-card px-3 text-xs text-ink-2 disabled:opacity-40"
              :disabled="service.tokenUsagePage.value === 1"
              @click="service.tokenUsagePage.value--"
            >
              上一页
            </button>
            <span class="min-w-[58px] text-center font-mono text-xs text-ink-3">{{ service.tokenUsagePage.value }} / {{ service.tokenUsagePageCount.value }}</span>
            <button
              type="button"
              class="min-h-[44px] rounded-input border border-line bg-card px-3 text-xs text-ink-2 disabled:opacity-40"
              :disabled="service.tokenUsagePage.value === service.tokenUsagePageCount.value"
              @click="service.tokenUsagePage.value++"
            >
              下一页
            </button>
          </nav>
        </div>

        <div
          v-else
          class="rounded-card border border-dashed border-line bg-bg py-12 text-center"
        >
          <p class="text-sm font-medium text-ink-2">
            {{ service.tokenUsageHistory.value.length > 0 ? '当前分类还没有记录' : '还没有 Token 用量记录' }}
          </p>
          <p class="mt-1 text-xs text-ink-3">
            {{ service.tokenUsageHistory.value.length > 0 ? '可以切换其他分类查看' : '完成一次 API 请求后会显示在这里' }}
          </p>
        </div>
      </div>
    </div>
  </section>
  <p
    v-else
    class="px-4 py-6 text-center text-xs text-ink-3"
  >
    用量统计服务未激活
  </p>
</template>
