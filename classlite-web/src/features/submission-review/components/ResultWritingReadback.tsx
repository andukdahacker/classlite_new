/**
 * ResultWritingReadback — Story 5.5a Task 4 (AC8). The read-only playback of a
 * writing submission: the student's own `content.text` rendered `pre-wrap` (blank
 * lines + indentation preserved) with NO editor chrome — no toolbar, no word-count,
 * no editable surface. Reading measure ≥16px so iOS mobile never zooms (AC12).
 */
import { useTranslation } from 'react-i18next'
import type { components } from '@/lib/api/client'
import { readWritingText } from '../lib/submissionContent'

type Submission = components['schemas']['Submission']

export interface ResultWritingReadbackProps {
  submission: Submission
}

export function ResultWritingReadback({ submission }: ResultWritingReadbackProps) {
  const { t } = useTranslation()
  const text = readWritingText(submission)
  return (
    <section className="flex flex-col gap-2" data-mobile-legible="true">
      <h2 className="text-sm font-medium text-[var(--cl-ink-soft)]">
        {t('submissionReview.essay.label')}
      </h2>
      <div
        data-testid="result-writing-readback"
        // The `pre-wrap` is an INLINE style on purpose: the essay's blank lines and
        // indentation are load-bearing to the read-back, and it must be observable
        // to the read-back test's computed-style assertion (a Tailwind utility class
        // is not applied under jsdom).
        style={{ whiteSpace: 'pre-wrap' }}
        className="rounded-[var(--cl-radius-md)] border border-[var(--cl-line)] bg-[var(--cl-surface)] p-4 text-base leading-relaxed text-[var(--cl-ink)]"
      >
        {text}
      </div>
    </section>
  )
}
