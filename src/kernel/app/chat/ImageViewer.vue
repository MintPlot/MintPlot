<script setup lang="ts">
// M4-d image viewer overlay: tap a floor thumbnail to inspect the attachment.
defineProps<{ src: string }>()
defineEmits<{ close: [] }>()
</script>

<template>
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
    @click="$emit('close')"
  >
    <img
      :src="src"
      alt="图片查看"
      class="mp-mo-center-card max-h-full max-w-full object-contain"
    >
  </div>
</template>
