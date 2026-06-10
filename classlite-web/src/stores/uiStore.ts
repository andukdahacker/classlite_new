/**
 * uiStore — ephemeral UI state (sidebar, modals, toasts).
 *
 * Holds NO server-derived data. Students, classes, grades, etc. live in
 * the TanStack Query cache per project-context FW-5 / architecture line
 * 463. Anything fetched from the API gets duplicated here and the
 * code-review will flag it.
 *
 * `initialState` MUST be exported. Test files reset between tests via
 * `useUIStore.setState(initialState, true)` — the `true` flag replaces
 * the whole state (per project-context TEST-FE-3 / Zustand v5 idiom).
 */
import { create } from 'zustand'

export interface Toast {
  id: string
  message: string
  variant?: 'info' | 'success' | 'warning' | 'error'
}

export interface UIState {
  sidebarCollapsed: boolean
  openModalId: string | null
  toastQueue: Toast[]
}

export interface UIActions {
  setSidebarCollapsed: (collapsed: boolean) => void
  openModal: (id: string) => void
  closeModal: () => void
  pushToast: (toast: Toast) => void
  dismissToast: (id: string) => void
  reset: () => void
}

export const initialState: UIState = {
  sidebarCollapsed: false,
  openModalId: null,
  toastQueue: [],
}

export const useUIStore = create<UIState & UIActions>((set) => ({
  ...initialState,
  setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
  openModal: (openModalId) => set({ openModalId }),
  closeModal: () => set({ openModalId: null }),
  pushToast: (toast) =>
    set((state) => ({ toastQueue: [...state.toastQueue, toast] })),
  dismissToast: (id) =>
    set((state) => ({
      toastQueue: state.toastQueue.filter((toast) => toast.id !== id),
    })),
  // `reset()` honors TEST-FE-3's "reset between tests" intent without
  // fighting Zustand v5's strict `setState(state, true)` typing (which
  // requires the action shape too). Tests call `useUIStore.getState().reset()`
  // in beforeEach.
  reset: () => set({ ...initialState }),
}))
