/**
 * arrivalToast — Story 2-3b R1-C1-P13/P19 fold.
 *
 * Cross-page toast plumbing for redirect flows. Upstream page calls
 * `queueArrivalToast(i18nKey)` before `navigate(...)`; downstream page reads
 * the pending key once via `consumeArrivalToast()` and surfaces it via
 * Sonner. `sessionStorage` survives the SPA navigate + a hard reload, which
 * matches the "you arrived here for a reason" UX intent.
 *
 * The value stored is an i18n KEY, not translated text — so the destination
 * page owns the locale + interpolation.
 */
const KEY = 'onboarding.arrivalToast'

export function queueArrivalToast(i18nKey: string): void {
  try {
    // R1-C2-P17 — surface the last-write-wins semantic. If a previous toast
    // is already queued (e.g. two back-to-back redirects), overwriting it
    // silently loses the first message. A dev-mode warn keeps the design
    // choice explicit without breaking the current call graph.
    if (import.meta.env.DEV) {
      const existing = window.sessionStorage.getItem(KEY)
      if (existing !== null && existing !== i18nKey) {
        console.warn(
          `[arrivalToast] overwriting queued toast "${existing}" with "${i18nKey}"`,
        )
      }
    }
    window.sessionStorage.setItem(KEY, i18nKey)
  } catch {
    // sessionStorage blocked (private mode, quota, SSR) — toast is best-effort.
  }
}

export function consumeArrivalToast(): string | null {
  try {
    const value = window.sessionStorage.getItem(KEY)
    if (value !== null) window.sessionStorage.removeItem(KEY)
    return value
  } catch {
    return null
  }
}
