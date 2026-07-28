/**
 * editorStore — structured-editor autosave + dirty state (Story 4.2 first
 * consumer; the shell was built unwired in an earlier story).
 *
 * Holds ONLY the autosave indicator status + dirty flag + last-saved
 * timestamp. The actual editor document (metadata + content blob) lives outside
 * Zustand entirely — local React state in the page, full-replace PATCHed by the
 * debounced TanStack Query mutation (architecture line 461 + FW-8). Putting the
 * document in Zustand would couple the editor to a non-reactive cache and
 * bypass the autosave contract.
 *
 * `SaveStatus` enumerates the five FR-21 autosave states the indicator renders:
 *   - idle    → "Auto-save on" (fresh mount, no edit yet)
 *   - saving  → "Saving…"
 *   - saved   → "Auto-saved · just now" / "· {N} ago" (render-time split)
 *   - unsaved → "Unsaved — {reason}" (VALIDITY GATE: a blank required field
 *               holds here and NEVER fires a save — never a false save-failure)
 *   - error   → "Save failed — retry"
 *
 * `initialState` MUST be exported (project-context TEST-FE-3 reset pattern).
 */
import { create } from 'zustand'

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'unsaved' | 'error'

export interface EditorState {
  saveStatus: SaveStatus
  dirty: boolean
  lastSavedAt: string | null
}

export interface EditorActions {
  setSaveStatus: (status: SaveStatus) => void
  markDirty: () => void
  /** Validity-gated hold — dirty work exists but a required field is blank, so
   * no save fires. Distinct from `error` (Sally): the failure signal stays
   * reserved for a real failed PATCH. */
  markUnsaved: () => void
  markSavedAt: (isoTimestamp: string) => void
  reset: () => void
}

export const initialState: EditorState = {
  saveStatus: 'idle',
  dirty: false,
  lastSavedAt: null,
}

export const useEditorStore = create<EditorState & EditorActions>((set) => ({
  ...initialState,
  setSaveStatus: (saveStatus) => set({ saveStatus }),
  markDirty: () => set({ dirty: true }),
  markUnsaved: () => set({ saveStatus: 'unsaved', dirty: true }),
  markSavedAt: (lastSavedAt) =>
    set({ lastSavedAt, dirty: false, saveStatus: 'saved' }),
  reset: () => set({ ...initialState }),
}))
