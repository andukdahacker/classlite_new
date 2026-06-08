import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: false,
    css: false,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    // Serialize file execution: parity-script.test.ts mutates the canonical
    // tokens.css on disk, which races with tokens-presence.test.ts reading
    // the same file from a parallel worker. The whole suite is ~2.5s;
    // running files sequentially adds a marginal cost for guaranteed
    // stability.
    fileParallelism: false,
  },
})
