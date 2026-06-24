import { useTranslation } from 'react-i18next'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

import type { Role } from '@/hooks/useRole'

/**
 * AnchoredQuestionCard — `s18` (teacher answer) and `s36` (student ask)
 * anchored Q&A card. Story 1d-4 AC4.
 *
 * Static visual identity only. Behavior — Q&A thread persistence, batch
 * handling, anchor-to-exercise reverse lookup, AI suggestion call — ships
 * in Epic 7 Story 7.4.
 *
 * The teacher vs student variants ship as ONE component with a `variant`
 * prop because the chrome differs only at the footer block (teacher gets
 * composer + AI suggest; student gets awaiting pill or reply readback).
 * Per UX-3, this is layout-level switching like Tabs, NOT role-conditional
 * logic — feature epics layer routing on top.
 */
export type QuestionVariant = 'teacher-answer' | 'student-ask'
export type QuestionState = 'awaiting' | 'answered'

export interface AnchoredQuestion {
  id: string
  variant: QuestionVariant
  state: QuestionState
  asker: { name: string; avatarUrl?: string | null; role: Role }
  questionText: string
  /** Human-readable fixture location string (e.g. `Question 3, span "wisdom of crowds"`). */
  anchoredExcerpt: { text: string; location: string }
  /** Required when state is 'answered'. */
  teacherReply?: {
    name: string
    avatarUrl?: string | null
    text: string
    /** ISO timestamp — never `new Date()` per TS-6. */
    timestamp: string
    /** Pre-formatted relative-time label. Real i18n in Epic 7. */
    timestampLabel?: string
  }
  /** ISO timestamp — never `new Date()` per TS-6. */
  askedAt: string
  /** Fixture relative-time label (e.g. `2h ago`). Real i18n in Epic 7. */
  askedAtLabel?: string
}

export interface AnchoredQuestionCardProps {
  question: AnchoredQuestion
  /**
   * AI-suggest chrome callback. Real submit-reply wiring lives in Epic 7
   * Story 7.4 — the static shell intentionally omits a submit callback so
   * the textarea + button render as visual chrome only.
   */
  onRequestAiSuggest?: () => void
}

const ROLE_BADGE_VARIANT: Record<Role, 'default' | 'secondary' | 'outline' | 'ghost'> = {
  owner: 'default',
  admin: 'secondary',
  teacher: 'secondary',
  student: 'outline',
}

function deriveInitials(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return '?'
  const parts = trimmed.split(/\s+/).filter(Boolean).slice(0, 2)
  if (parts.length === 0) return '?'
  return parts.map((part) => Array.from(part)[0] ?? '').join('').toUpperCase() || '?'
}

export function AnchoredQuestionCard({
  question,
  onRequestAiSuggest,
}: AnchoredQuestionCardProps) {
  const { t } = useTranslation()
  const { asker, questionText, anchoredExcerpt, teacherReply, askedAtLabel, askedAt } = question
  return (
    <article
      data-testid={`anchored-question-card-${question.id}`}
      data-variant={question.variant}
      data-state={question.state}
      className="flex flex-col gap-3 rounded-xl border border-[color:var(--cl-line-soft)] bg-card p-4 shadow-sm"
    >
      <header className="flex items-start gap-3">
        <Avatar>
          {asker.avatarUrl ? (
            <AvatarImage src={asker.avatarUrl} alt="" />
          ) : null}
          <AvatarFallback>{deriveInitials(asker.name)}</AvatarFallback>
        </Avatar>
        <div className="flex flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-foreground">{asker.name}</span>
            <Badge
              variant={ROLE_BADGE_VARIANT[asker.role] ?? 'outline'}
              data-testid={`anchored-question-card-${question.id}-role-badge`}
            >
              {t(`userPill.role.${asker.role}`)}
            </Badge>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-foreground">
            <span data-testid={`anchored-question-card-${question.id}-anchor-location`}>
              {anchoredExcerpt.location}
            </span>
            <span aria-hidden="true">·</span>
            <time
              dateTime={askedAt}
              data-testid={`anchored-question-card-${question.id}-asked-at`}
            >
              {askedAtLabel ?? askedAt}
            </time>
          </div>
        </div>
      </header>

      <p
        className="text-sm leading-relaxed text-foreground"
        data-testid={`anchored-question-card-${question.id}-question-text`}
      >
        {questionText}
      </p>

      <blockquote
        data-testid={`anchored-question-card-${question.id}-excerpt`}
        className="rounded-md border-l-2 border-[color:var(--cl-line)] bg-[color:var(--cl-paper)] px-3 py-2 text-sm italic text-foreground"
      >
        {anchoredExcerpt.text}
      </blockquote>

      {question.variant === 'teacher-answer' ? (
        <footer
          data-testid={`anchored-question-card-${question.id}-teacher-footer`}
          className="flex flex-col gap-2"
        >
          <Textarea
            data-testid={`anchored-question-card-${question.id}-reply-input`}
            aria-label={t('anchoredQuestion.replyInput.label')}
            placeholder={t('anchoredQuestion.replyInput.placeholder')}
            rows={3}
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button
              variant="secondary"
              size="sm"
              data-testid={`anchored-question-card-${question.id}-ai-suggest`}
              onClick={onRequestAiSuggest}
            >
              {t('anchoredQuestion.action.aiSuggest')}
            </Button>
            <Button
              size="sm"
              data-testid={`anchored-question-card-${question.id}-submit-reply`}
            >
              {t('anchoredQuestion.action.submitReply')}
            </Button>
          </div>
        </footer>
      ) : null}

      {question.variant === 'student-ask' ? (
        <footer
          data-testid={`anchored-question-card-${question.id}-student-footer`}
          className={cn('flex flex-col gap-2')}
        >
          {question.state === 'awaiting' || !teacherReply ? (
            <span
              data-testid={`anchored-question-card-${question.id}-awaiting-pill`}
              className="inline-flex w-fit items-center gap-1 rounded-full bg-[color:var(--cl-tint-gold)] px-2.5 py-1 text-xs font-medium text-[color:var(--cl-amber)]"
            >
              {t('anchoredQuestion.student.awaiting')}
            </span>
          ) : (
            <div
              data-testid={`anchored-question-card-${question.id}-teacher-reply`}
              className="flex items-start gap-3 rounded-lg bg-muted/40 p-3"
            >
              <Avatar size="sm">
                {teacherReply.avatarUrl ? (
                  <AvatarImage src={teacherReply.avatarUrl} alt="" />
                ) : null}
                <AvatarFallback>{deriveInitials(teacherReply.name)}</AvatarFallback>
              </Avatar>
              <div className="flex flex-1 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2 text-xs text-foreground">
                  <span className="font-medium text-foreground">{teacherReply.name}</span>
                  <time dateTime={teacherReply.timestamp}>
                    {teacherReply.timestampLabel ?? teacherReply.timestamp}
                  </time>
                </div>
                <p className="text-sm leading-relaxed text-foreground">{teacherReply.text}</p>
              </div>
            </div>
          )}
        </footer>
      ) : null}
    </article>
  )
}
