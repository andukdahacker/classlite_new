/**
 * AppLayout — composition + a11y + i18n contract (Story 1-7c AC2).
 */
import { describe, expect, test, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { axe } from 'vitest-axe'
import AppLayout from '@/components/shared/AppLayout'
import { useUIStore } from '@/stores/uiStore'
import { useLanguageStore } from '@/stores/languageStore'
import { assertI18nParity } from '@/lib/test/i18n-parity'
import i18n from '@/lib/i18n'

function renderAppLayout() {
  const router = createMemoryRouter(
    [
      {
        path: '/',
        Component: AppLayout,
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
    // TEST-FE-3 amendment from 1-7b: prefer the `.reset()` action over
    // direct setState so Zustand v5's action surface stays intact.
    useUIStore.getState().reset()
    useLanguageStore.getState().reset()
  })

  test('renders sidebar (aside), topbar (banner), nav, and main regions', () => {
    renderAppLayout()
    expect(
      screen.getByRole('complementary', {
        name: i18n.t('app.layout.sidebar.brand'),
      }),
    ).toBeDefined()
    expect(screen.getByRole('banner')).toBeDefined()
    expect(screen.getByRole('main')).toBeDefined()
    expect(
      screen.getByRole('navigation', {
        name: i18n.t('app.layout.sidebar.nav.aria'),
      }),
    ).toBeDefined()
    expect(screen.getByTestId('route-child')).toBeDefined()
  })

  test('skip-to-content link is the first tabbable element; focus transitions to <main>', () => {
    const { container } = renderAppLayout()
    const skipLink = container.querySelector(
      'a[href="#main-content"]',
    ) as HTMLAnchorElement | null
    expect(skipLink).not.toBeNull()

    // The skip link is the first focusable in document order. jsdom doesn't
    // simulate keyboard Tab navigation, so verify the contract structurally:
    // (a) it's first in tabbable order, (b) focusing it works, (c) <main>
    // accepts focus via tabIndex={-1} for the post-skip transition.
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

  test('mobile hamburger toggle flips sidebarCollapsed', () => {
    renderAppLayout()
    expect(useUIStore.getState().sidebarCollapsed).toBe(false)
    fireEvent.click(
      screen.getByRole('button', {
        name: i18n.t('app.layout.sidebar.collapseToggle'),
      }),
    )
    expect(useUIStore.getState().sidebarCollapsed).toBe(true)
    fireEvent.click(
      screen.getByRole('button', {
        name: i18n.t('app.layout.sidebar.collapseToggle'),
      }),
    )
    expect(useUIStore.getState().sidebarCollapsed).toBe(false)
  })

  test('language-toggle EN segment mutates the language store', () => {
    renderAppLayout()
    fireEvent.click(
      screen.getByRole('button', { name: i18n.t('app.layout.languageToggle.vi') }),
    )
    expect(useLanguageStore.getState().language).toBe('vi')
    fireEvent.click(
      screen.getByRole('button', { name: i18n.t('app.layout.languageToggle.en') }),
    )
    expect(useLanguageStore.getState().language).toBe('en')
  })

  test('all Story 1-7c layout i18n keys exist in en + vi', () => {
    assertI18nParity([
      'app.layout.sidebar.brand',
      'app.layout.sidebar.nav.aria',
      'app.layout.sidebar.collapseToggle',
      'app.layout.topbar.breadcrumb',
      'app.layout.topbar.search',
      'app.layout.topbar.searchHint',
      'app.layout.languageToggle.aria',
      'app.layout.languageToggle.en',
      'app.layout.languageToggle.vi',
      'app.layout.skipToContent',
    ])
  })

  test('passes axe-core audit with zero violations', async () => {
    const { container } = renderAppLayout()
    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })
})
