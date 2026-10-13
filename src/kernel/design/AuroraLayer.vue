<script setup lang="ts">
// Theme v3 aurora backdrop: the glow is BAKED into one background-image stack
// (base gradient + gaussian-falloff radial gradients from design/acrylic.ts)
// — no DOM blob shapes, so no visible layer boundary and nothing for a
// compositor to leak. Fully static; the parent positions the root and owns
// its stacking context. Reactive: family/mode/glow rebuild the paint.
import { computed } from 'vue'
import { useMpTheme } from './theme'
import { useMpColorFamily } from './color-families'
import { acrylicGlow, buildAuroraImage } from './acrylic'

const { theme } = useMpTheme()
const { familyId } = useMpColorFamily()

const auroraImage = computed(() => buildAuroraImage(familyId.value, theme.value, acrylicGlow.value))
</script>

<template>
  <div
    class="mp-aurora"
    :style="{ backgroundImage: auroraImage }"
    aria-hidden="true"
  >
    <div class="mp-aurora-grain" />
  </div>
</template>

<style scoped>
.mp-aurora {
  overflow: hidden;
  pointer-events: none;
  background-color: rgb(var(--mp-c-bg));
}

/* Grain tile at the mockup's 4.5% overlay — a full-strength blend flattens
   the aurora field (measured in the v1 postmortem). */
.mp-aurora-grain {
  position: absolute;
  inset: 0;
  mix-blend-mode: overlay;
  opacity: 0.045;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)'/%3E%3C/svg%3E");
}
</style>
