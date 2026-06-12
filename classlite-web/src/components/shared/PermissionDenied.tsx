/**
 * PermissionDenied — `s67` orientation screen (Story 1-7c AC4).
 *
 * UX-DR16's three-part recovery + UX spec §6.4's "permission denied as
 * orientation, not punishment": the screen names what's behind the
 * boundary, who can grant access, and one clear next action — plus a
 * lower-stakes escape (back to dashboard).
 *
 * Two body-copy variants today gated on `requiredRoles`:
 *   - `['owner', 'admin']` → bodyOwnerAdmin
 *   - `['owner']`          → bodyOwner
 *
 * Per UX-3 the variants are TWO explicit cases, not a hash map keyed by
 * a role string — adding a Teacher-only variant later is a new branch
 * + a new i18n key + a new test case.
 *
 * Story 2-6 wires per-route `errorElement={<PermissionDenied requiredRoles={[...]} />}`
 * so the route layer owns gating. Today only the standalone
 * `/permission-denied` URL is reachable; it renders the OwnerAdmin
 * variant as the default for the bare URL.
 */
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'

export type PermissionDeniedRoles = ['owner', 'admin'] | ['owner']

export interface PermissionDeniedProps {
  requiredRoles: PermissionDeniedRoles
}

function bodyKey(requiredRoles: PermissionDeniedRoles): string {
  if (requiredRoles.length === 1) return 'app.permissionDenied.bodyOwner'
  return 'app.permissionDenied.bodyOwnerAdmin'
}

function requiredRoleSummaryKey(requiredRoles: PermissionDeniedRoles): string {
  if (requiredRoles.length === 1) {
    return 'app.permissionDenied.requiredRoleSummaryOwner'
  }
  return 'app.permissionDenied.requiredRoleSummaryOwnerAdmin'
}

export default function PermissionDenied({
  requiredRoles,
}: PermissionDeniedProps) {
  const { t } = useTranslation()
  return (
    <main
      role="main"
      className="flex min-h-screen flex-col items-center justify-center bg-[var(--cl-paper)] px-4 text-center"
    >
      <h1 className="font-[var(--cl-font-display)] text-3xl text-[var(--cl-ink)]">
        {t('app.permissionDenied.title')}
      </h1>
      <p className="mt-3 max-w-md font-[var(--cl-font-body)] text-[var(--cl-ink-soft)]">
        {t(bodyKey(requiredRoles))}
      </p>
      <div className="mt-6 flex items-center gap-3">
        {/* Primary CTA: no-op until Epic 10 Story 10-1 ships the Inbox compose flow. */}
        <Button type="button">
          {t('app.permissionDenied.contactLinkCta')}
        </Button>
        <a
          href="/dashboard"
          className="font-[var(--cl-font-body)] text-sm text-[var(--cl-accent)] underline"
        >
          {t('app.permissionDenied.homeLinkCta')}
        </a>
      </div>
      {/* Tertiary (deemphasized) CTA — UX-DR16 third recovery affordance:
          one-line summary of the role requirement so the user instantly sees
          WHO can grant access. */}
      <p
        role="note"
        className="mt-4 font-[var(--cl-font-body)] text-xs text-[var(--cl-muted)]"
      >
        {t(requiredRoleSummaryKey(requiredRoles))}
      </p>
    </main>
  )
}
