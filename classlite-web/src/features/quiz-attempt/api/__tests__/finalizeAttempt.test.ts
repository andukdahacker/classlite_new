// Story 5.2b Task 2 (AC18/AC19) — the serialized finalizer + single-fire latch.
// WF-8 red list #2 (latch fires once) + terminal-409 idempotency + no-lossy-
// submit-on-flush-failure. Pure: no React, no MSW — deps are injected fns.
import { describe, expect, test, vi } from 'vitest'
import { ApiError } from '@/lib/api-fetch'
import {
  finalizeAttempt,
  type FinalizeLatch,
} from '../finalizeAttempt'
import type { components } from '@/lib/api/client'

type Submission = components['schemas']['Submission']

const FAKE_SUBMISSION = { id: 's1', status: 'submitted' } as unknown as Submission

function latch(): FinalizeLatch {
  return { current: false }
}

describe('finalizeAttempt — ordering + latch (AC18)', () => {
  test('runs flush THEN submit, in that order, exactly once each', async () => {
    const calls: string[] = []
    const flush = vi.fn(async () => {
      calls.push('flush')
    })
    const submit = vi.fn(async () => {
      calls.push('submit')
      return FAKE_SUBMISSION
    })
    const onBeforeFinalize = vi.fn(() => calls.push('before'))

    const result = await finalizeAttempt({
      flush,
      submit,
      alreadyFinalized: latch(),
      onBeforeFinalize,
    })

    expect(calls).toEqual(['before', 'flush', 'submit'])
    expect(result).toEqual({ kind: 'submitted', submission: FAKE_SUBMISSION })
    expect(flush).toHaveBeenCalledTimes(1)
    expect(submit).toHaveBeenCalledTimes(1)
  })

  test('single-fire latch — a second concurrent call is a no-op (POST once)', async () => {
    const shared = latch()
    let releaseFlush!: () => void
    const flushGate = new Promise<void>((r) => (releaseFlush = r))
    const flush = vi.fn(async () => {
      await flushGate
    })
    const submit = vi.fn(async () => FAKE_SUBMISSION)

    const first = finalizeAttempt({ flush, submit, alreadyFinalized: shared })
    // Second call arrives while the first is still awaiting flush.
    const second = await finalizeAttempt({ flush, submit, alreadyFinalized: shared })
    expect(second).toEqual({ kind: 'noop' })

    releaseFlush()
    await first
    expect(submit).toHaveBeenCalledTimes(1)
    expect(flush).toHaveBeenCalledTimes(1)
  })
})

describe('finalizeAttempt — integrity (Winston-B3 / AC19)', () => {
  test('flush failure → does NOT submit, re-opens the latch for retry', async () => {
    const shared = latch()
    const flush = vi.fn(async () => {
      throw new Error('save failed')
    })
    const submit = vi.fn(async () => FAKE_SUBMISSION)

    const result = await finalizeAttempt({ flush, submit, alreadyFinalized: shared })

    expect(result.kind).toBe('flush-failed')
    expect(submit).not.toHaveBeenCalled()
    expect(shared.current).toBe(false) // latch re-opened → retry allowed
  })

  // Review Patch #1 (CRITICAL) — a TERMINAL 409 on the flush means the server
  // already sealed the attempt (AC14 0:00 convergence / AC19 resume-finalize on
  // an already-expired attempt). It must NOT abort: fall through to submit and
  // finalize, else the expired attempt stays in_progress forever (no sweep).
  test('terminal 409 on FLUSH → falls through to submit and finalizes', async () => {
    const shared = latch()
    const calls: string[] = []
    const flush = vi.fn(async () => {
      calls.push('flush')
      throw new ApiError(409, 'TIME_EXPIRED', 'time expired', 'r')
    })
    const submit = vi.fn(async () => {
      calls.push('submit')
      return FAKE_SUBMISSION
    })

    const result = await finalizeAttempt({ flush, submit, alreadyFinalized: shared })

    expect(calls).toEqual(['flush', 'submit']) // terminal flush did NOT abort the submit
    expect(result).toEqual({ kind: 'submitted', submission: FAKE_SUBMISSION })
    expect(shared.current).toBe(true) // finalized — never stuck in_progress
  })

  test('terminal 409 on BOTH flush and submit → idempotent submitted:null, latch engaged', async () => {
    const shared = latch()
    const flush = vi.fn(async () => {
      throw new ApiError(409, 'TIME_EXPIRED', 'time expired', 'r')
    })
    const submit = vi.fn(async () => {
      throw new ApiError(409, 'SUBMISSION_LOCKED', 'locked', 'r')
    })

    const result = await finalizeAttempt({ flush, submit, alreadyFinalized: shared })

    expect(submit).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ kind: 'submitted', submission: null })
    expect(shared.current).toBe(true)
  })

  test('terminal 409 on submit → treated as already-final (idempotent), latch stays engaged', async () => {
    const shared = latch()
    const flush = vi.fn(async () => {})
    const submit = vi.fn(async () => {
      throw new ApiError(409, 'SUBMISSION_NOT_EDITABLE', 'already submitted', 'r')
    })

    const result = await finalizeAttempt({ flush, submit, alreadyFinalized: shared })

    expect(result).toEqual({ kind: 'submitted', submission: null })
    expect(shared.current).toBe(true) // stays finalized — no double POST
  })

  test('non-terminal submit failure → re-opens the latch for retry', async () => {
    const shared = latch()
    const flush = vi.fn(async () => {})
    const submit = vi.fn(async () => {
      throw new ApiError(0, 'NETWORK', 'offline', null)
    })

    const result = await finalizeAttempt({ flush, submit, alreadyFinalized: shared })

    expect(result.kind).toBe('submit-failed')
    expect(shared.current).toBe(false)
  })
})
