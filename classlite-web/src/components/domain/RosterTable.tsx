/**
 * RosterTable — Story 3.5b (AC12 · D9). The participants-and-attendance table on
 * s12: one row per active-enrolled student with an AttendanceToggle.
 *
 * The unmarked (null) row is VISUALLY LOUD and carries `data-unmarked="true"` so
 * a teacher's "who haven't I gotten to yet" scan reads unmistakably (D9) and the
 * a11y/tests can assert it. Domain-tier (FW-7): it takes plain generated-API
 * entries + an onSet callback and imports no feature module.
 */
import { type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { components } from '@/lib/api/client'
import { AttendanceToggle, type AttendanceStatus } from '@/components/domain/AttendanceToggle'

type RosterEntry = components['schemas']['AttendanceRosterEntry']

interface RosterTableProps {
  entries: RosterEntry[]
  onSet: (studentId: string, status: AttendanceStatus) => void
  disabled?: boolean
}

export function RosterTable({ entries, onSet, disabled = false }: RosterTableProps): ReactElement {
  const { t } = useTranslation()
  return (
    <ul className="divide-y divide-slate-100">
      {entries.map((entry) => {
        const unmarked = entry.status === null
        return (
          <li
            key={entry.studentId}
            data-testid={`attendance-row-${entry.studentId}`}
            data-unmarked={unmarked ? 'true' : 'false'}
            className={[
              'flex flex-wrap items-center justify-between gap-3 py-3',
              unmarked ? 'border-l-4 border-amber-400 bg-amber-50/60 pl-3' : 'pl-3',
            ].join(' ')}
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="truncate font-medium text-slate-900">{entry.name}</p>
                {unmarked && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                    {t('session.attendance.unmarked')}
                  </span>
                )}
              </div>
              <p className="truncate text-sm text-slate-500">{entry.email}</p>
            </div>
            <AttendanceToggle
              value={entry.status}
              onChange={(status) => onSet(entry.studentId, status)}
              disabled={disabled}
              groupLabel={t('session.attendance.rowLabel', { name: entry.name })}
            />
          </li>
        )
      })}
    </ul>
  )
}
