/**
 * SchedulePage — Story 3.4 (AC5, screen s13). Staff schedule workspace. Owns
 * the session query (FW-1); the workspace receives sessions as props. Role-
 * scoped by the server (owner/admin center-wide; teacher own classes). Trilogy:
 * loading = skeleton grid; empty = grid + in-canvas overlay; error = a scrim +
 * human message + one retry (distinct from empty so a teacher never retries a
 * genuinely free week).
 */
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { useRole } from '@/hooks/useRole'
import { queryClient } from '@/lib/query-client'
import { authKeys, type Session } from '@/features/auth/api/authKeys'
import { useClasses } from '@/features/classes/api/useClasses'
import { type ClassListScope } from '@/features/classes/api/classesKeys'
import { useSessions, type SessionWire } from './api/useSessions'
import { rangeWindow, stepAnchor, startOfDay, type CalendarView } from './lib/scheduleDates'
import { ScheduleWorkspace } from './components/ScheduleWorkspace'
import { SessionModal } from './components/SessionModal'

const SESSION_KEY_TUPLE = authKeys.session()
function subscribeToSessionCache(notify: () => void): () => void {
  return queryClient.getQueryCache().subscribe(notify)
}
function getSessionSnapshot(): Session | null {
  return queryClient.getQueryData<Session>(SESSION_KEY_TUPLE) ?? null
}
function useSessionSnapshot(): Session | null {
  return useSyncExternalStore<Session | null>(subscribeToSessionCache, getSessionSnapshot, () => null)
}

interface ModalState {
  open: boolean
  initial: SessionWire | null
  prefill: { date: string; startTime: string } | null
}

// Default start time for a create prefilled from a day (not a specific slot).
const DEFAULT_CREATE_TIME = '09:00'
// The now-line / today-highlight refresh cadence.
const NOW_TICK_MS = 60 * 1000

export function SchedulePage(): ReactElement {
  const { t, i18n } = useTranslation()
  const role = useRole()
  const session = useSessionSnapshot()
  const locale = i18n.language
  const centerId = session?.center?.id ?? null
  const scope: ClassListScope = role === 'teacher' ? `teacher:${session?.user?.id ?? 'self'}` : 'all'

  const [view, setView] = useState<CalendarView>('week')
  const [anchor, setAnchor] = useState<Date>(() => startOfDay(new Date()))
  const [classFilter, setClassFilter] = useState<string | null>(null)
  const [modal, setModal] = useState<ModalState>({ open: false, initial: null, prefill: null })

  const range = useMemo(() => {
    const window = rangeWindow(anchor, view)
    return { ...window, classId: classFilter }
  }, [anchor, view, classFilter])

  const sessionsQuery = useSessions(range)
  const classesQuery = useClasses(centerId, scope)

  // The now-line + today highlight must advance on a long-lived tab, so tick
  // rather than freeze at mount (FP16). A timer is a permitted useEffect use.
  const [now, setNow] = useState<Date>(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), NOW_TICK_MS)
    return () => clearInterval(id)
  }, [])

  const openCreate = (day?: Date) => {
    const d = day ?? anchor
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    setModal({ open: true, initial: null, prefill: { date, startTime: DEFAULT_CREATE_TIME } })
  }
  const openEdit = (s: SessionWire) => setModal({ open: true, initial: s, prefill: null })
  const closeModal = () => setModal({ open: false, initial: null, prefill: null })

  if (sessionsQuery.isError) {
    return (
      <div data-testid="schedule-error" role="alert" className="flex flex-col items-center gap-3 py-16 text-center">
        <p className="text-sm text-slate-600">{t('schedule.error.body')}</p>
        <Button onClick={() => sessionsQuery.refetch()}>{t('schedule.error.retry')}</Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <h1 className="text-lg font-semibold text-slate-800">{t('schedule.title')}</h1>
      <ScheduleWorkspace
        sessions={sessionsQuery.data ?? []}
        loading={sessionsQuery.isLoading}
        view={view}
        anchor={anchor}
        now={now}
        classes={classesQuery.data ?? []}
        classFilter={classFilter}
        locale={locale}
        onStep={(direction) => setAnchor((a) => stepAnchor(a, view, direction))}
        onToday={() => setAnchor(startOfDay(new Date()))}
        onViewChange={setView}
        onAnchorChange={setAnchor}
        onClassFilterChange={setClassFilter}
        onSelectSession={openEdit}
        onNewSession={openCreate}
      />
      {modal.open && (
        <SessionModal
          open={modal.open}
          onClose={closeModal}
          classes={classesQuery.data ?? []}
          classesLoading={classesQuery.isLoading}
          classesError={classesQuery.isError}
          prefill={modal.prefill}
          initial={modal.initial}
          locale={locale}
        />
      )}
    </div>
  )
}
