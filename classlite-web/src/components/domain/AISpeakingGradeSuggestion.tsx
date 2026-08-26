import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

import { AiAvatar, ConfidenceBadge, type AiConfidence } from './AiSuggestionChrome'
import { CommentCard, type CommentType } from './CommentCard'

/**
 * AISpeakingGradeSuggestion — Story 6.3c (T3, SD5). The teacher-only AI-suggestion review
 * surface for the s24 SPEAKING grading view. TWIN of the shipped 6.2b Writing
 * `AIGradeSuggestion` (the codebase "twin, don't parameterize" convention), narrowed to
 * the four SPEAKING criteria + timestamped `moments`, and split into TWO exports because
 * the Speaking epic mandates an INTERLEAVED timeline (epic AC L198 / 6-3a D9), not a
 * separate AI panel:
 *
 *   • `AiSpeakingBandStrip` — the four-criterion band strip (Accept/Edit/Dismiss +
 *     teacher-only confidence + rationale + the transcription-meta line + disclaimer +
 *     an overall-band preview reusing the exact `SpeakingBandInputs` treatment). Sits in
 *     the AI panel beside the teacher's own band inputs (the strip cannot interleave —
 *     band proposals have no timestamp).
 *
 *   • `AiMomentCard` — a single un-accepted (or accepted) AI moment proposal that the
 *     PAGE renders INLINE in the shipped `NotesRail`, chronologically among the teacher's
 *     own notes (AC6). Composes the shipped `CommentCard` chrome (FW-7: compose, never
 *     fork) + the AI avatar / confidence badge / type+criterion tags / timestamp seek.
 *
 * Confidence + rationale render on the TEACHER side ONLY (UX-DR22 / 6.3b). They are
 * dropped at the accept boundary — this component never sends them anywhere; the parent's
 * accept handler maps a proposal to the `{ type, criterion, timestampMs, text }` core, so
 * the student result path (which never receives `aiSpeakingSuggestion`) can never surface
 * an AI chip / confidence / rationale / transcript (AC9).
 *
 * Fully controlled: the parent owns the draft merge + which items are `accepted`. Edit is
 * a LOCAL pre-apply buffer; Accept then calls back with the edited value. Dismiss simply
 * calls back — the parent drops the proposal.
 */

/** The four SPEAKING criterion keys — inlined so the domain tier does not import a
 * feature lib (FW-7; mirrors the writing `AIGradeSuggestion` precedent). Structurally
 * identical to `speakingOverallBand.SPEAKING_CRITERION_KEYS`, so the page's proposals are
 * assignable without a cast. */
export type AiSpeakingCriterionKey =
  | 'fluencyCoherence'
  | 'lexicalResource'
  | 'grammaticalRange'
  | 'pronunciation'
const SPEAKING_CRITERION_KEYS: AiSpeakingCriterionKey[] = [
  'fluencyCoherence',
  'lexicalResource',
  'grammaticalRange',
  'pronunciation',
]

/** Wire moment enum (`suggestion`), mapped to the CommentCard taxonomy (`suggest`). */
export type AiMomentType = 'error' | 'praise' | 'suggestion'

const BAND_MIN = 1
const BAND_MAX = 9
const MS_PER_SECOND = 1000

/** A single criterion band proposal ({ band, rationale, confidence }). */
export interface AiSpeakingBandProposal {
  criterion: AiSpeakingCriterionKey
  band: number
  rationale: string
  confidence: AiConfidence
  /** True once accepted into `draft.scores` (rendered as "Applied", no more actions). */
  accepted?: boolean
}

/** A single AI moment proposal (timestamped, or general when `timestampMs === null`). */
export interface AiSpeakingMomentProposal {
  id: string
  type: AiMomentType
  criterion: AiSpeakingCriterionKey
  timestampMs: number | null
  text: string
  confidence: AiConfidence
  /** True once merged into the draft as a `SpeakingDraftComment{source:'ai'}`. */
  accepted?: boolean
}

/** Map the wire moment enum to the CommentCard taxonomy ('suggestion'→'suggest'). */
function toCardType(type: AiMomentType): CommentType {
  return type === 'suggestion' ? 'suggest' : type
}

/** A band is valid on the 1.0–9.0 half-grid (mirrors grading isValidBand — inlined so
 * the domain tier does not import a feature lib, FW-7). */
function isValidBand(value: number): boolean {
  return Number.isFinite(value) && value >= BAND_MIN && value <= BAND_MAX && Number.isInteger(value * 2)
}

/** mm:ss from milliseconds (TS-6 — numbers until this formatter, no Date). */
function formatMs(ms: number): string {
  const total = Math.max(0, Math.floor(ms / MS_PER_SECOND))
  return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, '0')}`
}

// --- band strip (the four criterion proposals + overall preview + meta + disclaimer) ---

export interface AiSpeakingBandStripProps {
  bands: readonly AiSpeakingBandProposal[]
  /** The AI overall band preview (parent computes it via computeSpeakingOverallBand). */
  overallBand: number
  /** Analysed recording duration in ms (SD7 meta line; formatted here — TS-6). */
  analyzedDurationMs: number
  /** Wall-clock the analysis took, in ms (SD7 meta line). */
  latencyMs: number
  onAcceptBand: (criterion: AiSpeakingCriterionKey, band: number) => void
  onDismissBand: (criterion: AiSpeakingCriterionKey) => void
}

export function AiSpeakingBandStrip({
  bands,
  overallBand,
  analyzedDurationMs,
  latencyMs,
  onAcceptBand,
  onDismissBand,
}: AiSpeakingBandStripProps) {
  const { t } = useTranslation()
  const seconds = Math.round(latencyMs / MS_PER_SECOND)

  return (
    <section
      data-testid="ai-speaking-band-strip"
      aria-label={t('speakingGrading.ai.bandStrip.label')}
      className="flex flex-col gap-3 rounded-xl border border-[color:var(--cl-line-soft)] bg-muted/30 p-3"
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t('speakingGrading.ai.overall.label')}
        </span>
        {/* Reuse the exact SpeakingBandInputs overall treatment (Geist Mono 2xl) so the AI
            preview and the teacher's own band read identically (do NOT add a new token). */}
        <span
          data-testid="ai-speaking-overall-band"
          className="font-mono text-2xl leading-none text-foreground"
        >
          {overallBand.toFixed(1)}
        </span>
      </div>

      <p className="text-xs text-muted-foreground" data-testid="ai-speaking-transcription-meta">
        {t('speakingGrading.ai.transcriptionMeta', {
          duration: formatMs(analyzedDurationMs),
          seconds,
        })}
      </p>

      <ul className="flex flex-col gap-2">
        {bands.map((proposal) => (
          <li key={proposal.criterion}>
            <AiSpeakingBandProposalCard
              proposal={proposal}
              onAccept={onAcceptBand}
              onDismiss={onDismissBand}
            />
          </li>
        ))}
      </ul>

      <p className="text-xs italic text-muted-foreground" data-testid="ai-speaking-disclaimer">
        {t('speakingGrading.ai.disclaimer')}
      </p>
    </section>
  )
}

function AiSpeakingBandProposalCard({
  proposal,
  onAccept,
  onDismiss,
}: {
  proposal: AiSpeakingBandProposal
  onAccept: (criterion: AiSpeakingCriterionKey, band: number) => void
  onDismiss: (criterion: AiSpeakingCriterionKey) => void
}) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [buffer, setBuffer] = useState(String(proposal.band))
  const parsed = Number.parseFloat(buffer)
  const editedValid = isValidBand(parsed)

  return (
    <div
      data-testid={`ai-speaking-band-proposal-${proposal.criterion}`}
      className="flex flex-col gap-1 rounded-lg border border-border bg-card p-2"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-foreground">
          {t(`criterion.${proposal.criterion}`)}
        </span>
        <div className="flex items-center gap-2">
          <ConfidenceBadge confidence={proposal.confidence} keyPrefix="speakingGrading.ai.confidence" />
          {editing ? (
            <Input
              type="text"
              inputMode="decimal"
              data-testid={`ai-speaking-band-${proposal.criterion}-input`}
              aria-label={t('speakingGrading.ai.band.editLabel')}
              value={buffer}
              onChange={(e) => setBuffer(e.target.value)}
              className="w-16"
            />
          ) : (
            <span
              data-testid={`ai-speaking-band-${proposal.criterion}-value`}
              className="font-mono text-base text-foreground"
            >
              {proposal.band.toFixed(1)}
            </span>
          )}
        </div>
      </div>
      <p
        className="text-xs text-muted-foreground"
        data-testid={`ai-speaking-band-${proposal.criterion}-rationale`}
      >
        {proposal.rationale}
      </p>
      {proposal.accepted ? (
        <span
          data-testid={`ai-speaking-band-${proposal.criterion}-applied`}
          className="text-xs font-medium text-[color:var(--cl-green)]"
        >
          {t('speakingGrading.ai.action.bandApplied')}
        </span>
      ) : (
        <div className="flex gap-2">
          <Button
            type="button"
            size="xs"
            data-testid={`ai-speaking-band-${proposal.criterion}-accept`}
            disabled={editing && !editedValid}
            onClick={() => onAccept(proposal.criterion, editing ? parsed : proposal.band)}
          >
            {t('speakingGrading.ai.action.accept')}
          </Button>
          <Button
            type="button"
            size="xs"
            variant="ghost"
            data-testid={`ai-speaking-band-${proposal.criterion}-edit`}
            aria-pressed={editing}
            onClick={() => setEditing((v) => !v)}
          >
            {t('speakingGrading.ai.action.edit')}
          </Button>
          <Button
            type="button"
            size="xs"
            variant="ghost"
            data-testid={`ai-speaking-band-${proposal.criterion}-dismiss`}
            onClick={() => onDismiss(proposal.criterion)}
          >
            {t('speakingGrading.ai.action.dismiss')}
          </Button>
        </div>
      )}
    </div>
  )
}

// --- AI moment card (composes CommentCard chrome + AI avatar/confidence/actions) ---

export interface AiMomentCardProps {
  moment: AiSpeakingMomentProposal
  /** Highlighted when its waveform marker / rail card is active (AC7). */
  active?: boolean
  /** A timestamped moment's seek affordance — the page wires it to the playhead (AC7).
   * Omitted / null-timestamp → no seek button (the moment lives in the general zone). */
  onSeek?: (id: string, timestampMs: number) => void
  onAccept: (
    id: string,
    next: { type: AiMomentType; criterion: AiSpeakingCriterionKey; text: string },
  ) => void
  onDismiss: (id: string) => void
  /** Report a card entering/leaving its per-card Edit buffer so the parent can exclude an
   * in-edit card from "Accept all praise" (mirrors the 6.2b patch). */
  onEditingChange?: (id: string, editing: boolean) => void
}

export function AiMomentCard({
  moment,
  active = false,
  onSeek,
  onAccept,
  onDismiss,
  onEditingChange,
}: AiMomentCardProps) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(moment.text)
  const [criterion, setCriterion] = useState<AiSpeakingCriterionKey>(moment.criterion)

  const toggleEditing = () =>
    setEditing((v) => {
      const next = !v
      onEditingChange?.(moment.id, next)
      return next
    })

  const accept = () =>
    onAccept(moment.id, {
      type: moment.type,
      criterion: editing ? criterion : moment.criterion,
      text: editing ? text.trim() : moment.text,
    })

  const pinned = moment.timestampMs !== null

  return (
    <article
      data-testid={`ai-moment-${moment.id}`}
      data-active={active ? 'true' : undefined}
      data-pinned={pinned ? 'true' : 'false'}
      className={cn(
        'flex flex-col gap-2 rounded-lg border border-border bg-card p-2',
        active && 'ring-2 ring-ring',
      )}
    >
      <header className="flex items-center gap-2">
        <AiAvatar label={t('speakingGrading.ai.avatar')} />
        <span className="text-xs font-medium text-muted-foreground">
          {t('speakingGrading.ai.momentLabel')}
        </span>
        <span className="ml-auto flex items-center gap-2">
          <ConfidenceBadge confidence={moment.confidence} keyPrefix="speakingGrading.ai.confidence" />
          {!pinned ? (
            <span
              data-testid={`ai-moment-${moment.id}-general`}
              className="rounded-full bg-muted px-2 py-0.5 text-[0.625rem] font-medium uppercase tracking-wide text-muted-foreground"
            >
              {t('speakingGrading.ai.general')}
            </span>
          ) : null}
        </span>
      </header>

      {pinned && onSeek ? (
        <button
          type="button"
          data-testid={`ai-moment-${moment.id}-seek`}
          onClick={() => onSeek(moment.id, moment.timestampMs as number)}
          aria-label={t('speakingGrading.pin.markerLabel', {
            time: formatMs(moment.timestampMs as number),
          })}
          className="self-start font-mono text-xs font-medium text-primary underline underline-offset-2"
        >
          {formatMs(moment.timestampMs as number)}
        </button>
      ) : null}

      {/* Compose the shipped CommentCard chrome (readOnly → no teacher footer). */}
      <CommentCard
        readOnly
        type={toCardType(moment.type)}
        criterionKey={`criterion.${moment.criterion}`}
        body={moment.text}
        testIdSlug={`ai-moment-${moment.id}`}
      />

      {editing ? (
        <div className="flex flex-col gap-2">
          <select
            data-testid={`ai-moment-${moment.id}-criterion`}
            aria-label={t('grading.comment.criterionLabel')}
            className="w-full rounded border border-border bg-background px-2 py-1 text-sm"
            value={criterion}
            onChange={(e) => setCriterion(e.target.value as AiSpeakingCriterionKey)}
          >
            {SPEAKING_CRITERION_KEYS.map((key) => (
              <option key={key} value={key}>
                {t(`criterion.${key}`)}
              </option>
            ))}
          </select>
          <Textarea
            data-testid={`ai-moment-${moment.id}-text`}
            aria-label={t('speakingGrading.ai.moment.editLabel')}
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
          />
        </div>
      ) : null}

      {moment.accepted ? (
        <span
          data-testid={`ai-moment-${moment.id}-applied`}
          className="text-xs font-medium text-[color:var(--cl-green)]"
        >
          {t('speakingGrading.ai.action.momentApplied')}
        </span>
      ) : (
        <div className="flex gap-2">
          <Button
            type="button"
            size="xs"
            data-testid={`ai-moment-${moment.id}-accept`}
            disabled={editing && text.trim() === ''}
            onClick={accept}
          >
            {t('speakingGrading.ai.action.accept')}
          </Button>
          <Button
            type="button"
            size="xs"
            variant="ghost"
            data-testid={`ai-moment-${moment.id}-edit`}
            aria-pressed={editing}
            onClick={toggleEditing}
          >
            {t('speakingGrading.ai.action.edit')}
          </Button>
          <Button
            type="button"
            size="xs"
            variant="ghost"
            data-testid={`ai-moment-${moment.id}-dismiss`}
            onClick={() => onDismiss(moment.id)}
          >
            {t('speakingGrading.ai.action.dismiss')}
          </Button>
        </div>
      )}
    </article>
  )
}
