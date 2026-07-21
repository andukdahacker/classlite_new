// Story 3.3 (AC9) — the OverviewTab Actions card "Save as template" opens the
// create form prefilled with the class scalars (+ the scalars-only note).
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HttpResponse, http } from 'msw'
import type { ReactElement } from 'react'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, describe, expect, test } from 'vitest'
import i18n from '@/lib/i18n'
import { server } from '@/test/msw-server'
import { createTestQueryClient } from '@/lib/query-client'
import OverviewTab from '@/features/classes/tabs/OverviewTab'
import { classWire } from '@/features/classes/api/__tests__/handlers'

function StateProbe(): ReactElement {
  const location = useLocation()
  return <div data-testid="new-form-state">{JSON.stringify(location.state)}</div>
}

afterEach(() => server.resetHandlers())

describe('OverviewTab — Save as template (AC9)', () => {
  test('opens the create form prefilled with the class scalars', async () => {
    const user = userEvent.setup()
    const cls = classWire({
      id: 'cls-1',
      name: 'Weekend IELTS',
      targetBand: 7,
      primarySkill: 'speaking',
      // eslint-disable-next-line no-restricted-syntax -- class.color is an opaque hex wire value
      color: '#3b82f6',
    })
    server.use(
      http.get('/api/classes/cls-1', () =>
        HttpResponse.json({ data: cls, meta: { serverTime: 'x' } }),
      ),
    )

    const client = createTestQueryClient()
    render(
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={['/classes/cls-1/overview']}>
            <Routes>
              <Route path="/classes/:id/overview" element={<OverviewTab />} />
              <Route path="/classes/templates/new" element={<StateProbe />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      </I18nextProvider>,
    )

    await user.click(await screen.findByTestId('class-save-as-template'))

    await waitFor(() => {
      const state = screen.getByTestId('new-form-state').textContent ?? ''
      expect(state).toContain('Weekend IELTS')
      expect(state).toContain('speaking')
      expect(state).toContain('savedAsTemplate')
    })
  })
})
