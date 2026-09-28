/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url'

import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: [
      // Order matters: the trailing-slash entry must win for deep imports.
      { find: '@contracts/', replacement: fileURLToPath(new URL('./contracts/', import.meta.url)) },
      { find: '@contracts', replacement: fileURLToPath(new URL('./contracts/index.ts', import.meta.url)) },
      { find: '@', replacement: fileURLToPath(new URL('./src', import.meta.url)) },
    ],
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.spec.ts'],
  },
})
