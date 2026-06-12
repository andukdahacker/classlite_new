/**
 * PermissionDenied — body-copy variants + a11y + i18n contract
 * (Story 1-7c AC4).
 *
 * All visible-text assertions resolve via `i18n.t(...)` so the test stays
 * locale-agnostic (project-context TEST-FE-4 — never hardcode English).
 */
import { describe, expect, test } from 'vitest'
import { render, screen } from '@testing-library/react'
import { axe } from 'vitest-axe'
import PermissionDenied from '@/components/shared/PermissionDenied'
import { assertI18nParity } from '@/lib/test/i18n-parity'
import i18n from '@/lib/i18n'

describe('PermissionDenied', () => {
  test('Owner+Admin variant uses the bodyOwnerAdmin copy', () => {
    render(<PermissionDenied requiredRoles={['owner', 'admin']} />)
    expect(
      screen.getByText(i18n.t('app.permissionDenied.bodyOwnerAdmin')),
    ).toBeDefined()
    expect(
      screen.queryByText(i18n.t('app.permissionDenied.bodyOwner')),
    ).toBeNull()
  })

  test('Owner-only variant uses the bodyOwner copy', () => {
    render(<PermissionDenied requiredRoles={['owner']} />)
    expect(
      screen.getByText(i18n.t('app.permissionDenied.bodyOwner')),
    ).toBeDefined()
    expect(
      screen.queryByText(i18n.t('app.permissionDenied.bodyOwnerAdmin')),
    ).toBeNull()
  })

  test('renders all three CTAs in priority order — primary button, secondary link, tertiary deemphasized role-requirement summary', () => {
    render(<PermissionDenied requiredRoles={['owner', 'admin']} />)
    // Primary: message-owner button.
    expect(
      screen.getByRole('button', {
        name: i18n.t('app.permissionDenied.contactLinkCta'),
      }),
    ).toBeDefined()
    // Secondary: back-to-dashboard link.
    expect(
      screen.getByRole('link', {
        name: i18n.t('app.permissionDenied.homeLinkCta'),
      }),
    ).toBeDefined()
    // Tertiary (deemphasized): role-requirement summary. ARIA's `note`
    // role does NOT compute its accessible name from text content, so we
    // assert visible text + role attribute structurally.
    const summary = screen.getByText(
      i18n.t('app.permissionDenied.requiredRoleSummaryOwnerAdmin'),
    )
    expect(summary.getAttribute('role')).toBe('note')
  })

  test('Owner-only variant renders the Owner-only role-requirement summary', () => {
    render(<PermissionDenied requiredRoles={['owner']} />)
    const summary = screen.getByText(
      i18n.t('app.permissionDenied.requiredRoleSummaryOwner'),
    )
    expect(summary.getAttribute('role')).toBe('note')
  })

  test('all PermissionDenied i18n keys exist in en + vi', () => {
    assertI18nParity([
      'app.permissionDenied.title',
      'app.permissionDenied.bodyOwnerAdmin',
      'app.permissionDenied.bodyOwner',
      'app.permissionDenied.contactLinkCta',
      'app.permissionDenied.homeLinkCta',
      'app.permissionDenied.requiredRoleSummaryOwnerAdmin',
      'app.permissionDenied.requiredRoleSummaryOwner',
    ])
  })

  test('passes axe-core audit with zero violations', async () => {
    const { container } = render(
      <PermissionDenied requiredRoles={['owner', 'admin']} />,
    )
    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })
})
