/**
 * useExerciseAutosave — Story 4.2 (AC6). The structured editor's document
 * autosave: NON-optimistic (FW-8, architecture.md:461 — a plain debounced
 * mutation, NOT the FW-2 optimistic triple), VALIDITY-GATED, and
 * CONCURRENCY-GUARDED via the 4.1 `updated_at` precondition.
 *
 * Contract (adapts onboarding/hooks/useAutoSave.ts):
 *   - `scheduleSave(doc)` — debounces DEBOUNCE_MS. Repeat calls collapse to ONE
 *     PATCH carrying the LAST document. VALIDITY GATE: a blank required field
 *     (title) does NOT fire a save — it holds in the `unsaved` state (never the
 *     `error` state — the failure signal stays reserved for a real failed PATCH,
 *     Sally).
 *   - `flush()` — cancels the debounce and PATCHes immediately (the manual
 *     "Save exercise" button + retry affordance). After a FAILED dispatched save
 *     it replays the last-attempted document (the debounce already nulled the
 *     pending ref), so "Retry" is never a dead no-op.
 *   - PATCHes are SERIALIZED: a new save waits for the in-flight one so it reads
 *     the advanced precondition, never 409-ing against the tab's own prior write.
 *   - The PATCH carries `If-Match: <last-read updatedAt>`. On success the
 *     precondition advances to the response's `updatedAt`. On a 409 (a concurrent
 *     writer — another tab) `conflict` flips true; the page reloads fresh state.
 *   - On unmount within the debounce window the pending edit is beaconed
 *     (best-effort, fire-and-forget) so a quick navigate-away never loses it.
 *   - Save status lives in `editorStore` (Story 4.2 is its first consumer). The
 *     document itself is NOT in the store (it is the page's local state).
 *
 * Out-of-order guard (mirrors useAutoSave): a monotonic `saveSeq` tags each
 * in-flight PATCH; a slower response that resolves after a newer one has landed
 * is dropped instead of stomping the newer `updatedAt` / status.
 *
 * The exposed callbacks are stable `useCallback`s so the page's autosave effect
 * can depend on `scheduleSave`/`flush` directly, never an object literal (the
 * FW-4 loop guard — see CenterSetupPage).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { apiFetch, ApiError } from '@/lib/api-fetch'
import { useEditorStore } from '@/stores/editorStore'
import { exerciseKeys } from '../api/exercisesKeys'
import type { Exercise } from '../api/useExercise'
import type { EditorDocument } from '../lib/editorTypes'

export const DEBOUNCE_MS = 1500
const CONFLICT_STATUS = 409

/** The full-replace PATCH body — metadata + content. Explicit nulls (TS-1). */
function toPatchBody(doc: EditorDocument) {
  return {
    title: doc.title,
    description: doc.description ?? null,
    skill: doc.skill,
    tags: doc.tags,
    targetBand: doc.targetBand ?? null,
    content: doc.content,
  }
}

export interface UseExerciseAutosaveResult {
  scheduleSave: (doc: EditorDocument) => void
  flush: () => Promise<void>
  /** True after a 409 — the exercise was modified elsewhere. The page reloads
   * fresh server state, then calls `resolveConflict(newUpdatedAt)`. */
  conflict: boolean
  /** Re-seed the concurrency precondition after a reload (409 recovery) and
   * clear the conflict flag. */
  resolveConflict: (freshUpdatedAt: string) => void
}

export function useExerciseAutosave(
  exerciseId: string,
  initialUpdatedAt: string,
): UseExerciseAutosaveResult {
  const queryClient = useQueryClient()
  const setSaveStatus = useEditorStore((s) => s.setSaveStatus)
  const markSavedAt = useEditorStore((s) => s.markSavedAt)
  const markUnsaved = useEditorStore((s) => s.markUnsaved)

  const preconditionRef = useRef(initialUpdatedAt)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingRef = useRef<EditorDocument | null>(null)
  // The document the most recent PATCH attempted. Retained on FAILURE so the
  // "Retry" / "Save exercise" affordance can replay it — the debounce nulls
  // `pendingRef` before dispatch, so without this a failed save is unrecoverable.
  const lastAttemptedRef = useRef<EditorDocument | null>(null)
  // Serializes PATCHes: each save chains after the in-flight one so it reads the
  // ADVANCED precondition, never 409-ing against the tab's own prior write.
  const inFlightRef = useRef<Promise<void>>(Promise.resolve())
  const saveSeqRef = useRef(0)
  const latestSeqRef = useRef(0)
  const isMountedRef = useRef(true)
  const [conflict, setConflict] = useState(false)
  // Mirror of `conflict` for the stable callbacks (flush/beacon) to read without
  // taking `conflict` as a dependency (which would churn their identity and
  // re-run the page's autosave effect — the FW-4 guard).
  const conflictRef = useRef(false)

  const runSave = useCallback(
    async (doc: EditorDocument) => {
      saveSeqRef.current += 1
      const mySeq = saveSeqRef.current
      latestSeqRef.current = mySeq
      lastAttemptedRef.current = doc
      setSaveStatus('saving')
      try {
        const updated = await apiFetch<Exercise>(`/api/exercises/${exerciseId}`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'If-Match': preconditionRef.current,
          },
          body: JSON.stringify(toPatchBody(doc)),
        })
        // The server's updatedAt has advanced — the next serialized save MUST
        // use it (this is what prevents a self-409), regardless of UI ownership.
        preconditionRef.current = updated.updatedAt
        // Stale-seq / unmount drop — a newer save already owns the UI state.
        if (!isMountedRef.current || mySeq < latestSeqRef.current) return
        // Sync (not invalidate) the detail cache with the authoritative response
        // so no refetch fires on the 1.5s autosave cadence; the local page state
        // remains the edit source of truth.
        queryClient.setQueryData(exerciseKeys.detail(exerciseId), updated)
        lastAttemptedRef.current = null
        markSavedAt(updated.updatedAt)
      } catch (err) {
        if (!isMountedRef.current || mySeq < latestSeqRef.current) return
        if (err instanceof ApiError && err.status === CONFLICT_STATUS) {
          // Loud, recoverable conflict (Winston) — the page reloads fresh state.
          conflictRef.current = true
          setConflict(true)
          setSaveStatus('error')
          return
        }
        // Real failure — keep `lastAttemptedRef` so flush()/Retry can replay it.
        setSaveStatus('error')
      }
    },
    [exerciseId, queryClient, setSaveStatus, markSavedAt],
  )

  const doSave = useCallback(
    (doc: EditorDocument): Promise<void> => {
      const next = inFlightRef.current.then(() => runSave(doc))
      // Keep the chain alive even if a save rejects, so the next save still runs.
      inFlightRef.current = next.catch(() => {})
      return next
    },
    [runSave],
  )

  const scheduleSave = useCallback(
    (doc: EditorDocument) => {
      // VALIDITY GATE (Sally): a blank required title holds in `unsaved` and
      // fires NO save — never a phantom write, never a false failure.
      if (doc.title.trim() === '') {
        if (timerRef.current) {
          clearTimeout(timerRef.current)
          timerRef.current = null
        }
        pendingRef.current = null
        markUnsaved()
        return
      }
      pendingRef.current = doc
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        const next = pendingRef.current
        pendingRef.current = null
        timerRef.current = null
        if (next) void doSave(next)
      }, DEBOUNCE_MS)
    },
    [doSave, markUnsaved],
  )

  const flush = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    // A 409 reload is in flight — a manual save/Retry here would fire the stale
    // precondition and just re-409 (setConflict(true) is a no-op, so the reload
    // effect never re-fires). The reload path owns recovery; hold. (Review P1)
    if (conflictRef.current) return
    // Replay the queued edit, or — if a dispatched save failed — the
    // last-attempted document (the debounce already nulled `pendingRef`).
    const doc = pendingRef.current ?? lastAttemptedRef.current
    pendingRef.current = null
    if (!doc) return
    // Same validity gate as scheduleSave — never replay a blank-title document
    // (e.g. after a failed save + title clear, `lastAttemptedRef` holds the stale
    // title; replaying it would desync the server title from the blank UI). (P1)
    if (doc.title.trim() === '') {
      markUnsaved()
      return
    }
    await doSave(doc)
  }, [doSave, markUnsaved])

  const resolveConflict = useCallback((freshUpdatedAt: string) => {
    preconditionRef.current = freshUpdatedAt
    conflictRef.current = false
    setConflict(false)
  }, [])

  const beaconPending = useCallback(
    (doc: EditorDocument) => {
      // Best-effort save on unmount (SPA navigation within the debounce window):
      // fire-and-forget, NO React state — the component is going away. Without
      // this, an edit made <DEBOUNCE_MS before navigating is silently lost.
      void apiFetch<Exercise>(`/api/exercises/${exerciseId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'If-Match': preconditionRef.current,
        },
        body: JSON.stringify(toPatchBody(doc)),
      }).catch(() => {})
    },
    [exerciseId],
  )

  useEffect(() => {
    isMountedRef.current = true
    return () => {
      isMountedRef.current = false
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      const pending = pendingRef.current
      pendingRef.current = null
      if (pending) beaconPending(pending)
    }
  }, [beaconPending])

  return { scheduleSave, flush, conflict, resolveConflict }
}
