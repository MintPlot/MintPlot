<script setup lang="ts">
// Theme v3 aurora backdrop (replica route): four real blurred blob divs plus
// the grain overlay — the exact technique of the approved mockup. Fully
// static (no animation, no pointer events); blur rasterizes once, so scroll
// perf is unaffected. The parent positions the root (fixed in the shell,
// absolute inside the chat overlay) and owns its stacking context.
import { computed } from 'vue'
import { useMpTheme } from './theme'
import { useMpColorFamily } from './color-families'
import { AURORA_BLOB_GEOMETRY, acrylicGlow, auroraBlobStyles } from './acrylic'

const { theme } = useMpTheme()
const { familyId } = useMpColorFamily()

const blobStyles = computed(() => auroraBlobStyles(familyId.value, theme.value, acrylicGlow.value))
</script>

<template>
  <div
    class="mp-aurora"
    aria-hidden="true"
  >
    <div
      v-for="(fill, index) in blobStyles"
      :key="index"
      class="mp-aurora-blob"
      :style="{ ...AURORA_BLOB_GEOMETRY[index], background: fill }"
    />
    <div class="mp-aurora-grain" />
  </div>
</template>

<style scoped>
.mp-aurora {
  overflow: hidden;
  pointer-events: none;
  background: var(--mp-aurora-base, rgb(var(--mp-c-bg)));
}

.mp-aurora-blob {
  position: absolute;
  border-radius: 50%;
  filter: blur(62px);
}

/* Alternating rotations: at phone widths the big ellipses' lower arcs would
   otherwise run near-horizontal right behind the chrome rows and read as
   rectangular slabs — tilting them keeps the glow organic. */
.mp-aurora-blob-1 { transform: rotate(-12deg); }
.mp-aurora-blob-2 { transform: rotate(9deg); }
.mp-aurora-blob-3 { transform: rotate(11deg); }
.mp-aurora-blob-4 { transform: rotate(-9deg); }

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
