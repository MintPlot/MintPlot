<script setup lang="ts">
// 对话 tab = 纯 AI 对话域(chatbox)落地视图(spec v1.1 §02 图 A)。
// M0 只落空态品牌时刻;会话列表与新建对话随 M2/M3 内核器官(会话存储 + LLM 管线)落地,
// 卡会话永不进本列表(双域独立,spec §01)。
import MintCat from '@/kernel/design/assets/MintCat.vue'
</script>

<template>
  <section class="flex h-full flex-col">
    <header class="flex shrink-0 items-center justify-between border-b border-line bg-card px-4">
      <h1 class="py-3 text-lg">
        对话
      </h1>
      <button
        type="button"
        class="flex h-11 w-11 items-center justify-center rounded-input text-xl text-primary"
        aria-label="新建对话"
        title="新建对话(随 M3 chatbox 闭环落地)"
      >
        +
      </button>
    </header>

    <div class="flex flex-1 flex-col items-center justify-center gap-4 px-8 pb-16 text-center">
      <MintCat class="h-24 w-24 text-ink" />
      <p class="text-sm text-ink-2">
        开始第一段对话
      </p>
    </div>
  </section>
</template>
