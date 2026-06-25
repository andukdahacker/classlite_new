/**
 * Password strength scoring — pure, categorical (UX-DR8).
 *
 * 5 states per UX-DR8: no-input (0) / weak (1) / fair (2) / strong (3) /
 * very strong (4). The bar in `PasswordStrengthBar` renders 4 segments;
 * the 5th state is the "no input" baseline that renders nothing visible
 * (only the screen-reader announcement key `auth.common.passwordStrength.empty`
 * is wired up for parity-helper completeness).
 *
 * Scoring rule — categorical, NOT statistical:
 *
 *   - Empty input: score 0.
 *   - Less than 8 chars: score 1 (always weak — below the project's
 *     min-length floor; see auth.common.validation.passwordMin).
 *   - 8+ chars: start at 1, then add 1 point for each of:
 *       * has BOTH lowercase AND uppercase (mixed case)
 *       * has a digit 0-9
 *       * has a non-alphanumeric character (symbol)
 *   - If the password would reach the maximum (4 points) but length is
 *     under 12, cap at 3. The 4-point "very strong" tier requires
 *     length ≥ 12 — short passwords with full character-class diversity
 *     are still only "strong."
 *
 * Why pure (no zxcvbn / library entropy estimator)?
 *
 *   Library entropy estimators drag in 200KB-1MB and behave
 *   non-deterministically across versions / locale dictionaries. The
 *   4-segment scale is categorical per UX-DR8 — "weak / fair / strong /
 *   very strong" maps to lengths + character-class diversity, not
 *   bits-of-entropy. If a future story wants statistical entropy, that's
 *   a follow-up; 1-8 ships the categorical version.
 *
 * Determinism: the function uses only regex character-class probes +
 * `.length` reads. No `Math.random`, no `Date.now`, no captured state.
 * Identical inputs ALWAYS return identical scores within and across
 * process lifetimes (pinned by `passwordStrength.test.ts`).
 */
export type StrengthScore = 0 | 1 | 2 | 3 | 4

const MIN_LENGTH_FOR_SCORE = 8
const MIN_LENGTH_FOR_MAX_SCORE = 12

export function scorePassword(password: string): StrengthScore {
  if (password.length === 0) return 0
  if (password.length < MIN_LENGTH_FOR_SCORE) return 1

  let points: number = 1 // length ≥ 8 baseline

  const hasLower = /[a-z]/.test(password)
  const hasUpper = /[A-Z]/.test(password)
  const hasMixedCase = hasLower && hasUpper
  const hasDigit = /[0-9]/.test(password)
  const hasSymbol = /[^A-Za-z0-9]/.test(password)

  if (hasMixedCase) points++
  if (hasDigit) points++
  if (hasSymbol) points++

  if (points === 4 && password.length < MIN_LENGTH_FOR_MAX_SCORE) {
    points = 3
  }

  return points as StrengthScore
}
