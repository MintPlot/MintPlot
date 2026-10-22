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
          'mp-glass-strong text-ink': toast.tone === 'info',
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
.mp-toast-enter-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}
/* Leaving toasts leave the flex flow (the host is fixed = a positioning
 * context) so the siblings below can FLIP up through the move class instead
 * of jumping when the element unmounts. The 50% translate keeps the natural
 * width centered while absolute. */
.mp-toast-leave-active {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  transition: opacity 0.15s ease, transform 0.15s ease;
}
.mp-toast-move {
  transition: transform 0.15s ease;
}
.mp-toast-enter-from {
  opacity: 0;
  transform: translateY(8px);
}
.mp-toast-leave-to {
  opacity: 0;
  transform: translate(-50%, 8px);
}
/* Reduced-motion parity (motion.css master gate covers mp-mo-* only; this
 * is the one transition family that lives outside it). */
@media (prefers-reduced-motion: reduce) {
  .mp-toast-enter-active,
  .mp-toast-leave-active,
  .mp-toast-move {
    transition: none;
  }
}
</style>
