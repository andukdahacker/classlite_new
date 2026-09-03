/**
 * StatusPill — Story 7.1b (D9). A composable, tone-driven status badge wrapping
 * the shadcn `Badge` primitive. Unlike `ClassStatusPill` (a class-lifecycle
 * TRANSITION control with a dropdown of next states), this is a purely
 * presentational pill — the generic base the inventory called for.
 *
 * Tones cover the staff surface today (`active` | `pending` | `archived`); Story
 * 7.2 reuses it for student status. The label resolves from
 * `people.staff.status.{tone}` via i18n (never a hardcoded string). Domain tier
 * — no feature imports (FW-7). Deliberately NOT a retrofit of `ClassStatusPill`
 * (D9 — targeted addition, not a sweep).
 */
import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'

export type StatusTone = 'active' | 'pending' | 'archived'

const TONE_CLASS: Record<StatusTone, string> = {
  active: 'bg-[color:var(--cl-tint-green)] text-[color:var(--cl-green)]',
  pending: 'bg-[color:var(--cl-tint-gold)] text-[color:var(--cl-amber)]',
  archived: 'bg-slate-100 text-slate-500',
}

export interface StatusPillProps {
  tone: StatusTone
}

export function StatusPill({ tone }: StatusPillProps): ReactElement {
  const { t } = useTranslation()
  return (
    <Badge
      variant="secondary"
      className={TONE_CLASS[tone]}
      data-testid={`status-pill-${tone}`}
    >
      {t(`people.staff.status.${tone}`)}
    </Badge>
  )
}
