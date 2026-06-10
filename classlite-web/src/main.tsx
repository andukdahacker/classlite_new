import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from '@/lib/query-client'
import { initSentry } from '@/lib/sentry'
import '@/lib/i18n'
// tokens.css is imported via index.css per Story 1.7a AC3 import-order spec.
import './index.css'
import App from './App'

// Sentry init runs BEFORE createRoot so the React tree has access to
// `Sentry.captureException` / `addBreadcrumb` from first paint. When
// VITE_SENTRY_DSN is unset (local dev without `.env.local`) initSentry
// silently no-ops, keeping the dashboard bootable without configuration.
initSentry()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
