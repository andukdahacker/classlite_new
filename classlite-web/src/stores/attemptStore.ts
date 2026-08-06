/**
 * attemptStore — Story 5.2d (AC3). The SHARED, content-agnostic save-status
 * slice for every attempt surface (quiz 5.2b, writing 5.3, speaking 5.4).
 * Extracted out of `quizAttemptStore` so the moved autosave hook + the
 * `SaveStatusIndicator` depend on one store named for the concept ("attempt"),
 * not the quiz feature. Modelled on `editorStore.ts`: `initialState` + a
 * `reset()` action (TEST-FE-3).
 *
 * What lives here: `saveStatus` — the prominent Saving/Saved/Error indicator
 * (AC12). `offline` is added FORWARD-READY for 5.3's offline autosave/reconnect
 * (R42): quiz never emits it, but the shared type + indicator branch ship now so
 * writing consumes a stable module (5.2d Out of Scope: the offline BEHAVIOR is
 * 5.3; only the status VALUE + indicator branch land here).
 *
 * What does NOT live here: the quiz navigator position / split-pane ratio (those
 * stay in `quizAttemptStore`), and the ANSWERS + FLAGGED draft (Query cache, D9).
 * Never store server / API data in Zustand. Never invalidate Query from a store
 * action (FW-6).
 */
import { create } from 'zustand'

/**
 * The prominent autosave indicator states (AC12). `unsaved` = dirty, pending;
 * `offline` = forward-ready for 5.3 (no autosave in flight because the network
 * is down) — quiz never emits it.
 */
export type AttemptSaveStatus =
  | 'idle'
  | 'saving'
  | 'saved'
  | 'unsaved'
  | 'error'
  | 'offline'

export interface AttemptState {
  saveStatus: AttemptSaveStatus
}

export interface AttemptActions {
  setSaveStatus: (status: AttemptSaveStatus) => void
  reset: () => void
}

export const initialState: AttemptState = {
  saveStatus: 'idle',
}

export const useAttemptStore = create<AttemptState & AttemptActions>((set) => ({
  ...initialState,
  setSaveStatus: (saveStatus) => set({ saveStatus }),
  reset: () => set({ ...initialState }),
}))
