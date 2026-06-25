/**
 * PasswordStrengthBar — 4-segment strength meter (UX-DR8).
 *
 * Consumer: `RegisterPage` only (login deliberately omits — the project
 * never reveals password policy on the login form per SEC-1).
 *
 * Renders nothing visible when `password === ''` so there's no empty bar
 * at first paint. The `aria-live` region stays mounted but is
 * `sr-only` when `score === 0` so the empty-state announcement
 * ("Password strength: none" / "Độ mạnh mật khẩu: chưa nhập") does NOT
 * appear as visible body text on initial paint (code-review P3
 * 2026-06-25 — AC2 contract says the empty key is screen-reader-only).
 *
 * Color mapping (canonical per D1 2026-06-25 — amends original AC1 spec
 * which referenced `--cl-status-danger` / `--cl-accent-2-btn` that don't
 * exist in tokens.css):
 *   - 1 weak       → bg-destructive    (shadcn semantic)
 *   - 2 fair       → bg-amber-500      (pragmatic stand-in until a
 *                                       --cl-status-warning token lands —
 *                                       follow-up tracked in
 *                                       deferred-work.md)
 *   - 3 strong     → bg-primary        (shadcn semantic — ClassLite teal)
 *   - 4 very strong → bg-[color:var(--cl-status-success)]  (arbitrary
 *                     value via the AC7 escape hatch — no shadcn
 *                     `success` token, mapping to the ClassLite
 *                     status-success color directly)
 */
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { scorePassword, type StrengthScore } from '@/features/auth/lib/passwordStrength'

const STRENGTH_KEY_BY_SCORE: Record<StrengthScore, string> = {
  0: 'auth.common.passwordStrength.empty',
  1: 'auth.common.passwordStrength.weak',
  2: 'auth.common.passwordStrength.fair',
  3: 'auth.common.passwordStrength.strong',
  4: 'auth.common.passwordStrength.veryStrong',
}

const TOTAL_SEGMENTS = 4

function segmentTone(index: number, score: StrengthScore): string {
  // index is 1-based for human-readable rule below.
  const filled = index <= score
  if (!filled) return 'bg-muted'
  if (score === 1) return 'bg-destructive'
  if (score === 2) return 'bg-amber-500'
  if (score === 3) return 'bg-primary'
  return 'bg-[color:var(--cl-status-success)]'
}

export interface PasswordStrengthBarProps {
  password: string
}

export default function PasswordStrengthBar({
  password,
}: PasswordStrengthBarProps) {
  const { t } = useTranslation()
  const score = scorePassword(password)
  const announcement = t(STRENGTH_KEY_BY_SCORE[score])

  return (
    <div data-slot="password-strength" className="grid gap-1">
      {password.length > 0 && (
        <div
          aria-hidden="true"
          data-testid="password-strength-bar"
          className="flex gap-1"
        >
          {Array.from({ length: TOTAL_SEGMENTS }, (_, i) => {
            const segmentIndex = i + 1
            return (
              <div
                key={segmentIndex}
                data-segment={segmentIndex}
                data-filled={segmentIndex <= score}
                className={cn(
                  'h-1 flex-1 rounded-full transition-colors',
                  segmentTone(segmentIndex, score),
                )}
              />
            )
          })}
        </div>
      )}
      <p
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-testid="password-strength-announcement"
        className={cn(
          'text-xs text-muted-foreground',
          // Empty state — keep in the a11y tree so the first keystroke's
          // transition is observed by screen readers, but hide visually
          // so users don't see "Password strength: none" on first paint.
          score === 0 && 'sr-only',
        )}
      >
        {announcement}
      </p>
    </div>
  )
}
