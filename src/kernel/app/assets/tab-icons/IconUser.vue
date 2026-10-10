<script setup lang="ts">
// 角色标签图标 — 故事风传送门（用户提供的裁切图，圆形徽章位图）
import charIcon from './story-char.png'
</script>

<template>
  <img
    :src="charIcon"
    alt=""
    class="rounded-full select-none"
    draggable="false"
  >
</template>
