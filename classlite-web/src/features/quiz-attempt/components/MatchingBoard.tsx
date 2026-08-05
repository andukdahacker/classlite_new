/**
 * MatchingBoard — Story 5.2b Task 6 (AC6, Sally-S3 / D5). Accessible-first
 * matching: each row is a question whose `options` is the replicated heading
 * bank. The DEFAULT interaction (touch + the keyboard path, WCAG 2.1.1) is a
 * native per-row `<select>` — it never requires a pointer. Pointer
 * drag-and-drop of the heading chips (`@dnd-kit/core`, PointerSensor only) is a
 * desktop ENHANCEMENT layered over the same control: a drop writes the same
 * per-row string the select would.
 */
import { useTranslation } from 'react-i18next'
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { cn } from '@/lib/utils'
import type { components } from '@/lib/api/client'

export interface MatchingRowState {
  /** The handle of the currently-focused question (for the current-border). */
  currentHandle: string | null
  /** Handles flagged for review. */
  flagged: ReadonlySet<string>
  /** Toggle a row's flag. */
  onToggleFlag: (handle: string) => void
}

type AttemptQuestion = components['schemas']['AttemptQuestion']

export interface MatchingRow {
  handle: string
  questionNumber: number
  question: AttemptQuestion
}

export interface MatchingBoardProps extends MatchingRowState {
  rows: MatchingRow[]
  /** handle → selected heading string. */
  values: Record<string, string>
  onChange: (handle: string, value: string) => void
  disabled?: boolean
}

function HeadingChip({ heading, disabled }: { heading: string; disabled?: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `heading:${heading}`,
    data: { heading },
    disabled,
  })
  return (
    <span
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      data-testid={`matching-chip-${heading}`}
      className={cn(
        'inline-flex cursor-grab select-none rounded-[var(--cl-radius-sm)] border border-input bg-[var(--cl-surface)] px-2.5 py-1 text-sm text-[var(--cl-ink)]',
        isDragging && 'opacity-50',
        disabled && 'cursor-not-allowed opacity-60',
      )}
    >
      {heading}
    </span>
  )
}

function MatchingRowField({
  row,
  headings,
  value,
  onChange,
  disabled,
  isCurrent,
  isFlagged,
  onToggleFlag,
}: {
  row: MatchingRow
  headings: string[]
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  isCurrent: boolean
  isFlagged: boolean
  onToggleFlag: (handle: string) => void
}) {
  const { t } = useTranslation()
  const { setNodeRef, isOver } = useDroppable({
    id: `row:${row.handle}`,
    data: { handle: row.handle },
    disabled,
  })
  const selectId = `q-${row.handle}`
  return (
    // Each row is individually addressable (`qwrap-<handle>`) so the navigator
    // jump / Prev-Next can scroll + focus it, and carries the current-border.
    <div
      ref={setNodeRef}
      id={`qwrap-${row.handle}`}
      data-testid={`question-${row.handle}`}
      className={cn(
        'flex items-center gap-2 rounded-[var(--cl-radius-sm)] border p-2',
        isCurrent ? 'border-[var(--cl-accent)]' : 'border-transparent',
        isOver && 'bg-[var(--cl-accent)]/10 ring-1 ring-[var(--cl-accent)]',
      )}
    >
      <div className="flex flex-1 flex-col gap-1.5 md:flex-row md:items-center md:justify-between">
        <label htmlFor={selectId} className="text-sm text-[var(--cl-ink)]">
          <span className="mr-1.5 text-[var(--cl-ink-soft)]">
            {t('attempt.question.label', { number: row.questionNumber })}
          </span>
          {row.question.text}
        </label>
        {/* Native select = the guaranteed keyboard + touch path (WCAG 2.1.1). */}
        <select
          id={selectId}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          aria-label={t('attempt.matching.rowAriaLabel', {
            number: row.questionNumber,
            text: row.question.text,
          })}
          data-testid={`matching-select-${row.handle}`}
          className="min-w-[10rem] rounded-[var(--cl-radius-sm)] border border-input bg-[var(--cl-surface)] px-2 py-1.5 text-sm text-[var(--cl-ink)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          <option value="">{t('attempt.matching.selectPlaceholder')}</option>
          {headings.map((heading) => (
            <option key={heading} value={heading}>
              {heading}
            </option>
          ))}
        </select>
      </div>
      <button
        type="button"
        onClick={() => onToggleFlag(row.handle)}
        disabled={disabled}
        aria-pressed={isFlagged}
        aria-label={t('attempt.flag.toggle', { number: row.questionNumber })}
        data-testid={`flag-${row.handle}`}
        className={cn(
          'flex size-11 shrink-0 items-center justify-center rounded-[var(--cl-radius-sm)] text-lg',
          isFlagged ? 'text-[var(--cl-amber)]' : 'text-[var(--cl-ink-soft)]',
        )}
      >
        ⚑
      </button>
    </div>
  )
}

export function MatchingBoard({
  rows,
  values,
  onChange,
  disabled,
  currentHandle,
  flagged,
  onToggleFlag,
}: MatchingBoardProps) {
  const { t } = useTranslation()
  // The heading bank is replicated on every row (AC6) — take it from the first.
  const headings = rows[0]?.question.options ?? []
  const sensors = useSensors(useSensor(PointerSensor))

  const handleDragEnd = (event: DragEndEvent) => {
    if (disabled) return
    const heading = event.active.data.current?.heading as string | undefined
    const handle = event.over?.data.current?.handle as string | undefined
    if (heading && handle) onChange(handle, heading)
  }

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="flex flex-col gap-3" data-testid="matching-board">
        <p className="text-sm font-medium text-[var(--cl-ink)]">
          {t('attempt.matching.instruction')}
        </p>
        {/* Desktop drag enhancement — the same value the select writes. */}
        <div
          className="hidden flex-wrap gap-2 md:flex"
          aria-hidden="true"
          data-testid="matching-heading-bank"
        >
          {headings.map((heading) => (
            <HeadingChip key={heading} heading={heading} disabled={disabled} />
          ))}
        </div>
        <div className="flex flex-col gap-1.5">
          {rows.map((row) => (
            <MatchingRowField
              key={row.handle}
              row={row}
              headings={headings}
              value={values[row.handle] ?? ''}
              onChange={(value) => onChange(row.handle, value)}
              disabled={disabled}
              isCurrent={row.handle === currentHandle}
              isFlagged={flagged.has(row.handle)}
              onToggleFlag={onToggleFlag}
            />
          ))}
        </div>
      </div>
    </DndContext>
  )
}
