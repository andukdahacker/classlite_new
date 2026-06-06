---
title: 'BLOCKER Resolutions — Test Design Follow-up'
date: '2026-06-04'
resolvedBy: 'Ducdo + Murat (TEA) + John (PM)'
relatedDocs:
  - 'test-design-architecture.md'
  - 'test-design-qa.md'
  - 'classlite_new-handoff.md'
status: 'all 7 BLOCKERs resolved; ready to feed bmad-create-epics-and-stories'
---

# Test Design BLOCKERs — Resolutions

The 7 BLOCKERs flagged in `test-design-architecture.md § Quick Guide` have been resolved on 2026-06-04. Decisions below are authoritative — use them as input to epic ACs and Phase 0 infrastructure work.

## Engineering Decisions

### A2 — Polar.sh webhook signature scheme

**Decision:** Roll-our-own Standard Webhooks verifier, ~50 LOC at `classlite-api/internal/polarwebhook/`.

- **Algorithm:** HMAC-SHA256
- **Verified headers:** `webhook-id`, `webhook-timestamp`, `webhook-signature`
- **Signed payload:** `{webhook-id}.{webhook-timestamp}.{raw-body}`
- **Replay window:** Reject if `webhook-timestamp` > 300s old (±30s clock skew tolerance)
- **Constant-time compare:** `crypto/hmac.Equal` (Go stdlib)
- **Secret rotation:** `POLAR_WEBHOOK_SECRET` + paired `POLAR_WEBHOOK_SECRET_PREVIOUS` for 24h overlap
- **Idempotency:** new table `polar_webhook_events(event_id PK, received_at, payload_hash)`; duplicate `event_id` → 200 (idempotent) with "already processed" log entry
- **Body preservation:** Middleware reads raw body BEFORE JSON parse, computes HMAC, restores via `io.NopCloser(bytes.NewBuffer(body))` (project-context GFW-6)
- **Error codes:** `WEBHOOK_SIGNATURE_INVALID` (401), `WEBHOOK_TIMESTAMP_STALE` (401)

**Mitigates:** R11. Murat downgrades from MITIGATE to MONITOR once `polarwebhook` package + tests ship.

### A7 — Worker tenant-context test harness

**Decision:** `SetupWorkerHarness(t)` lives at `classlite-api/internal/test/workers/harness.go`, mirrors `test.SetupDB(t)` ergonomics.

**Core invariant:** **Job row's `center_id` is the only tenant trust anchor.** Worker base class reads `center_id` from row, never from payload. Payload field (if present) is logged as discrepancy signal.

**3 mandatory adversarial test patterns per worker job type:**

| Pattern | What it proves |
|---|---|
| `Test{Worker}_HappyPath` | Job dequeued, tenant context set from row, handler runs, downstream effects asserted |
| `Test{Worker}_PayloadCenterIdIgnored` | Job row `center_id=A` + payload claims tenant B resource → RLS returns 0 rows → `NotFoundError` (NOT data leak) |
| `Test{Worker}_NullTenantContextRejected` | Skip `SET LOCAL` (simulate bug) → all DB ops return 0 rows, never all-rows leak |

**Generator:** `gen_worker_tests.go` script reads job-type registry and scaffolds the 3-pattern skeleton per type.

**Mitigates:** R3 (BLOCK → MITIGATE once harness ships; MITIGATE → MONITOR once all worker types have full 3-pattern coverage).

### A10 — R2 presigned URL replay policy

**Decision:** Expiry + content-type lock + server-side prefix validation. NO dedup table at v1.

**Seven reinforcements:**

1. Server-side `{center_id}` prefix validation at BOTH `/uploads/presign` AND `/uploads/confirm` → 403 `R2_KEY_PREFIX_MISMATCH` + audit log on mismatch.
2. Content-Type locked in presigned signature; PUT with wrong Content-Type fails at R2.
3. MIME allowlist validated server-side BEFORE presigning (never trust client claim).
4. Max expiry: **5 minutes** (architecture said 5–15, tightened to 5).
5. `/uploads/confirm` reads R2 metadata: validate actual stored Content-Type, object size ≤ per-feature cap (A9), object exists.
6. Presigned URLs never logged. slog filter masks `s3.amazonaws.com|r2.cloudflarestorage.com` URLs and `X-Amz-Signature` query params.
7. **Telemetry hook:** log on `/confirm` when R2 HeadObject shows object already confirmed. Promote to dedup-table approach if >3 such events/month post-launch.

**Mitigates:** R9. Telemetry hook is the safety valve.

## Product Decisions (locked with John/PM)

### A6 — AI credit refund-on-failure policy

**Mechanism:** append-only `ai_credit_ledger` table.

```sql
ai_credit_ledger (
  id              uuid PK,
  center_id       uuid NOT NULL,  -- RLS scope
  user_id         uuid NOT NULL,
  change          int  NOT NULL,  -- +500 grant, -1 deduct, +1 refund, +100/+500/+2000 purchase
  reason          text NOT NULL,  -- monthly_grant | job_deduction | job_failed_refund |
                                  -- addon_purchase | admin_adjustment
  ref_job_id      uuid NULL,
  ref_purchase_id uuid NULL,
  balance_after   int  NOT NULL,  -- cached for read perf
  created_at      timestamptz NOT NULL
);
-- RLS: append-only INSERT-only policy (mirrors auth_audit_logs from Story 1.3b)
-- Unique index: (ref_job_id, reason) for idempotency
-- Read index: (center_id, user_id, created_at DESC)
```

**Refund matrix:**

| Job final state | Refund? | UX |
|---|---|---|
| `complete` (success first try OR after auto-retry) | No | Normal grading view |
| `failed` after 3 retries (Gemini API errors) | **Yes** | "AI grading failed. Credit returned. Try again later or grade manually." |
| `failed` with `invalid_ai_response` / `invalid_band_scores` | **Yes** | "AI returned invalid output. Credit returned. Please grade manually." |
| Speaking `partial_success` (bands ok, transcript missing) | **No** | "Transcript unavailable. Bands proposed below — review carefully." |
| Generation `failed` after 5-min timeout | **Yes** | "Generation took too long. Credit returned." |
| User cancels before `processing` state | **Yes** | Silent refund |
| User cancels mid-`processing` | **No** | "Generation cancelled. Credit consumed." |

**Implementation invariants** (must appear as ACs in Epic 6 stories):

1. Refund row inserted in same transaction as job state transition to `failed`.
2. Idempotent: unique `(ref_job_id, reason)` prevents double-refund on worker retries.
3. Nightly reconciliation cron: sum ledger entries per user → compare to cached balance → alert on drift.
4. Free-tier users do NOT see Billing → Usage panel (they have 0 credits forever; show Upgrade-to-Pro CTA instead).

**Mitigates:** R23.

### A8 — VND prices, VAT, and tier math

**Tier pricing:**

| Tier | Monthly VND | Annual VND | AI credits/mo |
|---|---|---|---|
| Free (lead-gen) | 0 | 0 | 0 |
| Pro | **399.000** | **3.990.000** | 500 |
| Studio | **999.000** | **9.990.000** | 2.000 |

**Add-on AI credit packs** (carry-forward):

| Pack | Pro tier | Studio tier |
|---|---|---|
| 100 credits | 99.000 VND | n/a |
| 500 credits | 399.000 VND | 299.000 VND |
| 2.000 credits | n/a | 999.000 VND |

**VAT strategy:** 10% inclusive display.

- Marketing pages: "**399.000 VND/tháng**" large + "*Giá đã bao gồm VAT 10%*" small
- Checkout: subtotal 362.727 + VAT 36.273 = total 399.000 (breakdown shown)
- Invoice (Polar generates): standard Vietnamese VAT invoice format

**Free tier definition (lead-gen):**

- 0 AI credits (PRD-locked)
- 5-student/class cap is the natural upgrade trigger
- No trial mechanic in v1 (defer to Epic 9 post-launch review)

**Pre-launch ticket:** Vietnamese tax advisor consult re: 8% vs 10% VAT eligibility for educational SaaS (potential ~36k VND/mo per Pro saved if 8% applies).

**Mitigates:** removes the `[ASSUMPTION: TBD]` from PRD FR-61.

### A9 — Per-file size limits + storage overflow policy

**Per-feature caps:**

| Feature | Cap | Types |
|---|---|---|
| Speaking audio submission | 25 MB | WebM |
| Listening audio (exercise) | 100 MB | MP3, WAV |
| Knowledge Hub PDF | 50 MB | PDF |
| Knowledge Hub image | 15 MB | PNG, JPG, SVG |
| Avatar | 5 MB | PNG, JPG |
| Center logo | 5 MB | PNG, JPG, SVG |
| Student note attachment | 10 MB | PDF, PNG, JPG |

**Enforcement layers** (defense in depth):

1. Client pre-check (UX, not security)
2. Server pre-check at `/uploads/presign` → 413 `FILE_TOO_LARGE` with i18n error code
3. R2 presigned URL conditions: Content-Type locked + Content-Length-Range = per-feature cap
4. Server post-check at `/uploads/confirm` via `HeadObject` → delete object + return 413 if exceeded

**Storage overflow policy** (Pro/Studio plan storage):

| Threshold | Behavior |
|---|---|
| 80% of plan storage | Soft warning in Settings → Storage panel |
| 95% | Prominent banner + email to owner |
| **100%+** | **Hard block** new uploads — "Storage full. Delete files or upgrade to Studio." Existing files untouched. |
| Abuse alert | Background ops alert if >100 GB uploaded in 24h |

**Mitigates:** part of R9 (size-cap is one R2 security layer); blocks Epic 4 upload error-path tests.

### A5 — iOS / Android device verification

**Decision:** Use existing iPhone + Android. 0 VND additional spend.

- iOS Simulator does NOT cover MediaRecorder reality (different audio pipeline; misses real-device quirks like incoming-call interruption, microphone permission denial flow, audio focus loss, codec drift across iOS minor versions).
- Playwright WebKit (in CI) covers ~70% of bugs.
- Real-device manual smoke covers the remaining 30% — including all the bugs that actually ship.

**Murat folds into Epic 5 release-gate manual checklist (~20 min per release):**

```
□ Speaking recorder: record / re-record / upload on real iPhone (Safari)
□ Speaking recorder: record / re-record / upload on real Android (Chrome)
□ Permission denial → graceful UX
□ Interrupted by incoming call → recording state preserved or cleanly aborted
□ Recording survives backgrounding the tab for 30s
□ Submitted audio playable on a different device + browser combo
```

**Mitigates:** R7 release-gate concern.

### SLO + scalability targets

Sized for **50 Pro centers ambition** with 4× headroom.

**Reliability:**

| Metric | Launch target |
|---|---|
| Uptime SLO | 99.0% (~7.2 hrs/mo down budget) |
| API error rate (non-AI) | <1% 5xx |
| AI job success rate | ≥90% |
| RPO | 1 hour (Railway Pro + WAL archiving) |
| RTO | 4 hours (manual restore + DNS reroute runbook) |

**Scalability (v1 ceiling):**

| Metric | Target |
|---|---|
| Total tenants supported | 200 centers |
| Concurrent users (peak) | 500 |
| Largest single-tenant concurrent | 100 |
| AI jobs/hour sustained | 50 |
| AI jobs/hour burst (10 min) | 150 |
| API RPS sustained | 20 |
| API RPS burst | 80 |
| DB pool size | 15 |
| Worker pool size | 3 |

**Latency NFRs (per-PRD, restated for testability):**

| Endpoint class | p95 | p99 |
|---|---|---|
| Page load (FCP on 4G) | <2s | <3s |
| Search results | <500ms | <1s |
| Dashboard list endpoints | <800ms | <1.5s |
| Grading view (essay + AI suggestions) | <3s | <5s |
| Auth endpoints (login, refresh) | <400ms | <800ms |
| AI job submission (just enqueue) | <200ms | <400ms |
| Health endpoint | <50ms | <100ms |

**Year-1 upgrade path** (deferred, not blocking): 99.5% uptime requires Railway read replica (~$20/mo) + automated failover (~3 days eng). Decide post-launch based on observed reliability.

**Mitigates:** R48. R48 downgraded MITIGATE → MONITOR with these targets.

---

## Updated Risk Register (delta only)

| Risk | Before | After | Reason |
|---|---|---|---|
| R3 | BLOCK (9) | **MITIGATE (6)** after A7 harness ships | Architecture decision unblocks test pattern |
| R9 | MITIGATE (6) | **MITIGATE (6) — same, mitigation plan locked** | A10 + A9 enforcement layers documented |
| R11 | MITIGATE (6) | **MITIGATE (6) — same, mitigation plan locked** | A2 scheme documented |
| R21–R24 | MITIGATE (6) each | **MITIGATE (6) — same, mitigation plan locked** | A6 + A8 unblock test design |
| R48 | MITIGATE (6) | **MONITOR (4)** | SLO targets defined, accepted operational reality |

R1 (BLOCK 9) still requires golangci-lint analyzer story (separately tracked).

## Follow-up Tickets (not BLOCKERs, but track for pre-launch)

1. ✏️ **Tax advisor consult** — confirm 8% vs 10% VAT eligibility for educational SaaS (potential ~3.6M VND/mo saved at 100 Pro customers)
2. ✏️ **Year-1 SLO push to 99.5–99.9%** — Railway replica + automated failover when revenue justifies it
3. ✏️ **Trial mechanic (7-day Pro preview)** — defer to post-launch conversion data review
4. ✏️ **R2 presigned URL telemetry** — instrument the "already confirmed" signal; promote to dedup table if >3/month
5. ✏️ **DB pool size + worker pool tuning** — Railway autoscaling rules once load patterns observed

---

**Status:** All 7 BLOCKERs resolved. Murat updates test design risk register and architecture doc. John dispatches `bmad-create-epics-and-stories` next to fold these decisions into epic specs.
