/**
 * NeedsAttentionCard — the owner "Needs your attention" surface (Story 8-1b,
 * D8). Renders the PRE-BUNDLED `owner.needsAttention` block (unassigned
 * students · at-risk students · over-capacity classes · storage capacity ·
 * pending invites). Each actionable zone is an action link routing OUT to the
 * owning management surface, and each renders its OWN per-zone empty copy when
 * that zone is clear (AC11 — no single aggregate "all clear", so a clear zone
 * never masks another zone that still needs attention, e.g. an amber storage
 * meter).
 *
 * It does NOT mount `features/people` `NeedsAttentionList` — that self-fetches
 * the 7-3a `/api/enrollments/attention` endpoint, a redundant second call; here
 * everything is already in the dashboard payload (the page makes exactly one
 * fetch). There is NO Q&A rail (D10) and NO plan/seat capacity (D-CAP). Storage
 * capacity stays a meter, not an action link — plan/seat management is FU-8-1-A,
 * so there is no destination to route to yet (AC10 pragmatic, RULED 2026-09-18).
 */
import type { ReactElement, ReactNode } from 'react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import type { components } from '@/lib/api/client'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { AtRiskRow } from './AtRiskRow'
import { StorageCapacityCard } from './StorageCapacityCard'

type DashboardNeedsAttention = components['schemas']['DashboardNeedsAttention']

const ROSTER_HREF = '/students'
const STAFF_HREF = '/people/staff'
const CLASSES_HREF = '/classes'

/** One needs-attention zone: an action-link header when it has items, else a
 *  muted per-zone empty line (AC11). `testId` names both the zone and its empty
 *  variant (`<testId>` / `<testId>-empty`) for the assert-present/absent spine. */
function AttentionZone({
  testId,
  count,
  href,
  headerLabel,
  emptyLabel,
  accentClass,
  children,
}: {
  testId: string
  count: number
  href: string
  headerLabel: string
  emptyLabel: string
  accentClass: string
  children?: ReactNode
}): ReactElement {
  if (count === 0) {
    return (
      <p
        data-testid={`${testId}-empty`}
        className="rounded-lg border border-[var(--cl-border)] p-3 text-sm text-[var(--cl-ink-soft)]"
      >
        {emptyLabel}
      </p>
    )
  }
  return (
    <div data-testid={testId} className={`rounded-lg border-l-4 p-3 ${accentClass}`}>
      <Link
        to={href}
        className="text-sm font-medium text-[var(--cl-ink)] hover:underline"
      >
        {headerLabel}
      </Link>
      {children}
    </div>
  )
}

export interface NeedsAttentionCardProps {
  needsAttention: DashboardNeedsAttention
}

export function NeedsAttentionCard({
  needsAttention,
}: NeedsAttentionCardProps): ReactElement {
  const { t } = useTranslation()
  const {
    unassignedStudents,
    atRiskStudents,
    overCapacityClasses,
    capacity,
    pendingInvites,
  } = needsAttention

  return (
    <Card data-testid="needs-attention-card">
      <CardHeader>
        <h3 className="text-sm font-semibold text-[var(--cl-ink)]">
          {t('dashboard.owner.needsAttentionTitle')}
        </h3>
      </CardHeader>
      <CardContent className="space-y-4">
        <AttentionZone
          testId="attention-unassigned"
          count={unassignedStudents.count}
          href={ROSTER_HREF}
          headerLabel={t('dashboard.owner.unassignedStudents', {
            count: unassignedStudents.count,
          })}
          emptyLabel={t('dashboard.owner.unassignedEmpty')}
          accentClass="border-l-[var(--cl-amber)] bg-[var(--cl-tint-gold)]"
        >
          <ul className="mt-1 text-xs text-[var(--cl-ink-soft)]">
            {unassignedStudents.items.map((student) => (
              <li key={student.studentId}>{student.name}</li>
            ))}
          </ul>
        </AttentionZone>

        <AttentionZone
          testId="attention-at-risk"
          count={atRiskStudents.count}
          href={ROSTER_HREF}
          headerLabel={t('dashboard.owner.atRiskStudents', {
            count: atRiskStudents.count,
          })}
          emptyLabel={t('dashboard.owner.atRiskEmpty')}
          accentClass="border-l-[var(--cl-red)]"
        >
          <ul className="mt-2 space-y-2">
            {atRiskStudents.items.map((item) => (
              <AtRiskRow key={item.studentId} item={item} />
            ))}
          </ul>
        </AttentionZone>

        <AttentionZone
          testId="attention-over-capacity"
          count={overCapacityClasses.count}
          href={CLASSES_HREF}
          headerLabel={t('dashboard.owner.overCapacityClasses', {
            count: overCapacityClasses.count,
          })}
          emptyLabel={t('dashboard.owner.overCapacityEmpty')}
          accentClass="border-l-[var(--cl-amber)]"
        >
          <ul className="mt-1 text-xs text-[var(--cl-ink-soft)]">
            {overCapacityClasses.items.map((klass) => (
              <li key={klass.classId}>
                {t('dashboard.owner.overCapacityRow', {
                  className: klass.className,
                  active: klass.activeCount,
                  capacity: klass.capacity,
                })}
              </li>
            ))}
          </ul>
        </AttentionZone>

        <AttentionZone
          testId="attention-pending-invites"
          count={pendingInvites.count}
          href={STAFF_HREF}
          headerLabel={t('dashboard.owner.pendingInvites', {
            count: pendingInvites.count,
          })}
          emptyLabel={t('dashboard.owner.pendingInvitesEmpty')}
          accentClass="border-l-[var(--cl-accent)]"
        />

        <StorageCapacityCard capacity={capacity} />
      </CardContent>
    </Card>
  )
}
