# Sprint Change Proposal — Story 1.4 Re-spec

**Date:** 2026-06-03
**Author:** John (PM)
**Trigger:** Amelia (Dev) review of Story 1.4 surfaced 4 blocking contradictions, 4 high-severity gaps, and 6 cleanups before implementation could start.
**Mode:** Batch
**Scope classification:** **Minor** — single story, spec tightening only; no PRD / Epics / Architecture changes; routed back to Dev for direct implementation.

---

## 1. Issue Summary

Story 1.4 (Email/Password Registration & Email Verification API) was contexted on 2026-06-03 and marked `ready-for-dev`. On dev review, Amelia identified that the story would produce divergent implementations as written. The issues clustered into:

- **Internal contradictions between ACs and Dev Notes** (B1, B4) — two incompatible designs documented on the same page.
- **Unimplementable AC clauses** (B2) — distinguishing "rotated-out consumed token" from "current consumed token" requires data that doesn't exist.
- **Spec/implementation impedance mismatches** (B3) — token-bucket primitives can't express fixed-window rate-limit semantics.
- **Missing test seams** (H2) — ACs assert behaviors (`bcrypt never called`) that require dependency injection not specified.
- **Silent correctness traps** (H1, H3, H4) — transaction scope, malformed-body rate-limiter path, timing-based enumeration.
- **Cosmetic / cleanup** (M1–M6) — inconsistencies the dev would otherwise have to decide ad-hoc.

Story was reverted to `BLOCKED — pending PM re-spec` and a structured handoff packet (Story Review Findings) was prepended to the story file by Amelia.

## 2. Impact Analysis

| Artifact | Impact |
|---|---|
| **Epic 1B (auth)** | None — story scope unchanged. |
| **Story 1.4** | Major content edits across ACs 1, 3, 5, 7, 8, 9, 11, 13, 14 + Tasks 2, 3, 4, 5, 7, 8, 9 + Pre-Tenant Audit Context Dev Note + DTO Reference + Project Structure Notes. |
| **Story 1.5 (login/session)** | None — story 1.5 depends on 1.4's user-creation contract, which is unchanged in shape (still `users` row with `email`, `password_hash`, `email_verified`, etc.). |
| **Story 1.6 (Google OAuth)** | None — Google OAuth path is unaffected by these spec changes. |
| **Architecture** | No change — all decisions are within the existing architecture's degrees of freedom. The new `auth_audit_logs` table is a natural extension of the audit pattern from Story 1.3b, not an architectural shift. |
| **PRD** | No change — no FR/NFR scope movement. |
| **UX spec** | No change — backend-only story. |
| **Code already shipped (Stories 1.1–1.3b)** | No regressions introduced by the re-spec itself. Two pre-existing deferred items (W1 from 1.3b, W3 + W5 from 1.3) are scoped to close as part of 1.4 implementation. |

## 3. Recommended Approach

**Direct Adjustment.** Edit Story 1.4 in place. No rollback, no MVP descope, no replan.

- **Effort:** ~1 hour of PM time to apply spec edits (done).
- **Risk:** low — all edits tighten contracts the dev hasn't started against yet.
- **Timeline impact:** zero — Story 1.4 returns to `ready-for-dev` same day.

## 4. Detailed Change Proposals

Applied to `_bmad-output/implementation-artifacts/1-4-email-password-registration-and-email-verification-api.md` directly. Summary by AC / Task:

### Blockers (B1–B4)

| ID | Old | New | Rationale |
|---|---|---|---|
| **B1** | AC13 used `service.AuditService.Log` with zero-UUID `tc.CenterID`; Dev Notes simultaneously specified Option D (`auth_audit_logs` + `AuthAuditLogger`). | AC13 rewritten to reference `AuthAuditLogger.Log` + `auth_audit_logs` table; Dev Notes collapsed to Option D only with A/B/C archived in one-line rationale. | Two incompatible implementations on same page — picked the cleaner separation. |
| **B2** | AC5 had two clauses: (1) consumed + user verified → 200 idempotent, (2) consumed + token rotated → 410. | AC5 reduced to single rule: any consumed token where `users.email_verified=true` → 200 idempotent regardless of which prior token was used. | Distinguishing the two states from row data is impossible without race-prone heuristics; replaying a prior-issued token after verification is not an attack. |
| **B3** | AC9 demanded "≤5 requests / 10 min / IP" — fixed-window semantics. Task 8 implemented token bucket. | AC9 explicitly relaxed to token-bucket: "burst 5 + 1 token replenished every 2 min/IP" with worst-case 9 req / 10 min documented as acceptable. | `golang.org/x/time/rate` cannot express fixed-window; new middleware unjustified for register/resend endpoints. |
| **B4** | AC14 required `scripts/codegen.sh` execution; Task 10 forbade OpenAPI consumer regen. | AC14 scoped to **sqlc regen only**; OpenAPI consumer codegen explicitly deferred to first frontend auth story (1.8 / 1.9a). | Frontend doesn't consume these endpoints yet — regen would produce unused types. |

### High-severity gaps (H1–H4)

| ID | Change |
|---|---|
| **H1** | Task 3 reordered: input validation → hash OUTSIDE tx → open tx → `CreateUser` catches pgx unique-violation (`pgErr.Code == "23505"`) and returns `ConflictError{Code: "EMAIL_ALREADY_REGISTERED"}` → `CreateEmailVerification` → commit. No more `GetUserByEmail` pre-check (TOCTOU window closed). Cost-12 bcrypt no longer holds a pool connection. |
| **H2** | New `Hasher` interface + `BcryptHasher` (prod) + `MockHasher` (tests) added to `AuthService` struct as injected dependency. AC11 assertion `mockHasher.CallCount == 0` now testable. |
| **H3** | Task 8 specifies: per-email rate-limiter's `emailKeyFn` returns `""` (skip-limiter sentinel) on JSON parse failure / empty key. `r.Body` restoration via `io.NopCloser(bytes.NewBuffer(body))` mandatory on every code path (GFW-6). |
| **H4** | AC7 + Task 4 mandate 200ms constant-time response floor on `/resend-verification` 200 responses (both known-email and unknown-email paths). Validation 422 responses bypass the floor. Defeats timing-based email enumeration. |

### Cleanups (M1–M6)

| ID | Change |
|---|---|
| **M1** | `emailDelivery: "sent" \| "delayed"` field now always present in 201 register response body. AC1 + DTO Reference updated. Value derived at retry-queue enqueue time (buffer full → "delayed"; otherwise "sent"). |
| **M2** | AC3 explicit "single transaction; partial failure rolls back all three" requirement on verify writes. |
| **M3** | AC11 SQL-injection clause reworded — payloads in non-format-validated fields are safe data, not 422 input; adversarial test in Task 14 verifies. |
| **M4** | Task 9 gains 5 explicit test cases for EmailRetryQueue (success first try, success after 2 fails, drop at max, panic recovery, non-blocking on full buffer) + `clock` interface seam for deterministic backoff testing. |
| **M5** | Task 5 gains a pre-flight grep step verifying existing `NotFoundError{` and `ConflictError{` call sites compile cleanly with the new `Code` field (zero-value fallback). |
| **M6** | `GetEmailVerificationByID` now filters `created_at > now() - 24h` so pollIds expire at 24h matching the verification token TTL. AC8 unified the response: unknown / malformed / expired pollIds all return 404 `POLL_ID_NOT_FOUND`. |

### Scope additions (called out explicitly so they don't surprise at code review)

- New file `auth_audit.go` (`AuthAuditLogger` interface + pg impl + tests).
- New file `hasher.go` + `hasher_mock.go`.
- New migration `20260603100000_create_auth_audit_logs.{up,down}.sql` + new sqlc query file `auth_audit_logs.sql`.
- **Closes deferred work in-flight (intentional scope addition):** Story 1.3b W1 (rate-limit IP from context), Story 1.3 W3 (user auth-method invariant), Story 1.3 W5 (verification expiry at query layer).

## 5. Implementation Handoff

**Recipient:** Amelia (Dev agent).
**Scope:** Minor (direct implementation).
**Deliverables:** the re-spec'd `1-4-email-password-registration-and-email-verification-api.md` (Status: `ready-for-dev`, BLOCKED marker removed) + this proposal as the traceability record.

**Success criteria (carry to dev review):**
- All 14 ACs verifiable by tests listed in Tasks 12–15.
- No new deferred items unless explicitly justified in completion notes.
- Three pre-existing deferred items (1.3b W1, 1.3 W3, 1.3 W5) closed and noted in completion notes.
- `go test ./...` green on full regression.

**Next handoff:** Amelia runs `/bmad-agent-dev` → `DS` (dev-story).
