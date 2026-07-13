/**
 * Story 2-3c — DoneHeroPanel red-phase acceptance tests.
 *
 * Pure display component contract (Task 2.2):
 *   - Props: { centerName, shortCode, persona, classCount, teachersInvitedCount, onOpenDashboard }
 *   - NO business logic (derivation lives in OnboardingDonePage per A-S2)
 *   - Semantic markup: <h1> headline (Fraunces italic, tabIndex=-1 for focus),
 *     <dl> stat strip with per-tile <dt>/<dd>, primary CTA as <button>
 *   - SVG check aria-hidden
 *   - Reduced-motion respected (S-S4 pre-emptive — v1 static, spec future-proofs)
 *
 * ATDD contract: this file WILL fail to import until Amelia lands Task 2.2
 * (`src/features/onboarding/components/DoneHeroPanel.tsx`).
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { axe } from 'vitest-axe'
import 'vitest-axe/extend-expect'
import { describe, expect, test, vi } from 'vitest'

import DoneHeroPanel from '@/features/onboarding/components/DoneHeroPanel'
import i18n from '@/lib/i18n'

type Persona = 'operator' | 'founder' | 'solo_teacher'

interface RenderArgs {
  centerName?: string
  shortCode?: string
  persona?: Persona
  classCount?: number
  teachersInvitedCount?: number
  locale?: 'en' | 'vi'
  onOpenDashboard?: () => void
}

async function renderPanel(args: RenderArgs = {}) {
  const {
    centerName = 'Saigon English Center',
    shortCode = 'saigon-english',
    persona = 'operator',
    classCount = 3,
    teachersInvitedCount = 2,
    locale = 'en',
    onOpenDashboard = vi.fn(),
  } = args

  await i18n.changeLanguage(locale)

  const utils = render(
    <I18nextProvider i18n={i18n}>
      <DoneHeroPanel
        centerName={centerName}
        shortCode={shortCode}
        persona={persona}
        classCount={classCount}
        teachersInvitedCount={teachersInvitedCount}
        onOpenDashboard={onOpenDashboard}
      />
    </I18nextProvider>,
  )

  return { ...utils, onOpenDashboard }
}

describe('DoneHeroPanel — display contract', () => {
  test('renders interpolated headline in <h1> (Fraunces italic, tabIndex=-1 for focus)', async () => {
    await renderPanel({ centerName: 'Saigon English Center' })

    const heading = screen.getByRole('heading', { level: 1 })
    expect(heading).toHaveTextContent(/Saigon English Center/)
    expect(heading).toHaveAttribute('tabIndex', '-1')
  })

  test('SVG check is aria-hidden (decorative only)', async () => {
    const { container } = await renderPanel()

    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg).toHaveAttribute('aria-hidden', 'true')
  })

  test('stat strip uses semantic <dl> markup with 3 <dt>/<dd> pairs', async () => {
    const { container } = await renderPanel({
      classCount: 3,
      teachersInvitedCount: 2,
      shortCode: 'saigon-english',
    })

    const dl = container.querySelector('dl')
    expect(dl).not.toBeNull()
    expect(dl!.querySelectorAll('dt')).toHaveLength(3)
    expect(dl!.querySelectorAll('dd')).toHaveLength(3)
  })

  test('stat tiles use semantic <dt> label + <dd> value pair — no parent aria-label (R1-C1-P19)', async () => {
    await renderPanel({
      classCount: 3,
      teachersInvitedCount: 2,
      shortCode: 'saigon-english',
    })

    // R1-C1-P19: dropped parent aria-label — SR reads <dl> semantics
    // naturally as "term: definition". Each tile has a testid + a <dt>
    // (label) + <dd> (value).
    const classesTile = screen.getByTestId('stat-tile-classes')
    expect(classesTile).toHaveTextContent(/classes ready/i)
    expect(classesTile).toHaveTextContent(/3/)

    const teachersTile = screen.getByTestId('stat-tile-teachers')
    expect(teachersTile).toHaveTextContent(/teachers invited/i)
    expect(teachersTile).toHaveTextContent(/2/)

    const subdomainTile = screen.getByTestId('stat-tile-subdomain')
    expect(subdomainTile).toHaveTextContent(/subdomain/i)
    expect(subdomainTile).toHaveTextContent(/saigon-english\.classlite\.app/)
  })

  test('subdomain tile composes shortCode via JS template literal, NOT via i18next interpolation', async () => {
    await renderPanel({ shortCode: 'acme-english' })
    expect(
      screen.getByText(/acme-english\.classlite\.app/i),
    ).toBeInTheDocument()
  })

  test('primary CTA is a <button> (not <a>) — client-side navigate', async () => {
    await renderPanel()

    const cta = screen.getByRole('button', { name: /open dashboard/i })
    expect(cta.tagName.toLowerCase()).toBe('button')
    expect(cta).toHaveAttribute('type', 'button')
  })

  test('clicking CTA invokes onOpenDashboard prop', async () => {
    const { onOpenDashboard } = await renderPanel()

    await userEvent.click(
      screen.getByRole('button', { name: /open dashboard/i }),
    )
    expect(onOpenDashboard).toHaveBeenCalledTimes(1)
  })

  test('AC1 layout — <h1> container carries responsive step-down + min-w-0 + break-words (S-S1 VN overflow discipline)', async () => {
    await renderPanel({
      centerName: 'Trung tâm Anh ngữ Quốc tế Hà Nội',
      locale: 'vi',
    })

    const heading = screen.getByRole('heading', { level: 1 })
    expect(heading.className).toMatch(/min-w-0/)
    expect(heading.className).toMatch(/break-words/)
    // Responsive step-down (text-3xl md:text-4xl lg:text-5xl)
    expect(heading.className).toMatch(/text-3xl/)
    expect(heading.className).toMatch(/md:text-4xl/)
    expect(heading.className).toMatch(/lg:text-5xl/)
  })

  describe('per-persona subtitle (3 branches)', () => {
    const cases: Array<{ persona: Persona; match: RegExp }> = [
      { persona: 'operator', match: /center is live/i },
      { persona: 'founder', match: /first class is spun up/i },
      { persona: 'solo_teacher', match: /one class, one teacher/i },
    ]

    for (const { persona, match } of cases) {
      test(`persona=${persona} → renders persona-specific subtitle copy`, async () => {
        await renderPanel({ persona })
        expect(screen.getByText(match)).toBeInTheDocument()
      })
    }
  })

  test('zero axe violations (base render, en, operator)', async () => {
    const { container } = await renderPanel()
    const results = await axe(container)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(results as any).toHaveNoViolations()
  })
})
