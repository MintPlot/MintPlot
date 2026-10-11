<script setup lang="ts">
// 对话标签图标 — 故事风水晶气泡（用户提供的裁切图，圆形徽章位图）
import chatIcon from './story-chat.png'
</script>

<template>
  <img
    :src="chatIcon"
    alt=""
    class="rounded-full select-none"
    draggable="false"
  >
</template>
