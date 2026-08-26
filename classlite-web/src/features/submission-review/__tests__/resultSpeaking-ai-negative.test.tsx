/**
 * Story 6.3c (T7, AC9 — MANDATORY DoD). The teacher-only leak-guard, locked on the STUDENT
 * surface. An accepted AI moment is committed as a PLAIN teacher TimestampedComment (the
 * `source`/`confidence`/`rationale` are dropped at the grade-write boundary — proven in
 * SpeakingGradingPage.ai.test.tsx). Here we lock the other end: the student's own speaking
 * result playback surface must NEVER render an AI avatar, confidence badge, rationale, or
 * transcript — it reads as the teacher's own note. The invariant holds today (the component
 * is audio-only); this test guards against a future edit leaking teacher-only AI data onto
 * the student surface.
 */
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter } from 'react-router'
import { describe, expect, test } from 'vitest'

import i18n from '@/lib/i18n'
import { createTestQueryClient } from '@/lib/query-client'
import type { components } from '@/lib/api/client'
import { ResultSpeakingPlayback } from '@/features/submission-review'

type Submission = components['schemas']['Submission']

function speakingSubmission(): Submission {
  return {
    id: 'sub-5',
    centerId: 'c-1',
    assignmentId: 'a-1',
    studentId: 'user-student',
    status: 'graded',
    isLate: false,
    appliedPenalty: 0,
    startedAt: '2026-08-13T00:00:00Z',
    submittedAt: '2026-08-13T12:00:00Z',
    timeBudgetSeconds: null,
    schemaVersion: 1,
    content: { schemaVersion: 1, audioKey: 'c-1/rec.m4a', contentType: 'audio/mp4', durationSec: 30 },
    createdAt: '2026-08-13T00:00:00Z',
    updatedAt: '2026-08-13T12:00:00Z',
  } as Submission
}

describe('ResultSpeakingPlayback — no teacher-only AI data leaks to the student (AC9)', () => {
  test('renders no AI avatar / confidence / rationale / transcript chrome', () => {
    const qc = createTestQueryClient()
    render(
      <QueryClientProvider client={qc}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter>
            <ResultSpeakingPlayback
              assignmentId="a-1"
              submission={speakingSubmission()}
              audioUrl="https://r2/inline-take.m4a"
              audioUrlMintedAt={new Date('2026-08-13T12:00:00Z').toISOString()}
            />
          </MemoryRouter>
        </I18nextProvider>
      </QueryClientProvider>,
    )
    // The student surface exists…
    expect(screen.getByTestId('result-speaking-playback')).toBeInTheDocument()
    // …but carries NONE of the teacher-only AI chrome.
    expect(screen.queryByTestId('ai-avatar')).not.toBeInTheDocument()
    expect(screen.queryByTestId('ai-confidence')).not.toBeInTheDocument()
    expect(screen.queryByTestId('ai-speaking-band-strip')).not.toBeInTheDocument()
    expect(screen.queryByTestId('ai-speaking-transcript-body')).not.toBeInTheDocument()
    expect(screen.queryByTestId('ai-speaking-transcript-unavailable')).not.toBeInTheDocument()
    // No AI moment cards either.
    expect(screen.queryByText(i18n.t('speakingGrading.ai.momentLabel'))).not.toBeInTheDocument()
  })
})
