/**
 * useBeforeUnloadGuard — Story 5.4 Task 4 (AC15, Sally B1 / Winston B2). While an
 * un-uploaded in-memory recording is held, closing / reloading the tab must cost a
 * native confirm, not a silent loss — the "keep this tab open, it'll upload when
 * you're back online" promise (D2, honest copy) is only true if leaving is guarded.
 * The Blob lives only in memory across the retry/offline window; a reload loses it
 * (IndexedDB durability is FU-5-4-B).
 *
 * @param active whether an un-uploaded Blob is currently held.
 */
import { useEffect } from 'react'

export function useBeforeUnloadGuard(active: boolean): void {
  useEffect(() => {
    if (!active) return
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      // Legacy browsers require returnValue to be set to trigger the prompt.
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [active])
}
