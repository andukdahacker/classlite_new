/**
 * Story 6.3a (AC1/AC2/AC3/AC6/AC14 · D6/D7) — RED PHASE. The from-scratch Web-Audio
 * waveform player. jsdom has NO Web Audio, NO canvas 2D context, and returns ZERO
 * client rects — so every one of those is stubbed here (party: Murat: un-stubbed
 * getBoundingClientRect makes click-to-pin silently compute 0 and pass for the WRONG
 * reason). The pin-time-at-2× test is the headline: a pin is `audio.currentTime`,
 * SPEED-INDEPENDENT — never elapsed-listening × playbackRate.
 *
 * FAILS at import today: `@/components/domain/AudioWaveformPlayer` does not exist.
 *
 * SEAM (dev, green phase) — the prop contract this pins:
 *   interface AudioWaveformPlayerProps {
 *     audioUrl: string
 *     durationMs: number
 *     pins?: ReadonlyArray<{ id: string; timestampMs: number }>
 *     onPinAtPlayhead: (timestampMs: number) => void   // "Pin here" btn + `P`
 *     onSeekToPin?: (id: string) => void               // rail card → seek
 *     onRefreshUrl?: () => Promise<string>             // stale/404 re-sign (AC2/D6)
 *   }
 * Behaviors: fetch(audioUrl) → AudioContext.decodeAudioData → computePeaks → <canvas>;
 * labeled "Preparing audio…" skeleton while decoding; play/pause; waveform click =
 * SEEK ONLY; speed cycle 0.5/1/1.5/2×; keyboard ←/→ ±5s, Shift+←/→ ±30s, Space, `P`;
 * aria-live time readout. Missing/corrupt (D6): a 404 (after ONE onRefreshUrl retry)
 * or a decodeAudioData throw → "Ask student to re-record"; a transient 5xx/network →
 * inline retry, NEVER "re-record".
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { axe } from 'vitest-axe'

import i18n from '@/lib/i18n'
import { AudioWaveformPlayer } from '@/components/domain/AudioWaveformPlayer'

// ---- Fakes -----------------------------------------------------------------

class FakeAudioBuffer {
  duration: number
  numberOfChannels = 1
  sampleRate = 44_100
  length: number
  constructor(durationSec: number) {
    this.duration = durationSec
    this.length = Math.floor(durationSec * this.sampleRate)
  }
  getChannelData(): Float32Array {
    return new Float32Array(2048).fill(0.3)
  }
}

// Tests flip this to force a decode failure (corrupt file, AC3).
let decodeImpl: () => Promise<FakeAudioBuffer> = async () => new FakeAudioBuffer(278) // 4:38

class FakeAudioContext {
  decodeAudioData = vi.fn(() => decodeImpl())
  close = vi.fn(async () => {})
}

function stubFetchOk() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(new ArrayBuffer(8), { status: 200 })),
  )
}

function renderPlayer(props: Partial<Parameters<typeof AudioWaveformPlayer>[0]> = {}) {
  return render(
    <I18nextProvider i18n={i18n}>
      <AudioWaveformPlayer
        audioUrl="https://r2.example/center-a/speaking/x.webm?sig=1"
        durationMs={278_000}
        onPinAtPlayhead={props.onPinAtPlayhead ?? vi.fn()}
        {...props}
      />
    </I18nextProvider>,
  )
}

// ---- jsdom capability stubs ------------------------------------------------

beforeEach(() => {
  decodeImpl = async () => new FakeAudioBuffer(278)
  vi.stubGlobal('AudioContext', FakeAudioContext as unknown as typeof AudioContext)
  // Some browsers still expose the prefixed ctor; the player should feature-detect.
  vi.stubGlobal('webkitAudioContext', FakeAudioContext as unknown as typeof AudioContext)

  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    scale: vi.fn(),
    fillStyle: '',
    strokeStyle: '',
  } as unknown as CanvasRenderingContext2D)

  // jsdom returns an all-zero rect; a 600px-wide waveform makes click→seek meaningful.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 0, top: 0, left: 0, right: 600, bottom: 80, width: 600, height: 80, toJSON: () => ({}),
  } as DOMRect)

  // jsdom does not implement media playback.
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(async () => {})
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})

  stubFetchOk()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

// ---- AC1 render ------------------------------------------------------------

describe('AudioWaveformPlayer — render + transport (AC1/AC14)', () => {
  test('shows a labeled "Preparing audio…" skeleton while decoding, then the canvas', async () => {
    renderPlayer()
    // Labeled, not a mute skeleton (AC12).
    expect(screen.getByText(i18n.t('speakingGrading.state.preparingAudio'))).toBeInTheDocument()
    await waitFor(() => expect(document.querySelector('canvas')).toBeInTheDocument())
  })

  test('play/pause and speed cycle 0.5×/1×/1.5×/2× are reachable by role+label', async () => {
    renderPlayer()
    await waitFor(() => expect(document.querySelector('canvas')).toBeInTheDocument())

    const play = screen.getByRole('button', { name: /play/i })
    fireEvent.click(play)
    expect(screen.getByRole('button', { name: /pause/i })).toBeInTheDocument()

    const speed = screen.getByRole('button', { name: /speed/i })
    const audio = document.querySelector('audio') as HTMLAudioElement
    // 1× → 1.5× → 2× → 0.5× → 1× (the four-step cycle drives playbackRate).
    fireEvent.click(speed)
    expect(audio.playbackRate).toBe(1.5)
    fireEvent.click(speed)
    expect(audio.playbackRate).toBe(2)
    fireEvent.click(speed)
    expect(audio.playbackRate).toBe(0.5)
    fireEvent.click(speed)
    expect(audio.playbackRate).toBe(1)
  })

  test('exposes an aria-live time read-out', async () => {
    renderPlayer()
    await waitFor(() => expect(document.querySelector('canvas')).toBeInTheDocument())
    const live = document.querySelector('[aria-live]')
    expect(live).not.toBeNull()
    expect(live?.textContent ?? '').toMatch(/4:38/) // total duration in the readout
  })
})

// ---- AC6 pin-at-playhead, SPEED-INDEPENDENT --------------------------------

describe('AudioWaveformPlayer — Pin here (AC6/D7)', () => {
  test('"Pin here" pins at audio.currentTime — SPEED-INDEPENDENT (pin at 2×)', async () => {
    const onPinAtPlayhead = vi.fn()
    renderPlayer({ onPinAtPlayhead })
    await waitFor(() => expect(document.querySelector('canvas')).toBeInTheDocument())

    const audio = document.querySelector('audio') as HTMLAudioElement
    // Simulate: teacher listened at 2×, playhead is at 30.0s of real audio time.
    fireEvent.click(screen.getByRole('button', { name: /speed/i })) // → 1.5
    fireEvent.click(screen.getByRole('button', { name: /speed/i })) // → 2×
    audio.currentTime = 30
    fireEvent.timeUpdate(audio)

    fireEvent.click(screen.getByRole('button', { name: /pin here/i }))
    // 30_000ms — NOT 30_000 × 2. Pin time is real audio time, never elapsed × rate.
    expect(onPinAtPlayhead).toHaveBeenCalledWith(30_000)
  })

  test('the `P` key pins at the playhead too', async () => {
    const onPinAtPlayhead = vi.fn()
    const { container } = renderPlayer({ onPinAtPlayhead })
    await waitFor(() => expect(document.querySelector('canvas')).toBeInTheDocument())
    const audio = document.querySelector('audio') as HTMLAudioElement
    audio.currentTime = 12.5
    fireEvent.timeUpdate(audio)

    const transport = container.querySelector('[data-testid="waveform-transport"]') ?? container.firstElementChild!
    fireEvent.keyDown(transport, { key: 'p' })
    expect(onPinAtPlayhead).toHaveBeenCalledWith(12_500)
  })

  test('clicking a rail pin seeks the playhead (bidirectional), does NOT pin', async () => {
    const onPinAtPlayhead = vi.fn()
    const onSeekToPin = vi.fn()
    renderPlayer({
      onPinAtPlayhead,
      onSeekToPin,
      pins: [{ id: 'p1', timestampMs: 42_000 }],
    })
    await waitFor(() => expect(document.querySelector('canvas')).toBeInTheDocument())
    // A click on the waveform is SEEK ONLY — it must not create a pin (D7 collision fix).
    fireEvent.click(document.querySelector('canvas')!)
    expect(onPinAtPlayhead).not.toHaveBeenCalled()
  })
})

// ---- AC14 keyboard model ---------------------------------------------------

describe('AudioWaveformPlayer — keyboard operability (AC14/D7)', () => {
  test('←/→ seek ±5s, Shift+←/→ seek ±30s, Space toggles play/pause', async () => {
    const { container } = renderPlayer()
    await waitFor(() => expect(document.querySelector('canvas')).toBeInTheDocument())
    const audio = document.querySelector('audio') as HTMLAudioElement
    const transport = container.querySelector('[data-testid="waveform-transport"]') ?? container.firstElementChild!
    audio.currentTime = 60
    fireEvent.timeUpdate(audio)

    fireEvent.keyDown(transport, { key: 'ArrowRight' })
    expect(audio.currentTime).toBeCloseTo(65, 3)
    fireEvent.keyDown(transport, { key: 'ArrowLeft' })
    expect(audio.currentTime).toBeCloseTo(60, 3)
    fireEvent.keyDown(transport, { key: 'ArrowRight', shiftKey: true })
    expect(audio.currentTime).toBeCloseTo(90, 3)
    fireEvent.keyDown(transport, { key: 'ArrowLeft', shiftKey: true })
    expect(audio.currentTime).toBeCloseTo(60, 3)

    fireEvent.keyDown(transport, { key: ' ' })
    expect(screen.getByRole('button', { name: /pause/i })).toBeInTheDocument()
  })
})

// ---- AC3 / D6 missing-or-corrupt vs transient ------------------------------

describe('AudioWaveformPlayer — missing/corrupt vs transient (AC3/D6)', () => {
  test('a 404 (after one re-sign retry) → "Ask student to re-record", no waveform', async () => {
    const onRefreshUrl = vi.fn(async () => 'https://r2.example/center-a/speaking/x.webm?sig=2')
    // Both the initial GET and the re-signed retry 404.
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })))
    renderPlayer({ onRefreshUrl })

    await waitFor(() =>
      expect(screen.getByText(i18n.t('speakingGrading.state.reRecord'))).toBeInTheDocument(),
    )
    expect(onRefreshUrl).toHaveBeenCalledTimes(1) // exactly one re-sign before giving up
    expect(document.querySelector('canvas')).not.toBeInTheDocument()
  })

  test('a decodeAudioData throw on a fetched-OK file → "Ask student to re-record"', async () => {
    decodeImpl = async () => {
      throw new Error('corrupt')
    }
    renderPlayer()
    await waitFor(() =>
      expect(screen.getByText(i18n.t('speakingGrading.state.reRecord'))).toBeInTheDocument(),
    )
  })

  test('a transient 5xx → inline retry, NEVER "re-record" (D6 no false positive)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 503 })))
    renderPlayer()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument(),
    )
    expect(screen.queryByText(i18n.t('speakingGrading.state.reRecord'))).not.toBeInTheDocument()
  })
})

// ---- AC2 / D6 URL freshness + playback robustness (code-review fixes) -------

describe('AudioWaveformPlayer — playback robustness (AC2/D6)', () => {
  test('a play() rejection rolls back to "Play" — never a stuck "Pause"', async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(async () => {
      throw new Error('NotAllowedError')
    })
    renderPlayer()
    await waitFor(() => expect(document.querySelector('canvas')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /play/i }))
    // The optimistic flip rolls back once the rejected promise settles.
    await waitFor(() => expect(screen.getByRole('button', { name: /play/i })).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /pause/i })).not.toBeInTheDocument()
  })

  test('an <audio> error re-signs the URL once (playback-path recovery, AC2)', async () => {
    const onRefreshUrl = vi.fn(async () => 'https://r2.example/center-a/speaking/x.webm?sig=fresh')
    renderPlayer({ onRefreshUrl })
    await waitFor(() => expect(document.querySelector('canvas')).toBeInTheDocument())
    fireEvent.error(document.querySelector('audio') as HTMLAudioElement)
    await waitFor(() => expect(onRefreshUrl).toHaveBeenCalledTimes(1))
  })

  test('Space on a focused transport button is NOT hijacked into play/pause (P8/WCAG)', async () => {
    renderPlayer()
    await waitFor(() => expect(document.querySelector('canvas')).toBeInTheDocument())
    // A keydown bubbling from a child button (target !== the group) must fall through to
    // the button's native activation, not the group's Space→play handler.
    fireEvent.keyDown(screen.getByTestId('waveform-pin-here'), { key: ' ' })
    expect(screen.getByRole('button', { name: /play/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /pause/i })).not.toBeInTheDocument()
  })
})

// ---- AC14 a11y -------------------------------------------------------------

describe('AudioWaveformPlayer — accessibility (AC14)', () => {
  test('the player has no axe violations', async () => {
    const { container } = renderPlayer()
    await waitFor(() => expect(document.querySelector('canvas')).toBeInTheDocument())
    expect(await axe(container)).toHaveNoViolations()
  })
})
