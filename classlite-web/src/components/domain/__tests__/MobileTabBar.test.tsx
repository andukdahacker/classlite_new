/**
 * MobileTabBar — null guard + role-derived tab set tests.
 *
 * AC7 closes:
 *   - Role-to-tabs derivation lives IN the component (UX-3 exception
 *     documented in the component's JSDoc; UX-DR29 catches misuse).
 *   - `useRole()` returns `Role | null` in production unauthenticated
 *     state. The null path must render nothing safely.
 */
import { describe, expect, test } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { MobileTabBar } from '@/components/domain/MobileTabBar'
import { assertI18nParity } from '@/lib/test/i18n-parity'

function renderTabBar(role: Parameters<typeof MobileTabBar>[0]['role'], activeHref = '/dashboard') {
  return render(
    <MemoryRouter>
      <MobileTabBar role={role} activeHref={activeHref} />
    </MemoryRouter>,
  )
}

describe('MobileTabBar — null guard (Amelia, party-mode 2026-06-18)', () => {
  test('role=null renders nothing (no crash)', () => {
    const { container } = renderTabBar(null)
    expect(container.firstChild).toBeNull()
    expect(screen.queryByTestId('mobile-tab-bar')).toBeNull()
  })
})

describe('MobileTabBar — role-to-tabs derivation', () => {
  test('student → 5 tabs (Home / Assignments / Inbox / Classes / Me)', () => {
    renderTabBar('student')
    for (const slug of ['home', 'assignments', 'inbox', 'classes', 'me']) {
      expect(screen.getByTestId(`mobile-tab-${slug}`)).toBeDefined()
    }
  })

  test('teacher → 5 tabs (Home / Classes / Inbox / Schedule / Me)', () => {
    renderTabBar('teacher')
    for (const slug of ['home', 'classes', 'inbox', 'schedule', 'me']) {
      expect(screen.getByTestId(`mobile-tab-${slug}`)).toBeDefined()
    }
    // Teacher does NOT show student-only Assignments tab.
    expect(screen.queryByTestId('mobile-tab-assignments')).toBeNull()
  })

  test('owner → 5 tabs (Home / People / Inbox / Analytics / Me)', () => {
    renderTabBar('owner')
    for (const slug of ['home', 'people', 'inbox', 'analytics', 'me']) {
      expect(screen.getByTestId(`mobile-tab-${slug}`)).toBeDefined()
    }
  })

  test('admin shares the Owner mobile set (IA Chapter 8 convention)', () => {
    renderTabBar('admin')
    for (const slug of ['home', 'people', 'inbox', 'analytics', 'me']) {
      expect(screen.getByTestId(`mobile-tab-${slug}`)).toBeDefined()
    }
  })
})

describe('MobileTabBar — i18n parity (R38 inheritance)', () => {
  test('every tab labelKey + the nav landmark key resolves in en + vi', () => {
    assertI18nParity([
      'mobileTab.nav.primary',
      'mobileTab.student.home',
      'mobileTab.student.assignments',
      'mobileTab.student.inbox',
      'mobileTab.student.classes',
      'mobileTab.student.me',
      'mobileTab.teacher.home',
      'mobileTab.teacher.classes',
      'mobileTab.teacher.inbox',
      'mobileTab.teacher.schedule',
      'mobileTab.teacher.me',
      'mobileTab.owner.home',
      'mobileTab.owner.people',
      'mobileTab.owner.inbox',
      'mobileTab.owner.analytics',
      'mobileTab.owner.me',
    ])
  })
})
