# Story 9.3 — Party-Mode Review Punchlist (correct-course)

**Date:** 2026-10-05 · **Reviewers:** 6-lens party mode (Architect · TEA · PM · Dev · Security/PO · UX) + synthesis
**Subject:** Story `9-3-payment-failure-grace-period-and-invoices` (ready-for-dev) + its WF-8 ATDD reds
**Verdict:** **GO-WITH-FIXES** — all 6 lenses CONCERNS. The grace state machine + R24 zero-deletion reds are sound; the D8 schema/reuse-map cannot satisfy several reds as written, and the reds masked four prod bugs via fabricated fixtures. A defined pre-dev fix pass (not a rebuild) is required before coding.

> Scope of this doc: capture every finding, flag the items that need a **Ducdo ruling**, record the **red fixes already applied** (2026-10-05, same session), and enumerate the **green-phase requirements** the reds now demand. Story-spec edits (D8 schema, reuse-map, taxonomy, task list) are **held pending the rulings below** — this doc is the source of truth until the story is amended.

---

## A. DUCDO RULINGS — RESOLVED 2026-10-06 ✅

All four ruled and applied to the story (v0.2 "Correct-Course Amendments") + reds:
- **R1 → honor 23:59.** Day-7 downgrade fires at end of the 7th calendar day; reds assert it fires AT the deadline and NOT before (`graceDeadline()`).
- **R2 → write.** 9.3 writes declined/refunded invoice rows + propagates Polar status; 6-pill set now has producers; "Declined→Paid" = a was-declined-now-paid row (UX §8.6 gains a 6th pill).
- **R3 → pull.** Over-cap read-only enforcement is in 9.3 (new C8a seat-lock + C8b over-cap class; always-on path independent of the dark add-flag). FU-9-3-READONLY un-deferred. New red `grace_downgrade_readonly_atdd_test.go`.
- **R4 → give variant.** Owner = actionable strip; admin = informational (no link); teacher/student absent. FE red split accordingly.

Original fork table retained below for the record.

| # | Fork | Options | Panel lean |
|---|---|---|---|
| R1 | **Day-7 cutover moment** (BLOCKER-2) | (a) honor "23:59": schedule the day-7 tick at `grace_start+7d+23h59m`, assert downgrade fires AT the deadline and NOT before; OR (b) amend AC to "start of day 7" and keep the midnight test. Define day index as `floor((Now−grace_start)/24h)` (TZ-agnostic) and drop "23:59/VN-calendar" from gate logic (email display only). | Split: Architect → pure elapsed-duration + drop 23:59; TEA/PM/UX → honor the 23:59 promise at the deadline. **Needs your call.** |
| R2 | **Invoice status taxonomy** (BLOCKER-3) | (a) 9.3 WRITES declined/refunded rows + propagates Polar status (enables all 6 pills + filter + Retry); OR (b) trim AC14/AC15 to statuses 9.3 can produce (`paid` + whatever Polar sends), document the rest render-only. Also reconcile "Declined→Paid" — it is NOT in UX §8.6 (5 pills). | PM/UX rate HIGH (FR-66 ships non-functional otherwise); Dev/Security say implementable with added queries. Merged as BLOCKER because it also blocks building the filter/Retry UI. |
| R3 | **FR-65 "pause" scope for v1-prod** (HIGH) | (a) pull seat-lock + over-cap read-only into 9.3; OR (b) sign off that v1 day-7 downgrade = **AI-pause + storage-ceiling only** and amend FR-65 acceptance wording + launch messaging. Also: should `plan` flip at all while `BILLING_ENFORCEMENT_ENABLED` is dark-OFF? | PM flags that a lapsed paying customer currently keeps their 2nd teacher + 12-student classes fully editable — the epic AC advertises a pause that does not happen. |
| R4 | **Owner-only grace strip (D4)** — reconsideration, not a defect | D4 is your prior ruling (only the owner can fix payment). PM notes FR-65 says "every page, any role" and an absentee-owner/active-admin center downgrades silently for the admin. Option: an informational non-actionable variant for admins. | Re-litigation of a settled decision — raise only if you want to revisit. |

---

## B. BLOCKERs

**B1 — Same-period dunning recovery never clears grace → a paying owner is still auto-downgraded at day 7.** `setPlanFromPolarTx` early-returns when `genuine=false`; a real Polar retry-success fires `subscription.active` for the *same* billing period (period didn't roll) → it only binds the sub id, never clears grace / cancels ticks / sets active. Money + access-integrity failure. `where`: `billing_polar.go setPlanFromPolarTx:383-399`, AC9/D6. **Fix:** recovery detection must be **status-based** (`status==past_due` → ClearGrace + cancel-ticks + set active, independent of the genuine-change gate); wire the same into `applyOrderPaidTx`. *(raised by Architect, Dev, Security)*
→ **Red fixed** (B-fix-1 below). **Green:** implement status-based recovery.

**B2 — Day-7 23:59 vs midnight contradiction.** See **R1**. `where`: `grace_state_machine_atdd_test.go` graceDay = epoch+N×24h vs AC6/D9 "23:59" + the FE `graceEndsAt` fixture. **Fix:** resolve R1, then reconcile BE epoch + AC wording + FE fixture + the red's day-7 assertion.

**B3 — Invoice status taxonomy has no producer.** See **R2**. Only `'paid'` is ever written (`insertChargeInvoice:544`); payment-failure writes no invoice row → 5/6 pills + filter + declined-only Retry are dead UI; the FE red green-lit it with a fabricated `'declined'` row. *(PM, UX, Dev, Security)*
→ **Red fix deferred to R2** (the FE fixture change depends on the taxonomy decision). Noted in the invoice red header.

**B4 — D8 schema has no per-day marker → days 0/6 idempotency unsatisfiable, double-sends in prod.** `grace_retry_count` guards days 3/5 only; a re-run day-0/day-6 tick is indistinguishable and emails twice. `where`: D8, AC2/AC5. **Fix:** add a persisted high-water marker (`grace_last_tick_day smallint DEFAULT -1`, or a sent-day bitmask) to the D8 migration; gate EVERY day's effect on `elapsedDay > marker`, advance in the same tx. *(Architect, Dev, TEA)*
→ **Red fixed** (B-fix-2: re-run no-op now covers days 0/3/6). **Green:** add the marker column to D8.

---

## C. HIGHs

**C1 — "Cancel pending ticks" has no backing query and `job_status` has no `'cancelled'` value.** `MarkJobComplete/FailedTerminal` both `WHERE status='processing'` — can't touch the `pending` ticks the direct-call reds leave. **Fix:** add `CancelPendingGraceTicks` (terminate all pending/processing `billing_grace_tick` for the center to an ALLOWED terminal state, or DELETE — R24 does not cover the jobs table), called from `ExpireGraceToFree` and the recovery branch; state the chosen terminal status in D8. *(Architect, Dev)*

**C2 — Payment-failure event isn't resolved + the red forced raw-body metadata trust (SEC-7).** `resolvePolarCenter:213-245` default→`""` (no `past_due` case); the center's `polar_subscription_id` was NULL so the only way to green was metadata trust. **Fix:** both the dispatch switch AND `resolvePolarCenter` learn the event type, slotted into the persisted-sub-id-wins branch. *(Architect, Security)*
→ **Red fixed** (B-fix-3: bind the real sub id first + new confused-deputy negative asserts grace lands on the bound center, not the metadata center).

**C3 — PDF passthrough has no data source.** `polar_invoice_id` is never populated and an id ≠ a URL; `Download-PDF` is omitted for 100% of real invoices; the FE red hardcodes `pdfUrl`. **Fix:** extend `polarEvent` to parse the Polar invoice id/url, populate it in `insertChargeInvoice`, cite the Polar field; until a producer exists, scope AC15 to "omitted" and document the gap. *(Dev, PM, Security, UX)*

**C4 — No future-dated enqueue primitive + the entire tick cadence is gate-invisible.** `InsertJob` ignores `next_attempt_at` (all 7 ticks fire at once on naive reuse); the reds hand-drive `HandleGraceTick` so the reschedule chain (AC3), `ClaimNextJob` ordering, and SEC-6 worker tenant-reconstruction are untested. **Fix:** add `InsertDelayedJob(@center_id,@type,@params,@next_attempt_at)` to D8 **OR** commit to a self-rescheduling-job model (document which). **+ Add a worker-level integration red** (see D-green-1). *(Dev, TEA, Architect)*

**C5 — No backend red for invoice-endpoint owner-gating (TEST-BE-3) nor SEC-11 email sanitization.** Financial-data leak + CRLF header injection would ship green. *(Security, TEA)*
→ **Red fixed** (B-fix-4: `billing_invoice_authz_atdd_test.go` owner-gating + `invoice_email_sec11_atdd_test.go` ParseAddress/CRLF/subject-cap).

**C6 — FR-65 "pause" is mostly hollow in prod.** See **R3**. *(PM)*

---

## D. MEDIUM / LOW / NIT (condensed)

- **M1** `ExpireGraceToFree` CANNOT reuse `setPlanFromPolarTx` wholesale (it hardcodes `status='active'` + 422s on empty cycle). Spec it as a distinct write reusing only discrete helpers (`CaptureResourceBaselines`, storage re-point, credit cap). The "reuse the 9-2a downgrade-apply path" guidance in the story is misleading. *(Architect, Dev)*
- **M2** AC17 cross-tenant RLS had no red + was absent from traceability. → **Red fixed** (B-fix-5: `grace_cross_tenant_rls_atdd_test.go` service-level). **Green still owes** a store-level RLS adversarial test over `SetPastDueWithGrace`/`ClearGrace` (cross-tenant UPDATE blocked both directions).
- **M3** FE absence assertions were synchronous (false-greens). → **Red fixed** (B-fix-6: `fetchFired()` settle-gating + non-owner asserts the query never fired).
- **M4** SEC-6 worker tenant re-establishment is bypassed (reds call `HandleGraceTick` with a trusted `tc`). → captured in D-green-1.
- **M5** AC4 "request Polar to re-collect" anchored only on `grace_retry_count` — the actual collection attempt is unverified. *(TEA/PM; Dev considers the counter adequate — see Disagreements.)* Clarify AC4 counts OUR requests; if `internal/polar` exposes a re-collect, assert the MockClient recorded it on days 3/5.
- **M6** Anti-panic signposting is the uncovered half: email CONTENT (AC3 — assert on `MockEmailSender.Snapshot()` deadline + settings link), AC13 5-node timeline + "nothing deleted" copy, countdown, loading/error trilogy — all untested. A fetch failure must never SUPPRESS the grace warning.
- **M7** Strip renders server-baked English `deadlineLabel` verbatim → vi owner sees a non-localized date. Render from `graceEndsAt` via `{{val,vnDate}}`; treat `deadlineLabel` as non-UI metadata.
- **M8** `role=alert` on a persistent app-wide strip re-announces assertively on every route change (SR spam). Use `role=alert` only on first appearance; demote the standing strip to `role=region` aria-label "Billing status". Pin now so the deferred amber banner (s72) doesn't collide.
- **M9** R24 PK-set snapshot omits the seeded `assignments` table. → **Red fixed** (add `assignments` to `graceSnapshotTables`) — see B-fix-7.
- **L1** "Email all to accountant" artifact format + filter scope unspecified (CSV? PDF? HTML? honors the active filter or always all?). Specify in AC16.
- **L2** a11y/i18n/mobile gate gaps: no axe red (TEST-FE-5), color-only severity (WCAG 1.4.1), i18n parity arrays omit pill + timeline keys, no mobile variant for the strip/4-col table (UX-4). Expand at TA/green.
- **N1** EDGE-4 no-PII/secret-in-logs for grace emails has no coverage — add a lint/code-review checklist item mirroring the Gemini secret-hygiene precedent.

---

## E. Red fixes APPLIED this pass (2026-10-05)

All verified: `go vet -tags atdd_red_phase ./internal/test/ ./internal/handler/` compile-fails ONLY on the documented seams (`SetEmailSender`, `HandleGraceTick`, `EmailInvoicesToAccountant`); the untagged green suite compiles clean.

- **B-fix-1** `grace_idempotency_atdd_test.go` — recovery red now sends the UNCHANGED billing period (exercises the `!genuine` early-return; forces status-based recovery) + asserts a paying center is never downgraded.
- **B-fix-2** same file — `TestGrace_RerunTickSameDay_NoOp` parameterized over days **0/3/6** (forces the D8 per-day marker).
- **B-fix-3** same file + `story_9_3_helpers.go` — new `bindPolarSubscription` helper; state-machine + idempotency reds bind the real `polar_subscription_id` first (secure resolution path); new `TestGrace_PaymentFailed_ResolvesByBoundSubscription_NotMetadata` SEC-7 confused-deputy negative.
- **B-fix-4** NEW `handler/billing_invoice_authz_atdd_test.go` (owner-gating, 403 for non-owner) + NEW `test/invoice_email_sec11_atdd_test.go` (ParseAddress reject + CRLF-strip + subject cap).
- **B-fix-5** NEW `test/grace_cross_tenant_rls_atdd_test.go` (AC17 — A's tick leaves B byte-identical).
- **B-fix-6** `BillingGraceBanner.test.tsx` — absence assertions now settle-gated (`fetchFired()`); non-owner asserts the owner-gated query never fired.
- **B-fix-7** `story_9_3_helpers.go` — add `assignments` to `graceSnapshotTables` (R24 airtightness, M9).

---

## F. GREEN-PHASE requirements the reds now demand (not yet red — add at dev/TA)

1. **D-green-1 — Worker ProcessOnce cadence + SEC-6 integration test** (closes C4 + M4). NOT hand-written now because the grace-tick handler's dispatcher-registration shape is an unmade design fork (C4: self-rescheduling vs `InsertDelayedJob`). At green, add a `worker`-package red: drive `ProcessOnce` across MockClock days 0→7 asserting exactly-one-next-tick enqueued per day, zero after terminal/recovery, and the worker rebuilds `tc` from the job's `center_id` (never reads ambient `tc.UserID`).
2. **Store-level RLS adversarial test** over `SetPastDueWithGrace`/`ClearGrace`/`ExpireGraceToFree` (M2 — cross-tenant UPDATE of grace cols blocked both directions, deterministic tenant IDs, RLS never disabled).
3. **D8 schema:** add the per-day marker (B4) + decide the cancelled-tick terminal status (C1).
4. **`ExpireGraceToFree`** as a distinct write (M1), not `setPlanFromPolarTx`.
5. **Email CONTENT + FE signposting reds** (M6), vnDate (M7), live-region semantics (M8), axe/i18n-parity/mobile (L2) — TA-phase.

---

## G. What the panel CONFIRMED is solid (keep as-is)

- R24 zero-deletion PK-set + re-upgrade restore — faithful, non-brittle.
- Provider-agnostic `grace_retry_count` anchoring — de-risks the D2 Polar-retry uncertainty enough that a dev is never blocked (Dev lens; TEA wants the attempt also asserted — M5).
- Single shared `billingSvc` instance — no setter-vs-constructor dual-instance nil trap (but **add the explicit `main.go` wire step**: `billingSvc.SetEmailSender(...)` right after `SetCheckoutSuccessURL`, or it's a prod-only nil-deref the gate can't see).

---

## H. Cross-lens disagreements (for your awareness)

1. **Day-7 fix direction (R1):** Architect → TZ-agnostic elapsed-duration, drop 23:59; TEA/PM/UX → honor the 23:59 promise.
2. **AC4 counter sufficiency (M5):** Dev → counter adequate for the red; TEA/PM → assert the actual re-collect attempt.
3. **Owner-only strip (R4):** PM flags the admin blind spot; it's a settled Ducdo ruling (D4) — reconsideration, not a defect.
4. **Invoice-status/PDF severity:** PM/UX HIGH (FR-66 non-functional); Dev/Security MEDIUM (implementable). Merged ranking: taxonomy = BLOCKER (blocks filter/Retry UI), PDF = HIGH.
