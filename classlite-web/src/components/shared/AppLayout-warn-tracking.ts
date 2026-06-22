/**
 * Module-scope dedup for the AppLayout "no session role" dev warning
 * (Story 1d-3 code-review P11). Lives in its own module so:
 *
 *   - `AppLayout.tsx` stays compliant with the
 *     `react-refresh/only-export-components` lint rule (which forbids
 *     non-component exports from a component file).
 *   - Tests reset state via `__resetWarnTrackingForTests()` in
 *     `beforeEach` while the once-per-session contract still holds in
 *     production (React StrictMode + hot reload no longer spam the
 *     dev console).
 */

let hasWarnedNoRole = false

/**
 * Emit the guest-shell warning once per session. Subsequent calls are
 * no-ops until `__resetWarnTrackingForTests()` clears the flag.
 */
export function warnIfFirstNoRoleResolution(message: string): void {
  if (hasWarnedNoRole) return
  hasWarnedNoRole = true
  console.warn(message)
}

export function __resetWarnTrackingForTests(): void {
  hasWarnedNoRole = false
}
