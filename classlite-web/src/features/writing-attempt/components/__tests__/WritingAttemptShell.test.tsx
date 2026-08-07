// Story 5.3 Task 8 (WF-8, risk 6) — WritingAttemptShell integration, MSW-only
// seam. Covers the party-mode BLOCKER reds, all no-loss reds ABSENT-PUT-verified
// (Murat F4/F5/F7 — assert what does NOT happen):
//  - autosave N→1 PUT + full-replace body (FW-4)
//  - no-data-loss body-verified (503 then success carries the FULL current text)
//  - offline → ZERO PUT while offline + reassurance banner → reconnect resume-flush
//  - read-only (submitted) → textarea disabled + Submit absent + ZERO PUT
//  - untimed hard-deadline flip via the injected clock → read-only, ZERO PUT, NO write-409
//  - untimed past SOFT deadline → overdue chip, editable, NO POST (Murat F8)
//  - timed expired load → resume-finalize (flush 409 → POST → confirmation)
//  - multi-tab foreign submit → overlay + disabled + ZERO subsequent PUT
//  - 413 → Error status, text preserved; flush-on-unmount → one final PUT
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { axe } from 'vitest-axe'
import i18n from '@/lib/i18n'
import { server } from '@/test/msw-server'
import { createTestQueryClient } from '@/lib/query-client'
import { attemptKeys } from '@/features/attempts'
import { useAttemptStore } from '@/stores/attemptStore'
import type { components } from '@/lib/api/client'
import { WritingAttemptShell } from '../WritingAttemptShell'

type AttemptBundle = components['schemas']['AttemptBundle']
type Submission = components['schemas']['Submission']

const SUB = 'sub-w1'
const BASE_ISO = '2026-08-04T00:00:00Z'

function submission(overrides: Partial<Submission> = {}): Submission {
  return {
    id: SUB,
    centerId: 'c-1',
    assignmentId: 'a-1',
    studentId: 'user-student',
    status: 'in_progress',
    isLate: false,
    appliedPenalty: 0,
    startedAt: BASE_ISO,
    submittedAt: null,
    timeBudgetSeconds: null,
    schemaVersion: 1,
    content: {},
    createdAt: BASE_ISO,
    updatedAt: BASE_ISO,
    ...overrides,
  }
}

function bundle(overrides: {
  submission?: Partial<Submission>
  assignment?: Partial<AttemptBundle['assignment']>
  exerciseTitle?: string
} = {}): AttemptBundle {
  return {
    submission: submission(overrides.submission),
    assignment: {
      id: 'a-1',
      exerciseId: 'ex-1',
      classId: 'cl-1',
      status: 'open',
      deadlineAt: '2026-08-20T00:00:00Z',
      hardDeadlineAt: null,
      instructions: null,
      latePenalty: 5,
      createdAt: BASE_ISO,
      updatedAt: BASE_ISO,
      ...overrides.assignment,
    },
    exercise: {
      id: 'ex-1',
      title: overrides.exerciseTitle ?? 'IELTS Writing Task 2 — Essay',
      skill: 'writing',
      settings: { timeLimitEnabled: false, timeLimitMinutes: 0, caseSensitive: false },
      sections: [
        {
          type: 'writing',
          title: 'Task',
          content: 'Some people think... Discuss both views.',
          questionGroups: [],
        },
      ],
    },
  }
}

interface HarnessOpts {
  bundle?: AttemptBundle
  initialText?: string
  perfNowRef?: { current: number }
  putStatuses?: number[] // per-call status codes for PUT (default 200)
  putCode?: string
  submitStatus?: number
  submitCode?: string
  autosaveIntervalMs?: number // default 40; raise to keep autosave from firing
}

interface Recorded {
  events: string[]
  putBodies: unknown[]
}

function installHandlers(opts: HarnessOpts): Recorded {
  const rec: Recorded = { events: [], putBodies: [] }
  let putCall = 0
  server.use(
    http.put(`/api/submissions/${SUB}/progress`, async ({ request }) => {
      const body = await request.json()
      rec.events.push('PUT')
      rec.putBodies.push((body as { content: unknown }).content)
      const status = opts.putStatuses?.[putCall] ?? opts.putStatuses?.at(-1) ?? 200
      putCall += 1
      if (status !== 200) {
        return HttpResponse.json(
          { error: { code: opts.putCode ?? 'INTERNAL', message: 'x', requestId: 'r' } },
          { status },
        )
      }
      return HttpResponse.json({ data: submission(), meta: { serverTime: BASE_ISO } })
    }),
    http.post(`/api/submissions/${SUB}/submit`, () => {
      rec.events.push('POST')
      if (opts.submitStatus && opts.submitStatus !== 200) {
        return HttpResponse.json(
          { error: { code: opts.submitCode ?? 'INTERNAL', message: 'x', requestId: 'r' } },
          { status: opts.submitStatus },
        )
      }
      return HttpResponse.json({
        data: submission({ status: 'submitted' }),
        meta: { serverTime: BASE_ISO },
      })
    }),
  )
  return rec
}

function renderShell(opts: HarnessOpts = {}) {
  const b = opts.bundle ?? bundle()
  const initialText = opts.initialText ?? ''
  const client = createTestQueryClient()
  // Seed the draft cache exactly as the page's reconcile does (so the persistence
  // mirror is un-gated and the seed-before-write guard is satisfied).
  client.setQueryData(attemptKeys.draft(SUB), { schemaVersion: 1, text: initialText })
  const onSubmitted = vi.fn()
  const perfNowRef = opts.perfNowRef ?? { current: 0 }
  const utils = render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <WritingAttemptShell
            submissionId={SUB}
            bundle={b}
            serverTime={BASE_ISO}
            perfAtLoad={0}
            perfNow={() => perfNowRef.current}
            initialText={initialText}
            onSubmitted={onSubmitted}
            autosaveIntervalMs={opts.autosaveIntervalMs ?? 40}
            commitDebounceMs={5}
            tickMs={20}
          />
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  )
  return { ...utils, onSubmitted, perfNowRef, client }
}

beforeEach(() => {
  window.localStorage.clear()
  useAttemptStore.getState().reset()
  vi.restoreAllMocks()
})
afterEach(async () => {
  server.resetHandlers()
  window.localStorage.clear()
  useAttemptStore.getState().reset()
  if (i18n.language !== 'en') await i18n.changeLanguage('en')
})

async function typeInEditor(text: string) {
  const textarea = screen.getByTestId('writing-editor-leaf')
  await userEvent.type(textarea, text)
  return textarea
}

describe('WritingAttemptShell — surface (AC2/AC3/AC6)', () => {
  test('renders the prompt (lang=en), the editor leaf, and the word meter', () => {
    renderShell({ initialText: 'hello world' })
    expect(screen.getByTestId('writing-prompt')).toHaveAttribute('lang', 'en')
    expect(screen.getByTestId('writing-editor-leaf')).toHaveValue('hello world')
    // count is live from the store seed
    expect(screen.getAllByTestId('writing-word-count')[0]).toHaveAttribute(
      'data-count',
      '2',
    )
  })
})

describe('WritingAttemptShell — autosave (AC10, FW-4)', () => {
  test('N keystrokes produce ONE PUT carrying the FULL text', async () => {
    const rec = installHandlers({})
    renderShell()
    await typeInEditor('abcde')
    await waitFor(() => expect(rec.events.filter((e) => e === 'PUT')).toHaveLength(1))
    expect(rec.putBodies.at(-1)).toEqual({ schemaVersion: 1, text: 'abcde' })
  })

  test('no-data-loss: a 503 then a later flush carries the FULL current text (AC22)', async () => {
    const rec = installHandlers({ putStatuses: [503, 200], putCode: 'INTERNAL' })
    renderShell()
    await typeInEditor('AB')
    // first autosave PUT fails (503) → error status
    await waitFor(() => expect(rec.events.filter((e) => e === 'PUT')).toHaveLength(1))
    await waitFor(() =>
      expect(screen.getByTestId('save-status')).toHaveAttribute('data-status', 'error'),
    )
    await typeInEditor('CDE') // now the live text is "ABCDE"
    // Trigger a flush via the submit finalizer.
    await userEvent.click(screen.getByTestId('writing-submit-open'))
    await userEvent.click(screen.getByTestId('writing-submit-confirm'))
    await waitFor(() =>
      expect(rec.putBodies.some((b) => (b as { text?: string }).text === 'ABCDE')).toBe(
        true,
      ),
    )
  })
})

describe('WritingAttemptShell — offline (AC12, BLOCKER 1)', () => {
  test('ZERO PUT while offline + reassurance banner; reconnect flushes once', async () => {
    const rec = installHandlers({})
    renderShell({ initialText: 'seed' })

    // Go offline BEFORE typing so no autosave is armed.
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    await Promise.resolve().then(() => window.dispatchEvent(new Event('offline')))
    await waitFor(() =>
      expect(screen.getByTestId('writing-offline-banner')).toBeInTheDocument(),
    )
    await waitFor(() =>
      expect(screen.getByTestId('save-status')).toHaveAttribute(
        'data-status',
        'offline',
      ),
    )

    await typeInEditor(' more offline text')
    // Give any (incorrect) autosave a chance to fire — assert it did NOT.
    await new Promise((r) => setTimeout(r, 120))
    expect(rec.events.filter((e) => e === 'PUT')).toHaveLength(0)

    // Reconnect → the LIVE resume-flush pushes the local-newer draft up: one PUT.
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    window.dispatchEvent(new Event('online'))
    await waitFor(() => expect(rec.events.filter((e) => e === 'PUT')).toHaveLength(1))
    expect(rec.putBodies.at(-1)).toEqual({
      schemaVersion: 1,
      text: 'seed more offline text',
    })
  })
})

describe('WritingAttemptShell — read-only (AC16)', () => {
  test('an already-submitted bundle: textarea disabled, Submit absent, ZERO PUT on edit', async () => {
    const rec = installHandlers({})
    renderShell({ bundle: bundle({ submission: { status: 'submitted' } }) })
    expect(screen.getByTestId('writing-editor-leaf')).toBeDisabled()
    expect(screen.queryByTestId('writing-submit-open')).not.toBeInTheDocument()
    expect(screen.getByTestId('writing-readonly-banner')).toHaveTextContent(
      i18n.t('attempt.readonly.submitted'),
    )
    await new Promise((r) => setTimeout(r, 80))
    expect(rec.events.filter((e) => e === 'PUT')).toHaveLength(0)
  })

  test('untimed hard-deadline flip via the clock → read-only, ZERO PUT, no write-409 (BLOCKER 3)', async () => {
    const rec = installHandlers({})
    const perfNowRef = { current: 0 }
    renderShell({
      perfNowRef,
      bundle: bundle({
        assignment: { hardDeadlineAt: '2026-08-04T00:00:05Z' }, // 5s after base
      }),
    })
    // Editable at mount (serverNow = base).
    expect(screen.getByTestId('writing-editor-leaf')).not.toBeDisabled()
    // Advance the server clock past the hard deadline; the read-only tick flips.
    perfNowRef.current = 10_000
    await waitFor(() =>
      expect(screen.getByTestId('writing-readonly-banner')).toBeInTheDocument(),
    )
    expect(screen.getByTestId('writing-editor-leaf')).toBeDisabled()
    expect(screen.queryByTestId('writing-submit-open')).not.toBeInTheDocument()
    // The flip was clock-driven, not a write-409: no PUT ever fired.
    expect(rec.events.filter((e) => e === 'PUT')).toHaveLength(0)
  })

  test('unsaved PRE-deadline edits are flushed once when the read-only clock flips (no-loss)', async () => {
    // autosave interval huge → autosave will NOT fire during the test, so the
    // only way the pre-deadline text reaches the server is the flush-on-flip.
    const rec = installHandlers({})
    const perfNowRef = { current: 0 }
    renderShell({
      perfNowRef,
      autosaveIntervalMs: 100_000,
      bundle: bundle({ assignment: { hardDeadlineAt: '2026-08-04T00:00:05Z' } }),
    })
    await typeInEditor('final words')
    // No autosave has fired yet (interval is 100s).
    expect(rec.events.filter((e) => e === 'PUT')).toHaveLength(0)

    // Cross the hard deadline → the read-only tick flips → flush-on-flip PUTs once.
    perfNowRef.current = 10_000
    await waitFor(() =>
      expect(screen.getByTestId('writing-readonly-banner')).toBeInTheDocument(),
    )
    await waitFor(() => expect(rec.events.filter((e) => e === 'PUT')).toHaveLength(1))
    expect(rec.putBodies.at(-1)).toEqual({ schemaVersion: 1, text: 'final words' })

    // ...and NO further PUT after the flip (autosave stays disabled).
    await new Promise((r) => setTimeout(r, 80))
    expect(rec.events.filter((e) => e === 'PUT')).toHaveLength(1)
    expect(screen.getByTestId('writing-editor-leaf')).toBeDisabled()
  })

  test('read-only flip with NO pending edits issues zero PUT', async () => {
    const rec = installHandlers({})
    const perfNowRef = { current: 0 }
    renderShell({
      perfNowRef,
      autosaveIntervalMs: 100_000,
      bundle: bundle({ assignment: { hardDeadlineAt: '2026-08-04T00:00:05Z' } }),
    })
    perfNowRef.current = 10_000
    await waitFor(() =>
      expect(screen.getByTestId('writing-readonly-banner')).toBeInTheDocument(),
    )
    await new Promise((r) => setTimeout(r, 80))
    expect(rec.events.filter((e) => e === 'PUT')).toHaveLength(0)
  })

  test('read-only flip moves focus to the banner (Sally S7)', async () => {
    installHandlers({})
    const perfNowRef = { current: 0 }
    renderShell({
      perfNowRef,
      bundle: bundle({ assignment: { hardDeadlineAt: '2026-08-04T00:00:05Z' } }),
    })
    perfNowRef.current = 10_000
    await waitFor(() =>
      expect(screen.getByTestId('writing-readonly-banner')).toHaveFocus(),
    )
  })
})

describe('WritingAttemptShell — untimed past soft-deadline (AC9/AC17, Murat F8)', () => {
  test('overdue chip appears, attempt stays editable, and NO POST fires', async () => {
    const rec = installHandlers({})
    const perfNowRef = { current: 0 }
    renderShell({
      perfNowRef,
      bundle: bundle({
        assignment: { deadlineAt: '2026-08-04T00:00:05Z', hardDeadlineAt: null },
      }),
    })
    perfNowRef.current = 10_000 // past the SOFT deadline only
    await waitFor(() =>
      expect(screen.getByTestId('writing-due-countdown')).toHaveAttribute(
        'data-overdue',
        'true',
      ),
    )
    // Soft-overdue is NOT read-only (hardDeadline null) and NEVER auto-submits.
    expect(screen.getByTestId('writing-editor-leaf')).not.toBeDisabled()
    expect(rec.events.filter((e) => e === 'POST')).toHaveLength(0)
  })
})

describe('WritingAttemptShell — timed resume-finalize (AC17)', () => {
  test('an expired timed load flushes (terminal 409) then submits → confirmation', async () => {
    const rec = installHandlers({
      putStatuses: [409],
      putCode: 'TIME_EXPIRED',
    })
    // serverTime is 10 min past a 60s budget → expired at mount.
    const b = bundle({ submission: { timeBudgetSeconds: 60 } })
    const client = createTestQueryClient()
    client.setQueryData(attemptKeys.draft(SUB), { schemaVersion: 1, text: 'essay' })
    const onSubmitted = vi.fn()
    render(
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={client}>
          <MemoryRouter>
            <WritingAttemptShell
              submissionId={SUB}
              bundle={b}
              serverTime="2026-08-04T00:10:00Z"
              perfAtLoad={0}
              perfNow={() => 0}
              initialText="essay"
              onSubmitted={onSubmitted}
              autosaveIntervalMs={40}
              commitDebounceMs={5}
              tickMs={20}
            />
          </MemoryRouter>
        </QueryClientProvider>
      </I18nextProvider>,
    )
    await waitFor(() => expect(onSubmitted).toHaveBeenCalledTimes(1))
    // The terminal-409 flush fell through to the POST (5.2b CRITICAL #1).
    expect(rec.events.filter((e) => e === 'POST')).toHaveLength(1)
  })
})

describe('WritingAttemptShell — timed-expiry retry snapshot (AC15)', () => {
  test('a timed-expiry finalize failure opens the retry dialog with the REAL word count, not 0', async () => {
    // The expiry flush PUT fails non-terminally (500) → the retry fallback opens.
    installHandlers({ putStatuses: [500], putCode: 'INTERNAL' })
    const perfNowRef = { current: 0 }
    renderShell({
      perfNowRef,
      initialText: 'one two three four five', // 5 words
      bundle: bundle({ submission: { timeBudgetSeconds: 60 } }),
    })
    // Expire the timed attempt (advance the server clock past the 60s budget).
    // useAttemptTimer's countdown ticks at its own ~1s cadence (no injected
    // tickMs), so allow a few seconds for the expiry → flush(500) → retry round-trip.
    perfNowRef.current = 120_000
    await waitFor(
      () => expect(screen.getByTestId('writing-submit-dialog')).toBeInTheDocument(),
      { timeout: 4000 },
    )
    const dialog = screen.getByTestId('writing-submit-dialog')
    // Before the fix the retry dialog showed the initial snapshot ("0 words");
    // it must show the ACTUAL count from the live store.
    expect(screen.getByTestId('writing-submit-word-count')).toHaveTextContent(
      i18n.t('writing.submit.wordCount', { n: 5 }),
    )
    expect(dialog).toHaveTextContent(i18n.t('writing.submit.retryTitle'))
  })
})

describe('WritingAttemptShell — multi-tab (AC13, BLOCKER)', () => {
  test('a foreign submit shows the overlay, disables the editor, and issues ZERO PUT', async () => {
    const rec = installHandlers({})
    renderShell({ initialText: 'draft in tab 2' })
    // "tab 1" posts a submitted signal on the same per-submission channel.
    const tab1 = new BroadcastChannel(`classlite:attempt:${SUB}`)
    tab1.postMessage({ type: 'submitted', senderId: 'tab-1' })

    await waitFor(() =>
      expect(screen.getByTestId('submitted-elsewhere-overlay')).toBeInTheDocument(),
    )
    expect(screen.getByTestId('writing-editor-leaf')).toBeDisabled()
    expect(screen.getByTestId('submitted-elsewhere-view-result')).toHaveFocus()
    // No pending edits (never typed) → the orphan-loss warning must NOT show.
    expect(
      screen.queryByTestId('submitted-elsewhere-orphan-warning'),
    ).not.toBeInTheDocument()
    await new Promise((r) => setTimeout(r, 80))
    expect(rec.events.filter((e) => e === 'PUT')).toHaveLength(0)
    tab1.close()
  })

  test('a foreign submit while edits are PENDING shows the orphan-loss warning (Sally S6)', async () => {
    // autosave interval huge → the typed text stays 'unsaved' (never flushed), so
    // the orphan warning ("your recent edits weren't included") must surface.
    installHandlers({})
    renderShell({ autosaveIntervalMs: 100_000 })
    await typeInEditor('unsent tail')
    await waitFor(() =>
      expect(screen.getByTestId('save-status')).toHaveAttribute(
        'data-status',
        'unsaved',
      ),
    )
    const tab1 = new BroadcastChannel(`classlite:attempt:${SUB}`)
    tab1.postMessage({ type: 'submitted', senderId: 'tab-1' })
    await waitFor(() =>
      expect(screen.getByTestId('submitted-elsewhere-overlay')).toBeInTheDocument(),
    )
    expect(
      screen.getByTestId('submitted-elsewhere-orphan-warning'),
    ).toBeInTheDocument()
    tab1.close()
  })
})

describe('WritingAttemptShell — 413 + flush-on-unmount (AC4/AC10)', () => {
  test('a 413 surfaces the Error status and preserves the text', async () => {
    const rec = installHandlers({ putStatuses: [413], putCode: 'PAYLOAD_TOO_LARGE' })
    renderShell()
    const textarea = await typeInEditor('oversize')
    await waitFor(() => expect(rec.events.filter((e) => e === 'PUT')).toHaveLength(1))
    await waitFor(() =>
      expect(screen.getByTestId('save-status')).toHaveAttribute('data-status', 'error'),
    )
    expect(textarea).toHaveValue('oversize') // text preserved
  })

  test('flush-on-unmount beacons one final PUT with the latest text', async () => {
    const rec = installHandlers({})
    const { unmount, client } = renderShell()
    await typeInEditor('unsaved tail')
    // Let the leaf commit (arms the dirty flag + mirrors to the cache) — then
    // unmount. Either the 40ms autosave or the unmount beacon fires the final PUT;
    // both carry the latest text. The ONLY failure is an un-committed edit.
    await waitFor(() =>
      expect(
        client.getQueryData<{ text: string }>(attemptKeys.draft(SUB))?.text,
      ).toBe('unsaved tail'),
    )
    unmount()
    await waitFor(() =>
      expect(rec.events.filter((e) => e === 'PUT').length).toBeGreaterThanOrEqual(1),
    )
    expect(rec.putBodies.at(-1)).toEqual({ schemaVersion: 1, text: 'unsaved tail' })
  })
})

describe('WritingAttemptShell — a11y states (AC21, TEST-UX-1)', () => {
  test('no axe violations in the read-only state', async () => {
    installHandlers({})
    const { container } = renderShell({
      bundle: bundle({ submission: { status: 'submitted' } }),
    })
    await screen.findByTestId('writing-readonly-banner')
    expect(await axe(container)).toHaveNoViolations()
  })

  test('no axe violations in the offline state', async () => {
    installHandlers({})
    const { container } = renderShell({ initialText: 'seed' })
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    window.dispatchEvent(new Event('offline'))
    await screen.findByTestId('writing-offline-banner')
    expect(await axe(container)).toHaveNoViolations()
  })

  test('no axe violations in the submitted-elsewhere overlay', async () => {
    installHandlers({})
    const { container } = renderShell({ initialText: 'draft' })
    const tab1 = new BroadcastChannel(`classlite:attempt:${SUB}`)
    tab1.postMessage({ type: 'submitted', senderId: 'tab-1' })
    await screen.findByTestId('submitted-elsewhere-overlay')
    expect(await axe(container)).toHaveNoViolations()
    tab1.close()
  })
})

describe('WritingAttemptShell — submit under-length warning (AC7)', () => {
  test('below the minimum shows a non-blocking under-length warning (still submittable)', async () => {
    installHandlers({})
    renderShell({ initialText: 'three little words' }) // 3 words < 250
    await userEvent.click(screen.getByTestId('writing-submit-open'))
    const dialog = await screen.findByTestId('writing-submit-dialog')
    expect(dialog).toBeInTheDocument()
    expect(screen.getByTestId('writing-submit-underlength')).toBeInTheDocument()
    // The confirm action is present (not blocked).
    expect(screen.getByTestId('writing-submit-confirm')).toBeEnabled()
  })
})
