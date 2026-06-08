import { Component, Suspense, lazy, useSyncExternalStore } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

// DEV-ONLY: theme-resolution scratch route (Story 1.7a AC3 + AC4).
// `import.meta.env.DEV` is statically folded by Rolldown — in production builds
// this ternary takes the `null` branch and the dynamic import is dead code, so
// the ThemeResolutionPage chunk is never emitted to dist/. Task 11.9 greps
// dist/ to confirm `__theme-resolution` text does not leak into the bundle.
const DevThemeResolutionRoute = import.meta.env.DEV
  ? lazy(() => import('@/features/theme-resolution/ThemeResolutionPage'))
  : null

// useSyncExternalStore-based pathname subscription. Without this, client-side
// history changes (SPA nav, history.pushState) wouldn't re-render App and the
// dev route would only mount on a hard reload. Subscription is browser-only;
// the snapshot getter guards against jsdom/SSR.
function subscribeHistory(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener('popstate', callback)
  return () => window.removeEventListener('popstate', callback)
}

function getPathname(): string {
  return typeof window === 'undefined' ? '/' : window.location.pathname
}

function usePathname(): string {
  return useSyncExternalStore(subscribeHistory, getPathname, getPathname)
}

// Minimal ErrorBoundary so a chunk-fetch failure on the lazy dev route
// (HMR mid-restart, stale chunk URL, dev server bounce) doesn't unmount the
// whole App and leave the user staring at a blank page with no signal.
class DevRouteErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false }

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    if (import.meta.env.DEV) {
      console.error('[dev route] lazy chunk failed', error, info)
    }
  }

  render(): ReactNode {
    if (this.state.hasError) return null
    return this.props.children
  }
}

function App() {
  const { t } = useTranslation()
  const pathname = usePathname()

  if (DevThemeResolutionRoute && pathname === '/__theme-resolution') {
    return (
      <DevRouteErrorBoundary>
        <Suspense fallback={null}>
          <DevThemeResolutionRoute />
        </Suspense>
      </DevRouteErrorBoundary>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--cl-paper)]">
      <h1 className="font-[var(--cl-font-display)] text-3xl text-[var(--cl-ink)]">
        {t('app.welcome')}
      </h1>
    </div>
  )
}

export default App
