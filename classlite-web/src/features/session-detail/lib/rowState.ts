/**
 * rowState — Story 3.5 shared helpers for the notes/materials/exercises rows.
 * Two review-driven concerns (Round 1, Chunk 2):
 *   - focus return (TEST-UX-2): when an inline edit form closes on save/cancel,
 *     focus goes back to the row's Edit trigger instead of falling to <body>.
 *   - optimistic-row detection: a not-yet-persisted row carries a client temp id
 *     (`optimistic-<uuid>`); its edit/delete must be disabled so an action can't
 *     hit `/…/optimistic-<uuid>` → 404.
 */
import { useEffect, useRef } from 'react'

/** True when id is a client-generated optimistic placeholder, not a server id. */
export function isOptimisticId(id: string): boolean {
  return id.startsWith('optimistic-')
}

/**
 * useEditFocusReturn returns focus to the Edit trigger when `editing` flips from
 * true back to false (save or cancel). Attach the returned ref to the Edit
 * button so keyboard/screen-reader users are not ejected to the top of the page.
 */
export function useEditFocusReturn(editing: boolean) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const wasEditing = useRef(false)
  useEffect(() => {
    if (wasEditing.current && !editing) triggerRef.current?.focus()
    wasEditing.current = editing
  }, [editing])
  return triggerRef
}
