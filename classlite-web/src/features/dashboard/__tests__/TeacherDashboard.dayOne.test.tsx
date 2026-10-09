// Story 10.5 — Teacher Day-One Guided Start (s53). Inline Vitest + vitest-axe
// over the net-new activation surface (AC1/AC2/AC3/AC4/AC5).
//
// RED NATURE ([[reference_atdd_red_convention]]): this file imports the SHIPPED
// `RealTeacherDashboard` module, so the RED is runtime/assertion-level — the
// day-one branch (testid `teacher-day-one`, the three step cards, the
// create-class CTA wiring) + the `dashboard.teacher.dayOne.*` i18n keys do not
// exist until the green phase lands. No `test.skip()`.
//
// ── SEAMS the dev exposes to turn these green ──────────────────────────────
//   • RealTeacherDashboard fires useClasses(centerId, `teacher:<id>`) as a
//     SECOND fetch; data.length === 0 (loaded) → the day-one guided start.
//   • day-one container data-testid="teacher-day-one" (EmptyState tone='guided',
//     headline suppressed — the page-head <h1> carries the message).
//   • three step cards data-testid="day-one-step-{1,2,3}" each with a
//     data-step-state ∈ {done|todo|active|locked}:
//       - step 1 Profile → done when Boolean(user.fullName), else todo
//       - step 2 Create class → active + live CTA data-testid="day-one-create-class-cta"
//       - step 3 Invite students → locked, disabled CTA data-testid="day-one-invite-cta"
//   • step-2 CTA opens the shipped ClassFormDialog (role="dialog"), NOT a route.
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, test } from 'vitest'
import { axe } from 'vitest-axe'
import 'vitest-axe/extend-expect'
import i18n from '@/lib/i18n'
import { server } from '@/test/msw-server'
import {
  createTestQueryClient,
  queryClient as singletonQueryClient,
} from '@/lib/query-client'
import { authKeys, type Session } from '@/features/auth/api/authKeys'
import { RealTeacherDashboard } from '@/features/dashboard/RealTeacherDashboard'
import {
  dashboardHandlers,
  teacherDataEmpty,
  teacherData,
} from '@/features/dashboard/api/__tests__/handlers'
import {
  classWire,
  classListHandlers,
  errorHandlers,
  templatesHandlers,
} from '@/features/classes/api/__tests__/handlers'
import en from '@/locales/en.json'
import vi from '@/locales/vi.json'
import { STORY_10_5_KEYS } from '@/features/dashboard/__tests__/dayOneI18nKeys'

const CENTER_ID = 'c-1'

function makeSession(fullName: string): Session {
  return {
    user: {
      id: 'user-teacher-1',
      email: 'teacher@example.com',
      fullName,
      emailVerified: true,
    },
    accessToken: 'a.b.c',
    center: {
      id: CENTER_ID,
      name: 'Saigon English Center',
      shortCode: 'saigon-english',
      brandColor: null,
      logoUrl: null,
      timezone: 'Asia/Ho_Chi_Minh',
    },
    role: 'teacher',
  }
}

function renderDayOne(opts: {
  fullName?: string
  classes?: ReturnType<typeof classWire>[]
  /** When true, dashboard rails carry data so the negative test proves the
   *  normal dashboard (not day-one) rendered. */
  nonEmptyDashboard?: boolean
  /** When true, the teacher-scoped /api/classes fetch 500s (10.5 review
   *  Option 1 — the day-one trigger's own UX-1 error branch). */
  classesError?: boolean
}) {
  const client = createTestQueryClient()
  const session = makeSession(opts.fullName ?? 'Trang')
  client.setQueryData(authKeys.session(), session)
  // useSessionUser/useSessionCenter read the module-singleton cache.
  singletonQueryClient.setQueryData(authKeys.session(), session)
  server.use(
    ...dashboardHandlers(opts.nonEmptyDashboard ? teacherData : teacherDataEmpty),
    ...(opts.classesError
      ? [errorHandlers.listClasses500()]
      : classListHandlers(opts.classes ?? [])),
    ...templatesHandlers,
  )
  return render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={['/dashboard']}>
          <RealTeacherDashboard />
        </MemoryRouter>
      </I18nextProvider>
    </QueryClientProvider>,
  )
}

afterEach(async () => {
  server.resetHandlers()
  singletonQueryClient.clear()
  await i18n.changeLanguage('en')
})

// ---------------------------------------------------------------------------
// AC1 / AC3 — renders on the 0-class day-one dashboard
// ---------------------------------------------------------------------------
describe('RealTeacherDashboard — AC1/AC3 day-one guided start (useClasses empty)', () => {
  test('renders the guided start when the teacher has zero classes', async () => {
    renderDayOne({ classes: [] })
    const start = await screen.findByTestId('teacher-day-one')
    expect(start).toBeInTheDocument()
    // three ordered step cards.
    expect(within(start).getByTestId('day-one-step-1')).toBeInTheDocument()
    expect(within(start).getByTestId('day-one-step-2')).toBeInTheDocument()
    expect(within(start).getByTestId('day-one-step-3')).toBeInTheDocument()
    // the empty rails dead-end must NOT be what greets a day-one teacher.
    expect(screen.queryByTestId('rail-needs-grading')).not.toBeInTheDocument()
  })

  test('does NOT render when the teacher already has ≥1 class (mock HTTP boundary, TEST-FE-1)', async () => {
    renderDayOne({ classes: [classWire({ id: 'cls-1' })], nonEmptyDashboard: true })
    // the normal dashboard takes over — rails present, no day-one surface.
    expect(await screen.findByTestId('rail-needs-grading')).toBeInTheDocument()
    expect(screen.queryByTestId('teacher-day-one')).not.toBeInTheDocument()
  })

  // 10.5 review (Option 1, Ducdo 2026-10-09) — the day-one trigger fetch has its
  // own UX-1 error branch so a classes-fetch 500 does NOT drop a 0-class teacher
  // silently onto the empty-rails dead-end this story exists to kill.
  test('surfaces a scoped inline retry (not the empty-rails dead-end) when the classes fetch errors', async () => {
    renderDayOne({ classesError: true })
    const alert = await screen.findByRole('alert')
    expect(alert).toBeInTheDocument()
    // neither the day-one surface nor the normal rails greet the teacher.
    expect(screen.queryByTestId('teacher-day-one')).not.toBeInTheDocument()
    expect(screen.queryByTestId('rail-needs-grading')).not.toBeInTheDocument()
    // the retry re-issues the classes fetch (scoped), proven by a button.
    expect(within(alert).getByRole('button')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// AC3 — step-1 state derives from Boolean(user.fullName) (both branches)
// ---------------------------------------------------------------------------
describe('RealTeacherDashboard — AC3 step-1 profile state', () => {
  test('step 1 is DONE when user.fullName is non-empty', async () => {
    renderDayOne({ fullName: 'Trang', classes: [] })
    const step1 = await screen.findByTestId('day-one-step-1')
    expect(step1).toHaveAttribute('data-step-state', 'done')
  })

  test('step 1 is NOT done (todo) when user.fullName is empty', async () => {
    renderDayOne({ fullName: '', classes: [] })
    const step1 = await screen.findByTestId('day-one-step-1')
    expect(step1).toHaveAttribute('data-step-state', 'todo')
  })
})

// ---------------------------------------------------------------------------
// AC1 — step 2 active + CTA opens the create-class dialog; step 3 disabled
// ---------------------------------------------------------------------------
describe('RealTeacherDashboard — AC1 step-2 CTA + step-3 disabled', () => {
  test('step 2 is the active card and its CTA opens the create-class dialog', async () => {
    const user = userEvent.setup()
    renderDayOne({ classes: [] })
    const step2 = await screen.findByTestId('day-one-step-2')
    expect(step2).toHaveAttribute('data-step-state', 'active')
    const cta = within(step2).getByTestId('day-one-create-class-cta')
    await user.click(cta)
    // the shipped ClassFormDialog mounts in a dialog — not a route navigation.
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  test('step 3 is locked with a disabled (no-live-handler) CTA', async () => {
    renderDayOne({ classes: [] })
    const step3 = await screen.findByTestId('day-one-step-3')
    expect(step3).toHaveAttribute('data-step-state', 'locked')
    expect(within(step3).getByTestId('day-one-invite-cta')).toBeDisabled()
  })
})

// ---------------------------------------------------------------------------
// AC4 — a11y (axe) + non-colour-only states + i18n key existence both locales
// ---------------------------------------------------------------------------
describe('RealTeacherDashboard — AC4 a11y + i18n', () => {
  test.each(['en', 'vi'] as const)(
    'zero axe violations on the day-one start (%s)',
    async (locale) => {
      const { container } = renderDayOne({ classes: [] })
      await screen.findByTestId('teacher-day-one')
      if (locale === 'vi') await i18n.changeLanguage('vi')
      expect(await axe(container)).toHaveNoViolations()
    },
  )

  test('each step surfaces a non-colour-only text status label', async () => {
    renderDayOne({ classes: [] })
    const start = await screen.findByTestId('teacher-day-one')
    // the state is carried by a text status badge, not colour alone.
    expect(
      within(start).getByText(i18n.t('dashboard.teacher.dayOne.status.done') as string),
    ).toBeInTheDocument()
    expect(
      within(start).getByText(i18n.t('dashboard.teacher.dayOne.status.active') as string),
    ).toBeInTheDocument()
    expect(
      within(start).getByText(i18n.t('dashboard.teacher.dayOne.status.locked') as string),
    ).toBeInTheDocument()
  })

  test('every Story 10.5 day-one key exists in BOTH en.json and vi.json', () => {
    const enKeys = en as Record<string, string>
    const viKeys = vi as Record<string, string>
    for (const key of STORY_10_5_KEYS) {
      expect(enKeys[key], `${key} missing in en.json`).toBeDefined()
      expect(viKeys[key], `${key} missing in vi.json`).toBeDefined()
    }
  })
})

// ---------------------------------------------------------------------------
// AC2 — additive: the day-one start disappears once ≥1 class, and the page-head
// carries the message (the guided EmptyState headline is suppressed).
// ---------------------------------------------------------------------------
describe('RealTeacherDashboard — AC2 additive + page-head message', () => {
  test('the page-head <h1> carries the day-one greeting (headline not duplicated inside EmptyState)', async () => {
    renderDayOne({ fullName: 'Trang', classes: [] })
    const start = await screen.findByTestId('teacher-day-one')
    const heading = screen.getByTestId('teacher-dashboard-heading')
    expect(heading).toHaveTextContent(i18n.t('dashboard.teacher.dayOne.title') as string)
    expect(heading).toHaveTextContent('Trang')
    // the EmptyState's own <h2> headline is suppressed (no redundant second
    // headline beside the page-head h1).
    expect(within(start).queryByRole('heading', { level: 2 })).not.toBeInTheDocument()
  })

  test('once the teacher has a class the guided start is gone (hides at ≥1)', async () => {
    renderDayOne({ classes: [classWire({ id: 'cls-1' })], nonEmptyDashboard: true })
    await waitFor(() =>
      expect(screen.queryByTestId('teacher-day-one')).not.toBeInTheDocument(),
    )
  })
})
