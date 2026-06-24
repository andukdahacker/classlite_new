import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * CommentCard — shared comment card chrome for Phase 4 grading surfaces.
 * Static visual identity only. 1d-4 AC2 (WritingGradingSurface anchored
 * comments) + AC3 (SpeakingGradingSurface timestamp-pinned comments).
 *
 * Behavior — real comment thread state, AI per-comment review, anchor /
 * timestamp persistence — ships in Epic 6 Stories 6.1 (writing) and 6.3
 * (speaking). This shell is visual identity only.
 *
 * Three taxonomy colors per the spec (red error / green praise / amber
 * suggest). The taxonomy glyphs (`!` / `★` / `✎`) are aria-hidden — the
 * criterion label communicates the comment type to AT users.
 */
export type CommentType = 'error' | 'praise' | 'suggest'

export interface CommentCardProps {
  type: CommentType
  /** i18n key for the criterion label (e.g. `criterion.taskAchievement`). */
  criterionKey: string
  /** Comment body — fixture text in 1d-4. Real i18n in Epic 6. */
  body: string
  /** When present, rendered as a Geist Mono timestamp (e.g. `01:23`). */
  timestamp?: string
  /** Dim the card + cross out the body when resolved. */
  resolved?: boolean
  /** Stable selector slug for downstream feature-epic tests. */
  testIdSlug: string
  onResolve?: () => void
  onEdit?: () => void
}

const TAXONOMY: Record<
  CommentType,
  { glyph: string; tone: string; chip: string }
> = {
  error: {
    glyph: '!',
    tone: 'border-l-destructive',
    chip: 'bg-destructive/10 text-destructive',
  },
  praise: {
    glyph: '★',
    tone: 'border-l-[color:var(--cl-green)]',
    chip: 'bg-[color:var(--cl-tint-green)] text-[color:var(--cl-green)]',
  },
  suggest: {
    glyph: '✎',
    tone: 'border-l-[color:var(--cl-amber)]',
    chip: 'bg-[color:var(--cl-tint-gold)] text-[color:var(--cl-amber)]',
  },
}

export function CommentCard({
  type,
  criterionKey,
  body,
  timestamp,
  resolved,
  testIdSlug,
  onResolve,
  onEdit,
}: CommentCardProps) {
  const { t } = useTranslation()
  const taxonomy = TAXONOMY[type]
  return (
    <article
      data-testid={`comment-card-${testIdSlug}`}
      data-comment-type={type}
      data-resolved={resolved ? 'true' : 'false'}
      className={cn(
        'flex flex-col gap-2 rounded-lg border border-border border-l-4 bg-card p-3 shadow-sm',
        taxonomy.tone,
        // `resolved` was previously rendered with `opacity-60` on the whole
        // card, but a card-wide opacity drops effective foreground contrast
        // below WCAG AA (4.5) for the resolved comment body. Differentiate
        // visually by softening the background to `bg-muted/40` and using
        // the line-through on the body only — full token contrast survives.
        resolved && 'bg-muted/40',
      )}
    >
      <header className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className={cn(
            'inline-flex size-6 items-center justify-center rounded-full font-mono text-xs',
            taxonomy.chip,
          )}
        >
          {taxonomy.glyph}
        </span>
        <span className="text-xs font-semibold uppercase tracking-wide text-foreground">
          {t(criterionKey)}
        </span>
        {timestamp ? (
          <span
            data-testid={`comment-card-${testIdSlug}-timestamp`}
            className="ml-auto font-mono text-xs text-foreground"
          >
            {timestamp}
          </span>
        ) : null}
      </header>
      {body ? (
        <p
          className={cn(
            'text-sm leading-relaxed text-foreground',
            resolved && 'line-through',
          )}
        >
          {body}
        </p>
      ) : null}
      <footer className="flex gap-2">
        <Button
          size="xs"
          variant="ghost"
          onClick={onResolve}
          data-testid={`comment-card-${testIdSlug}-resolve`}
        >
          {t(resolved ? 'commentCard.action.reopen' : 'commentCard.action.resolve')}
        </Button>
        <Button
          size="xs"
          variant="ghost"
          onClick={onEdit}
          data-testid={`comment-card-${testIdSlug}-edit`}
        >
          {t('commentCard.action.edit')}
        </Button>
      </footer>
    </article>
  )
}
