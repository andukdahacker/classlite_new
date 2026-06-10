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
    // jsdom default URL is `about:blank`, which can't act as a base for
    // relative-URL fetches. The dashboard's apiFetch issues `fetch('/api/...')`
    // and MSW intercepts on URL pathname — both need a real http base.
    environmentOptions: {
      jsdom: {
        url: 'http://localhost:5173/',
      },
    },
    globals: false,
    css: false,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    setupFiles: ['src/test/vitest-setup.ts'],
    // Serialize file execution: parity-script.test.ts mutates the canonical
    // tokens.css on disk, which races with tokens-presence.test.ts reading
    // the same file from a parallel worker. The whole suite is ~2.5s;
    // running files sequentially adds a marginal cost for guaranteed
    // stability.
    fileParallelism: false,
  },
})
