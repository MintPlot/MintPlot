<script setup lang="ts">
// 变量分析设置(M3-t) — 副模型分析管线的用户面:主/副模型模式、分析模型、
// 对话层数(4–10)、输出上限、批量/JSON/上下文注入。设置走 mp_settings 普通
// 键(非秘密);主模型模式为默认,副模型模式每轮分析并在请求侧注入状态快照。
import { inject, onMounted, ref } from 'vue'
import { SETTINGS_STATE_KEY } from '@/kernel/app/chat-keys'
import type { SettingsState } from '@/kernel/settings/settings-state'

const settingsState = inject<SettingsState | null>(SETTINGS_STATE_KEY, null)

const mainModelAnalysis = ref(true)
const analysisModel = ref('')
const analysisDepth = ref(4)
const maxOutputTokens = ref(4096)
const batchMode = ref(true)
const jsonMode = ref(true)
const injectContext = ref(false)

onMounted(() => {
  if (!settingsState) return
  const scope = settingsState.scope([
    'uiTemplateMainModelAnalysis',
    'uiTemplateModel',
    'uiTemplateAnalysisDepth',
    'uiTemplateMaxOutputTokens',
    'uiTemplateBatchMode',
    'uiTemplateJsonMode',
    'uiTemplateInjectContext',
  ])
  mainModelAnalysis.value = scope.uiTemplateMainModelAnalysis !== false
  analysisModel.value = String(scope.uiTemplateModel ?? '')
  analysisDepth.value = Number(scope.uiTemplateAnalysisDepth ?? 4) || 4
  maxOutputTokens.value = Number(scope.uiTemplateMaxOutputTokens ?? 4096) || 4096
  batchMode.value = scope.uiTemplateBatchMode !== false
  jsonMode.value = scope.uiTemplateJsonMode !== false
  injectContext.value = scope.uiTemplateInjectContext === true
})

const persist = (): void => {
  if (!settingsState) return
  const scope = settingsState.scope([
    'uiTemplateMainModelAnalysis',
    'uiTemplateModel',
    'uiTemplateAnalysisDepth',
    'uiTemplateMaxOutputTokens',
    'uiTemplateBatchMode',
    'uiTemplateJsonMode',
    'uiTemplateInjectContext',
  ])
  scope.uiTemplateMainModelAnalysis = mainModelAnalysis.value
  scope.uiTemplateModel = analysisModel.value.trim()
  scope.uiTemplateAnalysisDepth = analysisDepth.value
  scope.uiTemplateMaxOutputTokens = maxOutputTokens.value
  scope.uiTemplateBatchMode = batchMode.value
  scope.uiTemplateJsonMode = jsonMode.value
  scope.uiTemplateInjectContext = injectContext.value
}
</script>

<template>
  <div
    v-if="settingsState"
    class="flex flex-col gap-3 px-4 py-4"
    @change="persist"
  >
    <div>
      <div class="mb-1 text-xs font-medium text-ink-3">
        变量分析模式
      </div>
      <div class="flex overflow-hidden rounded-input border border-line">
        <button
          type="button"
          class="flex-1 py-1.5 text-xs"
          :class="mainModelAnalysis ? 'bg-primary font-bold text-on-primary' : 'bg-card text-ink-2'"
          @click="mainModelAnalysis = true"
        >
          主模型
        </button>
        <button
          type="button"
          class="flex-1 py-1.5 text-xs"
          :class="!mainModelAnalysis ? 'bg-primary font-bold text-on-primary' : 'bg-card text-ink-2'"
          @click="mainModelAnalysis = false"
        >
          副模型
        </button>
      </div>
      <p class="mt-1 text-[10px] leading-relaxed text-ink-3">
        主模型：回复末尾隐藏变量块，漏块时自动改用副模型分析；副模型：每轮回复后用独立请求提取变量。
      </p>
    </div>

    <div>
      <label class="mb-1 block text-xs font-medium text-ink-3">分析模型（副模型）</label>
      <input
        v-model="analysisModel"
        placeholder="如 deepseek-chat / qwen3.5-0.8b，留空则不分析"
        class="w-full rounded-input border border-line bg-card px-2 py-1.5 text-sm text-ink outline-none focus:border-primary"
      >
    </div>

    <label class="block text-xs font-medium text-ink-3">
      分析对话层数：{{ analysisDepth }}
      <input
        v-model.number="analysisDepth"
        type="range"
        min="4"
        max="10"
        step="1"
        class="mt-1 w-full accent-primary"
      >
    </label>

    <label class="block text-xs font-medium text-ink-3">
      分析输出上限：{{ maxOutputTokens }}
      <input
        v-model.number="maxOutputTokens"
        type="range"
        min="1024"
        max="16384"
        step="256"
        class="mt-1 w-full accent-primary"
      >
    </label>

    <label class="flex items-center gap-2 text-xs text-ink-2">
      <input
        v-model="batchMode"
        type="checkbox"
        class="accent-primary"
      >
      合并分析请求（≤5 个模板一次请求）
    </label>
    <label class="flex items-center gap-2 text-xs text-ink-2">
      <input
        v-model="jsonMode"
        type="checkbox"
        class="accent-primary"
      >
      JSON 结构化输出
    </label>
    <label class="flex items-center gap-2 text-xs text-ink-2">
      <input
        v-model="injectContext"
        type="checkbox"
        class="accent-primary"
      >
      副模型模式下将变量注入上下文
    </label>
  </div>
</template>
