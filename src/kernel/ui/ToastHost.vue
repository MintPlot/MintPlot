<script setup lang="ts">
// Toast host — fixed bottom, above the tab bar; the read side of kernel/ui/toasts.
import { useToasts } from '@/kernel/ui/toasts'

const toasts = useToasts()
</script>

<template>
  <div
    class="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4"
    aria-live="polite"
  >
    <transition-group name="mp-toast">
      <div
        v-for="toast in toasts"
        :key="toast.id"
        class="pointer-events-auto max-w-md rounded-card px-4 py-2.5 text-sm shadow-md"
        :class="{
          'mp-glass text-ink': toast.tone === 'info',
          'bg-primary text-on-primary': toast.tone === 'success',
          'bg-danger text-on-primary': toast.tone === 'error',
        }"
      >
        {{ toast.message }}
      </div>
    </transition-group>
  </div>
</template>

<style scoped>
.mp-toast-enter-active,
.mp-toast-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}
.mp-toast-enter-from,
.mp-toast-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
</style>
