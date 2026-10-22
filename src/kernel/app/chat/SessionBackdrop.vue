<script setup lang="ts">
import AuroraLayer from '@/kernel/design/AuroraLayer.vue'
import type { CardBackdrop } from '@/kernel/sessions/card-session-store'

defineProps<{ cover: string; backdrop: CardBackdrop }>()
</script>

<template>
  <!-- All layers stay non-negative in the fixed page stacking context. -->
  <AuroraLayer class="absolute inset-0 z-0" />
  <div
    v-if="cover && backdrop.enabled"
    class="pointer-events-none absolute inset-0 z-[1] overflow-hidden"
    aria-hidden="true"
  >
    <img
      :src="cover"
      alt=""
      class="h-full w-full object-cover"
      :style="{ filter: `blur(${backdrop.blur}px)`, transform: 'scale(1.1)' }"
    >
    <div
      class="absolute inset-0"
      :style="{ backgroundColor: `rgba(0, 0, 0, ${backdrop.dim / 100})` }"
    />
  </div>
</template>
