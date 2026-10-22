<script setup lang="ts">
// 设置标签图标 — 故事风星晶齿轮（用户提供的裁切图，圆形徽章位图）
import settingsIcon from './story-settings.png'
</script>

<template>
  <img
    :src="settingsIcon"
    alt=""
    class="rounded-full select-none"
    draggable="false"
  >
</template>
