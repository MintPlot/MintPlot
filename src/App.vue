<script setup lang="ts">
// M0-c · token 自检面板(临时):明暗切换目检载体,M0-d 壳骨架落地后移除
import LineCat from '@/kernel/design/assets/LineCat.vue'
import { useMpTheme } from '@/kernel/design/theme'

const { theme, toggleTheme } = useMpTheme()
</script>

<template>
  <main class="min-h-dvh bg-bg px-5 py-10 text-ink">
    <section class="mx-auto flex max-w-md flex-col gap-5 rounded-panel border border-line bg-card p-6">
      <div class="flex items-center justify-between">
        <span class="font-mono text-xs tracking-widest text-accent">M0-c · TOKEN 自检</span>
        <button
          type="button"
          class="min-h-[44px] rounded-input border border-line-strong bg-card px-4 text-sm text-ink-2"
          @click="toggleTheme"
        >
          {{ theme === 'dark' ? '夜航墨绿' : '明' }}
        </button>
      </div>

      <div class="h-16 rounded-card bg-gradient-to-br from-mint-300 via-teal-400 to-cyan-500" />
      <h1 class="text-2xl">
        MintPlot
      </h1>
      <p class="text-sm text-ink-2">
        酿一壶自己的剧情 — 薄荷 / 手作 / 墨水
      </p>
      <p class="font-mono text-xs text-ink-3">
        v1.0.0-alpha · code 1 · 数字与计数统一 mono
      </p>

      <div class="flex flex-wrap gap-3">
        <button
          type="button"
          class="min-h-[44px] rounded-action bg-gradient-to-br from-primary to-primary-pressed px-5 text-sm font-semibold text-on-primary"
        >
          开始对话
        </button>
        <button
          type="button"
          class="min-h-[44px] rounded-action bg-accent-wash px-5 text-sm font-semibold text-accent"
        >
          导入角色卡
        </button>
      </div>

      <div class="h-px bg-line" />
      <div class="mp-glass rounded-card px-4 py-3 text-xs text-ink-2">
        玻璃只给固定 chrome(顶栏 / 输入坞 / 遮罩 / 抽屉),气泡一律实心卡 + hairline
      </div>

      <LineCat class="h-20 w-20 self-center text-primary" />
      <p class="self-center text-sm text-ink-2">
        开始第一段对话
      </p>
    </section>
  </main>
</template>
