/**
 * RecurrenceScopeConfirm — Story 3.4 (AC8, Sally/John BLOCKER). The safety
 * mechanism for editing/cancelling/deleting a recurring session: a WAI-ARIA
 * radiogroup whose labels are OUTCOME-FRAMED with a date anchor + a live count
 * (from the GET series block). The DEFAULT is the SAFE option ("This session
 * only") — never `all`. Delete/cancel reuse it with danger-token copy.
 */
import { type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { ApplyScope } from '../api/useSessions'
import { formatSessionDateTime } from '../lib/formatSessionTime'

interface RecurrenceScopeConfirmProps {
  value: ApplyScope
  onChange: (scope: ApplyScope) => void
  /** The clicked occurrence's start (ISO) — the date anchor for the labels. */
  targetStartsAt: string
  /** Live upcoming count from the GET /{id} series block; null while loading. */
  upcoming: number | null
  locale: string
  /** danger = delete/cancel copy tone; default = edit. */
  tone?: 'default' | 'danger'
}

export function RecurrenceScopeConfirm({
  value,
  onChange,
  targetStartsAt,
  upcoming,
  locale,
  tone = 'default',
}: RecurrenceScopeConfirmProps): ReactElement {
  const { t } = useTranslation()
  const dateAnchor = formatSessionDateTime(targetStartsAt, locale)

  // While the detail/series count is still loading, show a placeholder rather
  // than a false "0" on the destructive scope options (FP13).
  const count = upcoming === null ? t('schedule.modal.scope.countLoading') : upcoming
  const options: Array<{ scope: ApplyScope; label: string }> = [
    { scope: 'this', label: t('schedule.modal.scope.this') },
    {
      scope: 'future',
      label: t('schedule.modal.scope.future', { date: dateAnchor, count }),
    },
    { scope: 'all', label: t('schedule.modal.scope.all', { count }) },
  ]

  return (
    <fieldset
      role="radiogroup"
      aria-label={t('schedule.modal.scope.legend')}
      data-testid="recurrence-scope-confirm"
      className={`flex flex-col gap-2 rounded-md border p-3 ${
        tone === 'danger' ? 'border-red-200 bg-red-50' : 'border-slate-200'
      }`}
    >
      <legend className="px-1 text-xs font-medium text-slate-600">
        {t('schedule.modal.scope.legend')}
      </legend>
      {options.map((opt) => (
        <label key={opt.scope} className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="applyScope"
            value={opt.scope}
            checked={value === opt.scope}
            onChange={() => onChange(opt.scope)}
            // The safe option is autofocused so focus lands on it, not `all`.
            autoFocus={opt.scope === 'this'}
          />
          <span>{opt.label}</span>
        </label>
      ))}
    </fieldset>
  )
}
