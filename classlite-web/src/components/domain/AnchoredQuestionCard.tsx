import { useTranslation } from 'react-i18next'

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

import type { Role } from '@/hooks/useRole'

/**
 * AnchoredQuestionCard — `s18` (teacher answer) and `s36` (student ask)
 * anchored Q&A card. Story 1d-4 AC4; wired for behavior in Story 7.4b (AC14).
 *
 * PRESENTATIONAL. Story 7.4b gave the shell the behavior it intentionally
 * omitted: a controlled teacher reply composer (submit + send-&-resolve
 * callbacks, a personal/shared visibility toggle, a maxLength-capped textarea)
 * and an anchor-pin tone (orange item / blue exercise). It still holds NO
 * server state and runs NO mutations — the console/rail container owns the RHF
 * form + TanStack mutations and drives this card through the `reply` prop and
 * `onRequestAiSuggest`. Wire-type → view-model mapping lives in the feature.
 *
 * The teacher vs student variants ship as ONE component with a `variant`
 * prop because the chrome differs only at the footer block (teacher gets
 * composer + AI suggest; student gets awaiting pill or reply readback).
 * Per UX-3, this is layout-level switching like Tabs, NOT role-conditional
 * logic — feature epics layer routing on top.
 */
export type QuestionVariant = 'teacher-answer' | 'student-ask'
export type QuestionState = 'awaiting' | 'answered'

/** Anchor-pin tone (AC2/AC14): orange = item, blue = whole exercise (UX:370). */
export type AnchorTone = 'item' | 'exercise'

/** Reply visibility (contract enum, 7-4a). */
export type ReplyVisibility = 'personal' | 'shared'

/**
 * Content max for the ask + reply textareas — the single source for the 7-4a
 * contract cap (AskQuestionRequest / ReplyRequest content `maxLength`). The
 * feature Zod schemas and the BatchActionBar re-use this one literal so the
 * textarea `maxLength` and the Zod `.max()` can never drift apart.
 */
export const QUESTION_CONTENT_MAX = 5000

export interface AnchoredQuestion {
  id: string
  variant: QuestionVariant
  state: QuestionState
  asker: { name: string; avatarUrl?: string | null; role: Role }
  questionText: string
  /** Human-readable fixture location string (e.g. `Question 3, span "wisdom of crowds"`). */
  anchoredExcerpt: { text: string; location: string }
  /** Anchor-pin tone — orange item / blue exercise. Absent → no pin. */
  anchorTone?: AnchorTone
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

/**
 * Controlled teacher reply composer state (AC8/AC9/AC14). Provided by the
 * console container; when absent the teacher footer renders disabled static
 * chrome (the shell's Storybook identity). Holds no mutation — `onSubmit` /
 * `onSendAndResolve` fire the container's TanStack mutations.
 */
export interface AnchoredReplyComposer {
  value: string
  onChange: (value: string) => void
  visibility: ReplyVisibility
  onVisibilityChange: (visibility: ReplyVisibility) => void
  /** Send reply (resolve:false) — AC8. */
  onSubmit: () => void
  /** Send reply and resolve in one action (resolve:true) — AC9. */
  onSendAndResolve?: () => void
  submitting?: boolean
  /** Whether the composer passes client validation (non-empty). */
  canSubmit?: boolean
  /** Inline error (UX-1) — an i18n-resolved string, never a raw code. */
  error?: string | null
}

export interface AnchoredQuestionCardProps {
  question: AnchoredQuestion
  /** AI-suggest chrome callback (Epic 10 inbox owns the real call). */
  onRequestAiSuggest?: () => void
  /** Controlled teacher reply composer (AC14) — teacher-answer variant only. */
  reply?: AnchoredReplyComposer
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

const ANCHOR_TONE_CLASS: Record<AnchorTone, string> = {
  item: 'bg-orange-500',
  exercise: 'bg-blue-500',
}

export function AnchoredQuestionCard({
  question,
  onRequestAiSuggest,
  reply,
}: AnchoredQuestionCardProps) {
  const { t } = useTranslation()
  const { asker, questionText, anchoredExcerpt, teacherReply, askedAtLabel, askedAt, anchorTone } =
    question
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
            {anchorTone ? (
              <span
                role="img"
                aria-label={t(`anchoredQuestion.pin.${anchorTone}`)}
                data-testid={`anchored-question-card-${question.id}-anchor-pin`}
                data-tone={anchorTone}
                className={cn('inline-block size-2 shrink-0 rounded-full', ANCHOR_TONE_CLASS[anchorTone])}
              />
            ) : null}
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

      {/* Composer is gated off once the thread is resolved (AC11 one-way): a
          resolved question shows no reply/visibility/send-&-resolve controls —
          a reply on a resolved thread would fire a 0-row no-op resolve. */}
      {question.variant === 'teacher-answer' && question.state !== 'answered' ? (
        <footer
          data-testid={`anchored-question-card-${question.id}-teacher-footer`}
          className="flex flex-col gap-2"
        >
          <Textarea
            data-testid={`anchored-question-card-${question.id}-reply-input`}
            aria-label={t('anchoredQuestion.replyInput.label')}
            placeholder={t('anchoredQuestion.replyInput.placeholder')}
            rows={3}
            maxLength={QUESTION_CONTENT_MAX}
            value={reply?.value ?? ''}
            onChange={reply ? (event) => reply.onChange(event.target.value) : undefined}
            disabled={!reply || reply.submitting}
            readOnly={!reply}
          />

          <div
            role="group"
            aria-label={t('anchoredQuestion.visibility.label')}
            data-testid={`anchored-question-card-${question.id}-visibility-toggle`}
            className="flex items-center gap-1"
          >
            {(['personal', 'shared'] as const).map((option) => (
              <Button
                key={option}
                type="button"
                variant={reply?.visibility === option ? 'default' : 'outline'}
                size="sm"
                aria-pressed={reply?.visibility === option}
                data-testid={`anchored-question-card-${question.id}-visibility-${option}`}
                disabled={!reply || reply.submitting}
                onClick={reply ? () => reply.onVisibilityChange(option) : undefined}
              >
                {t(`anchoredQuestion.visibility.${option}`)}
              </Button>
            ))}
          </div>

          {reply?.error ? (
            <p
              role="alert"
              data-testid={`anchored-question-card-${question.id}-reply-error`}
              className="text-xs text-[color:var(--cl-danger)]"
            >
              {reply.error}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button
              variant="secondary"
              size="sm"
              data-testid={`anchored-question-card-${question.id}-ai-suggest`}
              onClick={onRequestAiSuggest}
            >
              {t('anchoredQuestion.action.aiSuggest')}
            </Button>
            <div className="flex items-center gap-2">
              {reply?.onSendAndResolve ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  data-testid={`anchored-question-card-${question.id}-send-resolve`}
                  disabled={!reply.canSubmit || reply.submitting}
                  onClick={reply.onSendAndResolve}
                >
                  {t('anchoredQuestion.action.sendResolve')}
                </Button>
              ) : null}
              <Button
                type="button"
                size="sm"
                data-testid={`anchored-question-card-${question.id}-submit-reply`}
                disabled={!reply || !reply.canSubmit || reply.submitting}
                onClick={reply ? reply.onSubmit : undefined}
              >
                {t('anchoredQuestion.action.submitReply')}
              </Button>
            </div>
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
