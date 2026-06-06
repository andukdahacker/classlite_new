# Epic 9: Billing, Plans & Account Management

**FRs:** FR-61 through FR-66, FR-68

---

## Story 9.1: Plan Tiers & Limit Enforcement

| Field        | Value              |
| ------------ | ------------------ |
| Size         | L                  |
| Audience     | Full-stack         |
| Dependencies | 2.6                |

**As an** owner, **I want** clearly defined plan tiers with enforced limits, **so that** I understand what each tier offers and the system prevents usage beyond my plan.

### Acceptance Criteria

**Given** the plan tier definitions
**When** the system enforces limits
**Then** three tiers are available with these limits and locked VND prices:
| Limit | Free | Pro | Studio |
|---|---|---|---|
| **Monthly price (VAT inclusive 10%)** | **0 VND** | **399.000 VND** | **999.000 VND** |
| **Annual price (VAT inclusive 10%)** | **0 VND** | **3.990.000 VND** | **9.990.000 VND** |
| Teachers | 1 | Up to 10 | Unlimited |
| Classes | 1 | Unlimited | Unlimited |
| Students per class | 5 | 20 | 60 |
| AI credits/month | 0 | 500 | 2,000 + add-on packs |
| Knowledge Hub storage | 500 MB | 5 GB | 50 GB |
**And** annual billing saves the equivalent of ~2 months vs. monthly

**Given** the public pricing page renders
**When** prices are displayed
**Then** they appear with VAT inclusive: "**399.000 VND/tháng**" prominent + "*Giá đã bao gồm VAT 10%*" small caption underneath. Annual prices follow the same convention with "~2 tháng miễn phí" badge.

**Given** a Free-tier owner navigates to Settings → Billing → Usage
**When** the page renders
**Then** the Usage panel is hidden and replaced with an "Upgrade to Pro" CTA (lead-gen motion: Free has 0 credits forever, no usage data to display).

**Given** an Owner navigating to `/settings/billing/plans` (s68)
**When** the plan picker renders
**Then** three tier cards are displayed with feature limits, pricing (VND), and an annual/monthly toggle
**And** the current plan is highlighted
**And** annual toggle shows savings callout

**Given** usage approaching a plan limit (e.g., 18/20 students in a class)
**When** the teacher or owner encounters the threshold
**Then** a soft warning yellow banner appears: "18 of 20 students — approaching limit"
**And** the banner shows two resolution paths: upgrade or restructure (e.g., split the class)
**And** warnings re-appear at each threshold step (18, 19)

**Given** usage exceeding a plan limit (e.g., attempting to add a 21st student)
**When** the action is attempted
**Then** a hard block prevents the action with a clear message
**And** the block suggests upgrading
**And** existing access is NOT degraded — only the new action is blocked

**Given** the billing dashboard (`/settings/billing`, s69)
**When** an Owner views it
**Then** it shows: current plan, next invoice date/amount, live usage meters (teachers, students, AI credits, storage), and payment method on file

**Given** the plan enforcement API
**When** any action that consumes a limited resource is attempted
**Then** the `billing_service` checks current usage against plan limits before allowing the action
**And** returns a structured error with `code: "PLAN_LIMIT_EXCEEDED"`, the limit name, current usage, and max allowed

**Given** the database
**When** migrations run
**Then** a `subscriptions` table exists: id, center_id, plan (free/pro/studio), billing_cycle (monthly/annual), status (active/past_due/cancelled), polar_subscription_id, current_period_start, current_period_end, created_at
**And** an `ai_credits` table exists: id, center_id, monthly_allocation, monthly_used, addon_remaining, reset_at
**And** RLS policies are applied

---

## Story 9.2: Upgrade, Downgrade & AI Credit Add-ons

| Field        | Value              |
| ------------ | ------------------ |
| Size         | L                  |
| Audience     | Full-stack         |
| Dependencies | 9.1                |

**As an** owner, **I want** to upgrade, downgrade, or purchase AI credit add-ons, **so that** I can adjust my plan as my center's needs change.

### Acceptance Criteria

**Given** an Owner clicking "Upgrade" on the plan picker or billing dashboard
**When** the upgrade modal renders (s71)
**Then** it shows: current plan → target plan, prorated calculation (day-count credit applied), new monthly/annual price, and a "Confirm upgrade" button
**And** the proration math is visible: "(X days remaining × daily rate of old plan) credited toward new plan"

**Given** a confirmed upgrade
**When** the Owner confirms
**Then** the upgrade is processed via Polar.sh API (ClassLite never handles raw payment data)
**And** the subscription is updated immediately
**And** new plan limits take effect immediately
**And** the prorated amount is shown on the next invoice

**Given** a downgrade request
**When** the Owner selects a lower tier
**Then** a confirmation modal explains: "Downgrade takes effect at next renewal on [date]"
**And** data is NOT removed — but access is restricted when new tier limits are exceeded at renewal
**And** the current plan remains active until the billing period ends

**Given** the AI credit add-on feature (FR-64)
**When** an Owner on Pro or Studio clicks "Buy more credits"
**Then** available add-on credit packs are displayed with locked pricing (one-time purchase, VAT inclusive 10%):
| Pack | Pro tier price | Studio tier price |
|---|---|---|
| 100 credits | **99.000 VND** | n/a (too small) |
| 500 credits | **399.000 VND** | **299.000 VND** (Studio loyalty discount) |
| 2.000 credits | n/a | **999.000 VND** |
**And** the purchase is processed via Polar.sh
**And** add-on credits are consumed AFTER the monthly allocation is exhausted
**And** add-on credits do not expire at month end — they carry forward

**Given** the checkout summary for any tier purchase or add-on
**When** the totals render
**Then** VAT is broken out explicitly: subtotal + VAT 10% = total (e.g., Pro monthly: subtotal 362.727 + VAT 36.273 = 399.000). The Polar-generated invoice uses standard Vietnamese VAT invoice format.

**Given** a Free tier center attempting to purchase AI credits
**When** they navigate to the add-on section
**Then** the option is not available — add-ons are Pro and Studio only
**And** an upgrade prompt is shown instead

**Given** the Polar.sh integration
**When** billing operations are performed
**Then** all payment operations proxy through `billing_handler` → `billing_service` — the frontend never calls Polar directly
**And** Polar webhook events are received at a dedicated endpoint to sync subscription state

---

## Story 9.3: Payment Failure, Grace Period & Invoices

| Field        | Value              |
| ------------ | ------------------ |
| Size         | L                  |
| Audience     | Full-stack         |
| Dependencies | 9.2                |

**As an** owner, **I want** clear handling of payment failures with a grace period and access to invoices, **so that** I have time to resolve billing issues and can manage my financial records.

### Acceptance Criteria

**Given** a payment failure on renewal
**When** the charge is declined
**Then** a 7-day grace period begins
**And** the system auto-retries the charge on day 3 and day 5
**And** warning emails are sent on days 0, 3, 5, and 6

**Given** the grace period
**When** any page loads during the 7-day window
**Then** a red top strip appears on EVERY page with a link to payment settings (s73)

**Given** day 7 (23:59) of the grace period
**When** payment has not been recovered
**Then** the center is auto-downgraded to the Free tier
**And** nothing is deleted — AI grading pauses, second teacher seat locks, classes over 5 students become read-only
**And** recovery path: update payment method and retry charge → plan is restored

**Given** an Owner navigating to `/settings/billing/invoices` (s70)
**When** the invoice history renders
**Then** a table shows all invoices with columns: date, amount, status, actions
**And** invoice statuses include: Paid, Declined, Declined → Paid, Refunded, Upcoming, Free
**And** actions per invoice: Download PDF, Retry (for declined)
**And** tax (e.g., 10% VAT for Vietnam) is itemized on each invoice

**Given** the invoice export features
**When** the Owner uses export options
**Then** CSV export downloads all invoices as a spreadsheet
**And** "Email all to accountant" sends the full invoice history to a specified email address

**Given** the payment failure API
**When** a Polar.sh webhook fires `payment_failed`
**Then** the subscription status is updated to `past_due`
**And** the grace period start date is recorded
**And** retry schedule is queued (day 3, day 5)
**And** on day 7 without recovery, the subscription status changes to `cancelled` and plan is set to `free`

**Given** a Polar.sh webhook delivery fails
**When** the webhook is retried
**Then** the endpoint is idempotent (processing the same event twice produces the same result, no double charges or double downgrades)

**Given** the auto-downgrade triggers on day 7
**When** the center has more data than Free tier allows
**Then** NO data is deleted — AI credits pause, extra teacher seats lock, classes over 5 students become read-only, storage uploads blocked but existing files remain accessible
**And** a downgrade-restore integration test asserts zero row deletions across all tables (classes, exercises, submissions, enrollments, knowledge files, ai_credit_ledger) — only state flags change. Re-upgrade restores full access. (R24 mitigation.)

**Given** the Polar.sh webhook signature verification middleware
**When** any webhook arrives at `POST /api/webhooks/polar`
**Then** the verifier follows Standard Webhooks spec: (1) reads `webhook-id`, `webhook-timestamp`, `webhook-signature` headers; (2) computes HMAC-SHA256 of `{webhook-id}.{webhook-timestamp}.{raw-body}` using `POLAR_WEBHOOK_SECRET`; (3) constant-time compares via `crypto/hmac.Equal`; (4) rejects if `webhook-timestamp` > 300s old (±30s clock skew) with 401 `WEBHOOK_TIMESTAMP_STALE`; (5) rejects mismatched signature with 401 `WEBHOOK_SIGNATURE_INVALID`. Implemented as `classlite-api/internal/polarwebhook/` (~50 LOC, roll-our-own, stdlib only).

**Given** the secret rotation period
**When** `POLAR_WEBHOOK_SECRET_PREVIOUS` env var is set
**Then** the verifier accepts signatures from BOTH the current AND previous secret for the 24-hour overlap window — supports zero-downtime secret rotation.

**Given** a duplicate webhook delivery (same `webhook-id`)
**When** it arrives a second time
**Then** the handler returns 200 with "already processed" log entry — no double state mutation. Dedup enforced by unique index on `polar_webhook_events(event_id)` table.

**Given** the verifier reads `r.Body` to compute HMAC
**When** the middleware completes verification
**Then** the body is restored via `io.NopCloser(bytes.NewBuffer(body))` before calling downstream handler (project-context GFW-6).

**Given** the database schema
**When** migrations run for Story 9.3
**Then** `polar_webhook_events` table exists: `event_id` text PRIMARY KEY, `received_at` timestamptz NOT NULL, `payload_hash` text. Index on `received_at` for cleanup. RLS NOT applied (webhook layer runs before tenant context is set; dedup is global).

**Given** the plan grace state machine
**When** tested in CI with `MockClock` advancing through days 0 / 3 / 5 / 6 / 7 23:59
**Then** day 0 + day 3 + day 5 + day 6 emails sent at the right times; day 3 + day 5 auto-retries attempted; day 7 23:59 triggers auto-downgrade to Free. Recovery before day 7 cancels all subsequent retries/emails and clears the top strip immediately. The `Clock` interface (introduced in Story 1.4 for AuthService) is propagated to BillingService — no real `time.Sleep` in tests.

---

## Story 9.4: User Profile Management

| Field        | Value              |
| ------------ | ------------------ |
| Size         | M                  |
| Audience     | Full-stack         |
| Dependencies | 1.5                |

**As a** user, **I want** to manage my profile settings, **so that** I can update my personal information, avatar, password, and preferences.

### Acceptance Criteria

**Given** any user navigating to `/profile` (s38)
**When** the profile page renders
**Then** editable fields are shown: full name, avatar (upload/change), email (display, change requires verification), password (change with current password confirmation), language preference (Vietnamese/English toggle), and notification settings

**Given** a language preference change
**When** the user switches from Vietnamese to English (or vice versa)
**Then** the entire UI re-renders immediately in the selected language
**And** the preference is stored on the user record and persisted across sessions
**And** the preference applies to the language cookie shared across domains

**Given** a password change
**When** the user submits their current password and a new password
**Then** the current password is verified
**And** the new password is hashed and stored
**And** all other sessions (refresh tokens) are NOT invalidated (unlike password reset)

**Given** an avatar upload
**When** the user selects an image
**Then** the image is uploaded to R2 via presigned URL (following `{center_id}/avatars/{uuid}.{ext}` convention)
**And** the avatar URL is updated on the user record
**And** the sidebar user pill updates to show the new avatar

**Given** the profile page rendering context
**When** displayed
**Then** the profile screen renders within the user's current role shell (sidebar matches their role)
**And** the page is accessible to all roles (Teacher, Student, Admin, Owner)

**Given** the profile API
**When** PUT `/api/users/me` is called
**Then** the request accepts: `{ "fullName", "avatarUrl", "languagePref", "notificationSettings" }`
**And** email changes require a separate verification flow (not in MVP scope — display only)
**And** password changes go through POST `/api/users/me/change-password` with `{ "currentPassword", "newPassword" }`
