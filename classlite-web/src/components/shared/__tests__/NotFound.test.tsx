/**
 * NotFound — catch-all 404 screen (Story 1-7c AC5).
 */
import { describe, expect, test } from 'vitest'
import { render, screen } from '@testing-library/react'
import { axe } from 'vitest-axe'
import NotFound from '@/components/shared/NotFound'
import { assertI18nParity } from '@/lib/test/i18n-parity'
import i18n from '@/lib/i18n'

describe('NotFound', () => {
  test('renders the localized title + body + home link', () => {
    render(<NotFound />)
    expect(
      screen.getByRole('heading', { name: i18n.t('app.notFound.title') }),
    ).toBeDefined()
    expect(screen.getByText(i18n.t('app.notFound.body'))).toBeDefined()
    const link = screen.getByRole('link', {
      name: i18n.t('app.notFound.homeLinkCta'),
    })
    expect(link.getAttribute('href')).toBe('/dashboard')
  })

  test('renders inside a <main role="main"> landmark', () => {
    const { container } = render(<NotFound />)
    expect(container.querySelector('main[role="main"]')).not.toBeNull()
  })

  test('all NotFound i18n keys exist in en + vi', () => {
    assertI18nParity([
      'app.notFound.title',
      'app.notFound.body',
      'app.notFound.homeLinkCta',
    ])
  })

  test('passes axe-core audit with zero violations', async () => {
    const { container } = render(<NotFound />)
    const results = await axe(container)
    expect(results).toHaveNoViolations()
  })
})
