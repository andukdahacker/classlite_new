/**
 * OnboardingLayout — Story 2-3a AC1/AC4/AC8, Task 1.
 *
 * Full-bleed wizard shell (no sidebar, no topbar). Owns:
 *   - Route guards (AC8) — see the order-sensitive `useEffect` below.
 *   - Auto-save context (Task 5.2) — child pages read `savingState` +
 *     `scheduleSave` + `flush` via `useOnboardingAutoSave`.
 *   - Shell chrome (wordmark top-left, email + Sign out top-right, dot-grid
 *     background, top-right AutoSaveIndicator slot).
 *
 * Guard ordering (Winston-W2 fold — compound `!isLoading && !isAuthenticated`
 * is load-bearing; the naive `!isAuthenticated` alone re-ships Story 1-8's
 * boot-probe race):
 *   (a) `isLoading` OR session cache never seeded → render skeleton, no navigate
 *   (b) !isLoading && !isAuthenticated → /login?next=<current>, replace
 *   (c) authenticated & !emailVerified → /verify-email, replace
 *   (d) authenticated & session.center != null → /dashboard, replace
 * Every `navigate()` uses `replace: true` to avoid StrictMode double-mount
 * polluting history (Winston-I8 code-comment).
 */
import { useEffect } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { authKeys } from '@/features/auth/api/authKeys'
import { useAuth } from '@/hooks/useAuth'
import {
  OnboardingAutoSaveProvider,
  useOnboardingAutoSave,
} from './OnboardingAutoSaveContext'
import { AutoSaveIndicator } from './components/AutoSaveIndicator'
import { onboardingSubmitFlag } from './onboardingSubmitFlag'

export function OnboardingLayoutSkeleton() {
  return (
    <div
      data-testid="skeleton-onboarding"
      className="min-h-screen bg-slate-50"
      aria-busy="true"
    >
      <div className="mx-auto max-w-4xl px-4 py-16">
        <div className="h-8 w-40 animate-pulse rounded bg-slate-200" />
        <div className="mt-8 h-4 w-64 animate-pulse rounded bg-slate-200" />
      </div>
    </div>
  )
}

export default function OnboardingLayout() {
  const { isLoading, session, user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()

  // `getQueryState(...) === undefined` means the cache slot was never
  // populated (fresh mount, no boot probe run) — treat as "unknown". A
  // seeded `null` (explicit logged-out marker) DOES fall into the
  // "no user" guard branch. This split is what closes the Winston-W2
  // boot-probe race regression: compound `!isLoading && !sessionKnown`
  // stays in skeleton until the probe resolves.
  const sessionKnown =
    queryClient.getQueryState(authKeys.session()) !== undefined
  const inFlight = isLoading || !sessionKnown

  useEffect(() => {
    if (inFlight) return
    // "Logged in" = user object present in session (regardless of email
    // verification). `useAuth().isAuthenticated` is stricter (verified only),
    // so we branch on `user` here to keep the /verify-email guard reachable.
    if (!user) {
      const nextPath = `${location.pathname}${location.search}`
      navigate(`/login?next=${encodeURIComponent(nextPath)}`, {
        replace: true,
      })
      return
    }
    if (!user.emailVerified) {
      navigate('/verify-email', { replace: true })
      return
    }
    if (session?.center != null && !onboardingSubmitFlag.current) {
      navigate('/dashboard', { replace: true })
    }
  }, [
    inFlight,
    user,
    session?.center,
    navigate,
    location.pathname,
    location.search,
  ])

  if (inFlight) return <OnboardingLayoutSkeleton />
  if (!user) return null
  if (!user.emailVerified) return null
  // Render bail mirrors the useEffect guard exactly — including the
  // onboardingSubmitFlag suppression. Without this gate, the cache write
  // in useCreateCenter.onSuccess would unmount CenterSetupPage mid-onSubmit
  // (before the PUT-progress + navigate calls settle), stranding the wizard.
  if (session?.center != null && !onboardingSubmitFlag.current) return null

  return (
    <OnboardingAutoSaveProvider>
      <OnboardingChrome email={user.email} />
    </OnboardingAutoSaveProvider>
  )
}

interface OnboardingChromeProps {
  email: string
}

/**
 * OnboardingChrome — split out so the sign-out handler can consume the
 * auto-save context (which requires being INSIDE the provider). Flushing
 * pending saves before nav is R1-P11's fix.
 */
function OnboardingChrome({ email }: OnboardingChromeProps) {
  const { t } = useTranslation()
  const autoSave = useOnboardingAutoSave()
  const location = useLocation()

  const handleSignOut = async (
    event: React.MouseEvent<HTMLAnchorElement>,
  ) => {
    event.preventDefault()
    // Flush pending auto-save before the browser navigates. A raw
    // `<a href="/logout">` aborts the in-flight fetch on nav; awaiting
    // flush() lands the PUT first (R1-P11).
    try {
      await autoSave.flush()
    } finally {
      window.location.href = '/logout'
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 [background-image:radial-gradient(rgba(15,23,42,0.06)_1px,transparent_1px)] [background-size:24px_24px]">
      <header className="flex items-center justify-between px-6 py-4">
        <div className="text-lg font-semibold tracking-tight">
          {t('onboarding.wizard.brand')}
        </div>
        <div className="flex items-center gap-3 text-sm text-slate-600">
          <span>{email}</span>
          <span aria-hidden="true">·</span>
          <a
            href="/logout"
            className="hover:underline"
            onClick={(event) => void handleSignOut(event)}
          >
            {t('onboarding.wizard.signOut')}
          </a>
          {/* R1-P29 — AutoSaveIndicator only meaningful on pages that write
              draft state. /welcome (persona pick) is a one-shot POST; the
              idle "Auto-save on" affordance was misleading there. */}
          {location.pathname !== '/welcome' ? <AutoSaveIndicator /> : null}
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">
        <Outlet />
      </main>
    </div>
  )
}
