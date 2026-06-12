/**
 * ErrorBoundary — polished render-time error fallback (Story 1-7c AC3).
 *
 * Replaces the minimal `RootErrorBoundary` from Story 1-7b. The polished
 * version:
 *
 *   - reports the error to Sentry via `captureException(...)` with the
 *     React component stack as context (architecture line 521)
 *   - reads back the Sentry event ID from `captureException`'s synchronous
 *     return value (Sentry React SDK v10) and renders it in a monospace
 *     span so a support session can quote the ID and an engineer pastes
 *     it into Sentry search to find the event with `tags.requestId`
 *   - exposes a retry CTA that clears the boundary's state and re-renders
 *     `children`. If the error was transient (HMR stale chunk, race
 *     condition), the second render succeeds and the user is back to
 *     where they were. If the error recurs, the boundary catches again.
 *   - exposes a secondary "Back to dashboard" link as a fallback path
 *     when retry won't help (per UX-DR16's three-part recovery —
 *     diagnosis + context + one clear next action, plus a lower-stakes
 *     escape)
 *
 * The boundary does NOT handle auth failures — those flow through the
 * `apiFetch` → `auth-refresh` → `/login` path from 1-7b (project-context
 * TS-5: 401 handling lives in the fetch layer).
 */
import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import * as Sentry from '@sentry/react'
import { Button } from '@/components/ui/button'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  eventId: string | null
}

function ErrorFallback({
  eventId,
  onRetry,
}: {
  eventId: string | null
  onRetry: () => void
}): ReactNode {
  const { t } = useTranslation()
  return (
    <div
      role="alert"
      className="flex min-h-screen flex-col items-center justify-center bg-[var(--cl-paper)] px-4 text-center"
    >
      <h1 className="font-[var(--cl-font-display)] text-3xl text-[var(--cl-ink)]">
        {t('app.errorBoundary.title')}
      </h1>
      <p className="mt-3 max-w-md font-[var(--cl-font-body)] text-[var(--cl-ink-soft)]">
        {t('app.errorBoundary.body')}
      </p>
      {eventId && (
        <p className="mt-4 font-[var(--cl-font-mono)] text-sm text-[var(--cl-muted)]">
          {t('app.errorBoundary.eventIdLabel')}:{' '}
          <span data-testid="error-event-id">{eventId}</span>
        </p>
      )}
      <div className="mt-6 flex items-center gap-3">
        <Button onClick={onRetry}>{t('app.errorBoundary.retryCta')}</Button>
        <a
          href="/dashboard"
          className="font-[var(--cl-font-body)] text-sm text-[var(--cl-accent)] underline"
        >
          {t('app.errorBoundary.homeLinkCta')}
        </a>
      </div>
    </div>
  )
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false, eventId: null }

  static getDerivedStateFromError(): Partial<ErrorBoundaryState> {
    return { hasError: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const eventId = Sentry.captureException(error, {
      contexts: { react: { componentStack: info.componentStack ?? '' } },
    })
    if (typeof eventId === 'string' && eventId.length > 0) {
      this.setState({ eventId })
    }
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, eventId: null })
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <ErrorFallback eventId={this.state.eventId} onRetry={this.handleRetry} />
      )
    }
    return this.props.children
  }
}
