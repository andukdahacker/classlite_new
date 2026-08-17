/**
 * NotReleasedNote — Story 5.5a Task 5 (AC5/D12). A QUIET secondary line, not a
 * pending hero: "grades not released yet" + a horizon ("you'll be notified when
 * your grade is ready"). In the pre-Epic-6 world this is the baseline for every
 * submission, not an error — the read-back is the hero. 5-5b adds the grade block
 * above the read-back when the grade is released.
 */
import { useTranslation } from 'react-i18next'

export function NotReleasedNote() {
  const { t } = useTranslation()
  return (
    <p
      data-testid="submission-review-not-released-note"
      className="text-sm text-[var(--cl-ink-soft)]"
    >
      {t('submissionReview.notReleased.note')}{' '}
      <span className="text-[var(--cl-ink-soft)]">
        {t('submissionReview.notReleased.horizon')}
      </span>
    </p>
  )
}
