/**
 * useAttemptBroadcast — Story 5.3 Task 3 (AC13, Sally S6). A per-submission
 * `BroadcastChannel` (`classlite:attempt:<submissionId>`) that lets one tab tell
 * its siblings it just submitted/finalized the attempt, so a second tab can flip
 * to a blocking "Submitted in another session" overlay and issue ZERO further PUT
 * (it cannot clobber the finalized submission).
 *
 * Guards:
 *  - PRIVATE MODE (`typeof BroadcastChannel === 'undefined'`, Safari private):
 *    `postSubmitted` is a no-op and no listener attaches — single-tab submit still
 *    finalizes, nothing throws.
 *  - ECHO GUARD: each hook instance stamps its posts with a unique `senderId` and
 *    ignores messages carrying its own id, so the POSTING tab never flips itself
 *    (belt on top of the spec's "a channel does not receive its own posts").
 *
 * Modelled on the `classlite_auth` BroadcastChannel pattern (`src/lib/auth-refresh.ts`)
 * + `useLanguageInit`'s echo sentinel.
 */
import { useCallback, useEffect, useRef } from 'react'

const CHANNEL_PREFIX = 'classlite:attempt:'

interface SubmittedSignal {
  type: 'submitted'
  senderId: string
}

function isSubmittedSignal(value: unknown): value is SubmittedSignal {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { type?: unknown }).type === 'submitted' &&
    typeof (value as { senderId?: unknown }).senderId === 'string'
  )
}

export interface UseAttemptBroadcastOptions {
  /** Fired when ANOTHER tab reports it submitted/finalized this attempt (AC13). */
  onForeignSubmit: () => void
}

export interface UseAttemptBroadcastResult {
  /** Notify sibling tabs that THIS tab just submitted (call after finalize). */
  postSubmitted: () => void
}

export function useAttemptBroadcast(
  submissionId: string,
  { onForeignSubmit }: UseAttemptBroadcastOptions,
): UseAttemptBroadcastResult {
  const channelRef = useRef<BroadcastChannel | null>(null)
  // A stable per-instance id for the echo guard, minted on mount (NOT during
  // render — an impure `crypto`/`random` call during render is a purity
  // violation). Empty until the mount effect runs; `postSubmitted` + the message
  // handler both read it only AFTER mount, so the ordering is safe.
  const senderIdRef = useRef<string>('')
  const onForeignSubmitRef = useRef(onForeignSubmit)
  useEffect(() => {
    onForeignSubmitRef.current = onForeignSubmit
  })

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return
    if (senderIdRef.current === '') {
      senderIdRef.current =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `s-${Math.random().toString(36).slice(2)}`
    }
    const channel = new BroadcastChannel(`${CHANNEL_PREFIX}${submissionId}`)
    channelRef.current = channel
    const handleMessage = (event: MessageEvent<unknown>) => {
      if (!isSubmittedSignal(event.data)) return
      if (event.data.senderId === senderIdRef.current) return // echo guard
      onForeignSubmitRef.current()
    }
    channel.addEventListener('message', handleMessage)
    return () => {
      channel.removeEventListener('message', handleMessage)
      channel.close()
      channelRef.current = null
    }
  }, [submissionId])

  const postSubmitted = useCallback(() => {
    channelRef.current?.postMessage({
      type: 'submitted',
      senderId: senderIdRef.current,
    } satisfies SubmittedSignal)
  }, [])

  return { postSubmitted }
}
