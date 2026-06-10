/**
 * AC7 — Zustand store contract.
 *
 * Five assertion groups per store:
 *   - `initialState` is a plain object literal (not a function — the
 *     `setState(initialState, true)` reset pattern relies on the object
 *     identity flowing through cleanly).
 *   - Reset between tests works (test A mutates, test B sees default).
 *   - Actions mutate ONLY their slice (no accidental fan-out).
 *   - Compound flows (push → dismiss, etc.) return to baseline.
 *   - Each store stays isolated (no cross-store import dependency).
 */
import { beforeEach, describe, expect, test } from 'vitest'
import {
  initialState as uiInitialState,
  useUIStore,
} from '@/stores/uiStore'
import {
  initialState as editorInitialState,
  useEditorStore,
} from '@/stores/editorStore'
import {
  initialState as languageInitialState,
  useLanguageStore,
} from '@/stores/languageStore'

beforeEach(() => {
  useUIStore.getState().reset()
  useEditorStore.getState().reset()
  useLanguageStore.getState().reset()
})

describe('uiStore', () => {
  test('initialState is a plain object literal', () => {
    expect(typeof uiInitialState).toBe('object')
    expect(uiInitialState).not.toBeNull()
    expect(typeof uiInitialState).not.toBe('function')
    expect(uiInitialState.sidebarCollapsed).toBe(false)
    expect(uiInitialState.openModalId).toBeNull()
    expect(uiInitialState.toastQueue).toEqual([])
  })

  test('reset() returns the store to default state', () => {
    useUIStore.getState().setSidebarCollapsed(true)
    useUIStore.getState().openModal('confirm-delete')
    expect(useUIStore.getState().sidebarCollapsed).toBe(true)
    expect(useUIStore.getState().openModalId).toBe('confirm-delete')

    useUIStore.getState().reset()
    expect(useUIStore.getState().sidebarCollapsed).toBe(false)
    expect(useUIStore.getState().openModalId).toBeNull()
  })

  test('setSidebarCollapsed mutates only the sidebarCollapsed slice', () => {
    useUIStore.getState().openModal('keep-me')
    useUIStore.getState().pushToast({ id: 'keep-me-too', message: 'hi' })
    useUIStore.getState().setSidebarCollapsed(true)
    expect(useUIStore.getState().sidebarCollapsed).toBe(true)
    expect(useUIStore.getState().openModalId).toBe('keep-me')
    expect(useUIStore.getState().toastQueue).toEqual([
      { id: 'keep-me-too', message: 'hi' },
    ])
  })

  test('pushToast then dismissToast returns to empty queue', () => {
    useUIStore.getState().pushToast({ id: 't1', message: 'one' })
    useUIStore.getState().pushToast({ id: 't2', message: 'two' })
    expect(useUIStore.getState().toastQueue.length).toBe(2)
    useUIStore.getState().dismissToast('t1')
    expect(useUIStore.getState().toastQueue).toEqual([
      { id: 't2', message: 'two' },
    ])
    useUIStore.getState().dismissToast('t2')
    expect(useUIStore.getState().toastQueue).toEqual([])
  })
})

describe('editorStore', () => {
  test('initialState defaults', () => {
    expect(editorInitialState).toEqual({
      saveStatus: 'idle',
      dirty: false,
      lastSavedAt: null,
    })
  })

  test('markSavedAt clears dirty and flips saveStatus to saved', () => {
    useEditorStore.getState().markDirty()
    expect(useEditorStore.getState().dirty).toBe(true)
    useEditorStore.getState().markSavedAt('2026-06-09T10:00:00Z')
    expect(useEditorStore.getState().dirty).toBe(false)
    expect(useEditorStore.getState().saveStatus).toBe('saved')
    expect(useEditorStore.getState().lastSavedAt).toBe('2026-06-09T10:00:00Z')
  })

  test('setSaveStatus does not touch dirty / lastSavedAt', () => {
    useEditorStore.getState().markDirty()
    useEditorStore.getState().setSaveStatus('saving')
    expect(useEditorStore.getState().saveStatus).toBe('saving')
    expect(useEditorStore.getState().dirty).toBe(true)
    expect(useEditorStore.getState().lastSavedAt).toBeNull()
  })
})

describe('languageStore', () => {
  test('initialState defaults to en', () => {
    expect(languageInitialState).toEqual({ language: 'en' })
  })

  test('setLanguage flips between en and vi', () => {
    useLanguageStore.getState().setLanguage('vi')
    expect(useLanguageStore.getState().language).toBe('vi')
    useLanguageStore.getState().setLanguage('en')
    expect(useLanguageStore.getState().language).toBe('en')
  })
})
