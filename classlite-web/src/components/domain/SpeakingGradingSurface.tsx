import { useTranslation } from 'react-i18next'
import { Play } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'

import { CommentCard, type CommentType } from './CommentCard'
import type { BandScoreBreakdown } from './WritingGradingSurface'

/**
 * SpeakingGradingSurface — `s24` waveform + timestamp pin grading shell.
 * Story 1d-4 AC3.
 *
 * Static visual identity only. Behavior — audio decode, Web Audio API
 * playback, real timestamp pinning, anchor persistence — ships in Epic 6
 * Story 6.3. The waveform is a fixture SVG `path` string; the play
 * button is chrome only. Pin chrome colors mirror AC2's taxonomy via
 * shared `CommentType`.
 */
export interface TimestampedComment {
  id: string
  type: CommentType
  /** Seconds from start. */
  timestamp: number
  criterionKey: string
  body: string
  resolved?: boolean
}

export interface SpeakingGradingSurfaceProps {
  /** Total duration in seconds — drives axis tick density. */
  durationSec: number
  /** Pre-rendered waveform SVG path (`d` attribute). The real audio
   * decode is Epic 6. */
  waveformPath: string
  comments: ReadonlyArray<TimestampedComment>
  score: BandScoreBreakdown
  /** Chrome callback — feature epic wires playback. */
  onPlay?: () => void
  onCommentResolve?: (id: string) => void
}

const PIN_TONE: Record<CommentType, string> = {
  error: 'bg-[color:var(--cl-red)]',
  praise: 'bg-[color:var(--cl-green)]',
  suggest: 'bg-[color:var(--cl-amber)]',
}

const WAVEFORM_HEIGHT = 80
const WAVEFORM_VIEW_WIDTH = 600

function formatTimestamp(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.floor(seconds)
  const minutes = Math.floor(total / 60)
  const remainder = total % 60
  return `${minutes}:${remainder.toString().padStart(2, '0')}`
}

const formatBand = (value: number): string =>
  Number.isFinite(value) && value >= 0 ? value.toFixed(1) : '—'

export function SpeakingGradingSurface({
  durationSec,
  waveformPath,
  comments,
  score,
  onPlay,
  onCommentResolve,
}: SpeakingGradingSurfaceProps) {
  const { t } = useTranslation()
  const hasDuration = Number.isFinite(durationSec) && durationSec > 0
  const safeDuration = hasDuration ? durationSec : 1
  const tickCount = Math.min(8, Math.max(2, Math.round(safeDuration / 30)))
  const ticks = hasDuration
    ? Array.from({ length: tickCount + 1 }, (_, index) => {
        const fraction = index / tickCount
        return { fraction, seconds: Math.round(fraction * safeDuration) }
      })
    : []

  return (
    <section
      data-testid="speaking-grading-surface"
      aria-label={t('speakingGrading.regionLabel')}
      className="flex flex-col gap-4 rounded-2xl border border-[color:var(--cl-line-soft)] bg-card shadow-sm"
    >
      <header
        data-testid="speaking-grading-surface-header"
        className="flex flex-wrap items-end justify-between gap-4 border-b border-[color:var(--cl-line-soft)] px-6 py-4"
      >
        <div className="flex flex-col gap-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-foreground">
            {t('speakingGrading.score.label')}
          </p>
          <div className="flex items-end gap-3">
            <span
              data-testid="speaking-grading-surface-band"
              className="font-mono text-[1.75rem] leading-none text-foreground"
            >
              {formatBand(score.primary)}
            </span>
            <ul className="flex flex-wrap gap-3 text-sm">
              {score.criteria.map((criterion) => (
                <li
                  key={criterion.criterionKey}
                  className="flex items-baseline gap-1"
                  data-testid={`speaking-grading-surface-criterion-${criterion.criterionKey}`}
                >
                  <span className="text-foreground">{t(criterion.criterionKey)}</span>
                  <span className="font-mono text-foreground">{formatBand(criterion.score)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={onPlay}
          data-testid="speaking-grading-surface-play"
        >
          <Play data-icon="inline-start" aria-hidden="true" />
          {t('speakingGrading.action.play')}
        </Button>
      </header>

      <div className="grid grid-cols-1 gap-0 md:grid-cols-[3fr_2fr]">
        <div className="px-6 py-5 md:border-r md:border-[color:var(--cl-line)]">
          <div
            data-testid="speaking-grading-surface-waveform"
            className="relative rounded-lg bg-[color:var(--cl-surface-warm)] p-3"
          >
            <svg
              viewBox={`0 0 ${WAVEFORM_VIEW_WIDTH} ${WAVEFORM_HEIGHT}`}
              preserveAspectRatio="none"
              role="img"
              aria-label={
                hasDuration
                  ? t('speakingGrading.waveform.label', {
                      duration: formatTimestamp(safeDuration),
                    })
                  : t('speakingGrading.waveform.noRecording')
              }
              className="block h-20 w-full text-[color:var(--cl-ink-soft)]"
              data-testid="speaking-grading-surface-waveform-svg"
            >
              <path
                d={waveformPath}
                fill="currentColor"
                fillOpacity={0.65}
                stroke="currentColor"
                strokeWidth={1}
              />
            </svg>
            {comments.map((comment) => {
              const fraction = Math.min(1, Math.max(0, comment.timestamp / safeDuration))
              return (
                <span
                  key={comment.id}
                  data-testid={`speaking-grading-surface-pin-${comment.id}`}
                  data-comment-type={comment.type}
                  className={cn(
                    'absolute top-2 inline-flex h-[calc(100%-1rem)] w-[3px] -translate-x-1/2 rounded-full',
                    PIN_TONE[comment.type],
                    comment.resolved && 'opacity-40',
                  )}
                  style={{ left: `${fraction * 100}%` }}
                />
              )
            })}
          </div>
          {hasDuration ? (
            <div
              data-testid="speaking-grading-surface-axis"
              className="mt-2 flex justify-between font-mono text-[0.7rem] text-muted-foreground"
              aria-hidden="true"
            >
              {ticks.map((tick) => (
                <span key={tick.fraction}>{formatTimestamp(tick.seconds)}</span>
              ))}
            </div>
          ) : null}
        </div>

        <ScrollArea
          data-testid="speaking-grading-surface-rail"
          className="max-h-[36rem] px-4 py-5"
        >
          {comments.length > 0 ? (
            <ol
              aria-label={t('speakingGrading.rail.label')}
              className="flex flex-col gap-3"
            >
              {comments.map((comment) => (
                <li key={comment.id}>
                  <CommentCard
                    type={comment.type}
                    criterionKey={comment.criterionKey}
                    body={comment.body}
                    timestamp={formatTimestamp(comment.timestamp)}
                    resolved={comment.resolved}
                    testIdSlug={comment.id}
                    onResolve={() => onCommentResolve?.(comment.id)}
                  />
                </li>
              ))}
            </ol>
          ) : (
            <p
              data-testid="speaking-grading-surface-rail-empty"
              role="status"
              className="rounded-lg border border-dashed border-border bg-muted/40 px-4 py-6 text-center text-sm text-muted-foreground"
            >
              {t('speakingGrading.rail.empty')}
            </p>
          )}
        </ScrollArea>
      </div>
    </section>
  )
}
