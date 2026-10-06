/**
 * useEmailInvoices — email the invoice history to an accountant (Story 9.3, AC16).
 * `POST /api/billing/invoices/email` with `{ recipient }` renders the history server-side and
 * sends it via Resend; the recipient is validated + CRLF-sanitized server-side (SEC-11). The FE
 * surfaces success/error inline (the dialog), so this does NOT route through the global billing
 * error dialog. Owner-only (the route gate).
 */
import { useMutation } from '@tanstack/react-query'
import { apiFetch, type ApiError } from '@/lib/api-fetch'
import { billingKeys } from './billingKeys'

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const

interface EmailInvoicesResult {
  sent: boolean
}

/** useEmailInvoices posts the accountant's email and resolves when the history is sent. */
export function useEmailInvoices() {
  return useMutation<EmailInvoicesResult, ApiError, string>({
    mutationKey: billingKeys.emailInvoicesMutation(),
    mutationFn: (recipient) =>
      apiFetch<EmailInvoicesResult>('/api/billing/invoices/email', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ recipient }),
      }),
  })
}
