<script setup lang="ts">
// 滑杠开关(M3-h 内核共享件):启用类操作的统一形态,与插件分区里 TTS 的
// 自带滑杠同款视觉。
const model = defineModel<boolean>({ required: true })
</script>

<template>
  <label class="inline-flex cursor-pointer items-center">
    <input
      v-model="model"
      type="checkbox"
      class="sr-only"
    >
    <span
      class="relative inline-block h-6 w-11 rounded-full transition-colors"
      :class="model ? 'bg-primary' : 'bg-line-strong'"
    >
      <span
        class="absolute top-0.5 h-5 w-5 rounded-full bg-card shadow transition-all"
        :class="model ? 'left-[22px]' : 'left-0.5'"
      />
    </span>
  </label>
</template>
