/**
 * liveTextStore — Story 5.3 (AC2/AC6, D5, Winston BLOCKER 2). The single live
 * source of the editor's CURRENT text, external to React so it can be:
 *
 *  - written by the uncontrolled `<textarea>` leaf on every keystroke (a cheap
 *    ref-like set — NEVER a `setQueryData` / `setState` on the shell),
 *  - read at save time by the autosave `getContent` (the ref-read the finalizer
 *    + flush rely on, so text typed since the last debounce is never lost),
 *  - subscribed by the ISOLATED `WordCountMeter` via `useSyncExternalStore`, so a
 *    keystroke re-renders ONLY the meter, never the shell or the ticking timers.
 *
 * This is the mechanism that keeps the writing surface off the architecture.md:255
 * banned per-keystroke shell-re-render / per-keystroke `JSON.stringify` path: the
 * Query-cache draft slice + the localStorage mirror are written on a DEBOUNCE from
 * this store, not on every set.
 */
export interface LiveTextStore {
  /** The current live text (read at save time — AC2 `getContent` reads the ref). */
  get(): string
  /** Set the live text; notifies subscribers only when the value actually changed. */
  set(text: string): void
  /** Subscribe to changes (for `useSyncExternalStore`); returns an unsubscribe. */
  subscribe(listener: () => void): () => void
}

/**
 * Build a live-text store seeded with the recovered draft text.
 * @param initial the seed text (the reconciled draft on load).
 */
export function createLiveTextStore(initial: string): LiveTextStore {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    get: () => value,
    set: (text) => {
      if (text === value) return
      value = text
      listeners.forEach((listener) => listener())
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
