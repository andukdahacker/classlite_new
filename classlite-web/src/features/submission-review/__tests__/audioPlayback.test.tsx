// Story 5.5a Task 4 (WF-8, risk 6) — hybrid speaking playback, MSW-only seam.
// The hybrid-audio crux (Murat: jsdom never truly loads media → drive it with
// synthetic events). Covers AC10/D8: P1-4 inline first-paint (no network on
// mount), P1-5 play-intent refresh of a stale (>~4min) URL with a "Loading your
// recording…" affordance, P1-6 synthetic <audio> error recovery — one refresh,
// second error → a RECOVERABLE retry (never a terminal "unavailable"), and a mint
// that itself 4xxs → still the recoverable retry. The <audio> is labelled +
// keyboard reachable.
//
// RED-PHASE (Story 5.5a, WF-8 risk-6). Excluded from `vitest run` (filename lacks
// `.test`/`.spec`). Dev renames `.red.tsx`→`.test.tsx` per file as each contract
// lands. `tsc --noEmit` red until the feature module + codegen exist (missing
// `@/features/submission-review/*` + `components['schemas']['EnvelopeAudioUrl']`).
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { HttpResponse, delay, http } from 'msw'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import i18n from '@/lib/i18n'
import { server } from '@/test/msw-server'
import { createTestQueryClient } from '@/lib/query-client'
import type { components } from '@/lib/api/client'
// RED: this component does not exist yet (Task 4).
import { ResultSpeakingPlayback } from '@/features/submission-review'

type Submission = components['schemas']['Submission']

const ASSIGNMENT_ID = 'a-1'
const AUDIO_PATH = `/api/assignments/${ASSIGNMENT_ID}/submission/audio`
const INLINE_URL = 'https://r2/inline-take.m4a'
const FRESH_URL = 'https://r2/fresh-take.m4a'

function speakingSubmission(): Submission {
  return {
    id: 'sub-5',
    centerId: 'c-1',
    assignmentId: ASSIGNMENT_ID,
    studentId: 'user-student',
    status: 'submitted',
    isLate: false,
    appliedPenalty: 0,
    startedAt: '2026-08-13T00:00:00Z',
    submittedAt: '2026-08-13T12:00:00Z',
    timeBudgetSeconds: null,
    schemaVersion: 1,
    content: { schemaVersion: 1, audioKey: 'c-1/rec.m4a', contentType: 'audio/mp4', durationSec: 30 },
    createdAt: '2026-08-13T00:00:00Z',
    updatedAt: '2026-08-13T12:00:00Z',
  }
}

/** Track mint calls so we can assert zero-on-mount + exactly-one-per-recovery. */
const calls = { audio: 0 }

interface AudioHandlerOpts {
  freshUrl?: string
  status?: number
  errorCode?: string
  slow?: boolean
}

function installAudio(opts: AudioHandlerOpts = {}) {
  server.use(
    http.get(AUDIO_PATH, async () => {
      calls.audio += 1
      if (opts.slow) await delay(20)
      if (opts.errorCode) {
        return HttpResponse.json(
          { error: { code: opts.errorCode, message: 'x', requestId: 'r' } },
          { status: opts.status ?? 403 },
        )
      }
      return HttpResponse.json({
        data: { url: opts.freshUrl ?? FRESH_URL },
        meta: { serverTime: '2026-08-14T00:00:00Z' },
      })
    }),
  )
}

function isoAgoMs(ms: number): string {
  return new Date(Date.now() - ms).toISOString()
}

function renderPlayback(props: {
  audioUrl?: string | null
  audioUrlMintedAt?: string
}) {
  const client = createTestQueryClient()
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ResultSpeakingPlayback
            assignmentId={ASSIGNMENT_ID}
            submission={speakingSubmission()}
            audioUrl={props.audioUrl ?? INLINE_URL}
            // Pinned prop: when the inline URL was minted; the component refreshes
            // on play-intent when this is older than ~4min (mirrors useFileDownloadUrl).
            audioUrlMintedAt={props.audioUrlMintedAt ?? new Date().toISOString()}
          />
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  )
}

beforeEach(() => {
  calls.audio = 0
})
afterEach(async () => {
  server.resetHandlers()
  if (i18n.language !== 'en') await i18n.changeLanguage('en')
})

describe('ResultSpeakingPlayback — inline first paint (P1-4/AC10)', () => {
  test('renders <audio controls> src === inline audioUrl, with NO network on mount', async () => {
    installAudio()
    renderPlayback({ audioUrl: INLINE_URL, audioUrlMintedAt: new Date().toISOString() })
    const audio = await screen.findByTestId('result-speaking-audio')
    expect(audio).toHaveAttribute('controls')
    expect((audio as HTMLAudioElement).src).toContain('inline-take.m4a')
    // First paint costs no extra RTT — the on-demand mint was NOT called.
    await Promise.resolve()
    expect(calls.audio).toBe(0)
  })

  test('the <audio> is labelled and keyboard reachable', async () => {
    installAudio()
    renderPlayback({})
    const audio = await screen.findByTestId('result-speaking-audio')
    expect(audio).toHaveAccessibleName(i18n.t('submissionReview.audio.label'))
    expect(audio).toHaveAttribute('controls') // native controls are focusable
    expect(i18n.exists('submissionReview.audio.label', { lng: 'en' })).toBe(true)
    expect(i18n.exists('submissionReview.audio.label', { lng: 'vi' })).toBe(true)
  })
})

describe('ResultSpeakingPlayback — play-intent refresh of a stale URL (P1-5/AC10)', () => {
  test('a >4min-old inline URL is refreshed on play-intent, with a "Loading…" affordance, before erroring', async () => {
    installAudio({ slow: true }) // observe the loading state
    renderPlayback({ audioUrl: INLINE_URL, audioUrlMintedAt: isoAgoMs(5 * 60 * 1000) })
    const audio = await screen.findByTestId('result-speaking-audio')

    fireEvent.play(audio)

    // "Loading your recording…" shows during the refresh.
    expect(await screen.findByText(i18n.t('submissionReview.audio.loading'))).toBeInTheDocument()
    // The mint was called and the src swapped to the fresh URL.
    await waitFor(() =>
      expect((screen.getByTestId('result-speaking-audio') as HTMLAudioElement).src).toContain(
        'fresh-take.m4a',
      ),
    )
    expect(calls.audio).toBe(1)
    // The refresh happened proactively — no error state was shown.
    expect(screen.queryByTestId('result-speaking-retry')).not.toBeInTheDocument()
    expect(i18n.exists('submissionReview.audio.loading', { lng: 'en' })).toBe(true)
    expect(i18n.exists('submissionReview.audio.loading', { lng: 'vi' })).toBe(true)
  })
})

describe('ResultSpeakingPlayback — synthetic error recovery (P1-6/AC10, Murat)', () => {
  test('an <audio> error fires exactly ONE on-demand refresh and swaps the src', async () => {
    installAudio()
    renderPlayback({ audioUrl: INLINE_URL, audioUrlMintedAt: new Date().toISOString() })
    const audio = await screen.findByTestId('result-speaking-audio')

    fireEvent.error(audio)

    await waitFor(() =>
      expect((screen.getByTestId('result-speaking-audio') as HTMLAudioElement).src).toContain(
        'fresh-take.m4a',
      ),
    )
    expect(calls.audio).toBe(1)
  })

  test('a SECOND error after the refresh → a RECOVERABLE "tap to try again", never terminal', async () => {
    installAudio()
    renderPlayback({ audioUrl: INLINE_URL, audioUrlMintedAt: new Date().toISOString() })
    const audio = await screen.findByTestId('result-speaking-audio')

    fireEvent.error(audio) // first error → one refresh
    await waitFor(() =>
      expect((screen.getByTestId('result-speaking-audio') as HTMLAudioElement).src).toContain(
        'fresh-take.m4a',
      ),
    )
    fireEvent.error(screen.getByTestId('result-speaking-audio')) // second error → recoverable retry

    const retry = await screen.findByTestId('result-speaking-retry')
    expect(retry).toHaveTextContent(i18n.t('submissionReview.audio.retry'))
    // Recoverable, NOT a terminal "unavailable".
    expect(screen.queryByTestId('result-speaking-unavailable')).not.toBeInTheDocument()
    // Exactly one refresh fired (the second error only surfaced the retry affordance).
    expect(calls.audio).toBe(1)
    expect(i18n.exists('submissionReview.audio.retry', { lng: 'en' })).toBe(true)
    expect(i18n.exists('submissionReview.audio.retry', { lng: 'vi' })).toBe(true)
  })

  test('a mint that itself 4xxs → the recoverable retry (still not terminal)', async () => {
    installAudio({ status: 403, errorCode: 'R2_KEY_PREFIX_MISMATCH' })
    renderPlayback({ audioUrl: INLINE_URL, audioUrlMintedAt: new Date().toISOString() })
    const audio = await screen.findByTestId('result-speaking-audio')

    fireEvent.error(audio)

    const retry = await screen.findByTestId('result-speaking-retry')
    expect(retry).toHaveTextContent(i18n.t('submissionReview.audio.retry'))
    expect(screen.queryByTestId('result-speaking-unavailable')).not.toBeInTheDocument()
    expect(calls.audio).toBe(1)
  })
})
