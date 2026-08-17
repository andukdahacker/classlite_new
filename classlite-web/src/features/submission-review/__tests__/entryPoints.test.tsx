// Story 5.5a Task 6 (WF-8, risk 6) — entry-point + repoint seams (AC13/T-nav).
// The page must be REACHABLE: pin that the /assignments list terminal rows
// (submitted / ai_processing / graded) offer a "Review submission" CTA linking to
// /assignments/{id}/submission, and that BOTH SubmittedElsewhereOverlay "View
// result" links (writing-attempt + speaking-attempt) now target the same route.
//
// RED-PHASE (Story 5.5a, WF-8 risk-6). Excluded from `vitest run` (filename lacks
// `.test`/`.spec`). Dev renames `.red.tsx`→`.test.tsx` per file as each contract
// lands. `tsc --noEmit` red until: (a) `reviewCtaForRow` is added to
// assignments/lib/assignmentRow.ts, and (b) each SubmittedElsewhereOverlay gains
// an `assignmentId` prop.
import { render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, test } from 'vitest'
import i18n from '@/lib/i18n'
import type { components } from '@/lib/api/client'
// RED: `reviewCtaForRow` does not exist yet on assignmentRow (Task 6 adds it).
import { reviewCtaForRow } from '@/features/assignments/lib/assignmentRow'
// RED: each overlay gains an `assignmentId` prop + retargets its link (Task 6).
import { SubmittedElsewhereOverlay as WritingSubmittedElsewhereOverlay } from '@/features/writing-attempt/components/SubmittedElsewhereOverlay'
import { SubmittedElsewhereOverlay as SpeakingSubmittedElsewhereOverlay } from '@/features/speaking-attempt/components/SubmittedElsewhereOverlay'

type SubmissionStatus = components['schemas']['SubmissionStatus']

const ASSIGNMENT_ID = 'a-1'
const REVIEW_ROUTE = `/assignments/${ASSIGNMENT_ID}/submission`

function renderWithRouter(node: React.ReactElement) {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>{node}</MemoryRouter>
    </I18nextProvider>,
  )
}

afterEach(async () => {
  if (i18n.language !== 'en') await i18n.changeLanguage('en')
})

describe('assignmentRow.reviewCtaForRow — terminal-row entry point (P2-7/AC13)', () => {
  test.each<SubmissionStatus>(['submitted', 'ai_processing', 'graded'])(
    '%s → a "Review submission" CTA linking to /assignments/{id}/submission',
    (status) => {
      const cta = reviewCtaForRow(status, ASSIGNMENT_ID)
      expect(cta).not.toBeNull()
      expect(cta?.to).toBe(REVIEW_ROUTE)
      expect(cta?.label).toBe('assignments.cta.reviewSubmission')
      expect(i18n.exists('assignments.cta.reviewSubmission', { lng: 'en' })).toBe(true)
      expect(i18n.exists('assignments.cta.reviewSubmission', { lng: 'vi' })).toBe(true)
    },
  )

  test.each<SubmissionStatus | null>([null, 'in_progress'])(
    '%s → no review CTA (nothing submitted to review)',
    (status) => {
      expect(reviewCtaForRow(status, ASSIGNMENT_ID)).toBeNull()
    },
  )
})

describe('SubmittedElsewhereOverlay repoint — "View result" → /submission (AC13)', () => {
  test('writing-attempt overlay links to /assignments/{id}/submission', () => {
    renderWithRouter(
      <WritingSubmittedElsewhereOverlay assignmentId={ASSIGNMENT_ID} hadUnsavedText={false} />,
    )
    expect(screen.getByTestId('submitted-elsewhere-view-result')).toHaveAttribute(
      'href',
      REVIEW_ROUTE,
    )
  })

  test('speaking-attempt overlay links to /assignments/{id}/submission', () => {
    renderWithRouter(
      <SpeakingSubmittedElsewhereOverlay
        assignmentId={ASSIGNMENT_ID}
        hadUnsavedRecording={false}
      />,
    )
    expect(screen.getByTestId('speaking-submitted-elsewhere-view-result')).toHaveAttribute(
      'href',
      REVIEW_ROUTE,
    )
  })
})
