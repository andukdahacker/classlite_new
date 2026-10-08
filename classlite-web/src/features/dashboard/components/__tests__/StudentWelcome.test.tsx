/**
 * StudentWelcome content-pinning test — Story 10.3 AC7 (characterization-first).
 *
 * The s62 welcome is re-platformed onto the canonical `EmptyState` (tone='guided')
 * in Task 5. Its EXISTING coverage (`StudentDashboard.test.tsx`) only asserts the
 * wrapper `data-testid="student-welcome"` + the localStorage gating — NOT the
 * checklist / accent / next-session content. So a re-platform that silently
 * dropped the checklist would stay green (and i18n parity stays green on a
 * present-but-unrendered key). This file pins the RENDERED content BEFORE the
 * refactor so the re-platform cannot flatten it away undetected.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, test, vi } from 'vitest'

import i18n from '@/lib/i18n'
import { StudentWelcome } from '../StudentWelcome'

function renderWelcome(nextSessionLabel?: string | null): () => void {
  const onDismiss = vi.fn()
  render(
    <I18nextProvider i18n={i18n}>
      <StudentWelcome onDismiss={onDismiss} nextSessionLabel={nextSessionLabel} />
    </I18nextProvider>,
  )
  return onDismiss
}

describe('StudentWelcome — pinned content (pre-refactor characterization)', () => {
  test('renders the headline AND its italic brand accent word', () => {
    renderWelcome()
    // Headline + accent resolve to real i18n copy — the accent is a distinct node.
    expect(
      screen.getByText(i18n.t('dashboard.welcome.headlineAccent') as string),
    ).toBeInTheDocument()
    expect(
      screen.getByText((content) =>
        content.startsWith(i18n.t('dashboard.welcome.headline') as string),
      ),
    ).toBeInTheDocument()
  })

  test('renders all three starter-checklist steps', () => {
    renderWelcome()
    expect(screen.getByText(i18n.t('dashboard.welcome.step1') as string)).toBeInTheDocument()
    expect(screen.getByText(i18n.t('dashboard.welcome.step2') as string)).toBeInTheDocument()
    expect(screen.getByText(i18n.t('dashboard.welcome.step3') as string)).toBeInTheDocument()
  })

  test('renders the next-session line when a label is supplied', () => {
    renderWelcome('IELTS Writing · Mon 7pm')
    expect(
      screen.getByText(
        i18n.t('dashboard.welcome.nextSession', {
          session: 'IELTS Writing · Mon 7pm',
        }) as string,
      ),
    ).toBeInTheDocument()
  })

  test('omits the next-session line when no label is supplied', () => {
    renderWelcome(null)
    // The interpolated prefix must be absent entirely (no bare label leak).
    // Derive the locale's OWN prefix from the template rather than hard-coding the
    // English phrasing, so the assertion still guards under a non-EN default
    // locale or a copy change (TEST-FE-4).
    const SENTINEL = '@@SESSION@@'
    const resolved = i18n.t('dashboard.welcome.nextSession', { session: SENTINEL }) as string
    const prefix = resolved.split(SENTINEL)[0].trim()
    expect(prefix.length).toBeGreaterThan(0)
    expect(
      screen.queryByText((content) => content.includes(prefix)),
    ).not.toBeInTheDocument()
  })

  test('the dismiss CTA fires onDismiss exactly once', async () => {
    const user = userEvent.setup()
    const onDismiss = renderWelcome()
    await user.click(screen.getByTestId('student-welcome-dismiss'))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})
