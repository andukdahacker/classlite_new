/**
 * InvoiceHistoryPage — the s70 owner-gated invoice-history page (Story 9.3, AC14-16).
 *
 * List-table (UX §396): date · amount · status · actions, with status pills, a status filter
 * (code-review D5), and the loading/empty/error trilogy (UX-1). Amounts render via `formatVnd`
 * VERBATIM from the server snapshot (D25) — never recomputed; VAT is itemized per row from the
 * snapshotted subtotal/vat. Per-row actions: Download PDF (passthrough to Polar's hosted invoice;
 * shown only for an `https:` pdfUrl, omitted when null — AC15) and Retry (declined rows → the
 * recovery surface). Export affordances: CSV (client-side via the reused downloadCsv — RFC-4180 +
 * formula-injection-safe) and "Email to accountant" (a Base-UI Dialog → useEmailInvoices, SEC-11
 * on the server; focus-trapped + Escape-closable — code-review P7). When exactly the page cap is
 * returned, an honest "showing the most recent N" note replaces the prior silent truncation
 * (code-review D7). Owner-only (the route gate + RouteRoleGate).
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { formatVnd } from '../lib/formatVnd'
import { formatVnDate } from '@/lib/formatVnDate'
import { downloadCsv, serializeCsv } from '@/features/people/lib/downloadCsv'
import { useInvoices, INVOICES_PAGE_SIZE, type BillingInvoice } from '../api/useInvoices'
import { useEmailInvoices } from '../api/useEmailInvoices'

/** The recovery surface a declined-invoice Retry routes to (re-checkout / card update). */
const RECOVERY_SURFACE_URL = '/settings/billing'

/** The status pill values the FE renders (the 6-pill taxonomy, R2). */
const STATUS_PILLS = ['paid', 'declined', 'declinedToPaid', 'refunded', 'upcoming', 'free'] as const

/** The server status values the filter control offers (code-review D5). '' = all statuses. */
const FILTER_STATUSES = ['', 'paid', 'declined', 'refunded'] as const
type FilterStatus = (typeof FILTER_STATUSES)[number]

/** statusPillKey maps a server status to its i18n pill key, falling back to the raw status. */
function statusPillKey(status: string): string {
  const known = STATUS_PILLS.find((s) => s.toLowerCase() === status.toLowerCase())
  return known ? `billing.invoices.status.${known}` : status
}

/** filterOptionKey maps a filter status to its i18n label (distinct text from the pills so the
 * <option> text never collides with a status-pill assertion). '' → the "all statuses" label. */
function filterOptionKey(status: FilterStatus): string {
  return status === '' ? 'billing.invoices.filterAll' : `billing.invoices.filter.${status}`
}

export function InvoiceHistoryPage() {
  const { t, i18n } = useTranslation()
  const [status, setStatus] = useState<FilterStatus>('')
  const { data: invoices, isLoading, isError } = useInvoices(status)
  const emailInvoices = useEmailInvoices()
  const [emailOpen, setEmailOpen] = useState(false)
  const [recipient, setRecipient] = useState('')

  const formatDate = (iso: string | null): string => (iso ? formatVnDate(iso, i18n.language) : '')
  const rows = invoices ?? []
  // The list endpoint caps a page at INVOICES_PAGE_SIZE; when exactly that many come back the
  // history is (likely) longer, so surface an honest note instead of silently truncating (D7).
  const maybeTruncated = rows.length >= INVOICES_PAGE_SIZE

  function handleExportCsv(exportRows: BillingInvoice[]): void {
    const header = [t('billing.invoices.colDate'), t('billing.invoices.colAmount'), t('billing.invoices.colStatus')]
    const body = exportRows.map((inv) => [formatDate(inv.issuedAt), String(inv.amountVnd), inv.status])
    downloadCsv('invoices.csv', serializeCsv(header, body))
  }

  return (
    <section className="flex flex-col gap-4 p-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">{t('billing.invoices.title')}</h1>
        <div className="flex items-center gap-2">
          <label htmlFor="invoice-status-filter" className="sr-only">
            {t('billing.invoices.filterLabel')}
          </label>
          <select
            id="invoice-status-filter"
            className="rounded border px-2 py-1 text-sm"
            value={status}
            onChange={(e) => setStatus(e.target.value as FilterStatus)}
          >
            {FILTER_STATUSES.map((s) => (
              <option key={s || 'all'} value={s}>
                {t(filterOptionKey(s))}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="rounded border px-3 py-1 text-sm font-medium"
            onClick={() => handleExportCsv(rows)}
          >
            {t('billing.invoices.exportCsv')}
          </button>
          <button
            type="button"
            className="rounded border px-3 py-1 text-sm font-medium"
            onClick={() => setEmailOpen(true)}
          >
            {t('billing.invoices.emailAccountant')}
          </button>
        </div>
      </header>

      {isLoading ? (
        <div data-testid="skeleton" aria-busy="true" className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-10 animate-pulse rounded bg-[color:var(--cl-chip-bg)]" />
          ))}
        </div>
      ) : isError ? (
        <div role="alert" className="rounded border border-[color:var(--cl-red)] bg-[color:var(--cl-tint-red)] px-4 py-3 text-sm">
          {t('billing.invoices.error')}
        </div>
      ) : rows.length === 0 ? (
        <div data-testid="invoices-empty" className="rounded border border-dashed px-4 py-8 text-center text-sm text-[color:var(--cl-muted)]">
          {t('billing.invoices.empty')}
        </div>
      ) : (
        <>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="py-2">{t('billing.invoices.colDate')}</th>
                <th className="py-2">{t('billing.invoices.colAmount')}</th>
                <th className="py-2">{t('billing.invoices.colStatus')}</th>
                <th className="py-2">{t('billing.invoices.colActions')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((inv) => (
                <tr key={inv.id} className="border-b">
                  <td className="py-2">{formatDate(inv.issuedAt)}</td>
                  <td className="py-2">
                    <span>{formatVnd(inv.amountVnd)}</span>
                    {inv.subtotalVnd != null && inv.vatVnd != null ? (
                      <span className="block text-xs text-[color:var(--cl-muted)]">
                        {formatVnd(inv.subtotalVnd)} + {formatVnd(inv.vatVnd)} VAT
                      </span>
                    ) : null}
                  </td>
                  <td className="py-2">
                    <span className="rounded-full bg-[color:var(--cl-chip-bg)] px-2 py-0.5 text-xs font-medium">
                      {t(statusPillKey(inv.status))}
                    </span>
                  </td>
                  <td className="py-2">
                    <span className="flex gap-3">
                      {inv.pdfUrl && inv.pdfUrl.startsWith('https:') ? (
                        <a href={inv.pdfUrl} target="_blank" rel="noopener noreferrer" className="underline">
                          {t('billing.invoices.downloadPdf')}
                        </a>
                      ) : null}
                      {inv.status.toLowerCase() === 'declined' ? (
                        <a href={RECOVERY_SURFACE_URL} className="underline">
                          {t('billing.invoices.retry')}
                        </a>
                      ) : null}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {maybeTruncated ? (
            <p className="text-xs text-[color:var(--cl-muted)]">
              {t('billing.invoices.truncated', { count: INVOICES_PAGE_SIZE })}
            </p>
          ) : null}
        </>
      )}

      <Dialog open={emailOpen} onOpenChange={setEmailOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('billing.invoices.emailDialog.title')}</DialogTitle>
            <DialogDescription>{t('billing.invoices.emailDialog.description')}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <label htmlFor="accountant-email" className="text-sm">
              {t('billing.invoices.emailDialog.recipient')}
            </label>
            <input
              id="accountant-email"
              type="email"
              className="rounded border px-2 py-1 text-sm"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
            />
            {emailInvoices.isSuccess ? (
              <p className="text-sm text-[color:var(--cl-green)]">{t('billing.invoices.emailDialog.success')}</p>
            ) : null}
            {emailInvoices.isError ? (
              <p role="alert" className="text-sm text-[color:var(--cl-red)]">
                {t('billing.invoices.emailDialog.error')}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <button type="button" className="rounded px-3 py-1 text-sm" onClick={() => setEmailOpen(false)}>
              {t('billing.invoices.emailDialog.cancel')}
            </button>
            <button
              type="button"
              className="rounded border px-3 py-1 text-sm font-medium"
              disabled={emailInvoices.isPending || !recipient}
              onClick={() => emailInvoices.mutate(recipient)}
            >
              {t('billing.invoices.emailDialog.send')}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
