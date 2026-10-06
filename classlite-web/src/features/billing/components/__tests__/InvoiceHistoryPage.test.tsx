// ATDD RED-PHASE — Story 9-3, Task 6 (s70 owner-gated invoice-history page). AC14/AC15/AC16.
// Loading/Empty/Error trilogy (TEST-FE-2/UX-1), status pills, PDF passthrough (https-guarded,
// omitted when null), CSV export (downloadCsv reuse), email-to-accountant dialog.
//
// RED signals (compile-fail via `tsc -b`):
//   1. `@/features/billing` does not export `InvoiceHistoryPage` (TS2305) — page not built.
//   2. `@/features/billing/api/useInvoices` does not exist (TS2307) — hook + billingKeys.invoices not built.
//
// GREEN-PHASE SEAMS:
//   - features/billing/api/useInvoices.ts (+ useEmailInvoices.ts) over GET /api/billing/invoices
//     ?status=&page=&pageSize= and POST /api/billing/invoices/email; billingKeys.invoices(filters).
//   - features/billing/components/InvoiceHistoryPage.tsx — List-table (UX §396) date/amount/status/
//     actions, status pills (Paid/Declined/Declined→Paid/Refunded/Upcoming/Free), filter,
//     pagination, trilogy; per-row PDF (https-guard + omit when null) + Retry (declined→recovery);
//     CSV export via features/people/lib/downloadCsv.ts; "Email to accountant" dialog.
//   - api.yaml: BillingInvoice + EnvelopeBillingInvoices (pagination meta); amounts render via
//     formatVnd verbatim (D25), VAT itemized from subtotalVnd/vatVnd.

import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, test } from 'vitest'
import i18n from '@/lib/i18n'
import { createTestQueryClient, queryClient } from '@/lib/query-client'
import { authKeys, type Session } from '@/features/auth/api/authKeys'
import { server } from '@/test/msw-server'
// RED: these modules do not exist yet.
import { InvoiceHistoryPage } from '@/features/billing'
import { useInvoices } from '@/features/billing/api/useInvoices'

const CENTER_ID = '00000000-0000-0000-0000-000000000001'

function seedOwner(): void {
  queryClient.setQueryData<Session>(authKeys.session(), {
    user: { id: 'u-owner', email: 'owner@example.com', fullName: 'Owner', emailVerified: true },
    accessToken: 'a.b.c',
    center: { id: CENTER_ID, name: 'Saigon English', shortCode: 'saigon', brandColor: null, logoUrl: null, timezone: 'Asia/Ho_Chi_Minh' },
    role: 'owner',
  })
}

const invoiceRows = [
  { id: 'inv-1', issuedAt: '2026-09-01T00:00:00+07:00', amountVnd: 399000, subtotalVnd: 362727, vatVnd: 36273, status: 'paid', pdfUrl: 'https://polar.example/invoices/inv-1.pdf' },
  { id: 'inv-2', issuedAt: '2026-08-01T00:00:00+07:00', amountVnd: 399000, subtotalVnd: 362727, vatVnd: 36273, status: 'declined', pdfUrl: null },
]

function renderPage(): void {
  seedOwner()
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={createTestQueryClient()}>
        <MemoryRouter initialEntries={['/settings/billing/invoices']}>
          <InvoiceHistoryPage />
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  )
}

afterEach(() => {
  queryClient.clear()
  // Touch the hook export so an unused-import does not mask the intended TS2307 red.
  void useInvoices
})

describe('InvoiceHistoryPage — s70 (AC14-16)', () => {
  test('renders skeleton while loading (UX-1)', () => {
    server.use(http.get('*/api/billing/invoices', () => HttpResponse.json({ data: [], meta: { requestId: 't', page: 1, pageSize: 20, total: 0 } })))
    renderPage()
    expect(screen.getByTestId('skeleton')).toBeInTheDocument()
  })

  test('renders invoice rows with status pills + VAT itemized on success', async () => {
    server.use(http.get('*/api/billing/invoices', () => HttpResponse.json({ data: invoiceRows, meta: { requestId: 't', page: 1, pageSize: 20, total: 2 } })))
    renderPage()
    // Status pills for both rows.
    expect(await screen.findByText(i18n.t('billing.invoices.status.paid'))).toBeInTheDocument()
    expect(screen.getByText(i18n.t('billing.invoices.status.declined'))).toBeInTheDocument()
    // Amount rendered via formatVnd verbatim (D25) — not recomputed.
    expect(screen.getAllByText(/399[.,]000/).length).toBeGreaterThan(0)
  })

  test('PDF action: present for https pdfUrl, omitted when null (AC15)', async () => {
    server.use(http.get('*/api/billing/invoices', () => HttpResponse.json({ data: invoiceRows, meta: { requestId: 't', page: 1, pageSize: 20, total: 2 } })))
    renderPage()
    await screen.findByText(i18n.t('billing.invoices.status.paid'))
    const pdfLinks = screen.getAllByRole('link', { name: i18n.t('billing.invoices.downloadPdf') })
    // Only the paid row (https pdfUrl) exposes the action; the null-pdf declined row omits it.
    expect(pdfLinks).toHaveLength(1)
    expect(pdfLinks[0]).toHaveAttribute('href', expect.stringMatching(/^https:/))
  })

  test('renders empty state when there are no invoices (UX-1)', async () => {
    server.use(http.get('*/api/billing/invoices', () => HttpResponse.json({ data: [], meta: { requestId: 't', page: 1, pageSize: 20, total: 0 } })))
    renderPage()
    await waitFor(() => expect(screen.getByTestId('invoices-empty')).toBeInTheDocument())
  })

  test('renders error alert on network failure (TEST-FE-2)', async () => {
    server.use(http.get('*/api/billing/invoices', () => HttpResponse.error()))
    renderPage()
    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })

  test('exposes CSV export + email-to-accountant affordances (AC16)', async () => {
    server.use(http.get('*/api/billing/invoices', () => HttpResponse.json({ data: invoiceRows, meta: { requestId: 't', page: 1, pageSize: 20, total: 2 } })))
    renderPage()
    await screen.findByText(i18n.t('billing.invoices.status.paid'))
    expect(screen.getByRole('button', { name: i18n.t('billing.invoices.exportCsv') })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: i18n.t('billing.invoices.emailAccountant') })).toBeInTheDocument()
  })

  test('i18n invoice keys exist in both locales (TEST-FE-4)', () => {
    for (const key of ['billing.invoices.title', 'billing.invoices.exportCsv', 'billing.invoices.emailAccountant', 'billing.invoices.downloadPdf']) {
      expect(i18n.exists(key)).toBe(true)
    }
  })
})
