/**
 * AppLayout — composition + a11y + i18n contract.
 *
 * Story 1-7c originally introduced this test against placeholder
 * `shared/Sidebar` + `TopBar` + `UserPill`. Story 1d-3 retired those
 * placeholders and refactored AppLayout to consume the canonical
 * `domain/AppShell` + `SidebarShell` + `TopbarShell` + `MobileTabBar` —
 * the assertions below are migrated to the new chrome / new i18n key
 * namespaces accordingly. The 1-7c mobile-hamburger toggle is gone (no
 * hamburger in the role-aware shell — mobile uses the bottom tab bar).
 *
 * Story 1d-3 party-mode review (2026-06-21, Winston): AppLayout now
 * defaults to a "guest shell" (topbar only, no sidebar, no mobile tab
 * bar) when `useRole()` returns null. The original 1d-3 implementation
 * defaulted to `role='owner'` — a privilege-direction footgun. The
 * tests below cover both paths.
 */
import { describe, expect, test, beforeEach, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { axe } from 'vitest-axe'
import AppLayout from '@/components/shared/AppLayout'
import { RoleProvider } from '@/hooks/RoleContext'
import type { Role } from '@/hooks/useRole'
import { useUIStore } from '@/stores/uiStore'
import { useLanguageStore } from '@/stores/languageStore'
import { assertI18nParity } from '@/lib/test/i18n-parity'
import i18n from '@/lib/i18n'

function renderAppLayout(role: Role | null = null) {
  const router = createMemoryRouter(
    [
      {
        path: '/',
        Component: () => (
          <RoleProvider value={role}>
            <AppLayout />
          </RoleProvider>
        ),
        children: [
          {
            index: true,
            element: <div data-testid="route-child">child content</div>,
          },
        ],
      },
    ],
    { initialEntries: ['/'] },
  )
  return render(<RouterProvider router={router} />)
}

describe('AppLayout', () => {
  beforeEach(() => {
    useUIStore.getState().reset()
    useLanguageStore.getState().reset()
  })

  describe('guest shell (role=null) — least-privilege default', () => {
    test('renders topbar + main but NOT sidebar or mobile tab bar', () => {
      renderAppLayout(null)
      // Topbar still renders so language toggle + skip link + outlet stay reachable.
      expect(screen.getByRole('banner')).toBeDefined()
      expect(screen.getByRole('main')).toBeDefined()
      expect(screen.getByTestId('route-child')).toBeDefined()
      // Sidebar + mobile tab bar are absent from the DOM (per TEST-FE-6 —
      // not just hidden, completely absent). Guest sessions have no nav
      // surface; the user is one click from /login.
      expect(screen.queryByTestId('sidebar-nav-primary')).toBeNull()
      expect(screen.queryByTestId('mobile-tab-bar')).toBeNull()
    })

    test('logs a dev-only warn so developers notice the degradation', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      renderAppLayout(null)
      // React strict-mode may double-fire effects; assert at least one call.
      const matched = warn.mock.calls.find((c) =>
        String(c[0]).includes('No session role resolved'),
      )
      expect(matched).toBeDefined()
      warn.mockRestore()
    })
  })

  describe('authenticated shell (role=owner) — full chrome', () => {
    test('renders sidebar (aside), topbar (banner), nav, and main regions', () => {
      renderAppLayout('owner')
      expect(
        screen.getByRole('complementary', {
          name: i18n.t('sidebar.brand'),
        }),
      ).toBeDefined()
      expect(screen.getByRole('banner')).toBeDefined()
      expect(screen.getByRole('main')).toBeDefined()
      expect(
        screen.getByRole('navigation', {
          name: i18n.t('sidebar.nav.primary'),
        }),
      ).toBeDefined()
      expect(screen.getByTestId('route-child')).toBeDefined()
      expect(screen.getByTestId('sidebar-nav-primary')).toBeDefined()
    })

    test('skip-to-content link is the first tabbable element; focus transitions to <main>', () => {
      const { container } = renderAppLayout('owner')
      const skipLink = container.querySelector(
        'a[href="#main-content"]',
      ) as HTMLAnchorElement | null
      expect(skipLink).not.toBeNull()

      const tabbables = Array.from(
        container.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      )
      expect(tabbables[0]).toBe(skipLink)

      skipLink?.focus()
      expect(document.activeElement).toBe(skipLink)

      const main = container.querySelector('main') as HTMLElement | null
      expect(main?.getAttribute('id')).toBe('main-content')
      expect(main?.getAttribute('tabindex')).toBe('-1')
      main?.focus()
      expect(document.activeElement).toBe(main)
    })

    test('passes axe-core audit with zero violations', async () => {
      const { container } = renderAppLayout('owner')
      const results = await axe(container)
      expect(results).toHaveNoViolations()
    })
  })

  describe('language toggle (both paths)', () => {
    test('segments mutate the language store regardless of role', () => {
      renderAppLayout(null)
      fireEvent.click(
        screen.getByRole('button', { name: i18n.t('app.layout.languageToggle.vi') }),
      )
      expect(useLanguageStore.getState().language).toBe('vi')
      fireEvent.click(
        screen.getByRole('button', { name: i18n.t('app.layout.languageToggle.en') }),
      )
      expect(useLanguageStore.getState().language).toBe('en')
    })
  })

  describe('i18n parity', () => {
    test('all Story 1d-3 layout i18n keys exist in en + vi', () => {
      assertI18nParity([
        'app.layout.skipToContent',
        'app.layout.languageToggle.aria',
        'app.layout.languageToggle.en',
        'app.layout.languageToggle.vi',
        'sidebar.brand',
        'sidebar.nav.primary',
        'topbar.breadcrumb.label',
        'topbar.search.placeholder',
        'topbar.search.hint',
        'userPill.role.owner',
      ])
    })
  })
})
