/**
 * StudentWelcome — the s62 first-login guided welcome (Story 8-1b, §6.4, D12);
 * re-platformed onto the canonical `EmptyState` (`tone='guided'`) in Story 10.3
 * (AC3, Task 5). A forward-looking hero: ghost icon + Fraunces display headline
 * with one italic-accent word + a muted one-liner + a short starter checklist +
 * a single primary action. It is ADDITIVE — the parent `StudentDashboard` owns
 * the durable per-user gating (`useStudentWelcome`), so it coexists with real
 * data and never blocks the cards.
 *
 * The primary action doubles as the explicit dismissal (`data-testid=
 * "student-welcome-dismiss"`): clicking it persists the durable flag (via the
 * parent's `onDismiss`) so a returning student never sees it again on this
 * device. No `live` role — the welcome is mount-present/gated, not an
 * async-arrived empty, so it must not announce as if it just loaded.
 */
import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { GraduationCap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/domain/EmptyState'

export interface StudentWelcomeProps {
  /** Persists the durable welcome flag and hides the hero. */
  onDismiss: () => void
  /** Optional next-session label for the forward-looking hero line. */
  nextSessionLabel?: string | null
}

export function StudentWelcome({
  onDismiss,
  nextSessionLabel,
}: StudentWelcomeProps): ReactElement {
  const { t } = useTranslation()
  return (
    <EmptyState
      data-testid="student-welcome"
      tone="guided"
      icon={<GraduationCap className="size-7" />}
      headline={t('dashboard.welcome.headline')}
      headlineAccent={t('dashboard.welcome.headlineAccent')}
      actions={
        <Button data-testid="student-welcome-dismiss" onClick={onDismiss}>
          {t('dashboard.welcome.cta')}
        </Button>
      }
    >
      <p className="text-sm text-[color:var(--cl-ink-soft)]">
        {t('dashboard.welcome.subtext')}
      </p>
      {nextSessionLabel ? (
        <p className="text-sm font-medium text-[color:var(--cl-ink)]">
          {t('dashboard.welcome.nextSession', { session: nextSessionLabel })}
        </p>
      ) : null}
      <ul className="flex flex-col gap-1 text-sm text-[color:var(--cl-ink-soft)]">
        <li>{t('dashboard.welcome.step1')}</li>
        <li>{t('dashboard.welcome.step2')}</li>
        <li>{t('dashboard.welcome.step3')}</li>
      </ul>
    </EmptyState>
  )
}
