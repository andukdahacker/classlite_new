/**
 * StudentDashboard — root of the student lazy bundle group.
 *
 * Mobile/4G students never need teacher or admin code (architecture line
 * 253). The router lazy-loads this component as the student chunk entry
 * so Rolldown can emit a focused bundle for the student surface.
 *
 * Story 1-7b ships a single-heading placeholder; the real student dashboard
 * UI lands per-feature in Epics 2-10.
 */
import { useTranslation } from 'react-i18next'

export default function StudentDashboard() {
  const { t } = useTranslation()
  // Story 1-7c wraps the student route in `<AppLayout>` so the heading
  // now mounts inside the layout's `<main>`. The placeholder no longer
  // sets its own min-height or background.
  return (
    <h1
      data-testid="student-dashboard-heading"
      className="font-[var(--cl-font-display)] text-3xl text-[var(--cl-ink)]"
    >
      {t('app.welcome')}
    </h1>
  )
}
