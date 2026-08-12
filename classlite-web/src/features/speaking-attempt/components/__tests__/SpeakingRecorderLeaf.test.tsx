/**
 * Story 5.4 Task 10 (AC2,10,11,24) — SpeakingRecorderLeaf tests. The AC2 lynchpin:
 * a render-count spy proving the recorder's 1s elapsed ticks re-render ONLY the leaf
 * subtree, never its parent (the shell). Plus the permission / interruption /
 * unsupported panels, the generic mic fallback line, and the SR record announces.
 */
import { useState } from 'react'
import { render, screen, act, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { axe } from 'vitest-axe'
import i18n from '@/lib/i18n'
import { SpeakingRecorderLeaf } from '../SpeakingRecorderLeaf'
import type { RecordedTake } from '../../hooks/useMediaRecorder'
import { installMediaMocks, type MediaMockController } from '../../test/mockMediaRecorder'

let media: MediaMockController
let clock: number

function renderLeaf(
  props: Partial<React.ComponentProps<typeof SpeakingRecorderLeaf>> = {},
  onParentRender?: () => void,
) {
  function Parent() {
    onParentRender?.()
    return (
      <SpeakingRecorderLeaf
        prompt="Describe a memorable journey."
        disabled={false}
        onTakeChange={() => {}}
        now={() => clock}
        {...props}
      />
    )
  }
  return render(
    <I18nextProvider i18n={i18n}>
      <Parent />
    </I18nextProvider>,
  )
}

beforeEach(() => {
  media = installMediaMocks()
  clock = 0
  vi.useRealTimers()
})
afterEach(() => {
  media.restore()
  vi.useRealTimers()
})

describe('AC2 — the recorder ticks do NOT re-render the parent (shell)', () => {
  // The parent holds state wired ONLY to the leaf's `onTakeChange` callback. A
  // regression that lifted the high-frequency elapsed/level state up (via ANY
  // per-tick parent notification) would re-render this parent on every tick, so the
  // `toBe(before)` assertion can actually FAIL — the old spy (no parent state,
  // no-op callback) could not detect such a regression.
  test('parent re-renders only when a take settles, never across elapsed ticks', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let parentRenders = 0
    function Parent() {
      const [, setLatestTake] = useState<RecordedTake | null>(null)
      parentRenders += 1
      return (
        <SpeakingRecorderLeaf
          prompt="Describe a memorable journey."
          disabled={false}
          onTakeChange={setLatestTake}
          now={() => clock}
        />
      )
    }
    render(
      <I18nextProvider i18n={i18n}>
        <Parent />
      </I18nextProvider>,
    )
    await userEvent.click(screen.getByTestId('speaking-prep-skip'))
    await userEvent.click(screen.getByTestId('speaking-record-button'))
    await screen.findByTestId('speaking-recording')

    const before = parentRenders
    await act(async () => {
      for (let s = 1; s <= 4; s += 1) {
        clock = s * 1000
        vi.advanceTimersByTime(1000)
      }
    })
    expect(screen.getByTestId('speaking-elapsed')).toHaveTextContent('0:04')
    // The 4 recorder ticks re-rendered the leaf but NOT the parent (AC2, D6).
    expect(parentRenders).toBe(before)

    // A settled take DOES notify the parent (proving the callback is wired) — but
    // exactly once, at low frequency, not per tick.
    clock = 5000
    vi.useRealTimers()
    await userEvent.click(screen.getByTestId('speaking-stop-button'))
    await screen.findByTestId('speaking-preview')
    expect(parentRenders).toBe(before + 1)
  })
})

describe('AC19 — a read-only flip mid-recording stops the recorder', () => {
  test('flipping disabled true while recording releases the mic (stops the stream)', async () => {
    function Wrap({ disabled }: { disabled: boolean }) {
      return (
        <I18nextProvider i18n={i18n}>
          <SpeakingRecorderLeaf
            prompt="Describe a memorable journey."
            disabled={disabled}
            onTakeChange={() => {}}
            now={() => clock}
          />
        </I18nextProvider>
      )
    }
    const { rerender } = render(<Wrap disabled={false} />)
    await userEvent.click(screen.getByTestId('speaking-prep-skip'))
    await userEvent.click(screen.getByTestId('speaking-record-button'))
    await screen.findByTestId('speaking-recording')
    const track = media.latestStream?.getAudioTracks()[0]
    expect(track?.stopped).toBe(false)

    // The attempt flips read-only (deadline tick / assignment close / foreign submit).
    rerender(<Wrap disabled={true} />)

    // The recorder stopped → the mic stream was released (no hot mic behind a lock).
    await waitFor(() => expect(track?.stopped).toBe(true))
    expect(screen.queryByTestId('speaking-recording')).not.toBeInTheDocument()
  })

  test('a locked attempt shows a disabled record button, not a ticking prep countdown', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <SpeakingRecorderLeaf
          prompt="Describe a memorable journey."
          disabled={true}
          onTakeChange={() => {}}
          now={() => clock}
        />
      </I18nextProvider>,
    )
    expect(screen.queryByTestId('speaking-prep-skip')).not.toBeInTheDocument()
    expect(screen.getByTestId('speaking-record-button')).toBeDisabled()
  })
})

describe('AC10 — record-arm failure panels', () => {
  test.each([
    ['NotAllowedError', 'permission-denied'],
    ['NotFoundError', 'no-device'],
    ['NotReadableError', 'device-busy'],
  ])('%s → the %s panel + the generic fallback line', async (domName, kind) => {
    media.rejectGetUserMedia(domName)
    renderLeaf()
    await userEvent.click(screen.getByTestId('speaking-prep-skip'))
    await userEvent.click(screen.getByTestId('speaking-record-button'))
    const panel = await screen.findByTestId('speaking-mic-panel')
    expect(panel).toHaveAttribute('data-kind', kind)
    expect(screen.getByTestId('speaking-mic-generic-fallback')).toBeInTheDocument()
  })

  test('neither codec supported → the unsupported orientation panel, no record button', async () => {
    media.setSupported(() => false)
    renderLeaf()
    const panel = await screen.findByTestId('speaking-mic-panel')
    expect(panel).toHaveAttribute('data-kind', 'unsupported')
    expect(screen.queryByTestId('speaking-record-button')).not.toBeInTheDocument()
    expect(screen.queryByTestId('speaking-prep-skip')).not.toBeInTheDocument()
  })
})

describe('AC11 — mid-recording interruption', () => {
  test('an audio-track ended mid-take → the distinct interrupted panel, no take', async () => {
    renderLeaf()
    await userEvent.click(screen.getByTestId('speaking-prep-skip'))
    await userEvent.click(screen.getByTestId('speaking-record-button'))
    await screen.findByTestId('speaking-recording')
    act(() => {
      media.latestStream?.getAudioTracks()[0].emitEnded()
    })
    expect(await screen.findByTestId('speaking-interrupted-panel')).toBeInTheDocument()
    expect(screen.queryByTestId('speaking-preview')).not.toBeInTheDocument()
  })
})

describe('AC24 — SR announces + cleanup', () => {
  test('announces "Recording started" then "Recording stopped — N seconds"', async () => {
    renderLeaf()
    await userEvent.click(screen.getByTestId('speaking-prep-skip'))
    await userEvent.click(screen.getByTestId('speaking-record-button'))
    await screen.findByTestId('speaking-recording')
    expect(screen.getByTestId('speaking-sr-announce')).toHaveTextContent(
      i18n.t('speaking.record.startedAnnounce'),
    )
    clock = 7000
    await userEvent.click(screen.getByTestId('speaking-stop-button'))
    await screen.findByTestId('speaking-preview')
    expect(screen.getByTestId('speaking-sr-announce')).toHaveTextContent(
      i18n.t('speaking.record.stoppedAnnounce', { seconds: 7 }),
    )
  })

  test('re-record revokes the prior take object-URL', async () => {
    renderLeaf()
    await userEvent.click(screen.getByTestId('speaking-prep-skip'))
    await userEvent.click(screen.getByTestId('speaking-record-button'))
    await screen.findByTestId('speaking-recording')
    clock = 3000
    await userEvent.click(screen.getByTestId('speaking-stop-button'))
    const audio = (await screen.findByTestId('speaking-preview-audio')) as HTMLAudioElement
    const url = audio.getAttribute('src')
    await userEvent.click(screen.getByTestId('speaking-rerecord'))
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(url)
  })
})

describe('a11y (axe)', () => {
  test.each([
    ['pre-record', async () => {}],
    [
      'permission-denied',
      async () => {
        media.rejectGetUserMedia('NotAllowedError')
        await userEvent.click(screen.getByTestId('speaking-prep-skip'))
        await userEvent.click(screen.getByTestId('speaking-record-button'))
        await screen.findByTestId('speaking-mic-panel')
      },
    ],
  ])('no violations — %s', async (_name, setup) => {
    const { container } = renderLeaf()
    await setup()
    expect(await axe(container)).toHaveNoViolations()
  })
})
