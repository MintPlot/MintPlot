<script setup lang="ts">
// 设置 tab 占位(M0):设置注册表随 M2+ 入驻。主题切换按钮为临时目检载体,
// 真实「外观」组(含主题偏好持久化)随设置器官落地后移除。
import { useMpTheme } from '@/kernel/design/theme'

const { theme, toggleTheme } = useMpTheme()
</script>

<template>
  <section class="flex h-full flex-col">
    <header class="shrink-0 border-b border-line bg-card px-4">
      <h1 class="py-3 text-lg">
        设置
      </h1>
    </header>

    <div class="flex flex-1 flex-col items-center justify-center gap-4 px-8 pb-16 text-center">
      <p class="text-sm text-ink-3">
        模型与 API · 角色卡玩法 · 外观 · 数据 · 关于与更新(随 M2+ 设置注册表入驻)
      </p>
      <button
        type="button"
        class="min-h-[44px] rounded-input border border-line-strong bg-card px-4 text-sm text-ink-2"
        @click="toggleTheme"
      >
        临时主题切换 · 当前{{ theme === 'dark' ? '夜航墨绿' : '明' }}
      </button>
    </div>
  </section>
</template>
