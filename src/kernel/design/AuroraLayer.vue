<script setup lang="ts">
// Theme v3 aurora backdrop (replica route, restored): four real blurred
// blob divs + the grain overlay — the exact technique of the approved
// mockup. The bake interlude (single-element gradient stack) read flat and
// was reverted (theme-v3-material-audit.md §3/§6-A). Fully static: the blur
// rasterizes once per blob and each blob sits on its own composited layer,
// so scroll perf is unaffected. The parent positions the root and owns its
// stacking context. Reactive: family/mode/glow rebuild the fills.
import { computed } from 'vue'
import { useMpTheme } from './theme'
import { useMpColorFamily } from './color-families'
import { AURORA_BLOB_GEOMETRY, MATERIAL_RECIPES, acrylicGlow, auroraBlobStyles } from './acrylic'

const { theme } = useMpTheme()
const { familyId } = useMpColorFamily()

const blobStyles = computed(() => auroraBlobStyles(familyId.value, theme.value, acrylicGlow.value))
const baseImage = computed(() => MATERIAL_RECIPES[familyId.value][theme.value].base)
</script>

<template>
  <div
    class="mp-aurora"
    :style="{ backgroundImage: baseImage }"
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
  background-color: rgb(var(--mp-c-bg));
}

.mp-aurora-blob {
  position: absolute;
  border-radius: 50%;
  filter: blur(55px);
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
