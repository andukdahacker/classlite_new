/**
 * StudentWelcome — the s62 first-login guided welcome (Story 8-1b, §6.4, D12).
 * A forward-looking hero (ghost icon + Fraunces display headline with one
 * italic-accent word + a muted one-liner + a short starter checklist + a single
 * primary action). It is ADDITIVE — it coexists with real data as it arrives and
 * never blocks the cards.
 *
 * The primary action doubles as the explicit dismissal (`data-testid=
 * "student-welcome-dismiss"`): clicking it persists the durable per-user flag
 * (via the parent's `onDismiss`) so a returning student never sees it again on
 * this device. Encouraging student tone (§6.4).
 */
import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { GraduationCap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

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
    <Card
      data-testid="student-welcome"
      className="border-[var(--cl-accent)] bg-[var(--cl-tint-blue)]"
    >
      <CardContent className="flex flex-col items-start gap-3 py-6">
        <GraduationCap
          aria-hidden="true"
          className="size-8 text-[var(--cl-accent)]"
        />
        <h2 className="font-[var(--cl-font-display)] text-2xl text-[var(--cl-ink)]">
          {t('dashboard.welcome.headline')}{' '}
          <span className="italic text-[var(--cl-accent)]">
            {t('dashboard.welcome.headlineAccent')}
          </span>
        </h2>
        <p className="text-sm text-[var(--cl-ink-soft)]">
          {t('dashboard.welcome.subtext')}
        </p>
        {nextSessionLabel ? (
          <p className="text-sm font-medium text-[var(--cl-ink)]">
            {t('dashboard.welcome.nextSession', { session: nextSessionLabel })}
          </p>
        ) : null}
        <ul className="list-inside list-disc text-sm text-[var(--cl-ink-soft)]">
          <li>{t('dashboard.welcome.step1')}</li>
          <li>{t('dashboard.welcome.step2')}</li>
          <li>{t('dashboard.welcome.step3')}</li>
        </ul>
        <Button data-testid="student-welcome-dismiss" onClick={onDismiss}>
          {t('dashboard.welcome.cta')}
        </Button>
      </CardContent>
    </Card>
  )
}
