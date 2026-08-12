/**
 * Story 5.4 Task 10 (WF-8) — SpeakingAttemptShell integration. MSW is the HTTP
 * seam; `installMediaMocks` is the deliberate second seam (the recorder's real
 * behavior is the A5 gate). Drives the recorder through the leaf and verifies the
 * party-mode reds: the P0 record→upload→submit flow with the 4-KEY request oracle,
 * codec variants, silent/keyless submit, offline (zero of all four while offline) +
 * reconnect, multi-tab, read-only zero-save, and the isolated-leaf render count.
 */
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import { I18nextProvider } from 'react-i18next'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import i18n from '@/lib/i18n'
import { server } from '@/test/msw-server'
import { createTestQueryClient } from '@/lib/query-client'
import { useAttemptStore } from '@/stores/attemptStore'
import type { components } from '@/lib/api/client'
import { SpeakingAttemptShell } from '../SpeakingAttemptShell'
import { installMediaMocks, type MediaMockController } from '../../test/mockMediaRecorder'

vi.mock('sonner', () => ({
  toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn() },
  Toaster: () => null,
}))

type AttemptBundle = components['schemas']['AttemptBundle']
type SubmissionContent = components['schemas']['SubmissionContent']

const SUBMISSION_ID = 'sub-sp1'
const SERVER_NOW = '2026-08-10T00:00:00Z'
const R2_HOST = 'https://r2-mock.example.com'

function bundle(overrides: {
  content?: SubmissionContent
  assignmentStatus?: string
  hardDeadlineAt?: string | null
  timeBudgetSeconds?: number | null
}): AttemptBundle {
  return {
    submission: {
      id: SUBMISSION_ID,
      centerId: 'c-1',
      assignmentId: 'a-1',
      studentId: 'user-student',
      status: 'in_progress',
      isLate: false,
      appliedPenalty: 0,
      startedAt: SERVER_NOW,
      submittedAt: null,
      timeBudgetSeconds: overrides.timeBudgetSeconds ?? null,
      schemaVersion: 1,
      content: overrides.content ?? {},
      createdAt: SERVER_NOW,
      updatedAt: SERVER_NOW,
    },
    assignment: {
      id: 'a-1',
      exerciseId: 'ex-1',
      classId: 'cl-1',
      status: (overrides.assignmentStatus ?? 'open') as AttemptBundle['assignment']['status'],
      deadlineAt: '2026-08-20T00:00:00Z',
      hardDeadlineAt: overrides.hardDeadlineAt ?? null,
      instructions: null,
      latePenalty: 0,
      createdAt: SERVER_NOW,
      updatedAt: SERVER_NOW,
    },
    exercise: {
      id: 'ex-1',
      title: 'IELTS Speaking Part 2',
      skill: 'speaking',
      settings: { timeLimitEnabled: false, timeLimitMinutes: 0, caseSensitive: false },
      sections: [
        {
          type: 'speaking',
          title: 'Cue card',
          content: 'Describe a memorable journey you have taken.',
          questionGroups: [],
        },
      ],
    },
  }
}

interface Counts {
  presign: number
  r2put: number
  confirm: number
  progress: number
  submit: number
}
let counts: Counts
let progressBodies: Array<Record<string, unknown>>

function installHandlers(opts: { putStatus?: number } = {}): void {
  counts = { presign: 0, r2put: 0, confirm: 0, progress: 0, submit: 0 }
  progressBodies = []
  server.use(
    http.post('/api/uploads/presign', () => {
      counts.presign += 1
      const key = `c-1/speaking/${counts.presign}.webm`
      return HttpResponse.json({ data: { url: `${R2_HOST}/${key}`, key } })
    }),
    http.put(`${R2_HOST}/*`, () => {
      counts.r2put += 1
      return new HttpResponse(null, { status: opts.putStatus ?? 200 })
    }),
    http.post('/api/uploads/confirm', () => {
      counts.confirm += 1
      return HttpResponse.json({ data: { key: 'k', contentType: 'audio/webm', size: 1 } })
    }),
    http.put(`/api/submissions/${SUBMISSION_ID}/progress`, async ({ request }) => {
      counts.progress += 1
      progressBodies.push((await request.json()) as Record<string, unknown>)
      return HttpResponse.json({ data: {}, meta: { serverTime: SERVER_NOW } })
    }),
    http.post(`/api/submissions/${SUBMISSION_ID}/submit`, () => {
      counts.submit += 1
      return HttpResponse.json({ data: {}, meta: { serverTime: SERVER_NOW } })
    }),
  )
}

let media: MediaMockController
let clock: number
const onSubmitted = vi.fn()

function renderShell(props: Partial<React.ComponentProps<typeof SpeakingAttemptShell>> = {}) {
  const client = createTestQueryClient()
  // A DATA router (createMemoryRouter + RouterProvider), not <MemoryRouter>, so the
  // shell's `useBlocker` in-app-nav guard works (it requires a data router, as the
  // app uses in production).
  const element = (
    <SpeakingAttemptShell
      submissionId={SUBMISSION_ID}
      bundle={props.bundle ?? bundle({})}
      serverTime={SERVER_NOW}
      perfAtLoad={0}
      perfNow={() => 0}
      recorderNow={() => clock}
      onSubmitted={onSubmitted}
      {...props}
    />
  )
  const router = createMemoryRouter(
    [
      { path: '/assignments/:assignmentId/speak', element },
      { path: '*', element: <div data-testid="nav-destination" /> },
    ],
    { initialEntries: ['/assignments/a-1/speak'] },
  )
  return {
    ...render(
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={client}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </I18nextProvider>,
    ),
    router,
  }
}

async function recordATake(durationMs = 5000): Promise<void> {
  await userEvent.click(screen.getByTestId('speaking-prep-skip'))
  await userEvent.click(screen.getByTestId('speaking-record-button'))
  await screen.findByTestId('speaking-recording')
  clock = durationMs
  await userEvent.click(screen.getByTestId('speaking-stop-button'))
  await screen.findByTestId('speaking-preview')
}

beforeEach(() => {
  media = installMediaMocks()
  clock = 0
  onSubmitted.mockClear()
  useAttemptStore.getState().reset()
  vi.useRealTimers()
})
afterEach(() => {
  media.restore()
  useAttemptStore.getState().reset()
})

describe('P0 — record → preview → submit (E2E-J7-001)', () => {
  test('webm: full flow → 4-key chain, ONE /progress PUT carries the key, submit → confirmation', async () => {
    installHandlers()
    renderShell()
    await recordATake(5000)
    await userEvent.click(screen.getByTestId('speaking-submit-open'))
    await userEvent.click(await screen.findByTestId('speaking-submit-confirm'))

    await waitFor(() => expect(onSubmitted).toHaveBeenCalledTimes(1))
    expect(counts.presign).toBe(1)
    expect(counts.r2put).toBe(1)
    expect(counts.confirm).toBe(1)
    expect(counts.progress).toBe(1)
    expect(counts.submit).toBe(1)
    // The single /progress PUT carries the uploaded key + canonical contentType.
    const content = progressBodies[0].content as Record<string, unknown>
    expect(content.audioKey).toBe('c-1/speaking/1.webm')
    expect(content.contentType).toBe('audio/webm')
  })

  test('mp4 variant (iOS Safari): presign carries audio/mp4 + .m4a key', async () => {
    installHandlers()
    media.setSupported((t) => t === 'audio/mp4')
    server.use(
      http.post('/api/uploads/presign', () => {
        counts.presign += 1
        const key = `c-1/speaking/${counts.presign}.m4a`
        return HttpResponse.json({ data: { url: `${R2_HOST}/${key}`, key } })
      }),
    )
    renderShell()
    await recordATake(4000)
    await userEvent.click(screen.getByTestId('speaking-submit-open'))
    await userEvent.click(await screen.findByTestId('speaking-submit-confirm'))
    await waitFor(() => expect(onSubmitted).toHaveBeenCalled())
    const content = progressBodies[0].content as Record<string, unknown>
    expect(content.contentType).toBe('audio/mp4')
    expect(content.audioKey).toContain('.m4a')
  })

  test('re-record revokes the prior take object-URL', async () => {
    installHandlers()
    renderShell()
    await recordATake(3000)
    const audio = screen.getByTestId('speaking-preview-audio') as HTMLAudioElement
    const firstUrl = audio.getAttribute('src')
    await userEvent.click(screen.getByTestId('speaking-rerecord'))
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(firstUrl)
  })
})

describe('submit safety (AC18, Sally B3)', () => {
  test('silent/short take → the submit sheet shows the "no usable recording" warning', async () => {
    installHandlers()
    renderShell()
    await recordATake(1000) // 1s < SPEAKING_MIN_DURATION_SEC
    await userEvent.click(screen.getByTestId('speaking-submit-open'))
    expect(await screen.findByTestId('speaking-submit-nousable')).toBeInTheDocument()
  })

  test('no-recording (keyless) path submits cleanly, ZERO upload', async () => {
    installHandlers()
    renderShell()
    await userEvent.click(screen.getByTestId('speaking-prep-skip'))
    await userEvent.click(screen.getByTestId('speaking-submit-open'))
    expect(await screen.findByTestId('speaking-submit-nousable')).toBeInTheDocument()
    await userEvent.click(screen.getByTestId('speaking-submit-confirm'))
    await waitFor(() => expect(onSubmitted).toHaveBeenCalled())
    expect(counts.presign).toBe(0)
    expect(counts.r2put).toBe(0)
    expect(counts.submit).toBe(1)
  })
})

describe('offline (AC15) + reconnect', () => {
  test('recording offline fires ZERO of all four request types + shows the honest banner', async () => {
    installHandlers()
    const onLineSpy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    try {
      renderShell()
      act(() => window.dispatchEvent(new Event('offline')))
      await recordATake(5000)
      expect(screen.getByTestId('speaking-offline-banner')).toHaveTextContent(
        i18n.t('speaking.offline.reassurance'),
      )
      expect(counts).toEqual({ presign: 0, r2put: 0, confirm: 0, progress: 0, submit: 0 })
    } finally {
      onLineSpy.mockRestore()
    }
  })

  test('reconnect auto-uploads the held take then flushes the key', async () => {
    installHandlers()
    const onLineSpy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    renderShell()
    act(() => window.dispatchEvent(new Event('offline')))
    await recordATake(5000)
    expect(counts.presign).toBe(0)
    // Back online → the live online handler auto-uploads.
    onLineSpy.mockReturnValue(true)
    act(() => window.dispatchEvent(new Event('online')))
    await waitFor(() => expect(counts.presign).toBe(1))
    await waitFor(() => expect(counts.progress).toBeGreaterThanOrEqual(1))
    onLineSpy.mockRestore()
  })
})

describe('multi-tab (AC17)', () => {
  test('a foreign submit → blocking overlay, ZERO further requests, orphan warning for the held take', async () => {
    installHandlers()
    renderShell()
    await recordATake(5000) // held, un-uploaded
    const channel = new BroadcastChannel(`classlite:attempt:${SUBMISSION_ID}`)
    act(() => channel.postMessage({ type: 'submitted', senderId: 'other-tab' }))
    expect(await screen.findByTestId('speaking-submitted-elsewhere-overlay')).toBeInTheDocument()
    expect(
      screen.getByTestId('speaking-submitted-elsewhere-orphan-warning'),
    ).toBeInTheDocument()
    expect(counts).toEqual({ presign: 0, r2put: 0, confirm: 0, progress: 0, submit: 0 })
    channel.close()
  })
})

describe('read-only (AC19)', () => {
  test('a closed assignment → read-only banner, no record button, zero requests', async () => {
    installHandlers()
    renderShell({ bundle: bundle({ assignmentStatus: 'closed' }) })
    expect(await screen.findByTestId('speaking-readonly-banner')).toBeInTheDocument()
    expect(screen.queryByTestId('speaking-submit-open')).not.toBeInTheDocument()
    expect(counts).toEqual({ presign: 0, r2put: 0, confirm: 0, progress: 0, submit: 0 })
  })
})

describe('isolated recorder leaf (AC2, D6) — functional', () => {
  test('recorder elapsed advances across ticks (leaf-local); the rigorous render-count spy lives in the leaf test', async () => {
    installHandlers()
    vi.useFakeTimers({ shouldAdvanceTime: true })
    renderShell()
    await userEvent.click(screen.getByTestId('speaking-prep-skip'))
    await userEvent.click(screen.getByTestId('speaking-record-button'))
    await screen.findByTestId('speaking-recording')
    await act(async () => {
      clock = 3000
      vi.advanceTimersByTime(3000)
    })
    expect(screen.getByTestId('speaking-elapsed')).toHaveTextContent('0:03')
    vi.useRealTimers()
  })
})

// Code-review follow-ups (Story 5.4 review, 2026-08-11).
describe('review: read-only flip mid-recording (AC19) + overlay inert (AC17)', () => {
  test('a foreign submit MID-RECORDING stops the recorder (mic released) + zero requests', async () => {
    installHandlers()
    renderShell()
    await userEvent.click(screen.getByTestId('speaking-prep-skip'))
    await userEvent.click(screen.getByTestId('speaking-record-button'))
    await screen.findByTestId('speaking-recording')
    const track = media.latestStream?.getAudioTracks()[0]
    expect(track?.stopped).toBe(false)

    const channel = new BroadcastChannel(`classlite:attempt:${SUBMISSION_ID}`)
    act(() => channel.postMessage({ type: 'submitted', senderId: 'other-tab' }))
    await screen.findByTestId('speaking-submitted-elsewhere-overlay')

    await waitFor(() => expect(track?.stopped).toBe(true)) // no hot mic behind the lock
    expect(counts).toEqual({ presign: 0, r2put: 0, confirm: 0, progress: 0, submit: 0 })
    channel.close()
  })

  test('background content is inert while the submitted-elsewhere overlay is up (AC17)', async () => {
    installHandlers()
    renderShell()
    await recordATake(5000)
    expect(screen.getByTestId('speaking-shell-content')).not.toHaveAttribute('inert')

    const channel = new BroadcastChannel(`classlite:attempt:${SUBMISSION_ID}`)
    act(() => channel.postMessage({ type: 'submitted', senderId: 'other-tab' }))
    await screen.findByTestId('speaking-submitted-elsewhere-overlay')
    expect(screen.getByTestId('speaking-shell-content')).toHaveAttribute('inert')
    channel.close()
  })
})

describe('review: silent failed upload → banner + manual retry (AC13/AC15)', () => {
  test('a failed reconnect upload shows the failed banner; retry re-uploads and flushes', async () => {
    installHandlers()
    // A non-retryable presign (413) fails the reconnect upload FAST (no backoff).
    server.use(
      http.post('/api/uploads/presign', () =>
        HttpResponse.json({ error: { code: 'FILE_TOO_LARGE' } }, { status: 413 }),
      ),
    )
    const onLineSpy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    renderShell()
    act(() => window.dispatchEvent(new Event('offline')))
    await recordATake(5000)

    onLineSpy.mockReturnValue(true)
    act(() => window.dispatchEvent(new Event('online')))
    // The auto-upload fails → the previously-silent case now surfaces a banner.
    expect(await screen.findByTestId('speaking-upload-failed')).toBeInTheDocument()

    // Restore a working upload path, then manual retry re-uploads + flushes the key.
    installHandlers()
    await userEvent.click(screen.getByTestId('speaking-upload-retry'))
    await waitFor(() => expect(counts.progress).toBeGreaterThanOrEqual(1))
    expect(counts.presign).toBe(1)
    onLineSpy.mockRestore()
  })
})

describe('review: submit-without-audio escape on upload failure (AC20)', () => {
  test('the retry dialog offers a keyless escape that finalizes without the take', async () => {
    installHandlers()
    renderShell()
    await recordATake(5000)
    // The submit-time upload fails fast (413) → retry dialog opens.
    server.use(
      http.post('/api/uploads/presign', () =>
        HttpResponse.json({ error: { code: 'FILE_TOO_LARGE' } }, { status: 413 }),
      ),
    )
    await userEvent.click(screen.getByTestId('speaking-submit-open'))
    await userEvent.click(await screen.findByTestId('speaking-submit-confirm'))

    const withoutAudio = await screen.findByTestId('speaking-submit-without-audio')
    await userEvent.click(withoutAudio)

    await waitFor(() => expect(onSubmitted).toHaveBeenCalledTimes(1))
    // Keyless finalize: submitted, and no presign/PUT was issued by the escape.
    expect(counts.submit).toBe(1)
    const lastContent = progressBodies.at(-1)?.content as Record<string, unknown> | undefined
    expect(lastContent?.audioKey ?? '').toBe('')
  })
})

describe('review: in-app nav guard (useBlocker, AC15)', () => {
  test('navigating away with a held un-uploaded take prompts a leave confirm; confirm proceeds', async () => {
    installHandlers()
    const { router } = renderShell()
    await recordATake(5000) // held, un-uploaded

    await act(async () => {
      await router.navigate('/somewhere-else')
    })
    expect(await screen.findByTestId('speaking-leave-confirm')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/assignments/a-1/speak') // still blocked

    await userEvent.click(screen.getByTestId('speaking-leave-confirm-action'))
    await waitFor(() => expect(router.state.location.pathname).toBe('/somewhere-else'))
  })
})
