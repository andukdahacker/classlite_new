// ATDD RED-PHASE — Story 8-3b, Task 6/7 · **P0 blocking-merge** (AC22, R-D/R-E).
// The D12 cross-tab blast radius + the latent BUG Winston found: the ALREADY-
// SHIPPED 8-2b class Mistakes tab must (a) render the new `questionType` label +
// reading/listening skillSource on auto_graded rows, and (b) NOT collapse two
// auto_graded reading/error patterns whose only difference is `questionType` —
// `ClassPerformanceView.tsx:256` keys the list on
// `${skillSource}-${criterion}-${type}`, which COLLIDES when `criterion===""`
// (React reconciliation bug on a live surface). The key must incorporate
// `questionType`. A partial ship here is `tsc -b`-green (see B1 for the backend
// population proof), so this render test is the FE half of the R-D gate.
//
// RED signal is TWO-fold and intentional:
//   1. `MistakePattern.questionType`/`exampleQuote`/`exampleNote` don't exist on
//      the generated type until Task 6 co-finalizes the contract (the fixtures
//      below won't type-check) — the WF-4 red.
//   2. Once typed, the render assertions fail until the dev edits the SHIPPED
//      MistakePatternRow.tsx:55 (label→questionType when criterion==="") and
//      ClassPerformanceView.tsx:256 (key incorporates questionType).
// No `test.skip()` ([[reference_atdd_red_convention]]). MSW is the ONE seam.
//
// ── SEAMS the dev must expose ──────────────────────────────────────────────
//   • MistakePatternRow labels `questionType` when `criterion===""` at
//     data-testid="analytics-mistake-row-${i}" (skillSource tag reads
//     analytics.skillSource.reading / .listening).
//   • ClassPerformanceView list key = `${skillSource}-${criterion||questionType}-${type}`
//     so two auto_graded reading/error patterns render as TWO rows.
//   • excludedSources:[] → data-testid="analytics-mistakes-excluded-note" ABSENT.
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { HttpResponse, http } from 'msw'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, test } from 'vitest'
import i18n from '@/lib/i18n'
import { server } from '@/test/msw-server'
import { createTestQueryClient } from '@/lib/query-client'
import { ClassPerformanceView } from '@/features/analytics/components/ClassPerformanceView'
import { CLASS_A_ID, classPerformance } from '@/features/analytics/api/__tests__/handlers'
import type { components } from '@/lib/api/client'

type MistakePattern = components['schemas']['MistakePattern']

// Two auto_graded reading/error patterns differing ONLY by questionType — the
// exact shape that collides under the current `${skillSource}-${criterion}-${type}`
// key when D-COFINAL empties criterion to "".
const readingA: MistakePattern = {
  skillSource: 'reading',
  criterion: '', // auto_graded → criterion emptied (Winston #2)
  questionType: 'matching', // canonical snake_case wire value (code-review P1)
  type: 'error',
  instanceCount: 5,
  affectedStudentCount: 4,
  trend: 'stable',
  patternSource: 'auto_graded',
  exampleQuote: null,
  exampleNote: null,
}
const readingB: MistakePattern = {
  ...readingA,
  questionType: 'true_false_not_given',
  instanceCount: 3,
}

const classPerfWithAutoGraded = classPerformance({
  mistakePatterns: {
    coveredSources: ['reading', 'writing'],
    excludedSources: [], // D12 — no longer ['auto_graded']
    patterns: [readingA, readingB],
  },
})

function renderClassPerf(): void {
  server.use(
    http.get('*/api/analytics/classes/:id', () =>
      HttpResponse.json({ data: classPerfWithAutoGraded, meta: { serverTime: '2026-09-16T10:00:00.000Z' } }),
    ),
  )
  const client = createTestQueryClient()
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[`/analytics/class/${CLASS_A_ID}`]}>
          <Routes>
            <Route path="/analytics/class/:id" element={<ClassPerformanceView />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  )
}

afterEach(() => {
  server.resetHandlers()
  server.events.removeAllListeners()
})

describe('8-3b D12 class Mistakes retrofit — AC22 (P0 blocking-merge)', () => {
  test('two auto_graded reading/error patterns render as TWO DISTINCT rows (key-collision fix)', async () => {
    renderClassPerf()
    const zone = await screen.findByTestId('analytics-zone-mistakes')
    // Falsifiable (code-review P4): a colliding key would drop/duplicate a row, so
    // assert BOTH rows exist AND that they render the two DISTINCT questionType
    // labels — not the same pattern twice. A stable-identity key is the only way
    // both survive with their own content; the prior `-${index}` suffix made this
    // vacuous (index alone already uniquified every key).
    const rows = within(zone).getAllByTestId(/^analytics-mistake-row-\d+$/)
    expect(rows).toHaveLength(2)
    const labels = [
      i18n.t('analytics.questionType.matching'),
      i18n.t('analytics.questionType.true_false_not_given'),
    ]
    expect(within(rows[0]).getByText(labels[0])).toBeInTheDocument()
    expect(within(rows[1]).getByText(labels[1])).toBeInTheDocument()
    // and the two labels are genuinely different strings (guards a fixture regression)
    expect(labels[0]).not.toEqual(labels[1])
  })

  test('auto_graded row labels questionType (criterion is "") + reading skillSource tag', async () => {
    renderClassPerf()
    const row0 = await screen.findByTestId('analytics-mistake-row-0')
    // The label resolves the questionType for auto_graded rows.
    expect(within(row0).getByText(i18n.t('analytics.questionType.matching'))).toBeInTheDocument()
    // reading|listening skillSource keys light up here too (R-E cross-tab).
    expect(within(row0).getByText(i18n.t('analytics.skillSource.reading'))).toBeInTheDocument()
  })

  test('excludedSources:[] → NO "not yet available" note renders', async () => {
    renderClassPerf()
    await screen.findByTestId('analytics-zone-mistakes')
    expect(screen.queryByTestId('analytics-mistakes-excluded-note')).not.toBeInTheDocument()
  })
})
