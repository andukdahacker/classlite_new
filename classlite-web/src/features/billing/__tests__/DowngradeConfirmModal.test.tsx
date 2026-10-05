// Story 9-2b — Task 4 (AC4/AC5). The downgrade-confirm modal: at-renewal + no-data-loss
// copy, a schedule call with {plan, billingCycle}, and an inline 422 error (never a raw code).
import type { ReactElement } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, test, vi } from 'vitest'
import i18n from '@/lib/i18n'
import { server } from '@/test/msw-server'
import { createTestQueryClient } from '@/lib/query-client'
import { DowngradeConfirmModal } from '../components/DowngradeConfirmModal'

function wrap(ui: ReactElement): ReactElement {
  return (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={createTestQueryClient()}>
        <MemoryRouter>{ui}</MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>
  )
}

afterEach(() => cleanup())

describe('DowngradeConfirmModal', () => {
  test('states the at-renewal semantics and no-data-loss (AC4)', async () => {
    render(
      wrap(
        <DowngradeConfirmModal
          open
          onClose={() => {}}
          targetPlan="pro"
          billingCycle="monthly"
          effectiveAt="2026-11-01T00:00:00+07:00"
        />,
      ),
    )
    const modal = await screen.findByTestId('downgrade-confirm-modal')
    expect(modal).toHaveTextContent(i18n.t('billing.downgrade.atRenewal', { date: '2026-11-01T00:00:00+07:00' }))
    expect(modal).toHaveTextContent(i18n.t('billing.downgrade.noDataLoss'))
    expect(modal).toHaveTextContent(i18n.t('billing.downgrade.stayActive'))
  })

  // Code-review patch (2026-10-05, Decision 1): the modal must name the billing cycle it
  // schedules, so inheriting the picker's monthly/annual price-view toggle is a deliberate,
  // visible choice.
  test('names the billing cycle it will schedule (annual vs monthly)', async () => {
    const { rerender } = render(
      wrap(
        <DowngradeConfirmModal open onClose={() => {}} targetPlan="pro" billingCycle="annual" effectiveAt="2026-11-01T00:00:00+07:00" />,
      ),
    )
    expect((await screen.findByTestId('downgrade-confirm-cycle')).textContent).toBe(
      i18n.t('billing.downgrade.cycleNoteAnnual'),
    )
    rerender(
      wrap(
        <DowngradeConfirmModal open onClose={() => {}} targetPlan="pro" billingCycle="monthly" effectiveAt="2026-11-01T00:00:00+07:00" />,
      ),
    )
    expect(screen.getByTestId('downgrade-confirm-cycle').textContent).toBe(
      i18n.t('billing.downgrade.cycleNoteMonthly'),
    )
  })

  test('confirm posts {plan, billingCycle} and closes on success (AC5)', async () => {
    let captured: Record<string, unknown> | null = null
    const onClose = vi.fn()
    server.use(
      http.post('*/api/billing/downgrade', async ({ request }) => {
        captured = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({ data: { pendingPlan: 'free', pendingBillingCycle: 'monthly', effectiveAt: '2026-11-01T00:00:00+07:00' }, meta: { requestId: 't' } })
      }),
      http.get('*/api/billing', () => HttpResponse.json({ data: {}, meta: { requestId: 't' } })),
    )
    render(
      wrap(
        <DowngradeConfirmModal open onClose={onClose} targetPlan="free" billingCycle="monthly" effectiveAt="2026-11-01T00:00:00+07:00" />,
      ),
    )
    await userEvent.click(await screen.findByTestId('downgrade-confirm-submit'))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(captured).toEqual({ plan: 'free', billingCycle: 'monthly' })
  })

  test('a 422 VALIDATION_ERROR surfaces inline, not a raw code (AC5 error, UX-1)', async () => {
    server.use(
      http.post('*/api/billing/downgrade', () => HttpResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'not a lower tier', requestId: 't' } }, { status: 422 })),
      http.get('*/api/billing', () => HttpResponse.json({ data: {}, meta: { requestId: 't' } })),
    )
    render(
      wrap(<DowngradeConfirmModal open onClose={() => {}} targetPlan="free" billingCycle="monthly" effectiveAt="2026-11-01T00:00:00+07:00" />),
    )
    await userEvent.click(await screen.findByTestId('downgrade-confirm-submit'))
    const err = await screen.findByTestId('downgrade-confirm-error')
    expect(err).toHaveTextContent(i18n.t('billing.downgrade.error'))
    expect(err).not.toHaveTextContent('VALIDATION_ERROR')
  })
})
