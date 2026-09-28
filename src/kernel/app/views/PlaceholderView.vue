<script setup lang="ts">
// 通用占位视图(M0):真实视图分别由角色卡工坊插件(角色 tab,首页级)、
// 各插件视图注册(工具 tab)在 M2+ 经注册表入驻。
defineProps<{
  title: string
  note: string
}>()
</script>

<template>
  <section class="flex h-full flex-col">
    <header class="shrink-0 border-b border-line bg-card px-4">
      <h1 class="py-3 text-lg">
        {{ title }}
      </h1>
    </header>

    <div class="flex flex-1 items-center justify-center px-8 pb-16">
      <p class="text-center text-sm text-ink-3">
        {{ note }}
      </p>
    </div>
  </section>
</template>
