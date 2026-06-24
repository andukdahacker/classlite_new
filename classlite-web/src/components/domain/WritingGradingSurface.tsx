import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { SafeHtml } from '@/lib/safe-html'

import { CommentCard, type CommentType } from './CommentCard'

/**
 * WritingGradingSurface — `s23` two-column writing grading shell. Story
 * 1d-4 AC2.
 *
 * Static visual identity only. Behavior — span selection, anchor
 * persistence, AI per-comment review, comment thread state — ships in
 * Epic 6 Story 6.1. Three highlight colors map to the comment taxonomy
 * via inline `<mark class="cl-anchor-{error|praise|suggest}">` wrappers
 * in fixture `essayHtml`. Band-score chrome uses Geist Mono per UX-DR22.
 *
 * `essayHtml` is a branded `SafeHtml` string: callers MUST sanitize
 * untrusted submission HTML before passing it. The component injects the
 * value via `dangerouslySetInnerHTML`, so any unsafe HTML reaching this
 * prop becomes a direct XSS vector. Epic 6 wires submission content
 * through a server-side sanitization layer before the brand is asserted.
 */
export type { CommentType }

export interface AnchoredComment {
  id: string
  type: CommentType
  /** i18n key — e.g. `criterion.taskAchievement`. */
  criterionKey: string
  /** Fixture body text; Epic 6 wires real i18n / threading. */
  body: string
  /** Anchor metadata for visual rendering only — NOT persistence. */
  anchor: { start: number; end: number; text: string }
  resolved?: boolean
}

export interface BandScoreBreakdown {
  /** Primary band — e.g. 6.5. UX-DR22 typography applies. */
  primary: number
  criteria: ReadonlyArray<{ criterionKey: string; score: number }>
}

export interface WritingGradingSurfaceProps {
  /**
   * Pre-sanitized HTML with `<mark>` wrappers. Branded `SafeHtml` so the
   * type system rejects raw `string`s — callers must run their input
   * through `asSafeHtml(sanitized)` before passing.
   */
  essayHtml: SafeHtml
  comments: ReadonlyArray<AnchoredComment>
  score: BandScoreBreakdown
  onCommentResolve?: (id: string) => void
  onCommentEdit?: (id: string) => void
  onSubmit?: () => void
  onSaveDraft?: () => void
}

const formatBand = (value: number): string =>
  Number.isFinite(value) && value >= 0 ? value.toFixed(1) : '—'

export function WritingGradingSurface({
  essayHtml,
  comments,
  score,
  onCommentResolve,
  onCommentEdit,
  onSubmit,
  onSaveDraft,
}: WritingGradingSurfaceProps) {
  const { t } = useTranslation()
  return (
    <section
      data-testid="writing-grading-surface"
      className="flex flex-col gap-4 rounded-2xl border border-[color:var(--cl-line-soft)] bg-card shadow-sm"
      aria-label={t('writingGrading.regionLabel')}
    >
      <header
        data-testid="writing-grading-surface-header"
        className="flex flex-wrap items-end justify-between gap-4 border-b border-[color:var(--cl-line-soft)] px-6 py-4"
      >
        <div className="flex flex-col gap-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-foreground">
            {t('writingGrading.score.label')}
          </p>
          <div className="flex items-end gap-3">
            <span
              data-testid="writing-grading-surface-band"
              className="font-mono text-[1.75rem] leading-none text-foreground"
            >
              {formatBand(score.primary)}
            </span>
            <ul className="flex flex-wrap gap-3 text-sm">
              {score.criteria.map((criterion) => (
                <li
                  key={criterion.criterionKey}
                  data-testid={`writing-grading-surface-criterion-${criterion.criterionKey}`}
                  className="flex items-baseline gap-1"
                >
                  <span className="text-foreground">{t(criterion.criterionKey)}</span>
                  <span className="font-mono text-foreground">{formatBand(criterion.score)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            data-testid="writing-grading-surface-save-draft"
            onClick={onSaveDraft}
          >
            {t('writingGrading.action.saveDraft')}
          </Button>
          <Button
            size="sm"
            data-testid="writing-grading-surface-submit"
            onClick={onSubmit}
          >
            {t('writingGrading.action.submit')}
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-0 md:grid-cols-[3fr_2fr]">
        <article
          data-testid="writing-grading-surface-essay"
          aria-label={t('writingGrading.essay.label')}
          className="prose-sm max-w-none px-6 py-5 text-sm leading-relaxed text-foreground md:border-r md:border-[color:var(--cl-line)]"
          dangerouslySetInnerHTML={{ __html: essayHtml }}
        />
        <ScrollArea
          data-testid="writing-grading-surface-rail"
          className="max-h-[36rem] px-4 py-5"
        >
          {comments.length > 0 ? (
            <ol
              aria-label={t('writingGrading.rail.label')}
              className="flex flex-col gap-3"
            >
              {comments.map((comment) => (
                <li key={comment.id}>
                  <CommentCard
                    type={comment.type}
                    criterionKey={comment.criterionKey}
                    body={comment.body}
                    resolved={comment.resolved}
                    testIdSlug={comment.id}
                    onResolve={() => onCommentResolve?.(comment.id)}
                    onEdit={() => onCommentEdit?.(comment.id)}
                  />
                </li>
              ))}
            </ol>
          ) : (
            <p
              data-testid="writing-grading-surface-rail-empty"
              role="status"
              className="rounded-lg border border-dashed border-border bg-muted/40 px-4 py-6 text-center text-sm text-muted-foreground"
            >
              {t('writingGrading.rail.empty')}
            </p>
          )}
        </ScrollArea>
      </div>
    </section>
  )
}
