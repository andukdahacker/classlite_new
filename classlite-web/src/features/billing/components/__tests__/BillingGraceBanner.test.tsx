// ATDD RED-PHASE — Story 9-3, Task 7 (s73 owner-only app-wide red grace strip). AC11/AC12/AC13.
// TEST-FE-6 negative-security assertion: the grace strip is ABSENT from the DOM for non-owner
// roles, not merely visually hidden (the owner-gated summary is the only source — D4).
//
// RED signals (compile-fail via `tsc -b`):
//   1. `@/features/billing` does not export `BillingGraceBanner` (TS2305) — component not built.
//   2. `BillingSummary['grace']` is not yet on the generated type (api.yaml BillingSummary.grace
//      block, D9) — reading `.grace` is a TS error until codegen regenerates the client.
//
// GREEN-PHASE SEAMS:
//   - features/billing/components/BillingGraceBanner.tsx — red strip, consumes
//     useBillingSummary().grace, owner-only, countdown + "Update payment method" link; wired into
//     the reserved AppShell.banner slot via AppLayout (Task 7). Mirrors the dashboard error tokens
//     border-[color:var(--cl-red)] bg-[color:var(--cl-tint-red)].
//   - api.yaml BillingSummary.grace: { graceStartedAt, graceEndsAt, retriesScheduled, nextEmailAt?,
//     deadlineLabel } | null — non-null only while status=past_due (D9, GO-5 explicit null).
//   - i18n billing.grace.* in en.json AND vi.json (lockstep) + BILLING_KEYS parity.

import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, test } from 'vitest'
import i18n from '@/lib/i18n'
import { createTestQueryClient, queryClient } from '@/lib/query-client'
import { authKeys, type Role, type Session } from '@/features/auth/api/authKeys'
// RED: BillingGraceBanner is not exported from the billing barrel yet.
import { BillingGraceBanner } from '@/features/billing'
import { server } from '@/test/msw-server'
import { http, HttpResponse } from 'msw'

const CENTER_ID = '00000000-0000-0000-0000-000000000001'

function seed(role: Role): void {
  queryClient.setQueryData<Session>(authKeys.session(), {
    user: { id: `u-${role}`, email: `${role}@example.com`, fullName: role, emailVerified: true },
    accessToken: 'a.b.c',
    center: { id: CENTER_ID, name: 'Saigon English', shortCode: 'saigon', brandColor: null, logoUrl: null, timezone: 'Asia/Ho_Chi_Minh' },
    role,
  })
}

// billingSummaryWithGrace returns a past_due summary carrying the D9 grace block.
function billingSummaryWithGrace(): unknown {
  return {
    plan: 'pro',
    billingCycle: 'monthly',
    status: 'past_due',
    isFree: false,
    creditsApplicable: true,
    currentPeriodStart: '2026-09-01T00:00:00+07:00',
    currentPeriodEnd: '2026-10-01T00:00:00+07:00',
    limits: { teachers: 10, classes: null, studentsPerClass: 20, aiCreditsPerMonth: 500, storageBytes: 5368709120 },
    usage: {
      teacherSeats: { current: 3, max: 10, approaching: false },
      classes: { current: 4, max: null, approaching: false },
      aiCredits: { monthlyAllocation: 500, monthlyUsed: 100, addonRemaining: 0, available: 400, resetAt: '2026-10-01T00:00:00+07:00' },
      storage: { usedBytes: 1, limitBytes: 5368709120, percentUsed: 0, approaching: false },
    },
    grace: {
      graceStartedAt: '2026-10-05T00:00:00+07:00',
      graceEndsAt: '2026-10-12T23:59:00+07:00',
      retriesScheduled: ['2026-10-08T00:00:00+07:00', '2026-10-10T00:00:00+07:00'],
      nextEmailAt: '2026-10-08T00:00:00+07:00',
      deadlineLabel: '12 Oct 2026',
    },
  }
}

// mountBanner wires the summary endpoint and tracks whether the owner-gated query actually
// fired — so absence assertions can prove "component settled and chose not to render", not the
// trivially-true "nothing rendered before the async fetch resolved".
function mountBanner(role: Role, summary: unknown): { fetchFired: () => boolean } {
  seed(role)
  let fired = false
  const grace = (summary as { grace?: unknown } | null)?.grace ?? null
  server.use(
    // Scoped owner+admin grace source (R4 — admin needs the indicator without the owner-only
    // full summary). Registered alongside the owner summary so the red is source-agnostic.
    http.get('*/api/billing/grace', () => {
      fired = true
      return HttpResponse.json({ data: grace, meta: { requestId: 't' } })
    }),
    http.get('*/api/billing', () => {
      fired = true
      return HttpResponse.json({ data: summary, meta: { requestId: 't' } })
    }),
  )
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={createTestQueryClient()}>
        <BillingGraceBanner />
      </QueryClientProvider>
    </I18nextProvider>,
  )
  return { fetchFired: () => fired }
}

afterEach(() => {
  queryClient.clear()
})

describe('BillingGraceBanner — red grace strip, role-scoped (s73 / AC11-13; R4)', () => {
  test('OWNER sees the actionable red strip with deadline + update-payment link', async () => {
    mountBanner('owner', billingSummaryWithGrace())
    const strip = await screen.findByRole('alert')
    expect(strip).toBeInTheDocument()
    // Hard-failure severity: red tokens, not the amber soft-limit banner (UX §327).
    expect(strip.className).toMatch(/cl-red|cl-tint-red/)
    // Names the day-7 deadline + the actionable recovery link (owner can fix payment).
    expect(screen.getByText(/12 Oct 2026/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: i18n.t('billing.grace.updatePayment') })).toBeInTheDocument()
  })

  // R4: admin sees an INFORMATIONAL variant — the problem + deadline, but NO action link
  // (only the owner can fix payment), so an absentee-owner center is not silently downgraded.
  test('ADMIN sees the informational strip WITHOUT the update-payment link', async () => {
    mountBanner('admin', billingSummaryWithGrace())
    expect(await screen.findByText(/12 Oct 2026/)).toBeInTheDocument()
    expect(screen.getByText(i18n.t('billing.grace.adminInfo'))).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: i18n.t('billing.grace.updatePayment') })).not.toBeInTheDocument()
  })

  test('strip clears when grace is null (recovery or post-downgrade)', async () => {
    const recovered = { ...(billingSummaryWithGrace() as Record<string, unknown>), status: 'active', grace: null }
    const { fetchFired } = mountBanner('owner', recovered)
    // Wait until the summary query has SETTLED, then assert no strip — proves the component
    // saw grace:null and chose not to render (not a pre-fetch false-negative).
    await waitFor(() => expect(fetchFired()).toBe(true))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  // TEST-FE-6: teacher/student are ABSENT from the DOM — not just hidden — and the grace
  // source is never even fetched for them (billing state must not reach non-billing roles).
  test.each(['teacher', 'student'] as Role[])('%s never sees the grace strip (absent + no fetch)', async (role) => {
    const { fetchFired } = mountBanner(role, billingSummaryWithGrace())
    // Give any (erroneous) query a chance to fire before asserting it did NOT.
    await new Promise((r) => setTimeout(r, 0))
    expect(fetchFired()).toBe(false)
    expect(screen.queryByText(/12 Oct 2026/)).not.toBeInTheDocument()
  })

  test('i18n grace keys exist in both locales (TEST-FE-4)', () => {
    for (const key of ['billing.grace.title', 'billing.grace.updatePayment', 'billing.grace.deadline', 'billing.grace.adminInfo']) {
      expect(i18n.exists(key)).toBe(true)
    }
  })
})
