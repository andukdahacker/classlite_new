import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

import { CommentCard, type CommentType } from './CommentCard'

/**
 * AIGradeSuggestion — Story 6.2b (T3, FD7). The teacher-only AI suggestion review
 * surface for screen s23: a band-strip of the four criterion proposals plus a rail
 * of AI anchored-comment cards, each with per-item Accept / Edit / Dismiss and a
 * bulk "Accept all praise". Greenfield DOMAIN component (cross-product s16/s17/s24)
 * — it COMPOSES the shipped `CommentCard` chrome (FW-7: compose, never fork) for the
 * comment body/criterion/type, and layers the AI-specific affordances (a gradient
 * "AI" avatar vs the teacher's dark "You"; the teacher-only High/Medium confidence
 * badge; the rationale) around it.
 *
 * Confidence + rationale render on the TEACHER side ONLY (UX-DR22 / 6.2a D3). They
 * are dropped at the accept boundary — this component never sends them anywhere; the
 * parent's accept handler maps a suggestion to the wire `AnchoredComment` subset, so
 * the student `/result` path (which never receives `aiSuggestion`) can never surface
 * an AI chip / confidence / rationale.
 *
 * Fully controlled: the parent owns the draft merge + which items are `accepted`.
 * Edit is a LOCAL pre-apply buffer (the teacher tweaks a band or comment before it
 * lands in the draft); Accept then calls back with the edited value. Dismiss simply
 * calls back — the parent drops the proposal from the panel (FD5).
 */

export type AiCriterionKey =
  | 'taskResponse'
  | 'coherenceCohesion'
  | 'lexicalResource'
  | 'grammaticalRange'
export type AiConfidence = 'high' | 'medium'
/** Wire comment enum (`suggestion`), mapped to the CommentCard taxonomy (`suggest`). */
export type AiCommentType = 'error' | 'praise' | 'suggestion'

/** A single criterion band proposal ({ band, rationale, confidence }). */
export interface AIGradeBandProposal {
  criterion: AiCriterionKey
  band: number
  rationale: string
  confidence: AiConfidence
  /** True once accepted into the draft (rendered as "Applied", no more actions). */
  accepted?: boolean
}

/** A single anchored (or demoted-to-general) AI comment proposal. */
export interface AIGradeCommentProposal {
  id: string
  type: AiCommentType
  criterion: AiCriterionKey
  text: string
  confidence: AiConfidence
  /** false → the worker demoted a null-anchor to whole-essay: render as general (AC6). */
  anchored: boolean
  /** True once accepted into the draft (rendered as "Added", no more actions). */
  accepted?: boolean
}

export interface AIGradeSuggestionProps {
  bands: readonly AIGradeBandProposal[]
  comments: readonly AIGradeCommentProposal[]
  /** The AI overall band preview (parent computes it from the four proposals). */
  overallBand: number
  analyzedWordCount: number
  latencyMs: number
  /** Accept a (possibly edited) band into `draft.scores[criterion]`. */
  onAcceptBand: (criterion: AiCriterionKey, band: number) => void
  onDismissBand: (criterion: AiCriterionKey) => void
  /** Accept a (possibly edited) comment as a `DraftComment{ source:'ai' }`. */
  onAcceptComment: (
    id: string,
    next: { type: AiCommentType; criterion: AiCriterionKey; text: string },
  ) => void
  onDismissComment: (id: string) => void
  /** Bulk-accept every un-accepted praise-type comment (touches only praise, AC7). */
  onAcceptAllPraise: () => void
  /** Report a comment card entering/leaving its per-card Edit buffer, so the parent can
   * exclude in-edit cards from "Accept all praise" (code-review 2026-08-21). */
  onCommentEditingChange?: (id: string, editing: boolean) => void
}

const MS_PER_SECOND = 1000
const BAND_MIN = 1
const BAND_MAX = 9

/** Map the wire comment enum to the CommentCard taxonomy. */
function toCardType(type: AiCommentType): CommentType {
  return type === 'suggestion' ? 'suggest' : type
}

/** A band is valid on the 1.0–9.0 half-grid (mirrors grading isValidBand — inlined so
 * the domain tier does not import a feature lib, FW-7). */
function isValidBand(value: number): boolean {
  return Number.isFinite(value) && value >= BAND_MIN && value <= BAND_MAX && Number.isInteger(value * 2)
}

/** The gradient "AI" avatar — distinguishes an AI card from the teacher's dark "You". */
function AiAvatar({ label }: { label: string }) {
  return (
    <span
      data-testid="ai-avatar"
      aria-hidden="true"
      className="inline-flex size-6 items-center justify-center rounded-full bg-gradient-to-r from-fuchsia-500 to-indigo-500 text-[0.625rem] font-semibold text-white"
    >
      {label}
    </span>
  )
}

function ConfidenceBadge({ confidence }: { confidence: AiConfidence }) {
  const { t } = useTranslation()
  return (
    <span
      data-testid="ai-confidence"
      className={cn(
        'rounded-full px-2 py-0.5 text-[0.625rem] font-medium uppercase tracking-wide',
        confidence === 'high'
          ? 'bg-[color:var(--cl-tint-green)] text-[color:var(--cl-green)]'
          : 'bg-[color:var(--cl-tint-gold)] text-[color:var(--cl-amber)]',
      )}
    >
      {t(`grading.ai.confidence.${confidence}`)}
    </span>
  )
}

export function AIGradeSuggestion({
  bands,
  comments,
  overallBand,
  analyzedWordCount,
  latencyMs,
  onAcceptBand,
  onDismissBand,
  onAcceptComment,
  onDismissComment,
  onAcceptAllPraise,
  onCommentEditingChange,
}: AIGradeSuggestionProps) {
  const { t } = useTranslation()
  const seconds = (latencyMs / MS_PER_SECOND).toFixed(1)
  const hasUnacceptedPraise = comments.some((c) => c.type === 'praise' && !c.accepted)

  return (
    // A non-landmark container (the parent panel provides the labelled region + heading
    // — a second same-named landmark trips axe `landmark-unique`).
    <div
      data-testid="ai-grade-suggestion"
      className="flex flex-col gap-4 rounded-2xl border border-[color:var(--cl-line-soft)] bg-card p-4 shadow-sm"
    >
      <div className="flex justify-end">
        <p className="text-xs text-muted-foreground" data-testid="ai-analyzed-meta">
          {t('grading.ai.analyzedMeta', { words: analyzedWordCount, seconds })}
        </p>
      </div>

      <AiBandStrip
        bands={bands}
        overallBand={overallBand}
        onAcceptBand={onAcceptBand}
        onDismissBand={onDismissBand}
      />

      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t('grading.ai.comments.title')}
        </h3>
        {hasUnacceptedPraise ? (
          <Button
            type="button"
            size="xs"
            variant="outline"
            data-testid="ai-accept-all-praise"
            onClick={onAcceptAllPraise}
          >
            {t('grading.ai.acceptAllPraise')}
          </Button>
        ) : null}
      </div>

      {comments.length > 0 ? (
        <ol className="flex flex-col gap-3" aria-label={t('grading.ai.comments.title')}>
          {comments.map((comment) => (
            <li key={comment.id}>
              <AiCommentCard
                comment={comment}
                onAccept={onAcceptComment}
                onDismiss={onDismissComment}
                onEditingChange={onCommentEditingChange}
              />
            </li>
          ))}
        </ol>
      ) : (
        <p
          data-testid="ai-comments-empty"
          role="status"
          className="rounded-lg border border-dashed border-border bg-muted/40 px-4 py-4 text-center text-xs text-muted-foreground"
        >
          {t('grading.ai.comments.empty')}
        </p>
      )}

      <p className="text-xs italic text-muted-foreground" data-testid="ai-disclaimer">
        {t('grading.ai.disclaimer')}
      </p>
    </div>
  )
}

// --- band strip (the four criterion proposals + overall preview) ---

function AiBandStrip({
  bands,
  overallBand,
  onAcceptBand,
  onDismissBand,
}: {
  bands: readonly AIGradeBandProposal[]
  overallBand: number
  onAcceptBand: (criterion: AiCriterionKey, band: number) => void
  onDismissBand: (criterion: AiCriterionKey) => void
}) {
  const { t } = useTranslation()
  return (
    <section
      data-testid="ai-band-strip"
      aria-label={t('grading.ai.bandStrip.label')}
      className="flex flex-col gap-3 rounded-xl border border-[color:var(--cl-line-soft)] bg-muted/30 p-3"
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t('grading.ai.overall.label')}
        </span>
        {/* FD6.3 — reuse the exact 6.1 teacher overall-band treatment (Geist Mono 2xl)
            so the AI preview and the teacher's own band read identically. */}
        <span
          data-testid="ai-overall-band"
          className="font-mono text-2xl leading-none text-foreground"
        >
          {overallBand.toFixed(1)}
        </span>
      </div>
      <ul className="flex flex-col gap-2">
        {bands.map((proposal) => (
          <li key={proposal.criterion}>
            <AiBandProposal proposal={proposal} onAccept={onAcceptBand} onDismiss={onDismissBand} />
          </li>
        ))}
      </ul>
    </section>
  )
}

function AiBandProposal({
  proposal,
  onAccept,
  onDismiss,
}: {
  proposal: AIGradeBandProposal
  onAccept: (criterion: AiCriterionKey, band: number) => void
  onDismiss: (criterion: AiCriterionKey) => void
}) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [buffer, setBuffer] = useState(String(proposal.band))
  const parsed = Number.parseFloat(buffer)
  const editedValid = isValidBand(parsed)

  return (
    <div
      data-testid={`ai-band-proposal-${proposal.criterion}`}
      className="flex flex-col gap-1 rounded-lg border border-border bg-card p-2"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-foreground">
          {t(`criterion.${proposal.criterion}`)}
        </span>
        <div className="flex items-center gap-2">
          <ConfidenceBadge confidence={proposal.confidence} />
          {editing ? (
            <Input
              type="text"
              inputMode="decimal"
              data-testid={`ai-band-${proposal.criterion}-input`}
              aria-label={t('grading.ai.band.editLabel')}
              value={buffer}
              onChange={(e) => setBuffer(e.target.value)}
              className="w-16"
            />
          ) : (
            <span
              data-testid={`ai-band-${proposal.criterion}-value`}
              className="font-mono text-base text-foreground"
            >
              {proposal.band.toFixed(1)}
            </span>
          )}
        </div>
      </div>
      <p className="text-xs text-muted-foreground" data-testid={`ai-band-${proposal.criterion}-rationale`}>
        {proposal.rationale}
      </p>
      {proposal.accepted ? (
        <span
          data-testid={`ai-band-${proposal.criterion}-applied`}
          className="text-xs font-medium text-[color:var(--cl-green)]"
        >
          {t('grading.ai.action.bandApplied')}
        </span>
      ) : (
        <div className="flex gap-2">
          <Button
            type="button"
            size="xs"
            data-testid={`ai-band-${proposal.criterion}-accept`}
            disabled={editing && !editedValid}
            onClick={() => onAccept(proposal.criterion, editing ? parsed : proposal.band)}
          >
            {t('grading.ai.action.accept')}
          </Button>
          <Button
            type="button"
            size="xs"
            variant="ghost"
            data-testid={`ai-band-${proposal.criterion}-edit`}
            aria-pressed={editing}
            onClick={() => setEditing((v) => !v)}
          >
            {t('grading.ai.action.edit')}
          </Button>
          <Button
            type="button"
            size="xs"
            variant="ghost"
            data-testid={`ai-band-${proposal.criterion}-dismiss`}
            onClick={() => onDismiss(proposal.criterion)}
          >
            {t('grading.ai.action.dismiss')}
          </Button>
        </div>
      )}
    </div>
  )
}

// --- AI comment card (composes CommentCard chrome + AI avatar/confidence/actions) ---

function AiCommentCard({
  comment,
  onAccept,
  onDismiss,
  onEditingChange,
}: {
  comment: AIGradeCommentProposal
  onAccept: (
    id: string,
    next: { type: AiCommentType; criterion: AiCriterionKey; text: string },
  ) => void
  onDismiss: (id: string) => void
  onEditingChange?: (id: string, editing: boolean) => void
}) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(comment.text)
  const [criterion, setCriterion] = useState<AiCriterionKey>(comment.criterion)

  // Toggle Edit and report the transition up so the parent can exclude an in-edit card
  // from "Accept all praise" (code-review 2026-08-21).
  const toggleEditing = () =>
    setEditing((v) => {
      const next = !v
      onEditingChange?.(comment.id, next)
      return next
    })

  const accept = () =>
    onAccept(comment.id, {
      type: comment.type,
      criterion: editing ? criterion : comment.criterion,
      text: editing ? text.trim() : comment.text,
    })

  const criterionKeys: AiCriterionKey[] = [
    'taskResponse',
    'coherenceCohesion',
    'lexicalResource',
    'grammaticalRange',
  ]

  return (
    <article
      data-testid={`ai-comment-${comment.id}`}
      data-anchored={comment.anchored ? 'true' : 'false'}
      className="flex flex-col gap-2 rounded-lg border border-border bg-card p-2"
    >
      <header className="flex items-center gap-2">
        <AiAvatar label={t('grading.ai.avatar')} />
        <span className="text-xs font-medium text-muted-foreground">{t('grading.ai.commentLabel')}</span>
        <span className="ml-auto flex items-center gap-2">
          <ConfidenceBadge confidence={comment.confidence} />
          {!comment.anchored ? (
            <span
              data-testid={`ai-comment-${comment.id}-general`}
              className="rounded-full bg-muted px-2 py-0.5 text-[0.625rem] font-medium uppercase tracking-wide text-muted-foreground"
            >
              {t('grading.ai.general')}
            </span>
          ) : null}
        </span>
      </header>

      {/* Compose the shipped CommentCard chrome (readOnly → no teacher footer). It
          renders the type glyph/tone + criterion tag + body; the AI affordances wrap it. */}
      <CommentCard
        readOnly
        type={toCardType(comment.type)}
        criterionKey={`criterion.${comment.criterion}`}
        body={comment.text}
        testIdSlug={`ai-${comment.id}`}
      />

      {editing ? (
        <div className="flex flex-col gap-2">
          <select
            data-testid={`ai-comment-${comment.id}-criterion`}
            aria-label={t('grading.comment.criterionLabel')}
            className="w-full rounded border border-border bg-background px-2 py-1 text-sm"
            value={criterion}
            onChange={(e) => setCriterion(e.target.value as AiCriterionKey)}
          >
            {criterionKeys.map((key) => (
              <option key={key} value={key}>
                {t(`criterion.${key}`)}
              </option>
            ))}
          </select>
          <Textarea
            data-testid={`ai-comment-${comment.id}-text`}
            aria-label={t('grading.ai.comment.editLabel')}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
          />
        </div>
      ) : null}

      {comment.accepted ? (
        <span
          data-testid={`ai-comment-${comment.id}-applied`}
          className="text-xs font-medium text-[color:var(--cl-green)]"
        >
          {t('grading.ai.action.commentApplied')}
        </span>
      ) : (
        <div className="flex gap-2">
          <Button
            type="button"
            size="xs"
            data-testid={`ai-comment-${comment.id}-accept`}
            disabled={editing && text.trim() === ''}
            onClick={accept}
          >
            {t('grading.ai.action.accept')}
          </Button>
          <Button
            type="button"
            size="xs"
            variant="ghost"
            data-testid={`ai-comment-${comment.id}-edit`}
            aria-pressed={editing}
            onClick={toggleEditing}
          >
            {t('grading.ai.action.edit')}
          </Button>
          <Button
            type="button"
            size="xs"
            variant="ghost"
            data-testid={`ai-comment-${comment.id}-dismiss`}
            onClick={() => onDismiss(comment.id)}
          >
            {t('grading.ai.action.dismiss')}
          </Button>
        </div>
      )}
    </article>
  )
}
