import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
  // Story 11-5a — the money-path E2E lane runs against the BUILT preview (AC5),
  // served under a `*.classlite.localhost` host so the captured refresh cookie
  // (Domain=.classlite.localhost) carries, with `/api` (incl. the dev mock-R2
  // PUT sink) proxied to the real API on :8080 so every browser call stays
  // same-origin (no CORS/preflight on the sink PUT). `vite preview` does NOT
  // inherit `server.proxy`, so it is declared explicitly here. `allowedHosts`
  // must permit the money-path host or preview 403s the request → silent
  // guest-shell boot (Dev Notes: preview-host alignment).
  preview: {
    port: 5173,
    allowedHosts: ['my.classlite.localhost', 'classlite.localhost'],
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
})
