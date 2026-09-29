<script setup lang="ts">
// 外观分区(M2):主题偏好切换。M0 的临时主题按钮随设置注册表入驻迁入此处。
import { useMpTheme } from '@/kernel/design/theme'

const { theme, toggleTheme } = useMpTheme()
</script>

<template>
  <div class="flex items-center justify-between px-4 py-3">
    <div>
      <p class="text-sm text-ink">
        主题
      </p>
      <p class="text-xs text-ink-3">
        明 / 夜航墨绿，跟随系统为默认
      </p>
    </div>
    <button
      type="button"
      class="min-h-[44px] rounded-input border border-line-strong bg-card px-4 text-sm text-ink-2"
      @click="toggleTheme"
    >
      切换 · 当前{{ theme === 'dark' ? '夜航墨绿' : '明' }}
    </button>
  </div>
</template>
