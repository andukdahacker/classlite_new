/**
 * RootErrorBoundary — minimal top-level Sentry-reporting boundary.
 *
 * Sits one level inside `<RouterProvider />` in App.tsx so render-time
 * errors in any route's lazy chunk (HMR stale chunk, exception thrown in
 * a child component) are caught, reported, and replaced with a single
 * accessible fallback instead of unmounting the entire app to a blank
 * white screen.
 *
 * Deliberately minimal — no Sentry event ID display, no retry button, no
 * styling beyond the design-token theme that flows from `<body>`. The
 * polished error UI (event ID + retry CTA + role-aware copy) lives in
 * Story 1-7c's `ErrorBoundary` per the Epic 1C scope. This boundary
 * exists ONLY to keep the user from seeing a blank page while Sentry
 * captures the stack.
 *
 * Class component because React 19 still requires class form for error
 * boundaries — `useErrorBoundary` is a third-party convention, not a
 * stable React API.
 */
import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import * as Sentry from '@sentry/react'

interface RootErrorBoundaryProps {
  children: ReactNode
}

interface RootErrorBoundaryState {
  hasError: boolean
}

function FallbackMessage(): ReactNode {
  const { t } = useTranslation()
  return (
    <div
      role="alert"
      className="flex min-h-screen items-center justify-center bg-[var(--cl-paper)] px-4 text-center text-[var(--cl-ink)]"
    >
      <p className="font-[var(--cl-font-body)] text-lg">
        {t('app.errorFallback')}
      </p>
    </div>
  )
}

export class RootErrorBoundary extends Component<
  RootErrorBoundaryProps,
  RootErrorBoundaryState
> {
  state: RootErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): RootErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    Sentry.captureException(error, {
      contexts: { react: { componentStack: info.componentStack ?? '' } },
    })
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return <FallbackMessage />
    }
    return this.props.children
  }
}
