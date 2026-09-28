import { useCallback, useEffect, useRef, useState } from 'react'

export interface CommandPalette {
  /** Whether the palette is open — the single source of truth. */
  open: boolean
  /** Controlled setter passed to the palette's `onOpenChange` (Escape/backdrop). */
  setOpen: (open: boolean) => void
  /** Imperative open — the SearchPill click target and a promotion seam. */
  openPalette: () => void
  /** Imperative close. */
  closePalette: () => void
}

/**
 * useCommandPalette — owns the ⌘K/Ctrl+K command-palette open-state and the
 * GLOBAL keydown listener (Story 8-4b, D1). Consumed once in `AppLayout` (the
 * sole `useUIStore` consumer and the SearchPill render site).
 *
 * Local state, NOT a Zustand slice: only ⌘K and the SearchPill command the
 * palette open today (FW-5/FW-6). The imperative `openPalette()`/`closePalette()`
 * are the promotion seam — the FIRST cross-subtree opener (a deep-link CTA, an
 * empty-state "search instead" action) promotes `open` to a UI-store slice, and
 * because callers already go through these functions that becomes a MOVE, not a
 * rewrite.
 *
 * The keydown effect uses an EMPTY dependency array + a FUNCTIONAL state update
 * (`setOpen(prev => !prev)`) and NEVER closes over `open` (D1, FW-4 inoculation):
 * a `[open]` dep would tear down + re-add the document listener on every toggle
 * — the unstable-subscription class that produced the auto-save loop
 * (project-context.md FW-4). The listener is registered exactly once for the
 * lifetime of the mount. `enabled` is read through a REF for the same reason, so
 * a role resolving (null → authenticated) never re-subscribes the listener.
 *
 * @param enabled when false the chord is ignored and the native ⌘K/Ctrl+K passes
 *   through (a guest with no palette to open must keep the browser shortcut —
 *   code review 2026-09-28). Defaults to true.
 */
export function useCommandPalette(enabled = true): CommandPalette {
  const [open, setOpen] = useState(false)
  const openPalette = useCallback(() => setOpen(true), [])
  const closePalette = useCallback(() => setOpen(false), [])
  // Mirror `enabled` into a ref so the keydown effect stays empty-dep (D1/AC1) —
  // synced in its own effect (never written during render). This effect only
  // updates a ref value; it does NOT re-subscribe the document listener.
  const enabledRef = useRef(enabled)
  useEffect(() => {
    enabledRef.current = enabled
  }, [enabled])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      // Ignore auto-repeat (holding the chord would toggle many times/second).
      if (event.repeat) return
      const isChord =
        (event.metaKey || event.ctrlKey) &&
        (event.key === 'k' || event.key === 'K')
      if (!isChord) return
      // Disabled (e.g. a no-role shell): let the native shortcut through — do NOT
      // preventDefault a chord we cannot act on.
      if (!enabledRef.current) return
      event.preventDefault()
      setOpen((prev) => !prev)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  return { open, setOpen, openPalette, closePalette }
}
