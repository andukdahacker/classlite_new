/**
 * TeacherDashboard — root of the teacher lazy bundle group.
 *
 * Teacher/owner/admin surfaces are the largest of the three lazy bundle
 * groups. The router lazy-loads this component as the teacher chunk
 * entry so Rolldown can emit a focused bundle that pre-auth and student
 * sessions never pull in.
 *
 * Routing-level role gating (block teachers from `/student`, block
 * students from `/dashboard`, etc.) ships with Story 2-6 (roles &
 * authorization). Story 1-7b ships a single-heading placeholder.
 */
import { useTranslation } from 'react-i18next'

export default function TeacherDashboard() {
  const { t } = useTranslation()
  // Story 1-7c wraps the teacher route in `<AppLayout>` so the heading
  // now mounts inside the layout's `<main>`. The placeholder no longer
  // sets its own min-height or background.
  return (
    <h1
      data-testid="teacher-dashboard-heading"
      className="font-[var(--cl-font-display)] text-3xl text-[var(--cl-ink)]"
    >
      {t('app.welcome')}
    </h1>
  )
}
