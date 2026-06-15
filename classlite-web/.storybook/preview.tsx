/* eslint-disable react-refresh/only-export-components --
 * Storybook config files mix a non-component default export (the Preview
 * config object) with locally-declared component-shaped helpers
 * (`SuspenseFallback`, `ChromeDecorator`). HMR fast-refresh is not in
 * scope for the Storybook iframe — Storybook handles its own preview
 * reloads — so this file is exempt by design.
 */
/**
 * Storybook preview — Story 1d-1 AC2.
 *
 * Composition order (outside → in): MemoryRouter → QueryClient → I18next →
 * RoleProvider → Suspense → Story. Any new decorator must preserve this
 * chain — Router on the outside because it owns the location context that
 * the rest of the stack reads; Suspense innermost so `useSuspenseQuery`
 * (FW-1) renders a story-local fallback instead of crashing the preview.
 *
 * Preview-side dependencies (registered BEFORE decorators run):
 *   - Tailwind utilities + tokens.css + dark-mode tokens + Fraunces / Geist
 *     / Geist Mono font packages → all flow through src/index.css.
 *   - MSW service worker → started by `initialize()` (browser-guarded
 *     below); per-story handlers declared via `parameters.msw.handlers`.
 *   - date-fns default locale → switched in lockstep with the locale
 *     toolbar so calendar / date formatters in downstream stories match
 *     the active language (TS-6).
 *
 * Mock seam (TEST-FE-1): MSW at the HTTP boundary. Empty / error states
 * MUST be driven by MSW responses (e.g. `HttpResponse.json({ data: [] })`
 * or `HttpResponse.error()`) — never by mocking `useQuery` / `useMutation`.
 */
import type { Preview, Decorator } from '@storybook/react-vite'
import { Suspense, useEffect, useState } from 'react'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter } from 'react-router'
import { QueryClientProvider } from '@tanstack/react-query'
import { initialize, mswLoader } from 'msw-storybook-addon'
import { setDefaultOptions } from 'date-fns'
import { vi as viLocale } from 'date-fns/locale/vi'
import { enUS } from 'date-fns/locale/en-US'

import i18n from '../src/lib/i18n'
import { createTestQueryClient } from '../src/lib/query-client'
import { RoleProvider } from '../src/hooks/RoleContext'
import type { Role } from '../src/hooks/useRole'
import '../src/index.css'

// Browser-guard MSW init — preview.tsx may be imported by Vitest jsdom
// or SSR tooling that lacks a Service Worker scope.
if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  initialize({ onUnhandledRequest: 'bypass' })
}

const SUPPORTED_LOCALES = ['en', 'vi'] as const
type Locale = (typeof SUPPORTED_LOCALES)[number]

// `null` is the unauthenticated baseline that matches production today
// (Story 1-7c stub) — listed first so the default visualises real-user
// behavior, not the authenticated 'teacher' case.
const SUPPORTED_ROLE_GLOBALS = ['none', 'owner', 'admin', 'teacher', 'student'] as const
type RoleGlobal = (typeof SUPPORTED_ROLE_GLOBALS)[number]

type StorybookGlobals = {
  locale?: string
  role?: string
}

type RouterParameter = {
  initialEntries?: readonly string[]
  initialIndex?: number
}

function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value)
}

function isRoleGlobal(value: unknown): value is RoleGlobal {
  return typeof value === 'string' && (SUPPORTED_ROLE_GLOBALS as readonly string[]).includes(value)
}

function roleGlobalToRoleValue(value: RoleGlobal): Role | null {
  return value === 'none' ? null : value
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
}

function SuspenseFallback() {
  return (
    <div
      role="status"
      aria-label="Loading story"
      className="h-16 w-full animate-pulse rounded-lg bg-muted"
    />
  )
}

// Apply locale side-effects (i18n + date-fns + <html lang>) synchronously
// during render so the first paint is correct. i18next's `changeLanguage`
// is synchronous when the locale's resources are already loaded, which is
// always true here (en + vi are loaded at module init). The function is
// idempotent on the current value.
function applyLocaleSync(locale: Locale): void {
  if (i18n.language !== locale) {
    void i18n.changeLanguage(locale)
  }
  setDefaultOptions({ locale: locale === 'vi' ? viLocale : enUS })
  if (typeof document !== 'undefined' && document.documentElement.lang !== locale) {
    document.documentElement.lang = locale
  }
}

const ChromeDecorator: Decorator = (Story, context) => {
  const globals = context.globals as StorybookGlobals
  const locale: Locale = isLocale(globals.locale) ? globals.locale : 'en'
  const roleGlobal: RoleGlobal = isRoleGlobal(globals.role) ? globals.role : 'none'
  const role = roleGlobalToRoleValue(roleGlobal)

  const routerParam = context.parameters?.router as RouterParameter | undefined
  const initialEntries =
    routerParam?.initialEntries && isStringArray([...routerParam.initialEntries])
      ? [...routerParam.initialEntries]
      : ['/']

  // Run synchronously every render — i18n / date-fns / <html lang> are
  // idempotent on the current value, so this costs ~nothing on no-op
  // calls and keeps the first paint of every story in sync with the
  // toolbar. useEffect would commit AFTER the first paint and flash the
  // previous locale.
  applyLocaleSync(locale)

  // Belt-and-braces: also fire on locale change so DevTools/HMR scenarios
  // where applyLocaleSync's idempotency check sees a stale i18n.language
  // still converge.
  useEffect(() => {
    applyLocaleSync(locale)
  }, [locale])

  // One QueryClient per decorator mount (not per render) so toolbar
  // changes don't discard in-flight queries or the cache identity.
  // `createTestQueryClient` reads `DEFAULT_STALE_TIME_MS` from the same
  // source the production client uses (src/lib/query-client.ts), so the
  // Storybook posture cannot drift from the app's posture.
  const [queryClient] = useState(() => createTestQueryClient())

  // Key the MemoryRouter on the resolved initialEntries so a story that
  // overrides `parameters.router.initialEntries` actually re-mounts with
  // the new path — react-router only honors initialEntries at mount, so
  // a swap without a key change shows the previous route.
  const routerKey = `${initialEntries.join('|')}|${routerParam?.initialIndex ?? 0}`

  return (
    <MemoryRouter
      key={routerKey}
      initialEntries={initialEntries}
      initialIndex={routerParam?.initialIndex}
    >
      <QueryClientProvider client={queryClient}>
        <I18nextProvider i18n={i18n}>
          <RoleProvider value={role}>
            <Suspense fallback={<SuspenseFallback />}>
              <Story />
            </Suspense>
          </RoleProvider>
        </I18nextProvider>
      </QueryClientProvider>
    </MemoryRouter>
  )
}

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    // AC5 — fail Storybook test-runner on a11y violations. The 'error'
    // mode is the CI-strict posture; flip to 'todo' only locally during
    // exploratory authoring.
    a11y: { test: 'error' },
    layout: 'padded',
  },
  globalTypes: {
    locale: {
      name: 'Locale',
      description: 'Active i18n locale',
      defaultValue: 'en',
      toolbar: {
        icon: 'globe',
        items: [
          { value: 'en', title: 'English', right: 'EN' },
          { value: 'vi', title: 'Tiếng Việt', right: 'VI' },
        ],
        dynamicTitle: true,
      },
    },
    role: {
      name: 'Role',
      // 'none' represents the unauthenticated baseline (matches Story
      // 1-7c stub which returns null from useRole). Listed first AND set
      // as the default so designers see the real production baseline,
      // not an authenticated impersonation.
      description: 'Active user role override (RoleContext)',
      defaultValue: 'none',
      toolbar: {
        icon: 'user',
        items: [
          { value: 'none', title: 'none (unauthenticated)' },
          { value: 'owner', title: 'owner' },
          { value: 'admin', title: 'admin' },
          { value: 'teacher', title: 'teacher' },
          { value: 'student', title: 'student' },
        ],
        dynamicTitle: true,
      },
    },
  },
  loaders: [mswLoader],
  decorators: [ChromeDecorator],
}

export default preview
