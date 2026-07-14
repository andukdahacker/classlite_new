/**
 * YourClassesRow — Story 2-4 Task 5.7 inline tests + AC9 XSS-safety belt.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter } from 'react-router'
import { Toaster } from '@/components/ui/sonner'
import { beforeEach, describe, expect, test, vi } from 'vitest'

const addBreadcrumbSpy = vi.fn()
vi.mock('@sentry/react', () => ({
  addBreadcrumb: (...args: unknown[]) => addBreadcrumbSpy(...args),
}))

import YourClassesRow from '@/features/dashboard/YourClassesRow'
import i18n from '@/lib/i18n'
import type { TemplateDraftPayload } from '@/lib/onboardingPayload'

type Draft = TemplateDraftPayload['classesDraft']

const DRAFT_TWO: Draft = [
  { cohortName: 'Batch A', startDate: '2026-08-15', teacherEmail: 'bob@example.com' },
  { cohortName: 'Batch B', startDate: '2026-08-20', teacherEmail: 'alice@example.com' },
]

const DRAFT_THREE: Draft = [
  ...DRAFT_TWO,
  { cohortName: 'Batch C', startDate: '2026-09-01', teacherEmail: null },
]

function renderRow(props: {
  centerName?: string
  classesDraft?: Draft
}) {
  return render(
    <MemoryRouter>
      <I18nextProvider i18n={i18n}>
        <YourClassesRow
          centerName={props.centerName ?? 'Saigon English Center'}
          classesDraft={props.classesDraft}
        />
        <Toaster richColors closeButton />
      </I18nextProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  addBreadcrumbSpy.mockClear()
})

describe('YourClassesRow — AC9 render + XSS-safety', () => {
  test('renders the AC9 root testid + heading', () => {
    renderRow({ classesDraft: DRAFT_TWO })
    expect(screen.getByTestId('dashboard-your-classes-row')).toBeInTheDocument()
    expect(
      screen.getByText(i18n.t('dashboard.yourClasses.heading') as string),
    ).toBeInTheDocument()
  })

  test('renders classesDraft.slice(0, 2) — 3 rows in shows 2 cards', () => {
    renderRow({ classesDraft: DRAFT_THREE })
    expect(screen.getByTestId('dashboard-your-classes-card-0')).toBeInTheDocument()
    expect(screen.getByTestId('dashboard-your-classes-card-1')).toBeInTheDocument()
    expect(screen.queryByTestId('dashboard-your-classes-card-2')).not.toBeInTheDocument()
  })

  test('renders ghost card + DeadLinkTrigger CTA when classesDraft is empty', () => {
    renderRow({ classesDraft: [] })
    const ghost = screen.getByTestId('dashboard-your-classes-ghost')
    expect(ghost).toBeInTheDocument()
    // The CTA copy contains `+` which is a regex-special char; assert via
    // textContent rather than a regex.
    expect(ghost.textContent).toContain(
      i18n.t('dashboard.yourClasses.createAnotherCta') as string,
    )
    // Confirm the CTA is a button (DeadLinkTrigger wraps in <button>).
    expect(ghost.querySelector('button')).not.toBeNull()
  })

  test('renders ghost card when classesDraft is undefined', () => {
    renderRow({ classesDraft: undefined })
    expect(screen.getByTestId('dashboard-your-classes-ghost')).toBeInTheDocument()
  })

  test('interpolates centerName into the ghost copy', () => {
    renderRow({ classesDraft: [], centerName: 'Hanoi Center' })
    expect(screen.getByTestId('dashboard-your-classes-ghost').textContent).toContain(
      'Hanoi Center',
    )
  })

  test('AC9 XSS-safety [W-INFO-17]: <script> in cohortName renders as text-node', () => {
    const evil = '<script>alert(1)</script>'
    const { container } = renderRow({
      classesDraft: [
        { cohortName: evil, startDate: '2026-08-15', teacherEmail: null },
      ],
    })
    const card = container.querySelector('[data-testid="dashboard-your-classes-card-0"]')
    // No injected element (script or attribute-vector) survives — scope to
    // the card itself so a top-level container assertion doesn't tolerate
    // an injection into an ancestor.
    expect(card).not.toBeNull()
    expect(card?.querySelector('script')).toBeNull()
    expect(card?.querySelector('img[onerror]')).toBeNull()
    // The escaped text lands in the DOM as a text node inside the card.
    expect(card?.textContent).toContain(evil)
  })

  test('AC9 XSS-safety [W-INFO-17]: attribute-vector <img onerror> in cohortName renders as text', () => {
    const attackPayload = '<img src=x onerror=alert(1)>'
    const { container } = renderRow({
      classesDraft: [
        { cohortName: attackPayload, startDate: '2026-08-15', teacherEmail: null },
      ],
    })
    const card = container.querySelector('[data-testid="dashboard-your-classes-card-0"]')
    expect(card).not.toBeNull()
    expect(card?.querySelector('img[onerror]')).toBeNull()
    expect(card?.querySelector('img')).toBeNull()
    expect(card?.textContent).toContain(attackPayload)
  })

  test('empty-state DeadLinkTrigger CTA click fires toast + Sentry breadcrumb (no navigate)', async () => {
    const user = userEvent.setup()
    renderRow({ classesDraft: [] })
    // Locate the CTA inside the ghost card — copy contains regex-special `+`
    // so we scope by testid and pick the button rather than name-matching.
    const ghost = screen.getByTestId('dashboard-your-classes-ghost')
    const cta = ghost.querySelector('button')
    expect(cta).not.toBeNull()
    await user.click(cta as HTMLButtonElement)

    // Toast text renders via Sonner
    const toast = await screen.findByText(
      i18n.t('dashboard.deadLink.notReady', { epicNum: 3 }) as string,
    )
    expect(toast).toBeInTheDocument()

    // Sentry breadcrumb fired with the CTA's target payload
    expect(addBreadcrumbSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'dashboard-dead-link-tapped',
        data: expect.objectContaining({
          targetPath: '/classes',
          targetSurface: 'classes',
          epicNum: 3,
        }),
      }),
    )
  })
})
