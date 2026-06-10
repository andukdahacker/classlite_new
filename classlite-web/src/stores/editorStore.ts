/**
 * editorStore — writing editor autosave + dirty state.
 *
 * Holds the autosave indicator + dirty flag + last-saved timestamp. The
 * actual document content lives outside Zustand entirely — debounced
 * TanStack Query mutation owns it per architecture line 461 and FW-8.
 * Putting document text in Zustand would couple the editor to a
 * non-reactive cache and bypass the autosave contract.
 *
 * `initialState` MUST be exported (project-context TEST-FE-3 reset
 * pattern).
 */
import { create } from 'zustand'

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

export interface EditorState {
  saveStatus: SaveStatus
  dirty: boolean
  lastSavedAt: string | null
}

export interface EditorActions {
  setSaveStatus: (status: SaveStatus) => void
  markDirty: () => void
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
  markSavedAt: (lastSavedAt) =>
    set({ lastSavedAt, dirty: false, saveStatus: 'saved' }),
  reset: () => set({ ...initialState }),
}))
