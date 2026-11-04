<script setup lang="ts">
// 文本输出形式(对话输出) — 回复的呈现方式设置:'stream' 打字机逐段发布
// (默认,现有行为) vs 'whole' 整段一次性发布。设置走 mp_settings 普通键
// (uiTextOutputMode);回合引擎每轮实时读取,切换即刻对下一条回复生效。
// 按钮 @click 里显式 persist —— button 不派发 change 事件,根节点
// @change 只能捕获 input 类控件。
import { inject, onMounted, ref } from 'vue'
import { SETTINGS_STATE_KEY } from '@/kernel/app/chat-keys'
import { TEXT_OUTPUT_MODE_KEY, type TextOutputMode } from '@/kernel/app/chat/output-mode'
import type { SettingsState } from '@/kernel/settings/settings-state'

const settingsState = inject<SettingsState | null>(SETTINGS_STATE_KEY, null)

const mode = ref<TextOutputMode>('stream')

onMounted(() => {
  if (!settingsState) return
  mode.value = readMode()
})

const readMode = (): TextOutputMode => {
  const scope = settingsState?.scope([TEXT_OUTPUT_MODE_KEY])
  return scope?.[TEXT_OUTPUT_MODE_KEY] === 'whole' ? 'whole' : 'stream'
}

const setMode = (next: TextOutputMode): void => {
  mode.value = next
  if (!settingsState) return
  const scope = settingsState.scope([TEXT_OUTPUT_MODE_KEY])
  scope[TEXT_OUTPUT_MODE_KEY] = next
}
</script>

<template>
  <div
    v-if="settingsState"
    class="flex flex-col gap-3 px-4 py-4"
  >
    <div>
      <div class="mb-1 text-xs font-medium text-ink-3">
        文本输出形式
      </div>
      <div
        class="flex overflow-hidden rounded-input border border-line"
        role="radiogroup"
        aria-label="文本输出形式"
      >
        <button
          type="button"
          role="radio"
          class="flex-1 py-1.5 text-xs"
          :class="mode === 'stream' ? 'bg-primary font-bold text-on-primary' : 'bg-card text-ink-2'"
          :aria-checked="mode === 'stream'"
          @click="setMode('stream')"
        >
          流式输出
        </button>
        <button
          type="button"
          role="radio"
          class="flex-1 py-1.5 text-xs"
          :class="mode === 'whole' ? 'bg-primary font-bold text-on-primary' : 'bg-card text-ink-2'"
          :aria-checked="mode === 'whole'"
          @click="setMode('whole')"
        >
          整段输出
        </button>
      </div>
      <p class="mt-1 text-[10px] leading-relaxed text-ink-3">
        流式输出：回复逐字显示；整段输出：回复完成后一次性显示。
      </p>
    </div>
  </div>
</template>
