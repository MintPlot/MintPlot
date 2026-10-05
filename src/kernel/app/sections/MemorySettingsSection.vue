<script setup lang="ts">
// 记忆设置(M4-e) — 滚动摘要引擎的用户面:记忆模型槽(留空跟随聊天模型,
// visionModel 同款口径)、保留窗口(8–40 楼)、批量(4–24 轮)、输出上限。
// 设置走 mp_settings 普通键(非秘密);端点与密钥始终用当前激活档案。
import { inject, onMounted, ref } from 'vue'
import { SETTINGS_STATE_KEY } from '@/kernel/app/chat-keys'
import type { SettingsState } from '@/kernel/settings/settings-state'

const settingsState = inject<SettingsState | null>(SETTINGS_STATE_KEY, null)

const memoryModel = ref('')
const keepFloors = ref(16)
const batchSize = ref(8)
const maxOutputTokens = ref(1024)

const KEYS = ['memoryModel', 'memoryKeepFloors', 'memoryBatchSize', 'memoryMaxOutputTokens'] as const

onMounted(() => {
  if (!settingsState) return
  const scope = settingsState.scope([...KEYS])
  memoryModel.value = String(scope.memoryModel ?? '')
  keepFloors.value = Number(scope.memoryKeepFloors ?? 16) || 16
  batchSize.value = Number(scope.memoryBatchSize ?? 8) || 8
  maxOutputTokens.value = Number(scope.memoryMaxOutputTokens ?? 1024) || 1024
})

const persist = (): void => {
  if (!settingsState) return
  const scope = settingsState.scope([...KEYS])
  scope.memoryModel = memoryModel.value.trim()
  scope.memoryKeepFloors = keepFloors.value
  scope.memoryBatchSize = batchSize.value
  scope.memoryMaxOutputTokens = maxOutputTokens.value
}
</script>

<template>
  <div
    v-if="settingsState"
    class="flex flex-col gap-3 px-4 py-4"
    @change="persist"
  >
    <div>
      <label class="mb-1 block text-xs font-medium text-ink-3">记忆模型</label>
      <input
        v-model="memoryModel"
        placeholder="留空则跟随当前聊天模型"
        class="w-full rounded-input border border-line bg-card px-2 py-1.5 text-sm text-ink outline-none focus:border-primary"
      >
      <p class="mt-1 text-[10px] leading-relaxed text-ink-3">
        后台摘要请求用当前激活档案的端点与密钥；想让整理走别的模型就在这里填模型名。
      </p>
    </div>

    <label class="block text-xs font-medium text-ink-3">
      保留窗口：{{ keepFloors }} 楼（窗口外旧楼由记忆接管）
      <input
        v-model.number="keepFloors"
        type="range"
        min="8"
        max="40"
        step="2"
        class="mt-1 w-full accent-primary"
      >
    </label>

    <label class="block text-xs font-medium text-ink-3">
      每批整理：{{ batchSize }} 楼
      <input
        v-model.number="batchSize"
        type="range"
        min="4"
        max="24"
        step="1"
        class="mt-1 w-full accent-primary"
      >
    </label>

    <label class="block text-xs font-medium text-ink-3">
      整理输出上限：{{ maxOutputTokens }} tokens
      <input
        v-model.number="maxOutputTokens"
        type="range"
        min="256"
        max="8192"
        step="128"
        class="mt-1 w-full accent-primary"
      >
    </label>
  </div>
</template>
