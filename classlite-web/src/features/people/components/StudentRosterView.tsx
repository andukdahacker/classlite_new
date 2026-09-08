/**
 * StudentRosterView — Story 7.2b (Task 4, AC4-10). ONE shared roster view in
 * two role variants (D7): `center` (s42 owner/admin, center-wide) and `teacher`
 * (s10a, own-class scoped). Models on `StaffListPage` (tabs + client-side
 * `countByStatus` + roving-tabindex + the UX-1 trilogy + session-snapshot),
 * over the paginated 7-2a `GET /api/students` (D2 component `useQuery`).
 *
 * No role branch touches data SCOPE — the backend self-scopes the teacher's
 * roster (7-2a D3), so a teacher never receives a foreign-class student; the
 * variant only changes columns, the tab set, and the head copy (UX-3 without a
 * mega-branch). Tabs + counts are CLIENT-derived over the loaded page (D5); the
 * roster is server-paginated at `page_size=100` (D6) and, past that ceiling,
 * surfaces a pager + a "counts reflect this page" note (AC10). The class filter
 * chip is server-side (`?class_id`) so it never desyncs the counts.
 */
import {
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
} from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { PerfPill } from '@/components/domain/PerfPill'
import { perfToneFromStatus, type PerfTone } from '@/components/domain/perfTone'
import {
  useStudentRoster,
  ROSTER_PAGE_SIZE,
  type StudentListItem,
} from '../api/useStudents'
import { formatStaffDateTime } from '../lib/formatStaffDate'

/**
 * NEW_STUDENT_WINDOW_DAYS — the "New" tab window (D5). Not carried on the wire
 * contract, so defined locally per CQ-3; aligns with 7-2a's `NewStudentWindowDays`
 * (flagged to confirm the value in the completion notes).
 */
const NEW_STUDENT_WINDOW_DAYS = 30
const MS_PER_DAY = 86_400_000
const SKELETON_ROWS = [0, 1, 2, 3] as const
const ROSTER_PANEL_ID = 'student-roster-panel'
/** Roster columns always present: Student · Classes · Avg band · Status · Joined. */
const STUDENT_TABLE_BASE_COLUMNS = 5

export type RosterVariant = 'center' | 'teacher'

type TabKey = 'all' | 'atRisk' | 'new' | 'byClass' | 'unassigned' | 'archived'

const TAB_ORDER: Record<RosterVariant, readonly TabKey[]> = {
  center: ['all', 'atRisk', 'new', 'unassigned', 'archived'],
  teacher: ['all', 'atRisk', 'new', 'byClass'],
}

/** Client-side "new" classification — joinedAt within the window of now (D5). */
function isNewStudent(joinedAt: string): boolean {
  const joined = Date.parse(joinedAt)
  if (Number.isNaN(joined)) return false
  const ageDays = (Date.now() - joined) / MS_PER_DAY
  return ageDays >= 0 && ageDays <= NEW_STUDENT_WINDOW_DAYS
}

function matchesTab(student: StudentListItem, tab: TabKey): boolean {
  // Archived students belong ONLY to the Archived tab — the dedicated tab exists
  // so All/At-risk/New/Unassigned/By-class must exclude them (else an archived,
  // un-enrolled student inflates the Unassigned count and shows under All).
  switch (tab) {
    case 'archived':
      return student.archivedAt !== null
    case 'atRisk':
      return student.archivedAt === null && student.atRiskStatus === 'at_risk'
    case 'new':
      return student.archivedAt === null && isNewStudent(student.joinedAt)
    case 'unassigned':
      return student.archivedAt === null && student.activeEnrollmentCount === 0
    case 'byClass':
    case 'all':
    default:
      return student.archivedAt === null
  }
}

export interface StudentRosterViewProps {
  variant: RosterVariant
}

export function StudentRosterView({ variant }: StudentRosterViewProps): ReactElement {
  const { t, i18n } = useTranslation()
  const isTeacher = variant === 'teacher'
  const detailBase = isTeacher ? '/students' : '/people/students'

  const [page, setPage] = useState(1)
  const [classId, setClassId] = useState<string | undefined>(undefined)
  const params = useMemo(() => ({ page, classId }), [page, classId])
  const rosterQuery = useStudentRoster(params)

  const [userTab, setUserTab] = useState<TabKey | null>(null)

  const students = useMemo(
    () => rosterQuery.data?.data ?? [],
    [rosterQuery.data],
  )
  const pagination = rosterQuery.data?.meta.pagination

  const tabs = TAB_ORDER[variant]

  const counts = useMemo<Partial<Record<TabKey, number>>>(() => {
    const out: Partial<Record<TabKey, number>> = {}
    for (const tab of tabs) {
      // "By class" is a grouping mode, not a count (D5).
      if (tab === 'byClass') continue
      out[tab] = students.filter((s) => matchesTab(s, tab)).length
    }
    return out
  }, [students, tabs])

  const defaultTab = useMemo<TabKey>(
    () => tabs.find((tab) => (counts[tab] ?? 0) > 0) ?? 'all',
    [tabs, counts],
  )
  const activeTab = userTab ?? defaultTab

  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])
  function handleTabsKeyDown(event: KeyboardEvent<HTMLElement>): void {
    const currentIndex = tabs.indexOf(activeTab)
    let nextIndex: number
    switch (event.key) {
      case 'ArrowRight':
        nextIndex = (currentIndex + 1) % tabs.length
        break
      case 'ArrowLeft':
        nextIndex = (currentIndex - 1 + tabs.length) % tabs.length
        break
      case 'Home':
        nextIndex = 0
        break
      case 'End':
        nextIndex = tabs.length - 1
        break
      default:
        return
    }
    event.preventDefault()
    setUserTab(tabs[nextIndex])
    tabRefs.current[nextIndex]?.focus()
  }

  const visibleStudents = useMemo(
    () => students.filter((s) => matchesTab(s, activeTab)),
    [students, activeTab],
  )

  // Class filter options — server-side chip: a selection re-queries with
  // ?class_id, so ONLY that class's students come back. Deriving options from the
  // current page alone would collapse the dropdown to the selected class and
  // block a direct A→B switch, so we accumulate the union of every class seen
  // since mount. Merge new classes into state during render (React's endorsed
  // "adjust state when data changes" pattern) — it converges once every class is
  // known and needs no ref/effect. Distinct by classId.
  const [knownClasses, setKnownClasses] = useState<Map<string, string>>(
    () => new Map(),
  )
  const mergedClasses = new Map(knownClasses)
  let sawNewClass = false
  for (const student of students) {
    for (const cls of student.enrolledClasses) {
      if (!mergedClasses.has(cls.classId)) {
        mergedClasses.set(cls.classId, cls.className)
        sawNewClass = true
      }
    }
  }
  if (sawNewClass) setKnownClasses(mergedClasses)
  const classOptions = [...mergedClasses.entries()].map(([id, name]) => ({ id, name }))

  // "By class" (teacher only) groups the visible rows by enrolled class (AC5) —
  // a student in N classes appears under each. Class-less students (shouldn't
  // occur for a teacher, who only sees own-class students) fall out of grouping.
  const byClassGroups = useMemo(() => {
    if (activeTab !== 'byClass') return []
    const groups = new Map<string, { className: string; students: StudentListItem[] }>()
    for (const student of visibleStudents) {
      for (const cls of student.enrolledClasses) {
        const group = groups.get(cls.classId)
        if (group) group.students.push(student)
        else groups.set(cls.classId, { className: cls.className, students: [student] })
      }
    }
    return [...groups.entries()].map(([classId, group]) => ({ classId, ...group }))
  }, [activeTab, visibleStudents])

  const atRiskCount = counts.atRisk ?? 0
  const unassignedCount = counts.unassigned ?? 0
  const total = pagination?.total ?? students.length
  const overflow = total > ROSTER_PAGE_SIZE
  // Base columns: Student · Classes · Avg band · Status · Joined; +1 variant
  // column (Teacher(s) for center, Attendance for teacher) — for colSpan cells.
  const columnCount = STUDENT_TABLE_BASE_COLUMNS + 1

  const isEmpty =
    !rosterQuery.isPending && !rosterQuery.isError && students.length === 0

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6" data-testid="student-roster-page">
      <header className="mb-6">
        <h1 className="font-fraunces text-2xl text-slate-900">
          {t(isTeacher ? 'people.student.list.titleTeacher' : 'people.student.list.titleCenter')}
        </h1>
        {isTeacher ? null : (
          // Center-only (s42/AC8): the teacher head has no Unassigned concept.
          // At total > 100 the counts reflect the loaded page (documented D6 /
          // FU-7-2-C) — the overflow note below carries that caveat.
          <p className="mt-1 text-sm text-slate-500" data-testid="student-count-superscript">
            {t('people.student.list.superscript', {
              enrolled: total,
              atRisk: atRiskCount,
              unassigned: unassignedCount,
            })}
          </p>
        )}
      </header>

      {rosterQuery.isPending ? (
        <RosterSkeletons />
      ) : rosterQuery.isError ? (
        <ErrorAlert
          message={t('people.student.list.error')}
          retryLabel={t('people.student.list.retry')}
          onRetry={() => rosterQuery.refetch()}
        />
      ) : isEmpty ? (
        <EmptyState />
      ) : (
        <>
          {classOptions.length > 0 ? (
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <label
                htmlFor="student-class-filter"
                className="text-xs uppercase tracking-wide text-slate-400"
              >
                {t('people.student.list.filter.classAria')}
              </label>
              <select
                id="student-class-filter"
                aria-label={t('people.student.list.filter.classAria')}
                value={classId ?? ''}
                onChange={(event) => {
                  setClassId(event.target.value || undefined)
                  setPage(1)
                }}
                className="rounded-md border border-slate-200 px-2 py-1 text-sm text-slate-700"
              >
                <option value="">{t('people.student.list.filter.allClasses')}</option>
                {classOptions.map((cls) => (
                  <option key={cls.id} value={cls.id}>
                    {cls.name}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <nav
            role="tablist"
            aria-label={t('people.student.tabs.ariaLabel')}
            onKeyDown={handleTabsKeyDown}
            className="mb-4 flex gap-1 overflow-x-auto border-b border-slate-200"
          >
            {tabs.map((tab, index) => {
              const selected = activeTab === tab
              const count = counts[tab]
              return (
                <button
                  key={tab}
                  ref={(el) => {
                    tabRefs.current[index] = el
                  }}
                  id={`student-tab-${tab}`}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  aria-current={selected ? 'page' : undefined}
                  aria-controls={ROSTER_PANEL_ID}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => setUserTab(tab)}
                  className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm ${
                    selected
                      ? 'border-[color:var(--cl-accent)] font-medium text-slate-900'
                      : 'border-transparent text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {t(`people.student.tabs.${tab}`)}
                  {count !== undefined ? (
                    <span className="ml-1 font-mono text-xs text-slate-400">{count}</span>
                  ) : null}
                </button>
              )
            })}
          </nav>

          <div
            id={ROSTER_PANEL_ID}
            role="tabpanel"
            aria-labelledby={`student-tab-${activeTab}`}
            className="overflow-x-auto"
          >
            <table
              className="w-full text-sm"
              data-testid="student-table"
              aria-label={t('people.student.table.ariaLabel')}
            >
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="py-2 pr-4 font-medium">{t('people.student.table.columns.student')}</th>
                  <th className="py-2 pr-4 font-medium">
                    {t(isTeacher ? 'people.student.table.columns.myClasses' : 'people.student.table.columns.classes')}
                  </th>
                  {isTeacher ? null : (
                    <th className="py-2 pr-4 font-medium">{t('people.student.table.columns.teachers')}</th>
                  )}
                  <th className="py-2 pr-4 font-medium">{t('people.student.table.columns.avgBand')}</th>
                  {isTeacher ? (
                    <th className="py-2 pr-4 font-medium">{t('people.student.table.columns.attendance')}</th>
                  ) : null}
                  <th className="py-2 pr-4 font-medium">{t('people.student.table.columns.status')}</th>
                  <th className="py-2 font-medium">{t('people.student.table.columns.joined')}</th>
                </tr>
              </thead>
              {activeTab === 'byClass' ? (
                byClassGroups.length > 0 ? (
                  byClassGroups.map((group) => (
                    <tbody
                      key={group.classId}
                      data-testid={`student-class-group-${group.classId}`}
                    >
                      <tr className="bg-slate-50">
                        <th
                          scope="colgroup"
                          colSpan={columnCount}
                          className="py-2 pr-4 text-left text-xs font-semibold uppercase tracking-wide text-slate-500"
                        >
                          {group.className}
                          <span className="ml-1 font-mono text-slate-400">
                            {group.students.length}
                          </span>
                        </th>
                      </tr>
                      {group.students.map((student) => (
                        <StudentRow
                          key={`${group.classId}-${student.studentId}`}
                          student={student}
                          variant={variant}
                          detailBase={detailBase}
                          locale={i18n.language}
                        />
                      ))}
                    </tbody>
                  ))
                ) : (
                  <tbody>
                    <EmptyTabRow columnCount={columnCount} />
                  </tbody>
                )
              ) : (
                <tbody>
                  {visibleStudents.length > 0 ? (
                    visibleStudents.map((student) => (
                      <StudentRow
                        key={student.studentId}
                        student={student}
                        variant={variant}
                        detailBase={detailBase}
                        locale={i18n.language}
                      />
                    ))
                  ) : (
                    <EmptyTabRow columnCount={columnCount} />
                  )}
                </tbody>
              )}
            </table>
          </div>

          {overflow ? (
            <div className="mt-4 flex flex-col gap-2">
              <p
                role="status"
                data-testid="student-page-count-note"
                className="text-xs text-slate-500"
              >
                {t('people.student.list.pageCountNote', { count: ROSTER_PAGE_SIZE })}
              </p>
              <Pager
                page={pagination?.page ?? page}
                totalPages={pagination?.totalPages ?? 1}
                onPage={setPage}
              />
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}

function StudentRow({
  student,
  variant,
  detailBase,
  locale,
}: {
  student: StudentListItem
  variant: RosterVariant
  detailBase: string
  locale: string
}): ReactElement {
  const { t } = useTranslation()
  const isTeacher = variant === 'teacher'
  const unassigned = variant === 'center' && student.activeEnrollmentCount === 0
  const tone: PerfTone = unassigned ? 'unassigned' : perfToneFromStatus(student.atRiskStatus)
  const initial = student.name.trim().charAt(0).toUpperCase() || '?'
  const classNames = student.enrolledClasses.map((cls) => cls.className)

  return (
    <tr className="border-b border-slate-100" data-testid={`student-row-${student.studentId}`}>
      <td className="py-3 pr-4">
        <div className="flex items-center gap-3">
          <span
            className={`flex h-8 w-8 items-center justify-center rounded-md text-xs font-semibold ${
              unassigned
                ? 'bg-slate-200 text-slate-400'
                : 'bg-[color:var(--cl-accent)] text-white'
            }`}
            aria-hidden="true"
          >
            {unassigned ? '??' : initial}
          </span>
          <div className="min-w-0">
            <Link
              to={`${detailBase}/${student.studentId}`}
              className="font-medium text-slate-900 hover:text-[color:var(--cl-accent)] hover:underline"
            >
              {student.name}
            </Link>
            <p className="font-mono text-xs text-slate-400">{student.email}</p>
          </div>
        </div>
      </td>
      <td className="py-3 pr-4">
        {unassigned ? (
          <span
            className="text-[color:var(--cl-amber)]"
            data-testid={`student-unassigned-${student.studentId}`}
          >
            {t('people.student.unassignedCell')}
          </span>
        ) : (
          <span className="font-mono text-xs text-slate-600">{classNames.join(' · ')}</span>
        )}
      </td>
      {isTeacher ? null : (
        <td className="py-3 pr-4">
          <div className="flex flex-wrap gap-1 font-mono text-xs text-slate-600">
            {student.teachers.map((teacher) => (
              <span key={teacher}>{teacher}</span>
            ))}
          </div>
        </td>
      )}
      <td className="py-3 pr-4">
        {student.overallBand !== null ? (
          <span className="font-semibold text-slate-900">{student.overallBand.toFixed(1)}</span>
        ) : (
          <span className="text-slate-400">{t('people.student.band.empty')}</span>
        )}
      </td>
      {isTeacher ? (
        // The roster wire contract carries no per-student attendance rate — it
        // lives on the whole-student detail. The column shows "—" until a
        // roster-level rate lands (flagged: FU). Never "0%" (AC4).
        <td className="py-3 pr-4 text-slate-400">{t('people.student.band.empty')}</td>
      ) : null}
      <td className="py-3 pr-4">
        <PerfPill tone={tone} />
      </td>
      <td className="py-3 font-mono text-xs text-slate-600">
        {formatStaffDateTime(student.joinedAt, locale)}
      </td>
    </tr>
  )
}

function Pager({
  page,
  totalPages,
  onPage,
}: {
  page: number
  totalPages: number
  onPage: (page: number) => void
}): ReactElement {
  const { t } = useTranslation()
  return (
    <div className="flex items-center gap-3" data-testid="student-pager">
      <Button
        size="sm"
        variant="outline"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
      >
        {t('people.student.list.prev')}
      </Button>
      <span className="font-mono text-xs text-slate-500">
        {t('people.student.list.page', { page, totalPages })}
      </span>
      <Button
        size="sm"
        variant="outline"
        disabled={page >= totalPages}
        onClick={() => onPage(page + 1)}
      >
        {t('people.student.list.next')}
      </Button>
    </div>
  )
}

function EmptyTabRow({ columnCount }: { columnCount: number }): ReactElement {
  const { t } = useTranslation()
  return (
    <tr data-testid="student-tab-empty">
      <td colSpan={columnCount} className="py-10 text-center text-sm text-slate-400">
        {t('people.student.list.emptyTab')}
      </td>
    </tr>
  )
}

function RosterSkeletons(): ReactElement {
  return (
    <div className="space-y-2">
      {SKELETON_ROWS.map((i) => (
        <Skeleton key={i} className="h-12 w-full" data-testid={`student-row-skeleton-${i}`} />
      ))}
    </div>
  )
}

function ErrorAlert({
  message,
  retryLabel,
  onRetry,
}: {
  message: string
  retryLabel: string
  onRetry: () => void
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

function EmptyState(): ReactElement {
  const { t } = useTranslation()
  // No invite/add action — enrolment is Story 7.3 (D14).
  return (
    <div
      className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-slate-200 px-6 py-16 text-center"
      data-testid="student-empty"
    >
      <h2 className="font-fraunces text-xl text-slate-900">
        {t('people.student.list.empty.headline')}
      </h2>
      <p className="max-w-sm text-sm text-slate-500">
        {t('people.student.list.empty.body')}
      </p>
    </div>
  )
}
