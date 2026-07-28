/**
 * ExerciseLibraryPage — Story 4.1 (AC1/AC2/AC8/AC9). The `/exercises` library
 * (s15): count-only header → skill count-tab strip (All + per-skill totals) →
 * tag/band filter controls → list table (skill-letter tile + title + mono meta
 * line `code · N sections · N {skill-unit}`, Skill pill, Tags, Last modified,
 * row actions Edit/Duplicate/Delete) → "Showing n of total" footer + pagination.
 *
 * Role-scoped: owner/admin see all center exercises, a teacher sees only their
 * own (server-branched; keyed by scope so audiences don't share a slot).
 *
 * Trilogy (UX-1): skeleton rows / TWO distinct empty states (true-empty warm
 * hero vs filtered-empty quiet "no matches" + clear) / inline error retry.
 * keepPreviousData keeps the table from flickering to empty on page/filter change.
 *
 * The "Classes assigned" column + class/assignment-status filters are OMITTED
 * this story (no Assignment entity until Epic 5) — not faked, not disabled.
 */
import {
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactElement,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { MoreHorizontal } from 'lucide-react'
import { toast } from 'sonner'
import { useRole } from '@/hooks/useRole'
import { queryClient } from '@/lib/query-client'
import { authKeys, type Session } from '@/features/auth/api/authKeys'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  useExercises,
  type ExerciseListItem,
  type ExerciseSkill,
} from './api/useExercises'
import type { ExerciseListScope } from './api/exercisesKeys'
import { useDuplicateExercise } from './api/useDuplicateExercise'
import { skillLetter, skillTileColor } from './lib/exerciseCode'
import { unitKeyForSkill } from './lib/exerciseUnits'
import { formatExerciseDate } from './lib/formatExerciseDate'
import { ExerciseFormDialog } from './components/ExerciseFormDialog'
import { ExerciseDeleteDialog } from './components/ExerciseDeleteDialog'

const PAGE_SIZE = 20

const SKILL_TABS: readonly ExerciseSkill[] = [
  'reading',
  'listening',
  'writing',
  'speaking',
  'grammar',
  'vocabulary',
  'general',
] as const

// --- session snapshot (mirrors ClassesPage — read the module-singleton cache) ---
const SESSION_KEY_TUPLE = authKeys.session()
function subscribeToSessionCache(notify: () => void): () => void {
  return queryClient.getQueryCache().subscribe(notify)
}
function getSessionSnapshot(): Session | null {
  return queryClient.getQueryData<Session>(SESSION_KEY_TUPLE) ?? null
}
function getSessionServerSnapshot(): Session | null {
  return null
}
function useSessionSnapshot(): Session | null {
  return useSyncExternalStore<Session | null>(
    subscribeToSessionCache,
    getSessionSnapshot,
    getSessionServerSnapshot,
  )
}

export function ExerciseLibraryPage(): ReactElement {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const role = useRole()
  const session = useSessionSnapshot()

  const centerId = session?.center?.id ?? null
  const scope: ExerciseListScope =
    role === 'teacher' ? `teacher:${session?.user?.id ?? 'self'}` : 'all'

  const [activeSkill, setActiveSkill] = useState<ExerciseSkill | null>(null)
  const [tag, setTag] = useState('')
  const [band, setBand] = useState('')
  const [page, setPage] = useState(1)

  const [dialog, setDialog] = useState<{ open: boolean; row: ExerciseListItem | null }>(
    { open: false, row: null },
  )
  const [deleteTarget, setDeleteTarget] = useState<ExerciseListItem | null>(null)

  const bandNumber = band.trim() === '' ? null : Number(band)
  const params = useMemo(
    () => ({
      page,
      pageSize: PAGE_SIZE,
      skill: activeSkill,
      tag: tag.trim() === '' ? null : tag.trim(),
      band: bandNumber != null && Number.isFinite(bandNumber) ? bandNumber : null,
    }),
    [page, activeSkill, tag, bandNumber],
  )

  const listQuery = useExercises(centerId, scope, params)
  const duplicate = useDuplicateExercise()

  const items = listQuery.data?.items ?? []
  const pagination = listQuery.data?.pagination ?? {
    page: 1,
    pageSize: PAGE_SIZE,
    total: 0,
    totalPages: 0,
  }
  const skillCountMap = useMemo(() => {
    const map = new Map<string, number>()
    for (const sc of listQuery.data?.skillCounts ?? []) map.set(sc.skill, sc.count)
    return map
  }, [listQuery.data?.skillCounts])
  const allCount = useMemo(
    () => Array.from(skillCountMap.values()).reduce((sum, n) => sum + n, 0),
    [skillCountMap],
  )

  // Mirror the query's band guard (CR-4-1-21): a non-finite entry (a stray
  // '.'/'-'/'e' a number input can transiently hold) is NOT sent, so it must
  // not count as an active filter either.
  const bandFilterActive = bandNumber != null && Number.isFinite(bandNumber)
  const anyFilterActive = activeSkill !== null || tag.trim() !== '' || bandFilterActive

  // Reconcile the page down when the server-reported page count shrinks (e.g.
  // deleting the last row on page > 1) so the user is never stranded on a blank
  // page with no pagination controls (CR-4-1-16). React's sanctioned "adjust
  // state during render" pattern — the guard makes it converge in one extra
  // render, no effect (react.dev/learn/you-might-not-need-an-effect).
  if (pagination.totalPages > 0 && page > pagination.totalPages) {
    setPage(pagination.totalPages)
  }

  function selectSkill(next: ExerciseSkill | null): void {
    setActiveSkill(next)
    setPage(1)
  }
  function clearFilters(): void {
    setActiveSkill(null)
    setTag('')
    setBand('')
    setPage(1)
  }
  function handleDuplicate(row: ExerciseListItem): void {
    // Guard against double-activation creating two clones (CR-4-1-20) — delete
    // and submit are already isPending-guarded; duplicate was not.
    if (duplicate.isPending) return
    duplicate.mutate(row.id, {
      onSuccess: () => toast.success(t('exercises.toast.duplicated')),
      onError: () => toast.error(t('exercises.toast.error')),
    })
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6" data-testid="exercises-page">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-fraunces text-2xl text-slate-900">
            {t('exercises.sectionHeading')}
          </h1>
          <p className="mt-1 text-sm text-slate-500" data-testid="exercises-count">
            {t('exercises.countLabel', { count: pagination.total })}
          </p>
        </div>
        <Button onClick={() => setDialog({ open: true, row: null })} data-testid="exercises-new-cta">
          {t('exercises.createCta')}
        </Button>
      </header>

      <div
        role="group"
        className="mb-4 flex flex-wrap gap-1 border-b border-slate-200"
        aria-label={t('exercises.tabsAriaLabel')}
      >
        <SkillTab
          label={t('exercises.tabs.all')}
          count={allCount}
          active={activeSkill === null}
          onClick={() => selectSkill(null)}
          testId="exercise-skill-tab-all"
        />
        {SKILL_TABS.map((skill) => (
          <SkillTab
            key={skill}
            label={t(`exercises.skill.${skill}`)}
            count={skillCountMap.get(skill) ?? 0}
            active={activeSkill === skill}
            onClick={() => selectSkill(skill)}
            testId={`exercise-skill-tab-${skill}`}
          />
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-slate-500">
          {t('exercises.filters.tagLabel')}
          <Input
            value={tag}
            onChange={(e) => {
              setTag(e.target.value)
              setPage(1)
            }}
            placeholder={t('exercises.filters.tagPlaceholder')}
            className="h-9 w-48"
            data-testid="exercise-filter-tag"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-slate-500">
          {t('exercises.filters.bandLabel')}
          <Input
            type="number"
            step="0.5"
            value={band}
            onChange={(e) => {
              setBand(e.target.value)
              setPage(1)
            }}
            placeholder={t('exercises.filters.bandPlaceholder')}
            className="h-9 w-28"
            data-testid="exercise-filter-band"
          />
        </label>
        {anyFilterActive ? (
          <Button variant="ghost" size="sm" onClick={clearFilters} data-testid="exercise-filter-clear">
            {t('exercises.filters.clear')}
          </Button>
        ) : null}
      </div>

      {listQuery.isPending ? (
        <ExerciseRowSkeletons />
      ) : listQuery.isError ? (
        <ErrorAlert
          onRetry={() => listQuery.refetch()}
          message={t('exercises.error.body')}
          retryLabel={t('exercises.error.retry')}
        />
      ) : pagination.total === 0 && !anyFilterActive ? (
        <TrueEmptyHero
          headline={t('exercises.empty.true.headline')}
          body={t('exercises.empty.true.body')}
          cta={t('exercises.empty.true.cta')}
          onCta={() => setDialog({ open: true, row: null })}
        />
      ) : pagination.total === 0 ? (
        <FilteredEmpty
          headline={t('exercises.empty.filtered.headline')}
          body={t('exercises.empty.filtered.body')}
          clearLabel={t('exercises.empty.filtered.clear')}
          onClear={clearFilters}
        />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="exercises-table">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="py-2 pr-4 font-medium">{t('exercises.table.columns.exercise')}</th>
                  <th className="py-2 pr-4 font-medium">{t('exercises.table.columns.skill')}</th>
                  <th className="py-2 pr-4 font-medium">{t('exercises.table.columns.tags')}</th>
                  <th className="py-2 pr-4 font-medium">{t('exercises.table.columns.lastModified')}</th>
                  <th className="py-2 font-medium">{t('exercises.table.columns.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => (
                  <ExerciseRow
                    key={row.id}
                    row={row}
                    onEdit={() => navigate(`/exercises/${row.id}/edit`)}
                    onDuplicate={() => handleDuplicate(row)}
                    onDelete={() => setDeleteTarget(row)}
                  />
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
            <span data-testid="exercises-showing">
              {t('exercises.footer.showing', {
                shown: items.length,
                total: pagination.total,
              })}
            </span>
            {pagination.totalPages > 1 ? (
              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  data-testid="exercises-prev"
                >
                  {t('exercises.pagination.prev')}
                </Button>
                <span className="font-mono text-xs" data-testid="exercises-page-indicator">
                  {t('exercises.pagination.page', {
                    page: pagination.page,
                    totalPages: pagination.totalPages,
                  })}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= pagination.totalPages}
                  onClick={() => setPage((p) => p + 1)}
                  data-testid="exercises-next"
                >
                  {t('exercises.pagination.next')}
                </Button>
              </div>
            ) : null}
          </div>
        </>
      )}

      {dialog.open ? (
        <ExerciseFormDialog
          centerId={centerId ?? ''}
          initial={dialog.row}
          onClose={() => setDialog({ open: false, row: null })}
          onCreated={(created) => navigate(`/exercises/${created.id}/edit`)}
        />
      ) : null}

      {deleteTarget ? (
        <ExerciseDeleteDialog
          exerciseId={deleteTarget.id}
          exerciseTitle={deleteTarget.title}
          onClose={() => setDeleteTarget(null)}
        />
      ) : null}
    </div>
  )
}

function SkillTab({
  label,
  count,
  active,
  onClick,
  testId,
}: {
  label: string
  count: number
  active: boolean
  onClick: () => void
  testId: string
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      aria-pressed={active}
      className={`-mb-px border-b-2 px-3 py-2 text-sm ${
        active
          ? 'border-[color:var(--cl-accent)] font-medium text-slate-900'
          : 'border-transparent text-slate-500 hover:text-slate-700'
      }`}
    >
      {label} <span className="font-mono text-xs text-slate-400">{count}</span>
    </button>
  )
}

function ExerciseRow({
  row,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  row: ExerciseListItem
  onEdit: () => void
  onDuplicate: () => void
  onDelete: () => void
}): ReactElement {
  const { t, i18n } = useTranslation()
  const metaLine = t('exercises.meta.line', {
    code: row.code,
    sections: row.sectionCount,
    count: row.questionCount,
    unit: t(`exercises.unit.${unitKeyForSkill(row.skill)}`),
  })
  return (
    <tr className="border-b border-slate-100">
      <td className="py-3 pr-4">
        <div className="flex items-center gap-3">
          <span
            className="flex h-8 w-8 items-center justify-center rounded-md text-xs font-semibold text-white"
            style={{ backgroundColor: skillTileColor(row.skill) }}
            aria-hidden="true"
          >
            {skillLetter(row.skill)}
          </span>
          <div className="min-w-0">
            <p className="font-medium text-slate-900">{row.title}</p>
            <p className="font-mono text-xs text-slate-400" data-testid={`exercise-meta-${row.id}`}>
              {metaLine}
            </p>
          </div>
        </div>
      </td>
      <td className="py-3 pr-4">
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
          {t(`exercises.skill.${row.skill}`)}
        </span>
      </td>
      <td className="py-3 pr-4">
        {row.tags && row.tags.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {row.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600"
              >
                {tag}
              </span>
            ))}
          </div>
        ) : (
          <span className="text-xs text-slate-300">{t('exercises.table.noTags')}</span>
        )}
      </td>
      <td className="py-3 pr-4 font-mono text-xs text-slate-500">
        {formatExerciseDate(row.updatedAt, i18n.language)}
      </td>
      <td className="py-3">
        <DropdownMenu>
          <DropdownMenuTrigger
            className="rounded p-1 text-slate-400 hover:text-slate-700 focus-visible:ring-2 focus-visible:ring-[color:var(--cl-accent)]"
            aria-label={t('exercises.table.actionsFor', { title: row.title })}
            data-testid={`exercise-actions-${row.id}`}
          >
            <MoreHorizontal className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onEdit} data-testid={`exercise-edit-${row.id}`}>
              {t('exercises.actions.edit')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onDuplicate} data-testid={`exercise-duplicate-${row.id}`}>
              {t('exercises.actions.duplicate')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onDelete} data-testid={`exercise-delete-${row.id}`}>
              {t('exercises.actions.delete')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </td>
    </tr>
  )
}

function ExerciseRowSkeletons(): ReactElement {
  return (
    <div className="space-y-2">
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-12 w-full" data-testid={`exercise-row-skeleton-${i}`} />
      ))}
    </div>
  )
}

function ErrorAlert({
  onRetry,
  message,
  retryLabel,
}: {
  onRetry: () => void
  message: string
  retryLabel: string
}): ReactElement {
  return (
    <div
      role="alert"
      className="flex items-center justify-between rounded-md border border-[color:var(--cl-red)] bg-[color:var(--cl-tint-red)] px-4 py-3 text-sm text-[color:var(--cl-red)]"
    >
      <span>{message}</span>
      <Button size="sm" variant="outline" onClick={onRetry}>
        {retryLabel}
      </Button>
    </div>
  )
}

function TrueEmptyHero({
  headline,
  body,
  cta,
  onCta,
}: {
  headline: string
  body: string
  cta: string
  onCta: () => void
}): ReactElement {
  return (
    <div
      className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-slate-200 px-6 py-16 text-center"
      data-testid="exercises-empty-hero"
    >
      <h2 className="font-fraunces text-xl text-slate-900">{headline}</h2>
      <p className="max-w-sm text-sm text-slate-500">{body}</p>
      <Button onClick={onCta}>{cta}</Button>
    </div>
  )
}

function FilteredEmpty({
  headline,
  body,
  clearLabel,
  onClear,
}: {
  headline: string
  body: string
  clearLabel: string
  onClear: () => void
}): ReactElement {
  return (
    <div
      className="flex flex-col items-center gap-2 rounded-md border border-dashed border-slate-200 px-6 py-12 text-center"
      data-testid="exercises-empty-filtered"
    >
      <p className="text-sm font-medium text-slate-600">{headline}</p>
      <p className="text-sm text-slate-400">{body}</p>
      <Button variant="ghost" size="sm" onClick={onClear}>
        {clearLabel}
      </Button>
    </div>
  )
}
