/**
 * Story 2-4 — `FinishSetupCard` red-phase acceptance tests.
 *
 * Covers Task 3.3 per AC1/AC2/AC3/AC4/AC5:
 *   - AC1 gate: renders only when persona != null AND currentCenter != null
 *     AND currentStep === 'done' AND NOT snoozed (per AC1 8-cell matrix,
 *     rows 5 + 6)
 *   - AC2 structure: eyebrow + title + subtitle + fraction + progress bar +
 *     <ol> task list + footer with snoozeCta button (NO Dismiss per S-STRONG-13)
 *   - AC2 fraction aria-live wrapper [S-STRONG-6]
 *   - AC3 per-persona enumeration renders correctly (7 items Operator/Founder,
 *     4 items Solo Teacher)
 *   - AC4 snooze click → localStorage write + Sentry breadcrumb + card unmounts
 *   - Data-testid inventory per M-STRONG-14:
 *     `dashboard-checklist-card`, `dashboard-checklist-fraction`,
 *     `dashboard-checklist-progress-bar`, `dashboard-checklist-item-<id>`,
 *     `dashboard-checklist-snooze-cta`.
 *
 * ATDD contract: TS2307 on `@/features/dashboard/FinishSetupCard` is RED.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const addBreadcrumbSpy = vi.fn()
vi.mock('@sentry/react', () => ({
  addBreadcrumb: (...args: unknown[]) => addBreadcrumbSpy(...args),
}))

import FinishSetupCard from '@/features/dashboard/FinishSetupCard'
import i18n from '@/lib/i18n'
import type { ChecklistCtx } from '@/features/dashboard/lib/checklistDefinition'
import type { CenterSummary } from '@/features/auth/api/authKeys'

const USER_ID = 'user-1'
const KEY = `classlite_finish_setup_v1_${USER_ID}`

const CENTER: CenterSummary = {
  id: 'c-1',
  name: 'Saigon English Center',
  shortCode: 'saigon-english',
  // eslint-disable-next-line no-restricted-syntax -- brand-color wire format
  brandColor: '#1e3a8a',
  logoUrl: null,
  timezone: 'Asia/Ho_Chi_Minh',
}

const CTX_POST_2_3C: ChecklistCtx = {
  currentCenter: CENTER,
  templateDraft: {
    selectedTemplateId: 'tpl-1',
    spawnedClassIds: ['c1', 'c2'],
    classesDraft: [
      { cohortName: 'Batch A', startDate: '2026-08-15', teacherEmail: 'bob@example.com' },
      { cohortName: 'Batch B', startDate: '2026-08-15', teacherEmail: 'alice@example.com' },
    ],
  },
  teachersInvitedCount: 2,
}

function renderCard(props: {
  persona: 'operator' | 'founder' | 'solo_teacher'
  userId?: string | null
  ctx?: ChecklistCtx
}) {
  // NB: cannot use `props.userId ?? USER_ID` — nullish-coalescing collapses
  // an explicit `null` (the AC1 gate case) to the default. Preserve `null`
  // when the caller passes it; only fall back on `undefined`.
  const userIdProp = 'userId' in props ? props.userId ?? null : USER_ID
  // Story 2-5a Task 5.5 — FinishSetupCard now uses `useNavigate` for the
  // graduated `centerCreated → /settings` click. Wrap the tree in a
  // MemoryRouter so the hook resolves without swapping the whole shipped
  // 2-4 test harness to a router-based one.
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={['/dashboard']}>
        <FinishSetupCard
          userId={userIdProp}
          persona={props.persona}
          ctx={props.ctx ?? CTX_POST_2_3C}
        />
      </MemoryRouter>
    </I18nextProvider>,
  )
}

beforeEach(() => {
  window.localStorage.clear()
  addBreadcrumbSpy.mockClear()
})

describe('FinishSetupCard — Task 3.3 (AC1/AC2/AC3/AC4)', () => {
  // ---------------------------------------------------------------------
  // AC2 structure
  // ---------------------------------------------------------------------
  test('renders eyebrow + persona-specific title + subtitle + fraction + <ol> tasks + snoozeCta', () => {
    renderCard({ persona: 'operator' })

    expect(screen.getByTestId('dashboard-checklist-card')).toBeInTheDocument()
    expect(
      screen.getByText(i18n.t('dashboard.checklist.eyebrow') as string),
    ).toBeInTheDocument()
    expect(
      screen.getByText(i18n.t('dashboard.checklist.title.operator') as string),
    ).toBeInTheDocument()
    expect(
      screen.getByText(i18n.t('dashboard.checklist.subtitle.operator') as string),
    ).toBeInTheDocument()

    expect(screen.getByTestId('dashboard-checklist-fraction')).toBeInTheDocument()
    expect(screen.getByTestId('dashboard-checklist-progress-bar')).toBeInTheDocument()
    // Task list is <ol>
    expect(screen.getByRole('list')).toBeInTheDocument()
    // Snooze button present; Dismiss REMOVED per S-STRONG-13
    expect(screen.getByTestId('dashboard-checklist-snooze-cta')).toBeInTheDocument()
    expect(screen.queryByText(/dismiss/i)).not.toBeInTheDocument()
  })

  // ---------------------------------------------------------------------
  // AC2 fraction aria-live wrapper [S-STRONG-6]
  // ---------------------------------------------------------------------
  test('fraction is wrapped in aria-live="polite" aria-atomic="true"', () => {
    renderCard({ persona: 'operator' })
    const fraction = screen.getByTestId('dashboard-checklist-fraction')
    const wrapper = fraction.closest('[aria-live]')
    expect(wrapper).not.toBeNull()
    expect(wrapper).toHaveAttribute('aria-live', 'polite')
    expect(wrapper).toHaveAttribute('aria-atomic', 'true')
  })

  // ---------------------------------------------------------------------
  // AC3 per-persona item count contracts
  // ---------------------------------------------------------------------
  test('Operator renders 7 <li> items per mockup s09', () => {
    renderCard({ persona: 'operator' })
    expect(screen.getAllByRole('listitem')).toHaveLength(7)
  })

  test('Founder renders 7 <li> items (identical to Operator)', () => {
    renderCard({ persona: 'founder' })
    expect(screen.getAllByRole('listitem')).toHaveLength(7)
  })

  test('Solo Teacher renders 4 <li> items', () => {
    renderCard({ persona: 'solo_teacher', ctx: { ...CTX_POST_2_3C, teachersInvitedCount: 0 } })
    expect(screen.getAllByRole('listitem')).toHaveLength(4)
  })

  test('every <li> has a `dashboard-checklist-item-<id>` testid', () => {
    renderCard({ persona: 'operator' })
    for (const id of [
      'centerCreated',
      'templatePicked',
      'firstClassesSpawned',
      'teachersInvited',
      'enrolStudents',
      'createMoreClasses',
      'addResources',
    ]) {
      expect(screen.getByTestId(`dashboard-checklist-item-${id}`)).toBeInTheDocument()
    }
  })

  // ---------------------------------------------------------------------
  // Fraction display correctness
  // ---------------------------------------------------------------------
  test('Operator post-2-3c fraction displays "4/7 complete"', () => {
    renderCard({ persona: 'operator' })
    const fraction = screen.getByTestId('dashboard-checklist-fraction')
    expect(fraction.textContent).toMatch(/4\s*\/\s*7/)
  })

  test('Operator fresh state fraction displays "1/7 complete"', () => {
    renderCard({
      persona: 'operator',
      ctx: { currentCenter: CENTER, templateDraft: null, teachersInvitedCount: 0 },
    })
    const fraction = screen.getByTestId('dashboard-checklist-fraction')
    expect(fraction.textContent).toMatch(/1\s*\/\s*7/)
  })

  // ---------------------------------------------------------------------
  // AC4 snooze click contract
  // ---------------------------------------------------------------------
  test('snooze click → localStorage write + Sentry breadcrumb `checklist-snoozed` + card unmounts', async () => {
    const user = userEvent.setup()
    renderCard({ persona: 'operator' })

    await user.click(screen.getByTestId('dashboard-checklist-snooze-cta'))

    expect(screen.queryByTestId('dashboard-checklist-card')).not.toBeInTheDocument()
    expect(window.localStorage.getItem(KEY)).not.toBeNull()
    expect(addBreadcrumbSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'checklist',
        message: 'checklist-snoozed',
        data: expect.objectContaining({
          userId: USER_ID,
          persona: 'operator',
          completed: 4,
          total: 7,
        }),
      }),
    )
  })

  test('AC1 gate: userId === null → card does NOT render (localStorage is null-scoped)', () => {
    renderCard({ persona: 'operator', userId: null })
    expect(screen.queryByTestId('dashboard-checklist-card')).not.toBeInTheDocument()
  })

  test('AC1 gate: currentCenter === null → card does NOT render', () => {
    renderCard({
      persona: 'operator',
      ctx: { currentCenter: null as never, templateDraft: null, teachersInvitedCount: 0 },
    })
    expect(screen.queryByTestId('dashboard-checklist-card')).not.toBeInTheDocument()
  })

  test('AC1 gate: pre-seeded snoozedUntil > Date.now() → card does NOT render', () => {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ snoozedUntil: Date.now() + 7 * 24 * 3600 * 1000 }),
    )
    renderCard({ persona: 'operator' })
    expect(screen.queryByTestId('dashboard-checklist-card')).not.toBeInTheDocument()
  })

  // ---------------------------------------------------------------------
  // Item done/pending render
  // ---------------------------------------------------------------------
  test('badges render per resolved state: Done, Required, Coming soon, Optional', () => {
    // Fresh operator state — only `centerCreated` is done. Required items
    // (`templatePicked`, `firstClassesSpawned`, `teachersInvited`) render
    // with the Required badge. `enrolStudents` is Coming soon.
    // `createMoreClasses` + `addResources` are Optional.
    renderCard({
      persona: 'operator',
      ctx: { currentCenter: CENTER, templateDraft: null, teachersInvitedCount: 0 },
    })

    const centerCreated = screen.getByTestId('dashboard-checklist-item-centerCreated')
    expect(centerCreated.textContent).toContain(i18n.t('dashboard.checklist.badge.done') as string)

    const templatePicked = screen.getByTestId('dashboard-checklist-item-templatePicked')
    expect(templatePicked.textContent).toContain(
      i18n.t('dashboard.checklist.badge.required') as string,
    )

    const enrolStudents = screen.getByTestId('dashboard-checklist-item-enrolStudents')
    expect(enrolStudents.textContent).toContain(
      i18n.t('dashboard.checklist.badge.comingSoon') as string,
    )

    const createMoreClasses = screen.getByTestId('dashboard-checklist-item-createMoreClasses')
    expect(createMoreClasses.textContent).toContain(
      i18n.t('dashboard.checklist.badge.optional') as string,
    )
  })
})
