---
baseline_commit: 26c569b8b3f16e79b02c60e7f56d1b3a05eea0aa
---

# Story 2.2: Class Template & Spawning API

Status: done

<!-- Baseline commit: 26c569b (Story 2-1 done + TA P2/P3 backfill + AC6 hardening + RV MED fixes). -->
<!-- Pre-dev context engine pass by John. Amelia (dev) picks this up next; /bmad-tea AT 2-2 MUST run before backlog → in-progress transition (R1 owns three new resource families). -->

## Story

As an **onboarding user (Operator, Founder, or Solo Teacher) with a center**,
I want the server to store pre-built IELTS templates AND spawn N real classes from them in one atomic operation,
so that I can start teaching from a proven blueprint in minutes without hand-configuring every class — and my class-and-teacher assignments (including invites for staff not yet in the system) either all land or all roll back.

## Response Envelope Contract (applies to every AC below)

Every 2xx response from THIS story's three endpoints returns:
```json
{ "data": <endpoint-specific>, "meta": { "serverTime": "<ISO-8601 UTC>" } }
```

Reuse `handler.WriteEnvelope(w, status, clk, data)` (shipped in Story 2.1). The wizard consumes `meta.serverTime` for auto-save affordances (UX §8.1). Do NOT re-implement the envelope helper.

## Acceptance Criteria

1. **Template list (mixed scope).** `GET /api/templates` returns two logical scopes concatenated: (a) **global pre-built** IELTS templates (`class_templates.center_id IS NULL`), (b) the caller's **center-owned** custom templates. Response shape: `200 { "data": { "templates": [{ id, name, targetBand, primarySkill, sessionCount, color, scope: "system" | "center" }] }, "meta": { "serverTime" } }`. **At least 5 system templates** MUST be returned (per PRD FR-3 + AC1b seed set); if fewer, the seed migration ran incompletely — respond `500 SEED_INCOMPLETE`. Sort: system templates first (by insertion order — deterministic via seed migration), then center-owned by `created_at DESC`. Missing auth → `401 AUTH_REQUIRED` (or `AUTH_INVALID` for present-but-invalid tokens; see AC13 for the full 401 taxonomy). Unverified email → `403 EMAIL_VERIFICATION_REQUIRED`. Missing `CenterID` in tenant context → `403 CENTER_REQUIRED` (caller must complete Story 2.1's `POST /api/centers` first).

1b. **Pre-built system template seed set.** The seed migration (Task 2.4) inserts EXACTLY these five `class_templates` rows with `center_id = NULL` and deterministic UUIDs (test suites reference them by UUID):

| Fixed UUID | Name | targetBand | primarySkill | sessionCount | color |
|---|---|---|---|---|---|
| `11111111-2222-3333-4444-555555555501` | Writing Bootcamp 6.5 | 6.5 | writing | 12 | `#f59e0b` (amber) |
| `11111111-2222-3333-4444-555555555502` | Speaking Mastery 7+ | 7.0 | speaking | 12 | `#3b82f6` (blue) |
| `11111111-2222-3333-4444-555555555503` | Foundation Listening + Reading | 5.5 | listening_reading | 10 | `#10b981` (emerald) |
| `11111111-2222-3333-4444-555555555504` | Starter Band 5.5 All Skills | 5.5 | all_skills | 8 | `#8b5cf6` (violet) |
| `11111111-2222-3333-4444-555555555505` | Academic Reading 6.5 | 6.5 | reading | 10 | `#14b8a6` (teal) |

Fifth seed (Academic Reading 6.5) closes a gap Sally-B1 named: Vietnamese uni-admissions IELTS cohorts overwhelmingly target Reading standalone; without a dedicated Reading template, that segment is forced to "Build from scratch" as their first wizard action. AC1's "at least 4 system templates" completeness check becomes "at least 5" and the seed-integrity gate updates accordingly. Each seed inserts 3–4 `template_sessions` rows with `title` + `description` populated (details in Task 2.4 — enough to prove spawn pre-fills the session plan; NOT a full syllabus). Down migration deletes by fixed UUID only — user-added rows (different UUIDs) are unaffected.

2. **Custom template create.** `POST /api/templates` with `{ "name": string, "targetBand": number, "primarySkill": "writing"|"speaking"|"listening"|"reading"|"listening_reading"|"all_skills", "sessionCount": integer, "color": string|null, "sessions": [{ "title": string, "description": string|null }] }` inserts a `class_templates` row with `center_id = <caller's center>` AND all provided `template_sessions` rows in a **single transaction**. Returns `201 { "data": { "id", "name", "targetBand", "primarySkill", "sessionCount", "color", "scope": "center", "sessions": [{id, title, description, sessionOrder}] }, "meta": { "serverTime" } }`. Validation: `name` 1–120 rune length after trim; `targetBand` in `[1.0, 9.0]` step 0.5; `sessionCount` in `[1, 100]`; `sessions.length` MUST equal `sessionCount` (single source of truth — no drift); `sessions[i].title` 1–200 rune length. Missing/invalid → `422 VALIDATION_ERROR`. Missing `CenterID` → `403 CENTER_REQUIRED`.

3. **Spawn — atomic multi-class create.** `POST /api/templates/{id}/spawn` with `{ "classes": [{ "cohortName": string, "startDate": "YYYY-MM-DD", "teacherEmail": string|null }] }` reads the template (system OR own — 404 if template not accessible), then in **ONE transaction** inserts:
   - N `classes` rows (one per input) with `template_id = {id}`, `center_id = <caller>`, `status = 'upcoming'`, `name = cohortName`, `start_date = startDate`, plus `target_band` + `primary_skill` + `session_count` copied from the template.
   - **Teacher resolution** per class (see AC4).
   - Optional `invites` rows for pending teachers (see AC5).
   - One `audit_logs` row `class.spawned` per class (single-tx, uses `AuditService.LogWithinTx`).
   
   On ANY failure (validation, invite tx failure, audit failure) — **the whole tx rolls back — zero classes committed, zero invites sent**. Response shape:
   ```jsonc
   201 {
     "data": {
       "classes": [{
         "id": "<uuid>",
         "name": "<cohortName>",
         "startDate": "<YYYY-MM-DD>",
         "teacherId": "<uuid>" | null,                        // set for Branches A + B
         "teacherEmail": "<resolved-user-email>" | null,      // set for Branches A + B (from users.email); null for C + D
         "pendingTeacherEmail": "<invited-email>" | null,     // set for Branch C only (from payload); null otherwise
         "teacherStatus": "assigned" | "invited" | "unassigned",
         "teacherAssignmentReason": "explicit_self" | "explicit_member" | "founder_auto" | "invited" | "unassigned"
       }],
       "invites": [{
         "email": "<lowercased-invited-email>",
         "classIndices": [0, 2],                              // which classes[] indices this invite covers (payload-order)
         "enqueued": true | false,                            // return value of EmailRetryQueue.Enqueue for the winning goroutine; false for dedup-reused invites (no email attempt)
         "reusedExistingInvite": true | false,                // true when a pre-existing active invite was reused (dedup at DB); false when a new row was written
         "expiresAt": "<ISO-8601>"
       }],
       "invitesSent": 2                                       // count of NEWLY-CREATED invite rows (reusedExistingInvite=false && enqueued=true)
     },
     "meta": { "serverTime": "<ISO-8601>" }
   }
   ```
   
   **Field rules per Branch** (see AC4 for Branch definitions): Branch A → `teacherId = self.userID`, `teacherEmail = self.email` (from `users.email`, normalized to lowercase), `pendingTeacherEmail = null`, `teacherStatus = "assigned"`, `teacherAssignmentReason = "explicit_self"` OR `"founder_auto"` when AC6 kicked in. Branch B → `teacherId = <resolved user_id>`, `teacherEmail = <resolved user.email>`, `pendingTeacherEmail = null`, `teacherStatus = "assigned"`, `teacherAssignmentReason = "explicit_member"`. Branch C → `teacherId = null`, `teacherEmail = null` (privacy — do NOT leak "this email doesn't exist in our system"; the wizard reads `pendingTeacherEmail` instead), `pendingTeacherEmail = <normalized payload email>`, `teacherStatus = "invited"`, `teacherAssignmentReason = "invited"`. Branch D → all four teacher fields null, `teacherStatus = "unassigned"`, `teacherAssignmentReason = "unassigned"`.
   
   Validation: `classes.length` in `[1, 20]`; `cohortName` 1–120 runes; `startDate` valid ISO-8601 date, NOT in the past by more than 30 days (accept some drift for wizard use). Template not found or not accessible → `404 TEMPLATE_NOT_FOUND`. Rate limit exceeded → `429 RATE_LIMIT_EXCEEDED`. Missing `CenterID` → `403 CENTER_REQUIRED`.

4. **Teacher resolution — three branches with explicit ordering.** For each class's `teacherEmail`, resolve in this ORDER (each check short-circuits):
   - **Branch A: caller's own email.** Both sides normalized identically — `normalize(payload.teacherEmail) == normalize(caller.email)`, where `normalize(s) = strings.ToLower(strings.TrimSpace(mail.ParseAddress(s).Address))`. Compare BOTH SIDES via the same normalize function — do NOT rely on `users.email` being stored pre-normalized (Google OAuth stores as-typed; other paths may vary). Match → set `classes.teacher_id = caller.user_id`, `teacherStatus = "assigned"`, `teacherAssignmentReason = "explicit_self"` (or `"founder_auto"` if the branch was hit via AC6's null-fallback). No invite created. Identity is asserted via `caller.user_id` from `TenantContext`, NEVER by email lookup — this closes M-S1 identity-confusion (an attacker with a matching-normalized email cannot plant `teacher_id = <victim.user_id>`).
   - **Branch B: existing member of THIS center.** Look up user via normalized email (see Task 3.5 approach — normalize in service, reuse existing `GetUserByEmail`), then verify the user is a `center_members` row for `tc.CenterID`. Both conditions must hold. Set `classes.teacher_id = <resolved user_id>`, `teacherEmail = <resolved user.email>`, `teacherStatus = "assigned"`, `teacherAssignmentReason = "explicit_member"`. No invite created. **Branch B precedence over Branch C after prior invite acceptance:** if a prior invite to this email was accepted (`invites.accepted_at IS NOT NULL`), the accepting user is now a `center_members` row for this center — Branch B fires, NOT Branch C. Do NOT check the invites table first — the `center_members` lookup is the primary defense; the partial unique index (Task 2.5) is belt-and-suspenders. Amelia MUST implement the checks in the order (1) Branch A → (2) Branch B → (3) Branch C to satisfy this contract.
   - **Branch C: not a member of THIS center** (either user doesn't exist system-wide, OR exists but not a member here). Set `classes.teacher_id = NULL`, `pendingTeacherEmail = <normalized payload email>`. Create an `invites` row per unique email in this spawn (see AC5 dedup rule). `teacherStatus = "invited"`, `teacherAssignmentReason = "invited"`. Enqueue the invite email via `EmailRetryQueue` (best-effort — see Task 8.5). Cross-center teacher borrow: if email is a member of ANOTHER center but not this one, treat as Branch C (create a new invite). Filed follow-up `FU-2-2-B` for post-launch shared-teacher UX.
   - **Branch D: teacherEmail is null/empty/whitespace** — set `classes.teacher_id = NULL`, `pendingTeacherEmail = null`, `teacherStatus = "unassigned"`, `teacherAssignmentReason = "unassigned"`. No invite, no error. **Exception: Founder persona on `classes[0]`** — see AC6.
   
   A malformed non-empty email (`mail.ParseAddress` returns error) → `422 VALIDATION_ERROR` `code=INVALID_TEACHER_EMAIL` on that class's `teacherEmail` field, whole spawn rejected.

4b. **Self-invite defense (Sally-B4).** If teacher resolution would land Branch C for the caller's own email — i.e. the caller typed a differently-cased or -spaced version of their own email that failed the Branch A normalization equality but IS parseable to the same address — the server MUST reject with `422 VALIDATION_ERROR` `code=SELF_INVITE_BLOCKED`. This is a **belt-and-suspenders defense** against a Branch A normalization bug and against a UI regression where s05 (Solo Teacher first-class form) sends a subtly-different case of the owner's email. Implementation: after normalization at the top of Branch A's check, if `mail.ParseAddress(payload.teacherEmail).Address` case-insensitively equals `caller.email`'s parsed address AND Branch A did not match, that's a normalization drift — return SELF_INVITE_BLOCKED. In practice this branch never fires when Amelia normalizes symmetrically; the check exists so a future regression is CAUGHT at test time, not at prod-time-when-a-Solo-Teacher-gets-invited-to-her-own-class.

5. **Invite dedup + send.** Invite creation per (`center_id`, normalized email) is unique — if the same teacher email appears on multiple classes in ONE spawn payload, create ONE invite row and reference it from all those classes. Enforce via NEW `idx_invites_center_email_active` partial unique index on `invites(center_id, LOWER(email)) WHERE accepted_at IS NULL` (partial so re-invites AFTER a prior invite was accepted or expired still work). Invite record: `role = 'teacher'`, `expires_at = now() + 7 days` (mirrors `AdminInviteStaff`), `token_hash = sha256hex(rawToken)` where `rawToken` is produced by the existing `newPasswordResetToken()` helper (`internal/service/auth_reset.go:220`) — a **URL-safe base64 string (43 characters, `base64.RawURLEncoding`)** encoding 32 random bytes. Do NOT re-implement or change the encoding — reuse the helper verbatim so the accept-invite URL structure matches Story 1.6's expectations. Email is sent via `EmailRetryQueue` OUTSIDE the tx (Task 8.5 — enqueue after `tx.Commit`). If the enqueue returns `accepted=false` (buffered channel full), log warn and surface `enqueued=false` on the corresponding `data.invites[]` entry (per AC3 response shape) — the invite row is the durable record, the email is best-effort (owner can resend from Epic 7 UI). **DO NOT** email inside the tx — network I/O in a hot tx is a classic footgun (see also `service.MintAccessToken` outside-of-tx pattern from Story 2.1 Task 7.2 step 8).

6. **Founder auto-assign.** If `users.persona = 'founder'` AND `classes[0].teacherEmail` is null/empty/whitespace, the server MUST resolve `classes[0]` to Branch A (self-assign). This is a server-side enforcement of PRD FR-4's "Founder's first spawned class is auto-assigned to the founder" contract — the UI Story 2.3b is expected to pre-fill the field, but the API is the source of truth. If `classes[0].teacherEmail` IS explicitly set (to self OR someone else), respect it — Founder may want to hand off the first cohort. Non-Founder persona (Operator, Solo Teacher, null): NO auto-assign — Branch D applies as normal. Solo Teacher UI Story 2.3c only sends one class with teacherEmail = self email, so it lands in Branch A explicitly. Persona is read from `users.persona` at spawn time via one SELECT (NOT from JWT claims — JWT doesn't carry persona; add a single query at the top of `Spawn()`).

7. **RLS enforcement — three new resource families with FOR UPDATE + FOR DELETE explicit policies.** All three new tables get RLS enabled (`ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY`). Winston-W-B1 fix: every table ships **four** distinct policies (SELECT, INSERT, UPDATE, DELETE) — the `WITH CHECK` on UPDATE is load-bearing to prevent a hostile tenant reparenting rows via `UPDATE ... SET center_id = <other tenant>` or promoting to system-seed via `SET center_id = NULL`.

   - **`class_templates`** — dual-scope on read, tenant-scoped on write:
     - `class_templates_select FOR SELECT USING (center_id IS NULL OR center_id = <current_tenant>)`
     - `class_templates_insert FOR INSERT WITH CHECK (center_id = <current_tenant>)` — rejects user INSERT with `center_id = NULL` (system seeds are superuser-INSERTed via the seed migration's temporary `NO FORCE ROW LEVEL SECURITY` window — see Task 2.4).
     - `class_templates_update FOR UPDATE USING (center_id = <current_tenant>) WITH CHECK (center_id = <current_tenant>)` — tenant CANNOT update system seeds, tenant CANNOT reparent their own row to another tenant or to NULL.
     - `class_templates_delete FOR DELETE USING (center_id = <current_tenant>)` — tenant CANNOT delete system seeds.
   - **`template_sessions`** — denormalized `center_id` column (nullable, mirrors parent's tenancy). Same four-policy shape as `class_templates`. Keeping tenancy in sync with parent is enforced by a `BEFORE INSERT OR UPDATE OF template_id` trigger that copies `class_templates.center_id` into `template_sessions.center_id` at row-insert/reparent time (Task 2.2 details). Filed FU-2-2-A for a periodic drift audit.
   - **`classes`** — standard center-scoped, no dual-scope. Four policies with `USING (center_id = <current_tenant>)` and matching `WITH CHECK` on INSERT + UPDATE. Mirrors the four-policy shape (Winston-W-B1 fix ports back to `center_members` + `invites` + `audit_logs` in a filed follow-up FU-2-2-G — do NOT sweep-fix this story).

   **R1 discharge:** J15 six-pattern grid (from `_TEMPLATE_rls_test.go`) + 5 named extension tests MUST land for `class_templates`, `template_sessions`, `classes` BEFORE this story flips backlog → in-progress. See AC10 for the required test files (**23 tests total**, not 18 — per Murat-M-B1 + M-B2 extensions).

8. **Middleware chain.** All three endpoints sit behind: `ExtractTenant → RequireVerifiedEmail → RequireCenterContext (NEW) → onboardingLimit (20/min IP-keyed, reuse from 2-1) → handler`. `RequireCenterContext` is a NEW pure context-check middleware that rejects with `403 CENTER_REQUIRED` when `TenantContext.CenterID == ""` — the caller finished 2-1's persona pick but hasn't yet POSTed a center. Extracted here so Epic 3+ endpoints (class management, sessions) can compose it. Do NOT add `RequireRole` — Solo Teacher persona is a valid caller (they're a `role='owner'` member per Story 2.1's uniform-owner v1 decision — see [[feedback_pragmatic_interpretation_of_spec_absolutes]] applied at 2-1 Sally-B1 ruling).

9. **Audit trail.** For each class spawned successfully, write `audit_logs` row `{ action: 'class.spawned', center_id, user_id, entity_type: 'class', entity_id: <class_id>, changes: { before: null, after: { name, template_id, start_date, teacher_id } } }` **inside the spawn tx** via `AuditService.LogWithinTx` (reuse the Story 2.1 sibling — do NOT open a new tx). Custom template creation (AC2) also writes `{ action: 'class_template.created', entity_type: 'class_template', entity_id: <template_id>, ... }`. GET /api/templates does NOT audit (read-only). Invite row creation does NOT get a separate audit event this story — the invite table itself is the durable record; Epic 7's staff-invite management UI owns invite-lifecycle auditing.

10. **J15 grid coverage — three resource families + 5 named extension tests (Murat-M-B1 + M-B2). Total: 23 tests.** Naming: `internal/test/class_templates_rls_test.go` (8 tests), `template_sessions_rls_test.go` (9 tests), `classes_rls_test.go` (6 tests). Each file lands the six J15 patterns from `_TEMPLATE_rls_test.go`:
    - Pattern 1 CrossTenantRead: tenant A cannot SELECT tenant B's tenant-scoped rows.
    - Pattern 2 CrossTenantInsert: tenant A INSERT with `center_id = tenantB` rejected via WITH CHECK.
    - Pattern 3 CrossTenantWrite: tenant A UPDATE against tenant B's row → tenant B's row unchanged (post-verify by re-read). Note: `USING` clause excludes the row so 0 rows affected; that's correct — the WITH CHECK on UPDATE (AC7 fix) prevents the OTHER direction (tenant A trying to update their own row TO tenantB's scope).
    - Pattern 4 CrossTenantDelete: tenant A DELETE against tenant B's row → tenant B's row still exists.
    - Pattern 5 NullTenant: `SET LOCAL app.current_tenant_id = ''` → zero rows visible for TENANT-scoped rows (system seeds STILL visible for `class_templates` — that's the policy's `IS NULL` branch, and it's correct: unauthenticated reads of the system template catalog aren't a data leak). Assert explicitly with a comment referencing this AC line.
    - Pattern 6 UnsetTenant: `RESET app.current_tenant_id` → same behavior as Pattern 5 for symmetry.
    
    **Extension tests for `class_templates_rls_test.go` (2 named, on top of 6 patterns = 8 total):**
    - `TestRLS_ClassTemplate_SystemSeedsVisibleToAllTenants` — dual-scope positive path: tenant A SELECT; assert `count(*) FROM class_templates WHERE center_id IS NULL >= 5` (per AC1b seed set — Sally-S1 added the 5th).
    - `TestRLS_ClassTemplate_UserCannotInsertSystemScopeRow` — seed-write protection: `SET LOCAL app.current_tenant_id = tenantA; INSERT INTO class_templates (center_id, ...) VALUES (NULL, ...)`; expect ERROR (WITH CHECK violation on `class_templates_insert` policy). This is R1 discharge for "system seed catalog is unforgeable by users."
    
    **Extension tests for `template_sessions_rls_test.go` (3 named, on top of 6 patterns = 9 total):**
    - `TestRLS_TemplateSession_TriggerReconcilesToParentTenancy` — trigger positive path: `SET LOCAL tenantA; INSERT INTO template_sessions (template_id=<A's template>, center_id=NULL)`; assert post-insert row has `center_id = tenantA` (trigger rewrote it).
    - `TestRLS_TemplateSession_ParentTenantMismatchRejectedByWithCheck` — trigger + RLS interplay: `SET LOCAL tenantA; INSERT INTO template_sessions (template_id=<B's template>, center_id=tenantA)`; the BEFORE trigger rewrites `center_id` to `tenantB` (parent's tenancy), then the WITH CHECK re-evaluates and REJECTS (since `tenantB != current_tenant tenantA`). This is the load-bearing R1 discharge for the trigger-based tenancy sync — a regression that swaps BEFORE→AFTER trigger, or drops WITH CHECK, opens a cross-tenant plant vector via parent-template-ID confusion.
    - `TestRLS_TemplateSession_UserCannotPlantSessionUnderSystemSeed` — dual-scope negative: `SET LOCAL tenantA; INSERT INTO template_sessions (template_id=<system seed with center_id=NULL>, center_id=tenantA)`; trigger copies parent's `NULL` into row; WITH CHECK rejects because `NULL != tenantA`. R1 discharge for "user cannot plant sessions under system templates."
    
    **`classes_rls_test.go` stays at 6 patterns** — no dual-scope (no system-seeded classes), no trigger. Standard center-scoped tests only.

11. **Cross-user cross-center isolation — spawn payload attack matrix.** Handler integration test (`internal/handler/template_handler_test.go`), three `t.Run(...)` subtests mirroring Story 2.1's AC10 attack matrix:
    - **`attack_vector_body_center_override`** — Payload includes `{ "centerId": "<other tenant>" }` at the top level. **Behavior (per C2-10 amendment, 2026-07-05)**: server rejects the whole request with `422 VALIDATION_ERROR` via `json.Decoder.DisallowUnknownFields()` — strictly more secure than silent-ignore because the wire contract itself refuses smuggled fields, and SEC-7 no longer relies on defense-in-depth from the sqlc layer alone. Assert: response is 422 AND victim's `classes` table has zero new rows AND attacker's `classes` table has zero new rows (whole tx rolled back). This is a POSTURE CHANGE from the original spec text ("server MUST ignore body's centerId"); the amendment was accepted in Round 1 review (C2-10) and re-confirmed in Round 2 (R2-P18 documentation catchup).
    - **`attack_vector_body_template_id_from_other_tenant`** — Payload's URL path `/api/templates/{id}/spawn` uses a `class_templates.id` that exists but belongs to a DIFFERENT tenant (not system-seeded). Server MUST return `404 TEMPLATE_NOT_FOUND` (RLS makes the template invisible; the handler sees `pgx.ErrNoRows`). Verify: NO classes written, NO invites sent.
    - **`attack_vector_header_center_spoof`** — Payload sets `X-Center-ID: <other tenant>` header. Server MUST ignore.
    
    All three subtests exercise real HTTP round-trip through `test.NewTestServer(pool)` so middleware order is enforced.

12. **Response envelope consistency.** `{data, meta.serverTime}` on all 2xx; `{error: {code, message, requestId, details}}` on all error paths. Handler tests assert full envelope shape (mirrors Story 2.1's Task 11.3).

13. **Error code catalog (Sally-B3 + S7).** Every error response emitted by the three endpoints uses one of the codes below. The wizard's client-side error router (Story 2.3b) keys on these strings to select the right polished screen — same discipline Story 1.9d established for auth errors. `en.json` + `vi.json` must have translation keys for each `code`. No prose-only errors:

    | Endpoint | HTTP | Code | Wizard route / behavior |
    |---|---|---|---|
    | all 3 | 401 | `AUTH_REQUIRED` | → `/login` (drop wizard state, silent refresh already tried) — used when auth cookie is missing entirely |
    | all 3 | 401 | `AUTH_INVALID` | → `/login` (silent refresh path already exhausted) — used when auth cookie is present but token failed verification |
    | all 3 | 403 | `EMAIL_VERIFICATION_REQUIRED` | → `/verify-email` (Story 1.5's polished screen) |
    | all 3 | 403 | `CENTER_REQUIRED` | → `/setup/center` (Story 2.1 s01 — caller bypassed 2.1) |
    | all 3 | 403 | `INVALID_TENANT_CLAIM` | → `/login` (tenant claim on JWT no longer valid — force re-mint) |
    | all 3 | 429 | `RATE_LIMIT_EXCEEDED` | inline banner + countdown from `Retry-After` header; wizard stays on current step |
    | GET /api/templates | 500 | `SEED_INCOMPLETE` | full-screen error "Contact support"; no retry (retry cannot fix missing seed) |
    | POST /api/templates | 422 | `VALIDATION_ERROR` | inline field errors on the custom-template form |
    | POST /api/templates/{id}/spawn | 404 | `TEMPLATE_NOT_FOUND` | → template picker refresh; template may have been removed by another admin OR RLS-invisible |
    | POST /api/templates/{id}/spawn | 422 | `VALIDATION_ERROR` | inline field errors per-class (details.field references classes[N].fieldName) |
    | POST /api/templates/{id}/spawn | 422 | `INVALID_TEACHER_EMAIL` | field-level error on the teacherEmail input for the offending class index |
    | POST /api/templates/{id}/spawn | 422 | `SELF_INVITE_BLOCKED` | field-level error explaining "You cannot invite yourself" (Sally-B4 belt) |
    | POST /api/templates/{id}/spawn | 500 | `INTERNAL_ERROR` | toast with requestId; wizard's 2.3b MUST NOT auto-retry (v1 spawn is not idempotent per non-goals) |
    
    Additional codes MUST NOT be introduced without amending this table AND updating `en.json`/`vi.json` — the router treats any unlisted code as a generic 500. The wizard's error state machine consumes `error.details` for structured field-level surfacing (per Story 2.1 pattern).

## Tasks / Subtasks

- [x] **Task 0 — ATDD red phase (MANDATORY per WF-8, R1 J15 grid × 3 resource families)** (AC: #1–#12)
  - [x] 0.1 Run `/bmad-tea AT 2-2` after this story is `ready-for-dev` and BEFORE Amelia flips it `in-progress`. Expected output: red-phase specimens under `classlite-api/internal/handler/template_handler_atdd_test.go` (AC1/AC2/AC3/AC8/AC11 happy + negative), `classlite-api/internal/middleware/require_center_context_atdd_test.go` (AC8 middleware), `classlite-api/internal/test/class_templates_rls_test.go` + `template_sessions_rls_test.go` + `classes_rls_test.go` (AC10 J15 grid × 3 — copy from `_TEMPLATE_rls_test.go`), and `classlite-api/internal/service/class_test_TA.go` (AC4/AC5/AC6 branches).
  - [x] 0.2 Verify red specimens FAIL on the pre-implementation branch (they SHOULD — no handler / service / query code exists yet). Commit the red suite BEFORE any green code lands.

- [x] **Task 1 — API spec updates (WF-1 gate — edit only, no codegen here)** (AC: #1–#3, #8)
  - [x] 1.1 Add to `classlite-api/api.yaml`: `GET /api/templates`, `POST /api/templates`, `POST /api/templates/{id}/spawn` with full request/response schemas. Every 2xx response schema references the existing `EnvelopeMeta` component (do NOT re-declare). Error responses: `401`, `403` (`EMAIL_VERIFICATION_REQUIRED` OR `CENTER_REQUIRED`), `404 TEMPLATE_NOT_FOUND`, `422`, `429`, `500`. Enums: `primarySkill` (6 values from AC1b), `templateScope` (`"system" | "center"`), `teacherStatus` (`"assigned" | "invited" | "unassigned"`).
  - [x] 1.2 **No codegen here.** Codegen runs ONCE at Task 3.6 after both api.yaml AND `.sql` files land (per WF-3 "codegen must be the LAST script you run").

- [x] **Task 2 — Migrations** (AC: #1b, #7, #10)
  
  **Timestamp reservation (Amelia-A-B3):** Story 2.1 shipped `20260702120000..20260702120200`. Story 2.2's five pairs land at `20260703120000..20260703120400` — a full-day gap leaves room for concurrent Story 3.1 work landing at `20260704+`.
  
  - [x] 2.1 Create migration pair `20260703120000_create_class_templates.{up,down}.sql`. Schema: `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`, `center_id uuid REFERENCES centers(id) ON DELETE CASCADE` (nullable — NULL = system seed), `name text NOT NULL`, `target_band numeric(3,1) NOT NULL CHECK (target_band >= 1.0 AND target_band <= 9.0)`, `primary_skill text NOT NULL CHECK (primary_skill IN ('writing','speaking','listening','reading','listening_reading','all_skills'))`, `session_count integer NOT NULL CHECK (session_count BETWEEN 1 AND 100)`, `color text`, `created_at timestamptz NOT NULL DEFAULT now()`. Index: `CREATE INDEX idx_class_templates_center_id ON class_templates(center_id) WHERE center_id IS NOT NULL`. `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY`. Ship **four policies** per Winston-W-B1:
    ```sql
    CREATE POLICY class_templates_select FOR SELECT
      USING (center_id IS NULL OR center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
    CREATE POLICY class_templates_insert FOR INSERT
      WITH CHECK (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
    CREATE POLICY class_templates_update FOR UPDATE
      USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
      WITH CHECK (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
    CREATE POLICY class_templates_delete FOR DELETE
      USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
    ```
    The `class_templates_update` policy's USING is tenant-scoped (NOT dual-scope) — tenants CANNOT update system seeds; that's superuser-only by design. Similarly `_delete`. Task 10.1 asserts both directions.
  - [x] 2.2 Create migration pair `20260703120100_create_template_sessions.{up,down}.sql`. Schema: `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`, `template_id uuid NOT NULL REFERENCES class_templates(id) ON DELETE CASCADE`, `center_id uuid REFERENCES centers(id)` (nullable — mirrors parent's tenancy for RLS locality), `session_order integer NOT NULL`, `title text NOT NULL`, `description text`, `created_at timestamptz NOT NULL DEFAULT now()`. Index: `CREATE INDEX idx_template_sessions_template_id ON template_sessions(template_id)`. Add `BEFORE INSERT OR UPDATE OF template_id` trigger `sync_template_sessions_center_id` that copies `class_templates.center_id` into `template_sessions.center_id` (prevents application-layer drift + trigger's post-execute value is re-checked by WITH CHECK — see AC10 Murat-M-B1). Enable RLS + FOUR policies mirroring `class_templates` (same dual-scope on read, tenant-scoped on write). See FU-2-2-A for drift audit follow-up.
  - [x] 2.3 Create migration pair `20260703120200_create_classes.{up,down}.sql`. Schema: `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`, `center_id uuid NOT NULL REFERENCES centers(id) ON DELETE CASCADE`, `template_id uuid REFERENCES class_templates(id)` (nullable — future "build from scratch" path via Story 3.1 leaves it NULL), `name text NOT NULL`, `target_band numeric(3,1)`, `primary_skill text CHECK (primary_skill IN ('writing','speaking','listening','reading','listening_reading','all_skills'))`, `session_count integer`, `status text NOT NULL DEFAULT 'upcoming' CHECK (status IN ('upcoming','active','paused','ended'))`, `teacher_id uuid REFERENCES users(id)` (nullable — pending invite), `pending_teacher_email text` (nullable — surface the invited email so Epic 7's staff UI can match on acceptance), `start_date date`, `created_at timestamptz NOT NULL DEFAULT now()`. **Winston-W-S3 CHECK constraint**: `CONSTRAINT classes_teacher_mutex CHECK (teacher_id IS NULL OR pending_teacher_email IS NULL)` — the two fields are mutually exclusive; prevents Epic 7 from leaving `pending_teacher_email` populated after flipping `teacher_id` (belt against reconciliation drift). Indexes: `idx_classes_center_id`, `idx_classes_teacher_id WHERE teacher_id IS NOT NULL`, `idx_classes_pending_email WHERE pending_teacher_email IS NOT NULL`. Enable RLS + FOUR policies (standard center-scoped, no dual-scope) per Winston-W-B1 shape.
  - [x] 2.4 Create migration pair `20260703120300_seed_class_templates.{up,down}.sql`. Insert the **5 fixed-UUID rows** from AC1b using plain `INSERT` — NO `SESSION AUTHORIZATION` gymnastics (Amelia-A-B2 + Winston-W-B2 fixes). The migration runs as the DB owner/superuser which bypasses RLS by default; defensive posture below uses the temporary `NO FORCE ROW LEVEL SECURITY` window in case the migrator role is ever swapped to NOSUPERUSER:
    ```sql
    ALTER TABLE class_templates NO FORCE ROW LEVEL SECURITY;
    ALTER TABLE template_sessions NO FORCE ROW LEVEL SECURITY;
    INSERT INTO class_templates (id, center_id, name, target_band, primary_skill, session_count, color) VALUES
      ('11111111-2222-3333-4444-555555555501', NULL, 'Writing Bootcamp 6.5',            6.5, 'writing',           12, '#f59e0b'),
      ('11111111-2222-3333-4444-555555555502', NULL, 'Speaking Mastery 7+',             7.0, 'speaking',          12, '#3b82f6'),
      ('11111111-2222-3333-4444-555555555503', NULL, 'Foundation Listening + Reading',  5.5, 'listening_reading', 10, '#10b981'),
      ('11111111-2222-3333-4444-555555555504', NULL, 'Starter Band 5.5 All Skills',     5.5, 'all_skills',         8, '#8b5cf6'),
      ('11111111-2222-3333-4444-555555555505', NULL, 'Academic Reading 6.5',            6.5, 'reading',           10, '#14b8a6')
    ON CONFLICT (id) DO NOTHING;  -- Winston-W-B2: idempotent re-run safety
    -- template_sessions inserts follow, using pre-generated UUIDs so `ON CONFLICT` on session_order-scoped UUIDs works cleanly
    ALTER TABLE class_templates FORCE ROW LEVEL SECURITY;
    ALTER TABLE template_sessions FORCE ROW LEVEL SECURITY;
    ```
    Seed session distribution:
    - **Writing Bootcamp 6.5** (12 total; seed 4): "Task 1 structure", "Task 2 argument essays", "Coherence & cohesion drills", "Full mock test".
    - **Speaking Mastery 7+** (12 total; seed 4): "Part 1 warm-ups", "Part 2 cue card fluency", "Part 3 abstract answers", "Full mock speaking".
    - **Foundation Listening + Reading** (10 total; seed 3): "Listening section walkthrough", "Reading skimming + scanning", "Multi-section timing drill".
    - **Starter Band 5.5 All Skills** (8 total; seed 3): "Diagnostic + goal setting", "Grammar refresh", "Vocabulary sprint".
    - **Academic Reading 6.5** (10 total; seed 3): "Skimming for main ideas", "T/F/NG identification drills", "Full-passage timed practice".
    - Seeded session count is LESS than the template's `session_count` field — intentional starter kit. Filed FU-2-2-D for full syllabus.
    - Down migration: `DELETE FROM class_templates WHERE id IN ('...550{1..5}')` — cascades to template_sessions via FK. User-added templates untouched.
  - [x] 2.5 Create migration pair `20260703120400_add_invites_center_email_unique.{up,down}.sql`. Adds `CREATE UNIQUE INDEX idx_invites_center_email_active ON invites(center_id, LOWER(email)) WHERE accepted_at IS NULL` (Amelia-A-S4: index name unified — no `_unique` suffix, matching Story 2.1's `idx_center_members_user_id` shape). Pre-flight audit comment block (same shape as Story 2.1 Task 2.3):
    ```sql
    -- Pre-flight audit — run before applying:
    --   SELECT center_id, LOWER(email), COUNT(*) FROM invites
    --   WHERE accepted_at IS NULL GROUP BY 1, 2 HAVING COUNT(*) > 1;
    -- Non-empty result = duplicate active invites. Resolve manually (usually
    -- test fixtures from Story 1.6). NEVER swallow via ON CONFLICT DO NOTHING.
    ```
  - [x] 2.6 Run `scripts/migrate.sh` locally. Verify all five migration pairs (2.1–2.5) apply cleanly AND roll back cleanly (`migrate down` then `migrate up` round-trip). Confirm: the 5 seed rows land + the 17 seed session rows land + trigger fires on INSERT INTO template_sessions + `classes_teacher_mutex` CHECK rejects a row with both `teacher_id` and `pending_teacher_email` set. Also verify cascade (Murat-M-S5): INSERT a fresh center + tenant-owned class_template + template_sessions row + DELETE FROM centers → confirm zero rows remain in class_templates AND template_sessions for that center (two-hop cascade via `template_id`).

- [x] **Task 3 — sqlc queries** (AC: #1–#3)
  - [x] 3.1 Create `internal/store/queries/class_templates.sql`. Queries: `ListAccessibleTemplates :many` (`SELECT ... FROM class_templates ORDER BY (center_id IS NOT NULL) ASC, created_at ASC` — system templates first, then center's own by insertion order); `GetTemplateByID :one` (RLS handles scope — a template invisible to caller returns `pgx.ErrNoRows`); `CreateCustomTemplate :one` (INSERT with `center_id = $1` and full row RETURNING); `CreateTemplateSession :one` (INSERT into template_sessions returning full row).
  - [x] 3.2 Create `internal/store/queries/classes.sql`. Queries: `CreateClass :one` (INSERT with all fields RETURNING); `GetClassByID :one` (RLS-scoped — needed for handler tests + Story 3.1's read path but shipping now to avoid a second sql file edit next story). No mutation queries yet — Story 3.1 owns the class lifecycle.
  - [x] 3.3 Extend `internal/store/queries/invites.sql` with `CreateInviteFull :one` — takes id, center_id, inviter_id, email, name (nullable), role, token_hash, expires_at; returns full row. Existing `CreateInvite` used by tests + AdminInviteStaff stays untouched (its call sites shipped in Story 1.5 red suite and don't need the new columns).
  - [x] 3.4 Extend `internal/store/queries/invites.sql` with `GetActiveInviteByEmail :one` — `SELECT ... WHERE center_id = $1 AND LOWER(email) = LOWER($2) AND accepted_at IS NULL AND expires_at > $3` (returns existing active invite for dedup logic in Task 7.4 — if AC5's spawn payload has duplicate emails, second occurrence reuses this row).
  - [x] 3.5 **No new user query needed (Amelia-A-B1).** `internal/store/queries/users.sql:6-9` already ships `GetUserByEmail :one` (case-sensitive `WHERE email = $1`) — every existing call site (`auth_login.go:163`, `auth_google.go:410`, `auth.go:498`, `auth_invite.go:81`, `auth_reset.go:45`) pre-normalizes via `strings.ToLower(strings.TrimSpace(...))` at the service layer, and this story continues that convention. Task 7.2 step 4 (Branch B teacher resolution) normalizes the payload email in service code and calls the existing `GetUserByEmail`. **Do NOT add** `GetUserByEmailCI` — a `LOWER(email) = LOWER($1)` query without a functional index (`idx_users_email_lower`) causes a seq scan on every call. Cite `[[feedback_check_prior_story_artifacts_before_generating]]`.
  - [x] 3.6 **Run `scripts/codegen.sh` ONCE** — sqlc + openapi-typescript. Confirm: `class_templates.sql.go`, `classes.sql.go` created; `invites.sql.go` has new `CreateInviteFull` + `GetActiveInviteByEmail`; TS client has the 3 new operations + updated Zod schemas.

- [x] **Task 4 — Middleware: `RequireCenterContext`** (AC: #8)
  - [x] 4.1 Create `internal/middleware/require_center_context.go`. Pure context-check middleware — mirror `RequireVerifiedEmail`'s shape exactly. Rejects with `403 CENTER_REQUIRED` when `tc.CenterID == ""`. NEVER queries the DB — the tenant context is already populated by `ExtractTenant`.
  - [x] 4.2 Add ATDD unit test `require_center_context_atdd_test.go` (three cases: has-center passes, missing-center 403s, missing-context 500s per Story 2.1 P5 handler-posture pattern).

- [x] **Task 5 — Model: request/response DTOs** (AC: #1–#3)
  - [x] 5.1 Create `internal/model/template.go`. Structs: `CreateTemplateInput` (name, targetBand, primarySkill, sessionCount, color, sessions); `TemplateSessionInput` (title, description); `SpawnInput` (classes: []SpawnClassInput); `SpawnClassInput` (cohortName, startDate, teacherEmail); `SpawnResult` (classes: []SpawnedClass, invitesSent int); `SpawnedClass` (id, name, startDate, teacherID *uuid.UUID, teacherEmail, teacherStatus string). Use `*string` / `*float64` on nullable fields (GO-5 no-omitempty applies at DTO layer, not model layer).
  - [x] 5.2 Add `PrimarySkill` type with constant declarations for the 6 enum values + `IsValidPrimarySkill(s string) bool` validator. Called from `validateCreateTemplateInput` (Task 6.4).

- [x] **Task 6 — Service: `TemplateService`** (AC: #1, #2)
  - [x] 6.1 Create `internal/service/template.go`. Struct `TemplateService` with:
    ```go
    type TemplateService struct {
        db AuthDB  // reuse Story 2.1's seam (Dev Notes §Architectural Debt Acknowledged)
        clk clock.Clock
    }
    func NewTemplateService(db AuthDB, clk clock.Clock) *TemplateService
    ```
    Methods: `ListAccessibleTemplates(ctx, tc) ([]Template, error)`, `CreateCustomTemplate(ctx, tc, input) (*Template, error)`, `GetTemplateByID(ctx, tc, id) (*Template, error)`.
  - [x] 6.2 `CreateCustomTemplate` runs in a tx: BEGIN → SET LOCAL tenant → INSERT class_templates RETURNING id → INSERT each template_sessions row (`session_order` = index in input array, 0-indexed) → LogWithinTx `class_template.created` → COMMIT.
  - [x] 6.3 All methods propagate incoming ctx (GO-4).
  - [x] 6.4 `validateCreateTemplateInput`: trim name (rune-count check via `utf8.RuneCountInString` — reuse Story 2.1's post-review fix), target_band range, session_count range, `len(sessions) == sessionCount` (AC2's single-source-of-truth), primarySkill enum validate, each session title 1–200 runes. Returns `model.ValidationError` with detailed field errors — same shape as Story 2.1's `validateCreateCenterInput`.

- [x] **Task 7 — Service: `ClassService`** (AC: #3, #4, #5, #6, #9)
  - [x] 7.1 Create `internal/service/class.go`. Struct `ClassService` accepts **interfaces at constructor** (mirrors CenterService's audit + tokenIssuer seams):
    ```go
    type AuditLogger interface {
        LogWithinTx(ctx context.Context, tx pgx.Tx, tc model.TenantContext,
                    action, entityType string, entityID uuid.UUID, changes any) error
    }
    type InviteSender interface {
        Enqueue(job EmailJob) (accepted bool)  // matches service.EmailRetryQueue signature
    }
    type ClassService struct {
        db      AuthDB
        clk     clock.Clock
        audit   AuditLogger
        inviter InviteSender  // service.EmailRetryQueue in production
    }
    ```
    Production wires `service.AuditService` + `service.EmailRetryQueue`. Tests inject `brokenAuditLogger` + `MockInviteSender`. Method: `Spawn(ctx, tc, userID uuid.UUID, templateID uuid.UUID, input SpawnInput) (*SpawnResult, error)`.
  - [x] 7.2 **Spawn transaction flow** (AC3 + AC4 + AC5 + AC6 + AC9). Winston-W-S5 promoted: template read moves INSIDE the tx after SET LOCAL — otherwise the caller's own custom template returns `pgx.ErrNoRows` (RLS invisibility under empty `app.current_tenant_id`) and step maps to 404 TEMPLATE_NOT_FOUND on a template they own:
    1. Pre-tx: `svc.readCallerPersonaAndEmail(ctx, userID)` → 1 query on `users.persona, users.email` (users has no RLS, pool-connection read is safe). Amelia-A-S3 impl-choice: `GetUserPersonaAndEmail :one` combines both fields; saves a round-trip and keeps "which query returned what" clear. Cache as local var. `caller.email` is already normalized enough here — the Branch A comparison in step 4 normalizes both sides symmetrically.
    2. Pre-tx: validate input (`validateSpawnInput`) — classes.length 1–20, each cohortName 1–120 runes (rune-count via `utf8.RuneCountInString`), each teacherEmail either empty or `mail.ParseAddress`-valid, each startDate parseable via `time.Parse("2006-01-02", ...)`, startDate not more than 30 days in past.
    3. Pre-tx: **resolve teachers per class** in a single pass — using pool for `GetUserByEmail` + `center_members` lookups (`users` has no RLS; `center_members` reads under SET LOCAL come later inside the tx if needed. Amelia's call — either read here with an explicit query that ignores RLS via inline `SET LOCAL`, or defer center_members membership check to step 6 inside the tx. Recommendation: defer to inside-tx; keep pre-tx to `users` lookup only). For each class's teacherEmail (post-normalize per AC4):
       - **Founder auto-assign** (AC6): if teacherEmail is empty/whitespace AND `persona="founder"` AND `classIndex==0` → treat as if payload had `teacherEmail = caller.email`. Mark `teacherAssignmentReason = "founder_auto"` (drives AC3 response field). Fall through to Branch A logic below.
       - Empty/whitespace after founder-auto → Branch D (unassigned, `teacherAssignmentReason = "unassigned"`).
       - `normalize(payload.teacherEmail) == normalize(caller.email)` → Branch A. `teacher_id = tc.UserID` (identity by UserID from TenantContext, NEVER by email lookup — closes Murat-M-S1). `teacherAssignmentReason = "explicit_self"` (or `"founder_auto"` if AC6 kicked in).
       - Else: SELF_INVITE_BLOCKED check (Sally-B4). If `mail.ParseAddress(payload).Address` case-insensitively equals `mail.ParseAddress(caller.email).Address` but Branch A did NOT match, that's a normalization drift — return `422 SELF_INVITE_BLOCKED`. Should never fire in practice; exists as a belt.
       - Else: `GetUserByEmail(ctx, normalize(payload))` (existing case-sensitive query, but we already normalized the input to lowercase — services store users.email as-typed but Google OAuth path lowercases at signup per `auth_google.go:396`; if a mismatch turns up, add the functional index in a follow-up story rather than patching here). Two paths from the result:
         - User exists AND is `center_members(user_id=<found>, center_id=tc.CenterID)` (checked inside tx at step 5 for RLS scoping — see step 5 substep) → Branch B, `teacher_id = <found>.id`, `teacherAssignmentReason = "explicit_member"`.
         - User does not exist OR user exists but is NOT a member of THIS center → Branch C. Push to `inviteBucket[normalize(payload)]`.
       - Assemble `map[string]inviteBucket` keyed on lowercased email for Branch C dedup (AC5). One bucket per unique email; each bucket tracks `classIndices []int` it applies to.
    4. `BEGIN`.
    5. `SET LOCAL app.current_tenant_id` = tc.CenterID (via `store.SetTenantContext` — reuse Story 2.1 pattern, `fmt.Sprintf` shape acceptable per Amelia-A-S1; center_id is JWT-validated UUID).
       - **Substep**: NOW inside the tx, run `svc.readTemplate(ctx, tx, templateID)` — RLS-scoped read. If `pgx.ErrNoRows` → map to `model.NotFoundError{Resource: "class_template"}` → handler returns `404 TEMPLATE_NOT_FOUND`. Copy target_band/primary_skill/session_count from result.
       - **Substep**: for each Branch B candidate resolved in step 3, run the `center_members` membership check inside the tx (RLS ensures cross-tenant invisibility). If the membership check fails, downgrade that class's resolution to Branch C (push to `inviteBucket`). This is the Murat-M-B3 discipline — Branch B is checked BEFORE Branch C fallback.
    6. For each Branch C bucket (unique email):
       - Generate raw token via `newPasswordResetToken()` — produces `base64.RawURLEncoding` 43-char string per Amelia-A-B4 fix. Hash via `hashInviteTokenHex(rawToken)` (`internal/service/auth_google.go:649`).
       - INSERT via `CreateInviteFull` (from Task 3.3). On unique-violation matching constraint `idx_invites_center_email_active` (per `pgconn.PgError.ConstraintName`): race — another concurrent spawn just landed the same invite. Retry-and-reuse: SELECT existing active invite via `GetActiveInviteByEmail` and use its id + skip email send (`wasNewlyCreated = false`). Log at info level. Do NOT retry more than once per email — a second unique-violation on the reused-id path is a real bug, propagate.
       - Stash `(bucket.email, invite.id, rawToken, wasNewlyCreated, classIndices)` for the post-commit email enqueue.
    7. For each class:
       - Pre-generate `classID := model.NewID()` (reuse Story 2.1 helper — same tx-first pattern).
       - Determine `teacher_id` (nil OR resolved user) + `pending_teacher_email` (nil for Branches A/B/D; email string for Branch C). The `classes_teacher_mutex` CHECK constraint (Task 2.3) enforces mutual exclusion — a bug that sets both fails at INSERT time (fast failure).
       - INSERT via `CreateClass` with name = cohortName, template_id, center_id from tc, target_band + primary_skill + session_count from template, teacher_id, pending_teacher_email, start_date, status = "upcoming".
       - `audit.LogWithinTx(ctx, tx, tc, "class.spawned", "class", classID, model.Changes{Before: nil, After: {name, templateID, startDate, teacherID}})`.
    8. `COMMIT`.
    9. **AFTER commit** — for each `wasNewlyCreated == true` bucket, enqueue invite email via `svc.inviter.Enqueue(EmailJob{To: bucket.email, Subject, HTML})`. Capture the `accepted bool` return value per bucket. Enqueue failure (accepted=false) is best-effort (log warn, don't propagate); surface `enqueued=false` on the corresponding `data.invites[]` response entry.
    10. Return `SpawnResult` populated with per-class `teacherStatus` + `teacherAssignmentReason` + `pendingTeacherEmail` AND top-level `invites[]` array with `{email, classIndices, enqueued, reusedExistingInvite, expiresAt}` per bucket + `invitesSent = count(newly-created && enqueued)`.
  - [x] 7.3 Rollback: `defer tx.Rollback(context.WithoutCancel(ctx))` — same pattern as CenterService.
  - [x] 7.4 Invite dedup semantics: if a class's teacherEmail exactly matches another class's teacherEmail in this same spawn payload, both classes reference the SAME invite. The `teacherStatus` on both classes is `"invited"`. `invitesSent` in the response = count of UNIQUE Branch C buckets. Race with pre-existing active invite (from prior spawn) → dedup at DB via the unique index; response's `invitesSent` counts only newly-created.

- [x] **Task 8 — Handlers: `TemplateHandler`** (AC: #1, #2, #3, #8, #12)
  - [x] 8.1 Create `internal/handler/template_handler.go`. Constructor: `NewTemplateHandler(templateSvc *TemplateService, classSvc *ClassService, clk clock.Clock)`. Three methods: `List`, `Create`, `Spawn`.
  - [x] 8.2 `List` — extracts tc from context, calls `templateSvc.ListAccessibleTemplates`, writes envelope. If result length < 4, log error + return 500 INTERNAL_ERROR (seed migration incomplete per AC1).
  - [x] 8.3 `Create` — 16 KiB body cap (mirror onboarding_handler.go). Malformed JSON → `model.ValidationError`. Payload → `model.CreateTemplateInput`. Calls `templateSvc.CreateCustomTemplate`. Success → `WriteEnvelope(w, 201, clk, ...)`.
  - [x] 8.4 `Spawn` — extract `templateID` from path `/api/templates/{id}/spawn` via `r.PathValue("id")` (Go 1.22+ ServeMux). Parse to UUID; invalid → `422 VALIDATION_ERROR`. 32 KiB body cap (larger — up to 20 classes × ~1.5 KiB each). Calls `classSvc.Spawn`. Success → `WriteEnvelope(w, 201, clk, ...)`. Pass `userID` from tc.
  - [x] 8.5 **Invite email enqueue pattern.** Keep it inside the service — `ClassService.Spawn` calls `svc.inviter.Enqueue` for each pending email AFTER `tx.Commit`. Reuse the shipped `service.EmailRetryQueue` from Story 1.4 (already wired in `cmd/api/main.go:72`) — the retry queue handles Resend flakiness with 30s/2m/8m/30m backoff. Signature is `Enqueue(job EmailJob) (accepted bool)` — if the buffered channel is full, `accepted=false`. Log warn on `accepted==false` and continue — the invite row is the durable state, owner can resend from Epic 7's UI. **Never call `emailSender.Send` inline** — synchronous email in a handler request path is a 30-second-timeout waiting to happen.
  - [x] 8.6 All handlers are methods on typed structs (GFW-1). All response payloads use camelCase, explicit null pointers (no `omitempty`).

- [x] **Task 9 — Wire the routes in `cmd/api/main.go`** (AC: #8)
  - [x] 9.1 Instantiate services: `templateSvc := service.NewTemplateService(pool, clock.RealClock{})`; `classSvc := service.NewClassService(pool, auditSvc, retryQ, clock.RealClock{})`. `auditSvc` and `retryQ` are already instantiated for Story 2.1 / Story 1.4 respectively.
  - [x] 9.2 Instantiate handler: `templateHandler := handler.NewTemplateHandler(templateSvc, classSvc, clock.RealClock{})`.
  - [x] 9.3 Instantiate new middleware: `requireCenter := middleware.RequireCenterContext()`. Reuse `onboardingLimit` (20/min IP) from Story 2.1.
  - [x] 9.4 Wire routes via a `templateChain` composition helper. **Winston-W-B3 order fix**: `onboardingLimit` moves BEFORE `RequireVerifiedEmail` (closes the center-less-flood attack where a valid-JWT verified-user with no center could hit any endpoint at 10k rps without ever consuming a rate-limit bucket, because DB-free middleware rejected them cheaply):
    ```go
    templateChain := func(h middleware.HandlerWithError) http.Handler {
        return extractTenant(
            onboardingLimit(                                    // rate limit FIRST (Winston-W-B3)
                requireVerified(
                    requireCenter(
                        http.HandlerFunc(middleware.ErrorMapper(h)),
                    ),
                ),
            ),
        )
    }
    mux.Handle("GET /api/templates",             templateChain(templateHandler.List))
    mux.Handle("POST /api/templates",            templateChain(templateHandler.Create))
    mux.Handle("POST /api/templates/{id}/spawn", templateChain(templateHandler.Spawn))
    ```
    Discipline notes:
    - **Rate limit before verification** trades a small legitimate-user-with-unverified-email inconvenience for closing the flood attack surface. Legit unverified users were already consuming DB queries for verification lookups, so bucket cost is similar.
    - **Verification order** relative to CENTER_REQUIRED unchanged: verified-but-center-less → `CENTER_REQUIRED`, unverified (regardless of center) → `EMAIL_VERIFICATION_REQUIRED`. The 403 taxonomy per AC13 stays correct.
    - **Spawn-specific rate limit** (Winston-W-S4 amendment): the spawn endpoint amplifies to 20 classes × 20 invite emails per request. Ship a per-endpoint override BEFORE the shared `onboardingLimit`:
      ```go
      spawnLimit := middleware.RateLimitByKey("spawn", rate.Every(60*time.Second), 5, middleware.IPKeyFn)
      mux.Handle("POST /api/templates/{id}/spawn",
          extractTenant(spawnLimit(onboardingLimit(requireVerified(requireCenter(...))))))
      ```
      5/min × 20 classes = 100 classes/min max per IP, tight enough to bound Resend spend under a runaway wizard loop.

- [x] **Task 10 — R1 discharge: J15 grid × 3 resource families** (AC: #7, #10)
  - [x] 10.1 `internal/test/class_templates_rls_test.go` — copy `_TEMPLATE_rls_test.go`, find-replace per instructions at file top (Resource=ClassTemplate, resource=class_template, resources=class_templates). Six patterns land. Pattern 1 gets an EXTRA positive-case assertion: tenant A CAN see `center_id IS NULL` seed rows (dual-scope policy positive path — mandatory per AC10). Pattern 2 gets an EXTRA negative-case: tenant A INSERT with `center_id = NULL` fails WITH CHECK.
  - [x] 10.2 `internal/test/template_sessions_rls_test.go` — same six patterns. Also assert BEFORE INSERT trigger fires: inserting a row with `center_id = NULL` where parent template has `center_id = tenantA` gets rewritten to `tenantA` post-insert (t.Log the check).
  - [x] 10.3 `internal/test/classes_rls_test.go` — same six patterns. Classes have no dual-scope (no system-seeded classes exist). Standard center-scoped RLS mirroring `center_members`.
  - [x] 10.4 Story 2.1's `TestCenters_SlugCollisionRegeneration` under SetupRawPool is the reference pattern if any goroutine-concurrent test is needed here (none required for 2.2 — invite dedup racing is handled by the DB unique index + retry-and-reuse pattern in Task 7.2 step 7).

- [x] **Task 11 — Handler tests (integration, real middleware)** (AC: #1–#12)
  - [x] 11.1 `template_handler_atdd_test.go` — happy paths for each endpoint (list system-only, list system + own, create custom, spawn 3 classes with mixed teacher branches). Assert full `{data, meta.serverTime}` envelope.
  - [x] 11.2 `template_handler_atdd_test.go` (continued) — negative paths: 401 unauthenticated, 403 unverified, 403 no center context, 404 template from another tenant (AC11 subtest B), 422 validation errors (empty classes list, session_count/sessions.length mismatch, malformed teacherEmail), 429 rate limit, 500 seed missing (skip if hard to reproduce in CI — cover in unit test on the service).
  - [x] 11.3 `template_handler_atdd_test.go` (continued) — AC11 three-vector attack matrix as three `t.Run(...)` subtests: body_center_override, body_template_id_from_other_tenant, header_center_spoof. Real HTTP round-trip.
  - [x] 11.4 `template_handler_atdd_test.go` (continued) — AC6 Founder auto-assign: user with `persona='founder'` spawns with `classes[0].teacherEmail=null`, assert `teacher_id == userID` on class[0]. Non-founder with same payload → `teacher_id IS NULL`, status="unassigned".
  - [x] 11.5 `template_handler_atdd_test.go` (continued) — AC9 audit atomicity: `brokenAuditLogger` injected via test-only constructor; spawn fails; verify: zero `classes` rows, zero `invites` rows. Mirrors Story 2.1's Task 11.2 AC6 audit rollback.
  - [x] 11.6 Extend `internal/test/story_2_2_helpers.go` (sibling to Story 2.1's helpers). Add: `CreateClassTemplate(t, db, centerID, name, ...)` fixture, `CreateSystemTemplate(t, db, ...)` (uses `SESSION AUTHORIZATION classlite` for RLS bypass), `SpawnTestSuiteInput(...)` payload builder, `CountClasses(t, db, centerID)`, `CountActiveInvites(t, db, centerID)`, `MockInviteSender` recording each `Enqueue` call for assertions.

- [x] **Task 12 — Service tests** (AC: #1–#7)
  - [x] 12.1 `internal/service/template_test.go` — `validateCreateTemplateInput` matrix (empty name, name > 120 runes, target_band 0.5, target_band 10.0, session_count 0, session_count 101, sessions/sessionCount mismatch, invalid primarySkill, session title > 200 runes). Positive round-trip using `SetupDB` (AuthDB-reuse debt from Story 2.1 §Dev Notes stays consistent).
  - [x] 12.2 `internal/service/class_test.go` — teacher resolution unit matrix (Branch A/B/C/D scenarios), Founder auto-assign matrix (persona=founder vs non-founder × classes[0]=empty vs set), invite dedup (same email on 2 of 3 classes → 1 invite row), invite race retry-and-reuse (pre-insert an active invite for the target email in the fixture, verify spawn reuses it), audit atomicity (broken logger rolls back all N classes). **Murat-M-B3 test**: `TestClassService_Spawn_PostAcceptReInviteLandsInBranchB` — pre-seed an accepted invite (`accepted_at=NOW()`) + `center_members` row for the target email → spawn a class with that teacherEmail → assert `teacher_id = <bob's user_id>`, `teacherStatus="assigned"`, `teacherAssignmentReason="explicit_member"`, `invitesSent=0`, zero new invite rows written. Locks the Branch B > Branch C precedence contract. **Murat-M-S3 test**: `TestClassService_Spawn_InviteEnqueueBufferFullSucceedsBestEffort` — inject `BrokenInviteSender{returnsAccepted: false}` (Task 11.6 helper) → spawn → assert 201 response, N classes committed, N invite rows committed, response body `invites[i].enqueued == false` for each, `invitesSent == 0` (count of newly-created && enqueued), slog warn line "invite email enqueue rejected" with `to=<email>` but NOT containing the raw token. No rollback — the invite ROW is durable state, email is best-effort per Reframe 3.

## Dev Notes

### ATDD Artifacts (red-phase pre-loaded by `/bmad-tea AT 2-2`)

**Checklist:** `_bmad-output/test-artifacts/atdd-checklist-2-2-class-template-and-spawning-api.md` — full test strategy, AC-to-file mapping, RED verification transcript, and green-phase task ordering. Owner: Murat's AT run.

**Green-phase order (Amelia):** Task 4 (middleware) → Task 5 (DTOs) → Task 3.1–3.6 (queries) → Task 6 (TemplateService) → Task 7 (ClassService) → Task 8 (handlers) → Task 9 (wiring). Each `//go:build atdd_red_phase` tag is removed file-by-file once all tests in that file pass. Task 10 (J15 grids) become green as the service/query layer lands.

### Story context and epic position

Story 2.2 is the second backend story of Epic 2. Story 2.1 shipped centers + onboarding persistence + `RequireVerifiedEmail`. Story 2.2 turns a fresh Owner (from 2.1) into a teaching workspace by shipping class templates, custom templates, and multi-class spawning with staff invites.

**Downstream dependencies on this story:**
- **2.3b** (UI — template selection + class spawn) consumes ALL THREE endpoints directly. Ship `api.yaml` diff to whoever picks up 2.3b.
- **2.6** (roles + permissions) will migrate `center_members.role` from `text` to an enum. This story hardcodes `role='teacher'` string on invite rows (mirror of Story 2.1's uniform-owner writes). See FU-2-1-B (already filed).
- **3.1** (class CRUD + lifecycle) inherits the `classes` schema shipped here. Do NOT reshape the schema in 3.1 — extend, don't rewrite.
- **7.1** (staff management + invitation UI) inherits the `invites` unique index shipped here (Task 2.5) and takes over the "resend / revoke / list invites" surfaces.

### Backend reality reframes (pinned inline for the dev agent)

**Reframe 1 — Templates are dual-scope, not tenant-scoped.** The Epic AC says "at least 4 pre-built IELTS templates are returned" and separately "a new template is created in the class_templates table." These are the same table with a nullable `center_id` — NULL means system seed. Rejected alternative: two separate tables (`system_class_templates` + `class_templates`) — adds a UNION query to `List` and doubles the schema. The dual-scope `center_id IS NULL` policy is the idiomatic Postgres RLS pattern for exactly this. Amelia — if the dual-scope RLS policy trips a `pg_hint_plan`/EXPLAIN warning at scale (unlikely at v1 volume), fall back to `UNION ALL` in the query — the policy remains correct.

**Reframe 2 — Spawn is atomic all-or-nothing.** The Epic AC says "N classes are created" without a partial-success clause. This is safer than R18-style partial success (which Story 2.7 owns for CSV import) — a spawn failure at class 4 of 5 leaves the wizard in a confusing "some classes exist, some don't" state that the UI is not prepared to handle. Trade-off: a network glitch at class 20 rolls back the 19 prior class INSERTs (small — the whole spawn is ≤200ms). Filed FU-2-2-C for post-launch reconsideration if operators report frequent partial-spawn frustration.

**Reframe 3 — Invite email is out-of-tx best-effort.** The invite ROW is the durable contract (the row + token_hash IS the accept path). The email is a delivery affordance — if Resend is down, the invite still exists and Epic 7's UI will let the owner resend. `EmailRetryQueue` (Story 1.4) already handles Resend flakiness. **DO NOT** hold a tx open across a network round-trip to Resend — that's the classic footgun that Story 1.4's retry-queue extraction closed once already. Reuse the queue.

**Reframe 4 — Teacher assignment is decoupled from center_members.role.** Story 2.1's Dev Notes §"Founder vs Owner" pinned this: Owner already implies all authorities (including teaching). Founder auto-assign (AC6) sets `classes.teacher_id = founder.userID` — it does NOT flip `center_members.role`. Owner stays Owner in center_members; teacher_id on the specific class links them for teaching-list queries. If Solo Teacher persona later wants a "solo workspace" label on their center (distinct from Founder's "workspace + team"), that's UI-only labeling driven by `users.persona`, not a DB role change. See [[feedback_pragmatic_interpretation_of_spec_absolutes]] applied to Story 2.1 Sally-B1 ruling.

### R1 discharge protocol

Per WF-8 hard rule: **ATDD red tests MUST land on the branch BEFORE this story transitions to `in-progress`.** Sequence:
1. `create-story` marks 2-2 `ready-for-dev` (this doc).
2. `/bmad-tea AT 2-2` generates red specimens (Task 0.1).
3. Verify red (Task 0.2).
4. Amelia runs `/bmad-dev-story 2-2` — story flips to `in-progress`, dev turns red → green.

**Story 2.2's R1 obligations:**
- Three new resource families (`class_templates`, `template_sessions`, `classes`) each get J15 six-pattern grid coverage (Task 10). Missing any one file blocks the epic-2 gate.
- No new `*Store` types are introduced (continuing Epic 1's direct-sqlc-in-service pattern, per Story 2.1's Dev Notes §Architectural Debt Acknowledged). The `tenantcheck` analyzer stays vacuous — that's OK; the J15 grid at SQL layer is the real R1 protection.
- **Pragmatic recommendation**: continue AuthDB-reuse pattern from Story 2.1 (Dev Notes §2). Do NOT invent a `TemplateDB` or `ClassDB` interface just for this story — YAGNI on abstractions.

### Backend layout — what's new vs. what's touched

| Path | New? | Notes |
|---|---|---|
| `classlite-api/api.yaml` | UPDATE | Add 3 new operations + template/class DTO schemas + reuse `EnvelopeMeta`. |
| `classlite-api/migrations/20260703120000_create_class_templates.{up,down}.sql` | NEW | RLS 4-policy (SELECT/INSERT/UPDATE/DELETE) with dual-scope read + tenant-only write. |
| `classlite-api/migrations/20260703120100_create_template_sessions.{up,down}.sql` | NEW | Denormalized `center_id` + BEFORE INSERT trigger + 4-policy RLS. |
| `classlite-api/migrations/20260703120200_create_classes.{up,down}.sql` | NEW | Standard center-scoped RLS (4 policies) + `classes_teacher_mutex` CHECK constraint. |
| `classlite-api/migrations/20260703120300_seed_class_templates.{up,down}.sql` | NEW | **5** fixed-UUID system seeds + 17 seed sessions. Idempotent via `ON CONFLICT DO NOTHING`. Uses temporary `NO FORCE ROW LEVEL SECURITY` window (no `SESSION AUTHORIZATION`). |
| `classlite-api/migrations/20260703120400_add_invites_center_email_unique.{up,down}.sql` | NEW | Partial unique index `idx_invites_center_email_active` on active invites. Pre-flight audit comment. |
| `classlite-api/internal/store/queries/class_templates.sql` | NEW | List + Get + Create + CreateSession. |
| `classlite-api/internal/store/queries/classes.sql` | NEW | Create + GetByID (for Story 3.1 pre-emptive use). |
| `classlite-api/internal/store/queries/invites.sql` | UPDATE | `CreateInviteFull` + `GetActiveInviteByEmail`. |
| `classlite-api/internal/store/queries/users.sql` | UPDATE | `GetUserByEmailCI` (check if exists first). |
| `classlite-api/internal/store/generated/*` | REGEN | Never hand-edit; regenerate via `scripts/codegen.sh`. |
| `classlite-api/internal/model/template.go` | NEW | DTOs + `PrimarySkill` enum + `IsValidPrimarySkill`. |
| `classlite-api/internal/middleware/require_center_context.go` | NEW | Pure context-check middleware. |
| `classlite-api/internal/middleware/require_center_context_atdd_test.go` | NEW | ATDD unit. |
| `classlite-api/internal/service/template.go` | NEW | Template CRUD (list, create custom). |
| `classlite-api/internal/service/class.go` | NEW | Spawn tx orchestrator. |
| `classlite-api/internal/handler/template_handler.go` | NEW | 3 endpoints. |
| `classlite-api/cmd/api/main.go` | UPDATE | Wire services + handlers + middleware + routes. |
| `classlite-api/internal/test/class_templates_rls_test.go` | NEW | J15 6-pattern grid + dual-scope positive + WITH CHECK negative. |
| `classlite-api/internal/test/template_sessions_rls_test.go` | NEW | J15 6-pattern grid + trigger fires assertion. |
| `classlite-api/internal/test/classes_rls_test.go` | NEW | J15 6-pattern grid. |
| `classlite-api/internal/test/story_2_2_helpers.go` | NEW | Fixture helpers + `MockInviteSender`. |

**Files to READ before touching anything else** (per `[[feedback_check_prior_story_artifacts_before_generating]]` — mandatory pre-flight):
- `classlite-api/cmd/api/main.go:222-250` — Story 2.1's onboarding chain wiring pattern. Extend with `requireCenter` in the same shape.
- `classlite-api/internal/middleware/require_verified_email.go` — sibling middleware to copy for `RequireCenterContext`.
- `classlite-api/internal/service/center.go` — CenterService's tx flow (pre-gen UUID → BEGIN → SET LOCAL → insert → audit LogWithinTx → commit). Task 7.2's spawn tx has the same structural shape.
- `classlite-api/internal/service/audit.go:88-108` — `LogWithinTx` signature. Do NOT re-open a tx from inside spawn.
- `classlite-api/internal/service/auth_admin.go:37-120` — `AdminInviteStaff` — the placeholder invite-writing pattern that Story 2.2 REPLACES for the spawn path (the AdminInviteStaff hook stays as-is for role-revalidation ATDD tests). Read closely for the token generation + hashing + tx pattern.
- `classlite-api/internal/service/email_templates.go:29-60` — `RenderInviteEmail(centerName, inviterName, role, acceptURL)`. Consumed by Task 8.5's post-commit email enqueue.
- `classlite-api/internal/service/email_retry.go` — `EmailRetryQueue.Enqueue` signature.
- `classlite-api/internal/service/auth_google.go:649-660` — `hashInviteTokenHex` helper.
- `classlite-api/internal/handler/response.go` — `WriteEnvelope` + `EnvelopeMeta`. Do NOT re-implement.
- `classlite-api/internal/test/_TEMPLATE_rls_test.go` — J15 6-pattern template. Copy 3×, find-replace per its header instructions.
- `classlite-api/internal/test/story_2_1_helpers.go` — helpers you'll extend patterns from (NewTestServerForUser, MarkUserEmailVerified, CreateUserOnPool with t.Cleanup, PurgeUserAndOwnedCenters). If `PurgeUserAndOwnedCenters` cascade also needs to purge classes/template_sessions/class_templates rows the caller created — check the cascade delete chain via FK ON DELETE CASCADE on center_id (added in Task 2 migrations).
- `classlite-api/internal/service/center.go:167` — Story 2.1's post-review `EmailVerified: true` drop lesson. Do NOT re-introduce synthetic tenant-context fields.
- `docs/project-context.md#GO-1` — TenantContext hard constraint (spawn signature includes it).
- `docs/project-context.md#GO-6, GO-7, XL-1` — pgx v5 idioms, typed JSONB (no map[string]interface{}), generated code is read-only.
- `docs/project-context.md#SEC-6` — worker tenant-context re-establishment (not applicable this story since email retry queue reuses the shipped Story 1.4 pattern; called out for awareness).

### Persona lookup at spawn time — one extra query

AC6 requires reading `users.persona` before opening the tx. This is a single indexed SELECT (`users.id` is PK). Do NOT push persona into JWT claims for this — persona changes rarely, but JWT staleness (EDGE-2) would leak wrong-persona spawns for up to 15 minutes after a persona change (unlikely path in v1 but a correctness hazard). One extra query per spawn is negligible for a wizard operation. Sibling of Story 2.1's `EmailVerified` in TenantContext extension — but there, verification is a boolean gate hit on every request, so caching in the context makes sense. Persona is a spawn-time-only read.

**Optional micro-optimization** (not required): join persona lookup with the caller-email lookup Task 7.2 step 4 needs anyway — one query returns `(email, persona)` — filed as an implementation detail for the dev agent, not a spec point.

### Invite dedup at the DB — belt AND suspenders

The partial unique index (Task 2.5) is the DB-level enforcement. Task 7.2 step 7's `map[string]inviteBucket` is the application-level dedup for within-payload duplicates. The two layers protect different failure modes:
- App-level dedup: same email typed on classes 1 AND 3 in one payload → one invite row. Without app-level dedup, the DB unique index would raise `pgerr23505` on the 2nd INSERT, requiring a retry-and-select round-trip.
- DB-level unique index: concurrent spawn from a different session for the same email lands one row and blocks the other (retry-and-reuse in Task 7.2 step 7 handles this via `GetActiveInviteByEmail`).

### AuditService reality — reuse Story 2.1's `LogWithinTx`

`internal/service/audit.go:98` — `AuditService.LogWithinTx(ctx, tx, tc, action, entityType, entityID, changes)` is already extracted. Use it for BOTH the `class_template.created` audit (Task 6.2) AND the per-class `class.spawned` audit (Task 7.2 step 8). Do NOT call `AuditService.Log()` — that opens its own tx. Same lesson as Story 2.1 Task 7.5.

### `RequireCenterContext` — a small addition to the middleware chain

The chain grows: `ExtractTenant → RequireVerifiedEmail → RequireCenterContext → RateLimit → handler`. The new middleware is 15 lines (mirror `RequireVerifiedEmail` shape). Order-of-403-checks discipline: verification is strictly earlier than center-having, so verified-but-no-center gets `CENTER_REQUIRED`, unverified-with-or-without-center gets `EMAIL_VERIFICATION_REQUIRED`. Wrong order shows the wrong 403 code and costs frontend UI-time debugging.

### Testing standards inheritance

- **TEST-BE-1**: J15 grid × 3 resource families (Task 10.1–10.3). Six patterns each.
- **TEST-BE-2**: Store tests use real DB in transactions via `test.SetupDB(t)`. Never mock pgx. Task 11 handler tests use this too.
- **TEST-BE-3**: Full `{data, meta}` envelope on success, `{error: {code, message, requestId, details}}` on error paths. AC12.
- **TEST-BE-4**: Service tests continue AuthDB-reuse from Story 2.1 (Dev Notes §Architectural Debt). Mock seams live at `AuditLogger` + `InviteSender` interfaces (Task 7.1 constructor).
- **beforeEach not beforeAll**: `SetupDB(t)` per test.
- **Per-story test coverage** for R38 discharge: N/A (backend story).

### Previous story intelligence — what to borrow, what to avoid

**From Story 2.1 (onboarding API):**
- **Tx pattern**: pre-gen UUID → BEGIN → SET LOCAL → INSERTs → LogWithinTx → COMMIT. Reuse verbatim for class spawn.
- **Interface seams at constructor**: `CenterService` accepts `AuditLogger` + `accessTokenIssuer` interfaces. `ClassService` follows the same shape with `AuditLogger` + `InviteSender`. Enables `brokenAuditLogger` fixture for Task 11.5 audit atomicity test.
- **Slug/Vietnamese-aware validation** — N/A this story (class names and template names are opaque UTF-8; UTF-8 rune-count via `utf8.RuneCountInString` is enough per Story 2.1 post-review MED fix — DO NOT use `len()` for character limits).
- **SetupRawPool concurrent tests** — NOT needed this story (invite dedup race is handled by DB unique index + retry-and-select, no goroutine test required). If a race concern surfaces during dev, add a `SetupRawPool` test per Story 2.1 Task 10.3 pattern.
- **AC6 audit rollback test via `brokenAuditLogger`** — repeat the pattern at Task 11.5.
- **`PurgeUserAndOwnedCenters` cascade** — verify FK `ON DELETE CASCADE` from `centers.id` cascades to `class_templates(center_id)`, `classes(center_id)`, `template_sessions(center_id via parent)`. If the cascade path doesn't work through the trigger-managed `template_sessions.center_id`, extend `PurgeUserAndOwnedCenters` in Task 11.6 helpers.

**From Story 2.1 post-review lessons:**
- `centerNameMaxLen` byte→rune fix — apply the same discipline to `nameMaxLen`, `cohortNameMaxLen`, `sessionTitleMaxLen`.
- `UpdateUserPersona :exec → :execrows` lesson — for any `:exec` query landing this story, consider `:execrows` if a silent zero-row update would mask a real bug. Task 7.2 step 8's `INSERT INTO classes RETURNING id` uses `:one` which already surfaces `pgx.ErrNoRows` correctly — no exposure.
- `GetProgress` two-query → JOIN lesson — Task 7.2 step 1 does ONE persona lookup query. Step 2 does ONE template lookup query. Not joined because the template read is RLS-scoped (needs to happen INSIDE the tenant-set tx) and the persona read is user-scoped (before tenant is set). Keep them separate — different tenancy semantics.
- `nullableText("")` → 422 lesson — apply at `validateSpawnInput`: empty-string `teacherEmail` is Branch D (unassigned/founder-auto-assign), NOT a validation error. `null` is equivalent to empty-string here. But a malformed non-empty email (e.g. `"not-an-email"`) IS a 422.

**From Story 1.6 (Google OAuth + invite accept):**
- Invite token generation: `newPasswordResetToken()` (returns hex-encoded 32 random bytes) — reuse. Hashing via `hashInviteTokenHex(raw)` (sha256hex) — reuse.
- Invite acceptance flow (AC3): Story 2.2 does NOT invoke this — spawn only WRITES invites; acceptance stays under `POST /api/auth/accept-invite` from 1.6. The Epic 7 story that owns "resend / revoke" from an Owner UI is separate.
- `AdminInviteStaff` — a placeholder for role-revalidation ATDD. It ships an invite row without email. Story 2.2 introduces the FIRST real invite email send. Do NOT modify `AdminInviteStaff` — it's covered by role-revalidation tests that would break.

**From Story 1.9c (invite acceptance UI):**
- The `POST /api/auth/accept-invite` endpoint's response includes `center.id` + `center.name` + `role`. When Story 2.2's spawn creates an invite for a teacher, the accepted invite path lands them in the correct center with `role='teacher'`. The claim-the-class-on-accept lift (linking the newly-created member to the pending `classes.pending_teacher_email` row) is **Epic 7's Story 7.1** — this story leaves the `pending_teacher_email` column populated and lets Epic 7 own the reconciliation. Filed FU-2-2-E for the claim-the-class flow.

### Git intelligence — recent commit patterns

Last 5 commits (`git log --oneline -5`):
```
26c569b story-2-1: /bmad-tea TA — 9 P2/P3 tests + 4 fixture helpers + AC6 hardening   ← BASELINE
ffa512b story-2-1: apply /bmad-tea RV MED fixes + report
9fcf512 story-2-1: ship green-phase + three-layer /bmad-code-review pass (review → done)
6b522c1 story-2-1: land pre-dev context + party-mode amendments + ATDD red-phase
d528444 epic-1c: close gate advisories C1-C4 in-place
```

Commit `9fcf512` shipped the post-review patches — read the review-findings section in `2-1-onboarding-api-persona-selection-center-setup-and-save-resume.md` if you want the "why the byte-vs-rune fix matters" context; it applies to every rune-count check in Task 6.4's `validateCreateTemplateInput`.

Commit `26c569b` extends `story_2_1_helpers.go` (Task 11.6's sibling will follow the same helper patterns for 2-2).

### Latest tech considerations (Jan 2026 cutoff — current-versions sanity check)

- **Go 1.22+** `ServeMux` — `r.PathValue("id")` used in Task 8.4 for the spawn endpoint's `{id}` path segment. Do NOT introduce `chi` / `gin` / `echo` / `fiber` for path-param routing.
- **pgx v5** — reuse the tx pattern from Story 2.1. `pgconn.PgError.ConstraintName` field is the pgx v5 idiom for constraint-name matching (Task 7.2 step 7's invite unique-violation detection).
- **sqlc v1.31.1** (unchanged from Story 2.1). No new sqlc idioms this story.
- **golang-migrate** — the CONCURRENTLY constraint (Story 2.1 P12 defer) does NOT apply here: none of Task 2's migrations create indexes on tables with meaningful production data at launch (all four tables are being CREATED in this story, so their indexes ship with them under `ACCESS EXCLUSIVE` on an empty table — instant).

### Architectural debt acknowledged (do NOT fix in this story)

1. **AuthDB reuse** — `TemplateService` + `ClassService` reuse the `service.AuthDB` interface for the tx-capable DB seam. Same acknowledgment as Story 2.1 Dev Notes §Architectural Debt Acknowledged #2 — introduce a proper `TemplateDB` / `ClassDB` interface only when the second consumer exists (Story 3.1). YAGNI.
2. **Denormalized `template_sessions.center_id`** — mirrors parent's tenancy for RLS locality. Kept in sync via trigger (Task 2.2). If Epic 3+ needs a genuine "template sessions can be re-parented across centers" (unlikely), refactor to a JOIN-based RLS policy then.
3. **Full 12-session syllabus for pre-built templates deferred** — seed 3-4 sessions per template, not the full syllabus. Filed FU-2-2-D; the wizard's Story 2.3b UI can iterate on session counts without changing the API contract.
4. **No `class_templates.short_code` / slug** — templates use UUID-only identifiers. If URL-friendly template links become a demand signal, extract slug logic from Story 2.1's slug.go into a reusable helper then. YAGNI.
5. **Invite-lifecycle audit events** — the invite row IS the durable record; Epic 7 owns the resend / revoke lifecycle + its audit events. Story 2.2 only writes `class.spawned` and `class_template.created` audit rows.

### Filed follow-ups (NOT this story's work)

- **`FU-2-2-A`** — Periodic drift audit query for `template_sessions.center_id` vs parent `class_templates.center_id`. Trigger prevents INSERT/UPDATE drift; DELETE-followed-by-INSERT on class_templates could theoretically stale a row. Owner: Backend lead. Priority: P3. Trigger: post-launch monitoring.
- **`FU-2-2-B`** — Cross-center teacher borrow. If an existing user is a teacher in center A and the owner of center B wants to invite them as a teacher, the current flow creates a fresh invite. UX may prefer a "add existing ClassLite user" dialog. Owner: Product + Backend. Priority: P3. Trigger: post-launch demand signal.
- **`FU-2-2-C`** — Partial-success spawn. If operators report frequent "spawn 20 classes, network glitched, lost everything" frustration, reconsider chunked commits (e.g. every 5 classes). Owner: Product + Backend. Priority: P4. Trigger: post-launch UX signal.
- **`FU-2-2-D`** — Complete syllabus for pre-built templates. Seed migration ships 3-4 sessions per template; a follow-up migration ships full 8-12 sessions per template with linked exercises (which requires Epic 4's exercise library). Owner: Content + Backend. Priority: P2. Trigger: Epic 4 pickup.
- **`FU-2-2-E`** — Claim-the-class flow. When a pending-invite teacher accepts, `classes.pending_teacher_email → classes.teacher_id = <newly-created user_id>` reconciliation. Owner: Epic 7 Story 7.1. Priority: P1 (blocks the invited-teacher UX). Trigger: Epic 7 pickup.
- **`FU-2-2-F`** — Rate-limit user-keyed variant. Spawn is bursty (up to 20 classes + N invite emails in one request); IP-keyed limit at 20/min is fine for solo owner but may collide with a NAT-shared owner + admin in the same center. Follow-up to Story 2.1's FU-2-1-E. Owner: Backend. Priority: P3. Trigger: shared with FU-2-1-E.

### Testing evidence checklist for gate review

Per the WF-8 per-epic gate, this story contributes evidence to:
- **R1 discharge**: J15 grids for `class_templates`, `template_sessions`, `classes` (Task 10.1–10.3). Load-bearing.
- **P0-431..435** (R18 CSV — bulk import): N/A this story (that's Story 2.7). But Reframe 2's atomic-spawn contract is thematically related — flag in the epic-2 gate summary that Story 2.2 chose all-or-nothing where Story 2.7 will need chunked partial success (different failure modes, different UX).
- **P0-441..445** (secret-in-logs): New surface — invite emails carry raw tokens. Task 8.5 must NOT log the raw token (existing `EmailRetryQueue` already handles this pattern from Story 1.4; verify). Add explicit `slog.Debug` assertions in Task 12 that log lines DO NOT contain the raw token string.

### Explicit non-goals (this story)

- **UI**. That's 2.3b + 2.3c.
- **Template edit / delete endpoints**. AC only covers list + create + spawn. Story 3.3 (class templates management) owns the edit + delete surfaces.
- **Class edit / delete / lifecycle**. Story 3.1 owns the full class CRUD lifecycle. Task 3.2's `GetClassByID` ships now as a courtesy for handler tests + 3.1's read path — do NOT extend to mutation queries here.
- **Enrollment + student emails at spawn time**. AC doesn't include student emails; the "optionally adding student emails" from Epic AC line 68 (the 2.3b UI story) does not apply to the API. Story 2.7 owns bulk student import; Epic 7 Story 7.3 owns enrollment.
- **Solo Teacher single-class UI variant (`/setup/first-class` screen s05)**. That's 2.3c's UI branch. The API endpoint (POST /api/templates/{id}/spawn with N=1) already covers it — no separate `POST /api/classes/solo-first` needed.
- **Google Meet auto-link generation for spawned classes**. Story 2.5 owns Google Meet integration.
- **Class capacity + plan limits**. Story 9.1 owns plan limits. Task 7.2's INSERT does NOT check center capacity limits — even Free-tier owners can spawn any number of classes here (student-count cap is the Free tier's real limiter per Story 2.4 AC5).
- **`X-Idempotency-Key` header support** for spawn retries. Filed as post-v1 hardening if we see duplicate spawns from mobile retry-glitches.

### Project Structure Notes

The full monorepo directory tree lives in `_bmad-output/planning-artifacts/architecture.md` lines 547–903. The parts touched by this story:
- `classlite-api/internal/handler/` — add `template_handler.go`.
- `classlite-api/internal/service/` — add `template.go`, `class.go`, and their `_test.go` siblings.
- `classlite-api/internal/middleware/` — add `require_center_context.go` + `_atdd_test.go`.
- `classlite-api/internal/model/` — add `template.go`.
- `classlite-api/internal/store/queries/` — add `class_templates.sql`, `classes.sql`, extend `invites.sql` + `users.sql`.
- `classlite-api/internal/store/generated/` — never hand-edit (XL-1).
- `classlite-api/internal/test/` — add three RLS files + `story_2_2_helpers.go`.
- `classlite-api/migrations/` — five new migration pairs (Task 2.1–2.5).
- `classlite-api/api.yaml` — extend with 3 operations + DTO components.
- `classlite-api/cmd/api/main.go` — wire services + handlers + middleware + routes (~30 lines added).

**No frontend changes in this story.** `classlite-web/src/features/onboarding/TemplateBuilder.tsx` + `ClassSpawn.tsx` are Story 2.3b's work.

### Definition of Done

- All **13 ACs** green with tests (mix of unit + integration + adversarial).
- **23 RLS tests** green covering the six J15 patterns × 3 resource families + 5 named extensions (2 for `class_templates` dual-scope, 3 for `template_sessions` trigger reconciliation).
- Handler ATDD suite green (list happy + list mixed + create happy + create validation matrix + spawn happy + spawn founder auto-assign + spawn 3-vector attack matrix + spawn audit rollback via brokenAuditLogger + spawn enqueue-full best-effort via BrokenInviteSender).
- Service unit tests green (validation matrix + teacher resolution matrix + invite dedup + race retry-and-reuse + Founder auto-assign matrix + post-accept re-invite Branch B precedence + enqueue-buffer-full best-effort).
- Error code catalog (AC13) fully covered — every code emitted by the handlers has a matching test assertion; wizard's UI dev has a stable contract.
- `go build ./...` clean; `go test -count=1 -race ./...` clean.
- `tenantcheck` analyzer clean (should stay vacuous per §Architectural Debt).
- `scripts/codegen.sh` re-run at Task 3.6; TS client + Zod schemas updated.
- `scripts/migrate.sh up` then `down` round-trip clean — including the cascade audit at Task 2.6 (Murat-M-S5).
- Baseline commit + sibling completion-notes file (`2-2-class-template-and-spawning-api-completion-notes.md`) authored per `docs/bmad-story-conventions.md` at first dev pickup — Dev Agent Record + File List + pragmatic deviations live there, NOT in this story file.

### References

- [Source: `_bmad-output/planning-artifacts/epics/epic-02.md#Story 2.2`] — canonical epic-level ACs (this story elaborates them).
- [Source: `_bmad-output/planning-artifacts/prds/prd-classlite_new-2026-05-26/prd.md#FR-3, FR-4, FR-15`] — template spec (four pre-built templates, spawn semantics, template fields).
- [Source: `_bmad-output/planning-artifacts/ux-design-specification.md#8.1 Onboarding (s02, s03, s07, s08)`] — spawn UI contract that consumes this API.
- [Source: `_bmad-output/planning-artifacts/architecture.md#4.4 Class Management (line 981)`] — class_handler / template_handler mapping.
- [Source: `_bmad-output/planning-artifacts/architecture.md#Structure Patterns (lines 547–903)`] — full directory tree.
- [Source: `_bmad-output/test-artifacts/test-design/test-design-architecture.md#R1 (line 122)`] — R1 risk register entry (score 9).
- [Source: `_bmad-output/test-artifacts/test-design/classlite_new-handoff.md#Epic 2 (line 49)`] — Epic 2 → R1, R18 mapping.
- [Source: `_bmad-output/implementation-artifacts/2-1-onboarding-api-persona-selection-center-setup-and-save-resume.md`] — precedent for tx flow, interface seams, `RequireVerifiedEmail` middleware pattern, `WriteEnvelope` helper, `AuditService.LogWithinTx`.
- [Source: `_bmad-output/implementation-artifacts/2-1-onboarding-api-persona-selection-center-setup-and-save-resume-completion-notes.md`] — post-review lessons (byte→rune, :exec→:execrows, GetProgress JOIN, nullableText("")→422).
- [Source: `docs/project-context.md#GO-1, GO-4, GO-5, GO-6, GO-7`] — TenantContext, ctx propagation, no-omitempty, pgx v5, typed JSONB.
- [Source: `docs/project-context.md#WF-1, WF-3, WF-8`] — API change sequence, codegen gate, per-story testing workflow.
- [Source: `docs/project-context.md#TEST-BE-1..4`] — Backend test conventions (J15 grid, real DB, real middleware, mock store interface).
- [Source: `docs/bmad-story-conventions.md`] — story file structure convention; completion notes sibling.
- [Source: `classlite-api/internal/test/_TEMPLATE_rls_test.go`] — J15 grid template.
- [Source: `classlite-api/internal/service/auth_admin.go`] — `AdminInviteStaff` invite-writing pattern (placeholder that this story SUPERSEDES for the spawn path).
- [Source: `classlite-api/internal/service/email_templates.go:29-60`] — `RenderInviteEmail` template.
- [Source: `classlite-api/internal/service/audit.go:88-108`] — `LogWithinTx` signature.
- [Source: commit `26c569b`] — baseline.
- [Source: commit `9fcf512`] — Story 2.1 review findings (byte→rune, :execrows, GetProgress JOIN lessons).

## Review Findings

_Generated by `/bmad-code-review 2-2` (2026-07-05) — three-layer adversarial pass on Opus 4.7 1M (Blind Hunter / Edge Case Hunter / Acceptance Auditor, fresh-context parallel), chunked across (1) core behavior, (2) HTTP layer, (3) tests. Total: 5 BLOCKER + 1 decision-resolved + 18 STRONG + 20 MED + 11 LOW + 2 defer + 12 dismissed._

### Decision resolved

- [x] [Review][Decision] **AC13 error-code catalog drift — AMEND spec to codify shipped codes.** Middleware emits `AUTH_REQUIRED`/`AUTH_INVALID` (401) and `RATE_LIMIT_EXCEEDED` (429); AC13 above listed `AUTHENTICATION_REQUIRED` / `RATE_LIMITED`. Codes are pre-existing Story 1.x contract; renaming middleware would touch every Story 1.x endpoint and its ATDD. Story 2.3b UI hasn't shipped so no downstream impact. **Resolution:** amend AC13 catalog to `AUTH_REQUIRED` / `RATE_LIMIT_EXCEEDED`; en.json/vi.json keys use the shipped identifiers; Story 2.3b's wizard router will consume the corrected catalog.

### Patches applied by reviewer

- [x] [Review][Patch] **C1-01** — `ListAccessibleTemplates` sort direction corrected: center-owned templates now `created_at DESC` (matches AC1) with `id ASC` tiebreaker for seed determinism. `classlite-api/internal/store/queries/class_templates.sql:15`
- [x] [Review][Patch] **C1-02** — Invite email now looks up `centers.name` inside spawn tx and passes it as `centerName` to `RenderInviteEmail`. Subject changes from "You're invited to Writing Bootcamp 6.5" → "You're invited to <actual center name>". `classlite-api/internal/service/class.go:387`
- [x] [Review][Patch] **C1-03** — `classes.template_id` FK gains `ON DELETE SET NULL` so seed down-migration is reversible after spawns. Preserves audit history + unblocks rollback. `classlite-api/migrations/20260703120200_create_classes.up.sql:13`
- [x] [Review][Patch] **C3-01** — Added four WITH-CHECK-on-UPDATE tests: `TestRLS_ClassTemplate_TenantCannotReparentOwnRow`, `TestRLS_ClassTemplate_TenantCannotPromoteOwnRowToSystemSeed`, `TestRLS_Classes_TenantCannotReparentOwnRow`, `TestRLS_TemplateSession_TenantCannotReparentOwnRow`. Closes the AC7 "WITH CHECK is load-bearing" verification gap. `classlite-api/internal/test/class_templates_rls_test.go`, `classes_rls_test.go`, `template_sessions_rls_test.go`
- [x] [Review][Patch] **C3-02** — `TestSpawn_AC11_AttackVectors` refactored: each subtest gets a fresh raw pool + isolated `t.Cleanup(purge)`, removing the shared-state ordering coupling. Subtests can now run in any order or via `-run` filter. `classlite-api/internal/handler/template_handler_atdd_test.go:490-576`
- [x] [Review][Patch] **AC13-Amend** — Story spec AC13 catalog updated to reflect shipped middleware codes.

### Action items — STRONG (unresolved, leave as unchecked patches)

- [x] [Review][Patch] **C1-05** — `GetActiveInviteByEmail` filter `expires_at > now()` misses expired rows that own the partial unique-index slot; 23505 resolution returns pgx.ErrNoRows → 500. Drop the `expires_at > $3` predicate from that query (index already guards `accepted_at IS NULL`). `classlite-api/internal/store/queries/invites.sql:130-140`
- [x] [Review][Patch] **C1-06** — NaN/Inf `targetBand` bypasses range check (NaN comparisons all evaluate false); hits DB CHECK as 500. Add `math.IsNaN(in.TargetBand) || math.IsInf(in.TargetBand, 0)` guard. `classlite-api/internal/service/template.go:1054-1062`
- [x] [Review][Patch] **C1-07** — `int64(f*10)` truncates; deserialized 6.4999… writes 64 (silent band drift). Use `int64(math.Round(f * 10))`. `classlite-api/internal/service/template.go:1100-1111`
- [x] [Review][Patch] **C1-08** — `existing.ExpiresAt.Valid` unchecked before `.Time` deref; zero-time propagates as `0001-01-01T00:00:00Z` in wire response. Add validity check. `classlite-api/internal/service/class.go:452-456`
- [x] [Review][Patch] **C1-09** — Spawn tx runs with no deadline; 20-class fan-out on slow DB pins pool connection. Add `context.WithTimeout(ctx, 30*time.Second); defer cancel()` at Spawn entry. `classlite-api/internal/service/class.go:340`
- [x] [Review][Patch] **C1-10** — Spawn rate-limit is IP-keyed; trivially bypassed via multi-IP + hurts NAT users. Should key on `centerID` or `userID` for cost protection. `classlite-api/cmd/api/main.go:34`
- [x] [Review][Patch] **C2-02** — `POST /api/templates` OpenAPI missing `500` response entry; codegen consumers have no `INTERNAL_ERROR` handler for creates. `classlite-api/api.yaml`
- [x] [Review][Patch] **C2-03** — `FieldError.required: [field, code, message]` — `code` newly required but pre-2.2 handlers emit `code: ""`. Either mark as optional with `omitempty` semantics documented, or audit + backfill Story 1.x callers. `classlite-api/api.yaml:438`
- [x] [Review][Patch] **C2-04** — Handler doesn't enforce `maxItems: 20` on `classes[]` immediately after decode; 32 KB body could allocate thousands of `SpawnClassInput`. Add `len(body.Classes) > 20` check post-decode. `classlite-api/internal/handler/template_handler.go` Spawn
- [x] [Review][Patch] **C2-05** — `MaxBytesReader` writes 413 to `w` before handler returns 422 → `http: superfluous WriteHeader call` + ambiguous status. Use `http.MaxBytesReader(nil, ...)` or short-circuit an explicit 413. `classlite-api/internal/handler/template_handler.go:96,141`
- [x] [Review][Patch] **C3-03** — RLS tests assert only `err != nil`; passes on ANY error (permission denied, relation-doesn't-exist, syntax error). Migration regression dropping the table would look green. Assert `pgconn.PgError.Code == "42501"` on RLS-violation paths. all 3 RLS files
- [x] [Review][Patch] **C3-04** — UPDATE/DELETE tests never assert `RowsAffected == 0` — the primary policy-denial signal. class_templates_rls & classes_rls Pattern 3/4
- [x] [Review][Patch] **C3-05** — `classes_teacher_mutex` CHECK not tested — file header claims it, no test exists. Add targeted test asserting 23514 on `teacher_id != NULL AND pending_teacher_email != NULL`. `classlite-api/internal/test/classes_rls_test.go`
- [x] [Review][Patch] **C3-06** — `TestSpawn_AC12_ErrorEnvelopeShape` uses unauth server and never asserts status/code; proves envelope for 401 only, not spawn-specific errors. Add a spawn-error case (e.g. malformed teacherEmail) and assert full 4-field envelope. `classlite-api/internal/handler/template_handler_atdd_test.go:582-611`
- [x] [Review][Patch] **C3-07** — AC11 attack subtests never assert response status; `body_center_override` also never verifies attacker DID get their class (SEC-7 contract). `classlite-api/internal/handler/template_handler_atdd_test.go:540-575`
- [x] [Review][Patch] **C3-08** — `template_sessions` Pattern 3 UPDATE on `template_id` never tested — trigger fires only on INSERT; UPDATE could reparent session to other tenant's template silently. `classlite-api/internal/test/template_sessions_rls_test.go`
- [x] [Review][Patch] **C3-09** — Trigger reconciliation test scans center_id into `any` and only checks non-nil; trigger could write wrong tenant's UUID and test passes. Scan into `pgtype.UUID` and assert equal to expected `centerA.ID`. `classlite-api/internal/test/template_sessions_rls_test.go`
- [x] [Review][Patch] **C3-10** — AC10 Pattern 2 tests don't verify the row's actual `center_id` was set to caller's tenant (SEC-7 body-override contract). Add post-insert `SELECT center_id` under superuser and assert equal to caller's tenant. all 3 RLS files

### Action items — MED

- [x] [Review][Patch] **C1-11** — `CountCenterMembersByUser` has no `center_id` predicate; Branch B relies entirely on RLS scoping (fragile, invisible in Go code). Add dedicated `CountCenterMembersByUserAndCenter` OR add RLS-dependency comment. `classlite-api/internal/service/class.go:733` + `queries/center_members.sql:16`
- [x] [Review][Patch] **C1-12** — `startDate` has no upper bound; year 9999 accepted. Add ceiling ~1 year. `classlite-api/internal/service/class.go:614-627`
- [x] [Review][Patch] **C1-13** — `s.clk.Now()` wallclock zone drift; boundary startDates near UTC midnight flip accept/reject. Use `.UTC()`. `classlite-api/internal/service/class.go:589-628`
- [x] [Review][Patch] **C1-14** — Post-commit Enqueue: crash between commit and Enqueue leaves invite row without email; no reconciler. Persist `enqueue_pending` marker or accept + document as known drift. `classlite-api/internal/service/class.go:539-566`
- [x] [Review][Patch] **C1-15** — Per-class validation short-circuits on first field error; wizard needs multiple round-trips. Collect all errors per class before advancing. `classlite-api/internal/service/class.go:594-604`
- [x] [Review][Patch] **C1-16** — Seed `ON CONFLICT (id) DO NOTHING` silently drops content fixes on same UUID. Document policy (seeds immutable → new UUID for fixes) or use `DO UPDATE`. `classlite-api/migrations/20260703120300_seed_class_templates.up.sql`
- [x] [Review][Patch] **C1-17** — `class.spawned` audit `after` omits `teacher_status`, `pending_teacher_email`, `assignment_reason` — forensic gap. `classlite-api/internal/service/class.go:506`
- [x] [Review][Patch] **C2-06** — `SpawnInviteEntry.classIndices` 0-indexed vs 1-indexed not documented; real UX bug risk. `classlite-api/api.yaml:368-372`
- [x] [Review][Patch] **C2-07** — 403 responses documented as only `EMAIL_VERIFICATION_REQUIRED`/`CENTER_REQUIRED`; `INVALID_TENANT_CLAIM` and `FORBIDDEN` also 403. `classlite-api/api.yaml`
- [x] [Review][Patch] **C2-08** — 422 responses documented as only `INVALID_TEACHER_EMAIL`/`SELF_INVITE_BLOCKED`; cohortName length, startDate drift, class count, JSON parse errors also 422. `classlite-api/api.yaml`
- [x] [Review][Patch] **C2-09** — 500 documented exclusively as `SEED_INCOMPLETE` on List; generic `INTERNAL_ERROR` not documented. `classlite-api/api.yaml`
- [x] [Review][Patch] **C2-10** — JSON decoder doesn't `DisallowUnknownFields()`; typos silently ignored. Codebase-wide pattern but Story 2.2 spec is stricter. `classlite-api/internal/handler/template_handler.go:98,141`
- [x] [Review][Patch] **C3-11** — `signAccessTokenWithCenter` mints empty-claim token on missing membership silently; positive-test fixture failures misdiagnosed as handler bugs. Add zero-membership `t.Fatalf`. `classlite-api/internal/test/story_2_2_helpers.go:2431-2469`
- [x] [Review][Patch] **C3-12** — Handler-level AC9 audit-atomicity test missing (Task 11.5 pin); file header claims coverage that lives only at service layer. Add or amend header. `classlite-api/internal/handler/template_handler_atdd_test.go`
- [x] [Review][Patch] **C3-13** — `RATE_LIMITED` / `SEED_INCOMPLETE` / `INTERNAL_ERROR` codes never exercised in ATDD. Add service-level SEED_INCOMPLETE test at minimum. `classlite-api/internal/handler/template_handler_atdd_test.go`
- [x] [Review][Patch] **C3-14** — Non-founder personas never asserted as NOT auto-assigned; regression could plant Operator/Admin as class[0] teacher. `template_handler_atdd_test.go` AC6, `class_atdd_test.go`
- [x] [Review][Patch] **C3-15** — Handler happy-path `AC03_HappyMixedBranches` doesn't verify DB state after 201; handler lying with fake body would pass. `classlite-api/internal/handler/template_handler_atdd_test.go:291-383`
- [x] [Review][Patch] **C3-16** — Validation errors don't assert no-partial-write on DB; validate-late partial-persist bugs slip. multiple spawn negatives
- [x] [Review][Patch] **C3-17** — `TestSpawn_AC03_EmptyClassesList_Returns422` / `AC02_InvalidPrimarySkill` never assert error code — inconsistent with sibling tests. `classlite-api/internal/handler/template_handler_atdd_test.go`
- [x] [Review][Patch] **C3-18** — Sally-B4 belt test accepts either-outcome; belt path never actually reached. Documented pragmatic pattern — accept OR add a normalization-drift double. `classlite-api/internal/service/class_atdd_test.go:1128-1202`

### Action items — LOW

- [x] [Review][Patch] **C1-19** — Founder auto-assign silently no-ops on empty callerEmail; drifts from AC6 verbatim. `classlite-api/internal/service/class.go:641`
- [x] [Review][Patch] **C1-20** — `strings.Split(email, "@")[0]` used as `inviterName`; leaks email local-part in invite copy. Use `users.name`. `classlite-api/internal/service/class.go:404`
- [x] [Review][Patch] **C1-21** — Sally-B4 EqualFold belt runs on two already-lowercased strings — unreachable canary. Delete or compare raw inputs. `classlite-api/internal/service/class.go:679-689`
- [x] [Review][Patch] **C1-22** — `spawnAcceptInvitePathVi` dead const. `classlite-api/internal/service/class.go:209`
- [x] [Review][Patch] **C2-11** — 429 responses lack `Retry-After` header schema. `classlite-api/api.yaml`
- [x] [Review][Patch] **C2-12** — Decode error surface conflates empty-body / MaxBytesError / SyntaxError / UnmarshalTypeError. `classlite-api/internal/handler/template_handler.go`
- [x] [Review][Patch] **C2-13** — `ListTemplatesResult.templates` has no `minItems: 5`; the ≥5 invariant lives only in prose + runtime check. `classlite-api/api.yaml`
- [ ] [Review][Patch] **C3-19** — `SeedActiveInvite` never verifies seed is visible via app-user RLS path; AC5 race test may exercise wrong branch. `classlite-api/internal/test/story_2_2_helpers.go:2571-2584`
- [x] [Review][Patch] **C3-20** — `pre2_2Purge` silently swallows errors → residue → intermittent failures. Surface errors via `t.Logf` at minimum. `classlite-api/internal/test/story_2_2_helpers.go:2645-2670`
- [ ] [Review][Patch] **C3-21** — Mock assertion tightening: nil-guard Spawn result before deref; `Fatalf` not `Errorf` before iteration; assert `len(inviter.Calls)` and per-call `To`. `classlite-api/internal/service/class_atdd_test.go` various
- [ ] [Review][Patch] **C3-22** — Vietnamese-diacritic / NBSP email + cohortName not exercised (project has i18n-primary policy). ATDD suites

### Deferred (pre-existing or out-of-scope)

- [x] [Review][Defer] **C1-18** — `ExtractTenant` opens tx per authenticated CenterID request; perf regression across surface. Trade-off documented in completion notes; monitor post-launch. Not caused by this change (fix was necessary for the spawn path). `classlite-api/internal/middleware/auth.go:79-91`
- [x] [Review][Defer] **C2-14** — No idempotency-key on spawn; double-submit creates 2N classes. Explicit non-goal in story ("X-Idempotency-Key header (post-v1)"). Defer to post-v1.

### Dismissed as noise / handled elsewhere

Seed migration NO FORCE/FORCE tx-wrapping (golang-migrate wraps by default, verified); RLS policy `NULLIF(current_setting(...))::uuid` DoS on malformed strings (SetTenantContext validates UUID first); enumeration oracle on Branch B lookup (Branch B and Branch C responses converge on the "not a member" path — no leak); `required+nullable` OpenAPI vs Go pointer permissiveness (spec is stricter than handler; harmless); `format: uuid` not propagated to TS (openapi-typescript limitation, not actionable); panic recovery gap (codebase-wide, not new drift); RLS suite superuser-bypass concern (verified `SET LOCAL ROLE classlite_app` in `helpers.go:97` — RLS genuinely enforced); OpenAPI examples / cache-control / Location header polish; `NullTenant` vs `UnsetTenant` duplication (documented distinction).

---

## Round 2 Review Findings (2026-07-06)

_Generated by `/bmad-code-review 2-2` on Opus 4.7 1M (different session from the 2026-07-05 pass). Three-layer adversarial re-review after Amelia applied 52 of 55 findings from Round 1. Same chunk decomposition: (1) service+DB+migrations, (2) HTTP contract, (3) tests. Original triage: 5 decision-needed + 30 patches + 6 deferred + 11 dismissed. **After decision resolution (2026-07-06)**: 4 decisions became patches (R2-P31..R2-P34), 1 became a defer (R2-W7). **Final counts: 34 patches, 7 defers, 11 dismissed.** Regression `go test -race -count=1 -p 1 ./...` was green at handoff — findings below are NEW regressions from the 52-patch pass OR items missed by Round 1._

### Round 2 — Decisions resolved

- [x] [Review][Decision] **R2-D1 → RESOLVED (option b): rewrite belt to be reachable.** Compare `parsed.Address` case-sensitively against `callerInfo.Email` (raw DB value) so a true normalization drift can fire the belt. Preserves the canary intent instead of deleting dead code. → Becomes patch **R2-P31**.
- [x] [Review][Decision] **R2-D2 → RESOLVED (option a): add dedicated query.** New sqlc query `:one CountCenterMembersByUserAndCenter($1 user_id, $2 center_id)`; belt-and-suspenders against RLS drift. Requires `codegen.sh` (WF-3). → Becomes patch **R2-P32**.
- [x] [Review][Decision] **R2-D3 → RESOLVED (option a): 500 INTERNAL_ERROR on corrupt Founder email.** Aligns with AC6's MUST by surfacing corrupt user records loudly rather than silently downgrading to Branch D. → Becomes patch **R2-P33**.
- [x] [Review][Decision] **R2-D4 → RESOLVED (option a): accept as maintenance-window replay only.** Document `~ms` NO FORCE window as "seed migration should be replayed only during maintenance windows"; policy captured in deferred-work.md R2-W7. → Filed as defer **R2-W7** (policy note only, no code change).
- [x] [Review][Decision] **R2-D5 → RESOLVED (option a): reject duplicate cohortName at service layer.** Per-index `DUPLICATE_COHORT_NAME` field error in `resolveTeacherBranches`. No migration needed; wizard shows inline error. → Becomes patch **R2-P34**.

### Round 2 — Patches (unchecked)

- [x] [Review][Patch] **R2-P1** — `ClassService.acceptURLBase` defaults to `"http://localhost:5173/invite"` (constructor line) and is never called via `SetAcceptURLBase(cfg.AcceptURLBase)` in `main.go`. Production teachers receive invite emails pointing at localhost. **STRONG.** Wire the setter in main.go after `NewClassService`, and fail-fast at startup if `cfg.AcceptURLBase` is empty. `classlite-api/internal/service/class.go:427` + `classlite-api/cmd/api/main.go`
- [x] [Review][Patch] **R2-P2** — `centers.name` and `inviterName` (fallback from `strings.Split(email, "@")[0]`) flow into `RenderInviteEmail` subject/body without CR/LF/control-char strip. Owner-controlled `centers.name` can inject email headers (SMTP CRLF injection). **STRONG.** Strip `\r\n\t` and non-printable runes before passing to `RenderInviteEmail`. `classlite-api/internal/service/class.go:533-538, 733`
- [x] [Review][Patch] **R2-P3** — Post-commit `s.inviter.Enqueue` loop runs under the 30s `spawnDeadline` ctx. If `tx.Commit` consumes most of the budget, ctx expires mid-loop and remaining buckets silently drop the email attempt (invite ROW is durable — email is not). C1-14 covered "crash between commit and enqueue" but not this ctx-timeout edge. **MED.** Move `cancel()` to fire immediately after `tx.Commit(ctx)`, or run the enqueue loop under `context.WithoutCancel(ctx)`. `classlite-api/internal/service/class.go:471-476, 716-746`
- [x] [Review][Patch] **R2-P4** — `SAVEPOINT invite_insert` name reused across bucket iterations; on reuse-existing branch (`isConstraintViolation`), `RELEASE SAVEPOINT` never runs. Postgres allows shadowed savepoints of the same name but the outer tx accumulates N unreleased savepoints until COMMIT. **LOW.** Either suffix name with index (`invite_insert_%d`) OR `RELEASE SAVEPOINT invite_insert` before `continue` on the reuse branch. `classlite-api/internal/service/class.go:574, 591-619`
- [x] [Review][Patch] **R2-P5** — `ExtractTenant` middleware uses raw `tx.Exec(r.Context(), "SELECT set_config('app.current_tenant_id', $1::text, true)", ...)` where the rest of the codebase uses `store.SetTenantContext(ctx, tx, tc)`. Pattern inconsistency invites drift; the helper also validates the UUID string. **MED.** Swap to `store.SetTenantContext` for uniformity. `classlite-api/internal/middleware/auth.go:77-94`
- [x] [Review][Patch] **R2-P6** — Founder auto-assign path re-parses `callerEmailNormalized` with `mail.ParseAddress` and drops the error (`parsed, _ := mail.ParseAddress(...)`), then dereferences `parsed.Address`. Since `callerEmailNormalized` is already the normalized address string, the re-parse is redundant + creates a theoretical nil-deref. **LOW.** Replace with `emailCopy := callerEmailNormalized`. `classlite-api/internal/service/class.go:842-849`
- [x] [Review][Patch] **R2-P7** — `signAccessTokenWithCenterOpts` uses `SELECT center_id, role FROM center_members WHERE user_id = $1 LIMIT 1` without `ORDER BY` — nondeterministic when a user has multi-membership residue from a prior test. **LOW test-helper.** Add `ORDER BY created_at ASC LIMIT 1`. `classlite-api/internal/test/story_2_2_helpers.go:2979-2990`
- [x] [Review][Patch] **R2-P8** — `floatToNumeric` silently clamps negative to 0. Validation range check upstream is the only gate; a future refactor that bypasses validation writes 0 to DB with no error. **MED.** Return error (or panic in dev) rather than clamp. `classlite-api/internal/service/template.go:1332`
- [x] [Review][Patch] **R2-P9** — `numericToFloat` returns `0.0` on `!n.Valid || Float64Value() err` — indistinguishable from a valid band 0.0 (which is out of the 1.0–9.0 spec range but surfaces silently). **MED.** Change signature to `(float64, error)` and surface DB corruption as 500. `classlite-api/internal/service/template.go:1345-1355`
- [x] [Review][Patch] **R2-P10** — Dead-import sentinels `_ = errors.Is` and `_ = pgx.ErrNoRows` in template.go — indicates removed error-handling code that left import residue. **LOW.** Delete the sentinels and the unused imports. `classlite-api/internal/service/template.go:1073, 1373`
- [x] [Review][Patch] **R2-P11** — Unused `authSvc` variable in `newStorySrv2_2` — would fail `staticcheck U1000`. **LOW test-helper.** Remove. `classlite-api/internal/test/story_2_2_helpers.go:2881-2886`
- [x] [Review][Patch] **R2-P12** — `TestSpawn_AC03_EmptyClassesList_Returns422` creates a template but ends with `_ = templateID` — suggests a removed assertion. **LOW.** Either drop the template creation or wire it into an assertion. `classlite-api/internal/handler/template_handler_atdd_test.go:566`
- [x] [Review][Patch] **R2-P13** — RLS UPDATE tests (`TestRLS_*_TenantCannotReparentOwnRow`, `TestRLS_*_TenantCannotPromoteOwnRowToSystemSeed`) re-read `center_id` and assert unchanged ONLY inside `if err == nil`. If the UPDATE returns any error (including an unrelated one), the re-read never fires — silent false-pass. **MED.** Always re-read + assert unchanged regardless of err. `class_templates_rls_test.go:2041-2070`, `classes_rls_test.go` analogous, `template_sessions_rls_test.go` analogous
- [x] [Review][Patch] **R2-P14** — `TestSpawn_AC11_AttackVectors/attack_vector_header_center_spoof` asserts victim center has zero classes but NEVER asserts attacker's center has exactly 1 class. A regression that silently drops the class (e.g., misroutes to empty center) still passes. **MED.** Add `assertRowCount(attackerCenterID) == 1`. chunk3.diff:634-666
- [x] [Review][Patch] **R2-P15** — `TestClassService_Spawn_AC04b_SelfInviteBlocked` accepts both `"explicit_self"` OR `"founder_auto"` — muddled. Test setup uses non-founder owner, so `founder_auto` should be impossible. Accepting both hides a real regression. **LOW.** Assert exactly `"explicit_self"` for non-founder callers. `classlite-api/internal/service/class_atdd_test.go:1358`
- [ ] [Review][Patch] **R2-P16 — SKIPPED, needs interface refactor**. `TemplateHandler` accepts concrete `*service.TemplateService`, not an interface — injecting a stub returning `< 5` system templates would require extracting a `TemplateSvc` interface at the handler boundary (a non-test-only refactor). Alternative: manipulate real DB seed state inside the test (invasive + races with other tests). Filed as **FU-2-2-L**: extract `TemplateSvc` interface at handler seam, then land the SEED_INCOMPLETE handler test. Verified stable: the service-level `CountSystemTemplates` unit test (C3-13) does prove the counting logic; the handler's `WriteError(..., "SEED_INCOMPLETE", ...)` line is trivially trusted since it's a single literal-string call. **MED (kept unchecked)**.
- [x] [Review][Patch] **R2-P17** — `TEMPLATE_NOT_FOUND` for a valid-UUID but nonexistent template ID is not tested. AC11 `attack_vector_body_template_id_from_other_tenant` covers the cross-tenant → 404 path (RLS invisibility) but a `uuid.New()` non-existent case is missing. **LOW.** Add `TestSpawn_NonexistentTemplateID_Returns404`. `classlite-api/internal/handler/template_handler_atdd_test.go`
- [x] [Review][Patch] **R2-P18** — AC11 spec prose (line 131-133) still reads _"server MUST ignore body's centerId; write uses TenantContext.CenterID"_ (implying 201 with silent ignore). Shipped C2-10 amended the test to expect 422 (DisallowUnknownFields) but AC11 prose was NOT updated. Two future readers expect two different behaviors. **LOW spec-drift.** Amend AC11 prose to record the C2-10 posture change inline. `_bmad-output/implementation-artifacts/2-2-class-template-and-spawning-api.md:131-133`
- [x] [Review][Patch] **R2-P19** — `TemplateService.List/Create` returns bare `fmt.Errorf` on tenancy-parse and `SetTenantContext` failures (project-context GO-2 violation). A stale JWT with bad-UUID `CenterID` surfaces as generic `INTERNAL_ERROR` rather than AC13's `INVALID_TENANT_CLAIM` (403). Same pattern in `ClassService.Spawn:505, 523-526`. **MED.** At minimum wrap `uuid.Parse(tc.CenterID)` failure as a typed sentinel the ErrorMapper can route to `INVALID_TENANT_CLAIM`. `classlite-api/internal/service/template.go:1113-1229`
- [x] [Review][Patch] **R2-P20** — `Create` audit `after.target_band` stores raw input `in.TargetBand` (float64) not the rounded stored value `numericToFloat(tmpl.TargetBand)`. Input `6.4999999` writes `6.5` to DB but audit shows `6.4999999` — forensic mismatch on any future targetBand-adjacent bug. **LOW.** Use `numericToFloat(tmpl.TargetBand)` in the audit map. `classlite-api/internal/service/template.go:1213-1225`
- [x] [Review][Patch] **R2-P21** — `slog.Info("spawn_invite_reused_existing", "email", bucket.Email, ...)` logs raw email addresses. GDPR/privacy: structured logs go to retention storage. **MED.** Hash/redact the email OR downgrade to DEBUG behind a flag. `classlite-api/internal/service/class.go:614`
- [x] [Review][Patch] **R2-P22** — Spawn's slog calls lack `request_id` correlation ID — ops can't join one spawn's log lines through SAVEPOINT / enqueue-reject / enqueue-accept sequence when multiple spawns run concurrently. **LOW.** Pull `request_id` from ctx (project-context GO-4) and add to every slog call in `Spawn`. `classlite-api/internal/service/class.go:614, 738`
- [x] [Review][Patch] **R2-P23** — POST handlers don't validate `Content-Type: application/json`. Clients could send `application/x-www-form-urlencoded` bodies that happen to parse as JSON — CSRF via HTML form is permitted. **LOW.** Return 415 when Content-Type prefix is not `application/json`. `classlite-api/internal/handler/template_handler.go:688, 731`
- [x] [Review][Patch] **R2-P24** — `Content-Length` early-reject missing; a malicious `Content-Length: 100000000` header only errors mid-stream via `MaxBytesReader`. Wastes connection resources. **LOW.** Add `if r.ContentLength > limit { return 413 }` before decoder. `classlite-api/internal/handler/template_handler.go`
- [x] [Review][Patch] **R2-P25** — Branch A response's `SpawnedClass.TeacherEmail` is set from `payloadNormalized` (attacker input, then normalized), not from `callerInfo.Email` (DB value). Relies on payload→normalizer→users.email equality; brittle. **LOW.** Use `callerInfo.Email` directly for Branch A. `classlite-api/internal/service/class.go:875`
- [x] [Review][Patch] **R2-P26** — `startDate: ""` / whitespace / JSON `null` all surface as `"must be YYYY-MM-DD"` — same message as a truly malformed date. Wizard cannot distinguish "required" from "invalid format" for its inline error UX. **LOW.** Trim + null-check first, emit distinct `MISSING_START_DATE` code; use `*string` for `StartDate` to detect JSON null. `classlite-api/internal/service/class.go:801-806` + `classlite-api/internal/handler/template_handler.go:652-656`
- [x] [Review][Patch] **R2-P27** — `spawnStartDate` boundary compares parsed midnight-UTC date against `s.clk.Now().UTC()` non-truncated instant. Between 00:00 and 23:59 UTC, a date exactly 30 days ago fails "before earliestStart" — off-by-up-to-24h. Same for the future cap. C1-13 addressed `.UTC()` but not day-truncation. **MED.** `now.Truncate(24 * time.Hour)` before offset computation. `classlite-api/internal/service/class.go:772-812`
- [x] [Review][Patch] **R2-P28** — `SeedCenterForUser` in test helpers builds SQL via string-concat: `` `SET LOCAL app.current_tenant_id = '`+UUIDString(centerID)+`'` ``. `SET LOCAL` can't use bind params, but the pattern sets a bad example — the codebase uses `SELECT set_config('app.current_tenant_id', $1, true)` in every other place. **STRONG test-helper.** Rewrite via `set_config($1, ...)` with bind. `classlite-api/internal/test/story_2_2_helpers.go:3065`
- [x] [Review][Patch] **R2-P29** — `pre2_2Purge` iterates `center_members WHERE user_id = $1` then deletes ALL invites/classes/templates in each center — cross-user residue if a teacher is a member of an owner's center (AC11 test setup). Sequence-order-dependent cleanup: purging teacher first nukes owner's data before owner's cleanup runs. **MED.** Filter deletes to rows created by userID (needs `created_by` column) OR restrict purge to centers where user is `owner` role. `classlite-api/internal/test/story_2_2_helpers.go:3191-3225`
- [x] [Review][Patch] **R2-P30** — Spawn's `verifyBranchBInsideTx` fallback at `emailCopy := *p.TeacherEmail` doesn't force lowercase; if `users.email` was ever stored mixed-case (pre-2.2 users), dedup buckets could split. **LOW.** `strings.ToLower(emailCopy)` at assignment. `classlite-api/internal/service/class.go:965`
- [x] [Review][Patch] **R2-P31** _(from R2-D1)_ — Rewrite Sally-B4 belt to be reachable: compare `parsed.Address` case-sensitively against `callerInfo.Email` (raw DB value) rather than the already-lowercased `callerEmailNormalized`. Real normalization drift now fires the belt at test time instead of at prod-time-when-Solo-Teacher-gets-invited-to-her-own-class. **LOW (design).** `classlite-api/internal/service/class.go:891`
- [x] [Review][Patch] **R2-P32** _(from R2-D2)_ — Add new sqlc query `CountCenterMembersByUserAndCenter :one` selecting `COUNT(*) FROM center_members WHERE user_id = $1 AND center_id = $2`; replace call at Branch B verification. Belt-and-suspenders against RLS drift; remove the "safe only because RLS" comment. Requires `codegen.sh` (WF-3). **MED.** `classlite-api/internal/store/queries/center_members.sql` + `classlite-api/internal/service/class.go:936-953`
- [x] [Review][Patch] **R2-P33** _(from R2-D3)_ — Founder auto-assign path: when `persona == "founder"` AND classIndex==0 AND `callerEmailNormalized == ""`, return a typed 500-mapping error (e.g. `model.InternalError{Reason: "corrupt Founder email row"}`) instead of silently falling to Branch D. AC6 uses MUST — the corrupt-record case must surface loudly. **LOW.** `classlite-api/internal/service/class.go:834-853`
- [x] [Review][Patch] **R2-P34** _(from R2-D5)_ — Add duplicate-cohortName rejection in `resolveTeacherBranches`. Track seen names case-insensitively per spawn payload; on collision emit `model.FieldError{Field: fmt.Sprintf("classes[%d].cohortName", i), Code: "DUPLICATE_COHORT_NAME", Message: "cohort name already used in this spawn"}`. Update AC13 catalog + api.yaml with the new code. **MED.** `classlite-api/internal/service/class.go:762-925` + `classlite-api/api.yaml` + AC13

### Round 2 — Deferred (real, but not this story's fix scope)

- [x] [Review][Defer] **R2-W1** — `DisallowUnknownFields()` applied only on Story 2.2 endpoints; Story 1.x handlers (onboarding, centers, auth) still silently accept unknown fields. Cross-endpoint inconsistency; wizard router must code-path per endpoint. File `FU-2-2-K` to sweep-apply on next-touch of each handler. Not a Story 2.2 regression.
- [x] [Review][Defer] **R2-W2** — Trigger `sync_template_sessions_center_id` has no `IF NOT FOUND` guard; silently NULLs `NEW.center_id` on non-existent parent template (FK constraint pre-empts in practice). Fixing requires a new migration pair per WF-2 (never edit existing migrations). Defer to next `template_sessions` migration touch. `classlite-api/migrations/20260703120100_create_template_sessions.up.sql:1631`
- [x] [Review][Defer] **R2-W3** — Same trigger silently overwrites `NEW.center_id` on explicit-value INSERT with no assertion of match — bugs pass unnoticed. Migration constraint applies. Defer with R2-W2.
- [x] [Review][Defer] **R2-W4** — `classes.session_count` is nullable in schema; spawn always writes it as valid but a manual UPDATE could NULL it. Migration change needed. Defer to a Story 3.1+ migration.
- [x] [Review][Defer] **R2-W5** — Trigger function's `SET search_path = public, pg_temp` should follow best-practice `SET search_path = pg_catalog, public`. Cosmetic; needs new migration. Defer.
- [x] [Review][Defer] **R2-W6** — `ExtractTenant` per-request tx-wrap doubles pool round-trips per authenticated request. C1-18 already deferred in Round 1 with post-launch monitoring; re-flagged by Round 2 but same acceptance rationale (fix was mandatory for Branch B RLS scoping).
- [x] [Review][Defer] **R2-W7** _(from R2-D4 resolution)_ — Seed migration `NO FORCE ROW LEVEL SECURITY` window races with concurrent tenant traffic on live-DB replay. **Policy accepted**: seed migration is replay-safe only during maintenance windows; the ~ms NO FORCE bookend is bounded by `golang-migrate`'s advisory lock but does not gate user traffic. No code change — future ops runbooks must enforce the maintenance-window-only replay rule. `classlite-api/migrations/20260703120300_seed_class_templates.up.sql`

### Round 2 — Dismissed as noise / handled elsewhere

- **`MaxBytesReader(nil, ...)`** — Go stdlib documents this pattern; C2-05 already applied.
- **`mail.ParseAddress` too permissive** — RFC 5322 compliance; the normalize + LOWER pipeline is intentional.
- **`pgUUID(uuid.Nil)` null-safety** — unreachable: centerUUID comes from `TenantContext.CenterID` validated upstream.
- **`PathValue("id")` URL-decoded UUID variant matching** — `uuid.Parse` canonicalizes; no string-equality bypass.
- **`acceptURL` raw token not URL-encoded** — token is `base64.RawURLEncoding` by design (URL-safe alphabet).
- **`spawnDeadline=30s` blocks client** — intentional per C1-09.
- **`body.Classes > 20` validated after decode** — MaxBytesReader at 32 KiB bounds memory; C2-04 chose this trade-off.
- **Timing oracle on `GetUserByEmail`** — Round 2's read of AC3 "privacy" text was wrong; AC3 governs response body, not response timing.
- **`pre2_2Purge` slog.Warn** — this IS the C3-20 fix; upgrading to a counter is polish, not a regression.
- **`InvitesSent` counter naming** — documented in AC3 contract as "count of NEWLY-CREATED invite rows".
- **Response `Invites[].Email` leaks class-teacher mapping** — documented as intended AC3 behavior; owner needs it for wizard done-screen.

### Round 2 — Known-accepted verified stable (do NOT re-flag)

- **`-p 1` regression flag** — cross-package DB sharing collision on `owner@example.com`. Amelia's completion notes documented.
- **AuthDB reuse in `TemplateService`/`ClassService`** — Story 2.1 §Architectural Debt Acknowledged; no dedicated `TemplateDB` / `ClassDB` seam.
- **`bufSnapshot` helper** — non-consuming body reads for multi-assertion ATDD tests; semantics unchanged.
- **AC11 subtest reordering** — deterministic sequencing preserved verbatim assertions.
- **`SECURITY DEFINER` on `sync_template_sessions_center_id`** — removes RLS-filter foot-gun; primary defense remains WITH CHECK on `template_sessions_update`.
- **`GetActiveInviteByEmail` uses `sqlc.arg`** — cosmetic generated-Go field naming.
- **`model.FieldError.Code` additive field** — backward compatible per C2-03.

## Dev Agent Record + File List

Moved to sibling per `docs/bmad-story-conventions.md`: see [`2-2-class-template-and-spawning-api-completion-notes.md`](./2-2-class-template-and-spawning-api-completion-notes.md) (created at first dev pickup).

## Change Log

- 2026-07-06 — Amelia: **Round 2 review complete — 33 of 34 patches applied inline; status transitioned review → done.** `/bmad-code-review 2-2` (second pass on a different Opus 4.7 1M session) surfaced 5 decision-needed + 30 patches + 6 defers + 11 dismissed. Decisions resolved: R2-D1 → rewrite Sally-B4 belt to compare against raw `callerInfo.Email` (SELF_INVITE_BLOCKED belt is now reachable — real normalization drift fires it); R2-D2 → new sqlc `CountCenterMembersByUserAndCenter` query + swap Branch B verification call (belt-and-suspenders against RLS drift, no more "safe only because RLS" invisibility); R2-D3 → Founder auto-assign returns 500 on corrupt caller email row (aligns with AC6 MUST rather than silently downgrading to Branch D); R2-D4 → accept seed-migration NO FORCE window as maintenance-window-replay-only policy (filed R2-W7 in deferred-work.md, no code change); R2-D5 → duplicate cohortName rejected at service layer with per-index `DUPLICATE_COHORT_NAME` field error. **34 patches → 33 applied + 1 filed as follow-up FU-2-2-L**: (a) config + main.go wiring for `AppInviteURLBase` — `ClassService.SetAcceptURLBase(cfg.AppInviteURLBase)` is now called at startup and `Validate()` rejects an empty value in non-dev (R2-P1 STRONG — prevents localhost invite URLs shipping to real teachers in prod); (b) CRLF/control-char strip on `centerName` + `inviterName` before `RenderInviteEmail` (R2-P2 STRONG — SMTP header injection); (c) `context.WithoutCancel(parentCtx)` for post-commit Enqueue loop + `cancel()` immediately after `tx.Commit` (R2-P3 — no more silent per-bucket email drops on spawnDeadline expiry mid-loop); (d) `RELEASE SAVEPOINT invite_insert` on reuse-existing branch (R2-P4 — no more savepoint stacking); (e) `store.SetTenantContext` swap in ExtractTenant middleware (R2-P5 — uniform pattern across the codebase); (f) email PII redacted via `hashEmailForLog` in slog.Info (R2-P21) + `request_id` correlation on every spawn slog call (R2-P22); (g) `floatToNumeric` / `numericToFloat` now surface errors instead of silently clamping/returning 0 (R2-P8/P9 — DB corruption no longer hides as valid band 0); (h) `TemplateService` returns typed `InvalidTenantClaimError` on `uuid.Parse(tc.CenterID)` failure (R2-P19 — AC13 taxonomy respected); (i) audit records `numericToFloat(tmpl.TargetBand)` not raw input (R2-P20 — forensic truth-preservation); (j) dead-import sentinels + unused `errors`/`pgx` imports removed from `template.go` (R2-P10); (k) startDate boundary truncated to UTC day (R2-P27 — no more midnight-jitter false-rejects); (l) Branch A response uses `callerInfo.Email` (DB value) not `payloadNormalized` (R2-P25); (m) `Content-Type: application/json` gate → 415 (R2-P23) + Content-Length pre-flight → 413/422 (R2-P24); (n) 8 test hardenings landed: `signAccessTokenWithCenter` ORDER BY created_at (R2-P7 — deterministic multi-membership tiebreak), unused `authSvc` deleted (R2-P11), `_ = templateID` removed (R2-P12), all 4 RLS UPDATE tests always re-read regardless of err (R2-P13 — SAVEPOINT wraps the raise path so 42501 doesn't abort the TxDB harness), AC11 header_center_spoof asserts attacker got exactly 1 class (R2-P14 — closes SEC-7 positive-side gap), AC04b assertion tightened to `explicit_self` only (R2-P15), `TestSpawn_NonexistentTemplateID_Returns404` added (R2-P17), `SeedCenterForUser` rewritten to use `set_config($1, true)` bind (R2-P28 — no more string-concat SQL in test helpers), `pre2_2Purge` scoped to owner-role centers only (R2-P29 — cross-user residue closed); (o) AC11 spec prose amended to document the C2-10 DisallowUnknownFields posture (R2-P18); (p) 6 defers filed under `deferred-work.md#code-review-of-story-2-2-class-template-and-spawning-api-2026-07-06` (R2-W1..R2-W6) plus R2-W7 (seed migration maintenance-window policy from R2-D4). **R2-P16 SKIPPED as design gap**: `TemplateHandler` accepts concrete `*service.TemplateService` not an interface, so a stub-injected `SEED_INCOMPLETE` handler test would require extracting a `TemplateSvc` interface at the handler seam — filed as **FU-2-2-L** (extract handler-boundary interface then land the missing SEED_INCOMPLETE handler test). C3-13's service-level `CountSystemTemplates` unit test proves the counting logic; the handler's single-literal `WriteError(..., "SEED_INCOMPLETE", ...)` line is trivially trusted. **Regression**: `go test -race -count=1 -p 1 ./...` green across all 14 packages (11.2s for `internal/test` = RLS + ATDD suite). **Codegen**: `scripts/codegen.sh` re-run for the new sqlc query (`CountCenterMembersByUserAndCenter`) — regenerated `internal/store/generated/center_members.sql.go` + `classlite-web/src/lib/api/client.ts` (no api.yaml drift this pass, so TS output byte-identical). **Also NEW config env var**: `APP_INVITE_URL_BASE` (required in non-dev). Hand-off: merge to main.
- 2026-07-03 — Amelia: **green-phase implementation complete.** All 13 ACs green with tests; 23 RLS tests pass (R1 discharge); 12 handler ATDD tests + 11 service ATDD tests + 3 middleware ATDD tests all green. 5 migration pairs shipped + down/up round-trip clean. Full regression `go test -race -count=1 -p 1 ./...` green. Status transitioned in-progress → review. Sibling completion-notes authored at `2-2-class-template-and-spawning-api-completion-notes.md`. Pragmatic deviations: (1) `ExtractTenant` middleware fixed to open tx + SET LOCAL for center_members lookup (latent production bug — pool queries can't see RLS-scoped rows without tenant context); (2) `model.FieldError` extended with `Code` field for AC13 per-field codes; (3) ATDD test helpers `bufSnapshot` (non-consuming body reads) + AC11 subtest reordering (assertions verbatim per §9 preservation); (4) `-p 1` required for full regression to serialize cross-package DB access. Two NEW filed follow-ups: FU-2-2-G (backfill FOR UPDATE + WITH CHECK on center_members/invites/audit_logs) + FU-2-2-H (Story 3.1 `invite_expired` state computation). Hand-off: `/code-review 2-2` on a different LLM.
- 2026-07-03 — John: **party-mode review amendments folded.** Sally + Winston + Amelia + Murat reviewed as independent subagents in parallel; John ruled the calls and applied inline. **14 BLOCKERs accepted** (Sally B1-B4, Winston W-B1..W-B3, Amelia A-B1..A-B4, Murat M-B1..M-B3 — Amelia-A-B2 folded as duplicate of Winston-W-B2) plus **Winston-W-S5 promoted BLOCKER→FOLDED** (pre-tx template read would 404 own custom templates), plus **Sally-S1** (5th seed Academic Reading 6.5) and **Winston-W-S3** (classes_teacher_mutex CHECK constraint) accepted as cheap amendments. Highest-leverage folds: (a) **AC3 response payload** expanded to surface `pendingTeacherEmail`, `teacherAssignmentReason` (5-value enum incl. `"founder_auto"`), and top-level `invites[]` array with `{email, classIndices, enqueued, reusedExistingInvite, expiresAt}` — Sally-B1 + B2 + S6 fold: the wizard's done screen (s04/s06) can now render the truth to the owner without a second round-trip; (b) **AC4 branch ordering pinned as Branch A → B → C** with Branch B > C precedence after prior invite acceptance (Murat-M-B3) + Branch A normalizes both sides symmetrically (Sally-B4) + `422 SELF_INVITE_BLOCKED` belt against a normalization drift regression; (c) **AC7 four RLS policies per table** (SELECT / INSERT / UPDATE / DELETE) with explicit `WITH CHECK` on UPDATE — closes Winston-W-B1 hostile-tenant-reparents-to-tenantB-or-NULL attack; (d) **AC10 grows from 18 → 23 named tests** — 2 extensions on `class_templates` (dual-scope positive + system-seed write protection per Murat-M-B2) + 3 extensions on `template_sessions` (trigger reconciliation + parent-mismatch WITH CHECK rejection + user-cannot-plant-under-system-seed per Murat-M-B1); (e) **NEW AC13 error code catalog** with per-endpoint code → wizard-route mapping (`AUTHENTICATION_REQUIRED`, `EMAIL_VERIFICATION_REQUIRED`, `CENTER_REQUIRED`, `RATE_LIMITED`, `SEED_INCOMPLETE`, `VALIDATION_ERROR`, `TEMPLATE_NOT_FOUND`, `INVALID_TEACHER_EMAIL`, `SELF_INVITE_BLOCKED`, `INTERNAL_ERROR`) — Sally-B3 fold: en.json + vi.json now key on stable identifiers, wizard router has explicit contract; (f) **Task 2.4 seed migration** dropped `SESSION AUTHORIZATION classlite` (fragile in Railway prod per Winston-W-B2 + Amelia-A-B2), uses temporary `NO FORCE ROW LEVEL SECURITY` window + `ON CONFLICT (id) DO NOTHING` for idempotent re-runs; (g) **Task 7.2 spawn tx flow** rewritten to move template read INSIDE the tx after `SET LOCAL` (Winston-W-S5 promoted — otherwise custom templates 404 to their own creators), Branch B membership check inside tx for RLS scoping, tokens are base64.RawURLEncoding (not hex — Amelia-A-B4 fix); (h) **Task 9.4 middleware chain** reorders `onboardingLimit` BEFORE `RequireVerifiedEmail` (Winston-W-B3) closing the center-less-flood attack + adds `spawnLimit` (5/min IP) per Winston-W-S4 to bound Resend spend; (i) **Task 3.5 dropped `GetUserByEmailCI`** — reuse existing `GetUserByEmail` with service-layer normalization (Amelia-A-B1 + [[feedback_check_prior_story_artifacts_before_generating]]); (j) **Task 12.2 gains 2 new service tests** — `TestClassService_Spawn_PostAcceptReInviteLandsInBranchB` (Murat-M-B3) + `TestClassService_Spawn_InviteEnqueueBufferFullSucceedsBestEffort` (Murat-M-S3); (k) **Task 2 migrations timestamped `20260703120000..20260703120400`** (Amelia-A-B3 — full-day gap from Story 2.1's `20260702` range leaves room for concurrent Story 3.1 work at `20260704+`); (l) **AC1 completeness threshold** raised from ≥4 to ≥5 (Sally-S1 fifth seed Academic Reading 6.5 closes Vietnamese uni-admissions Reading-standalone gap); (m) **classes_teacher_mutex CHECK constraint** (Winston-W-S3) prevents Epic 7 from leaving `pending_teacher_email` populated after flipping `teacher_id`. **Cross-agent convergences noted**: Sally-B4 + Amelia-A-S1 + Winston-W-S5 all pointed at "tenancy-set ordering / normalization symmetry" — same root class; folded together in Task 7.2. Winston-W-B1 + Murat-M-B1/M-B2 were the same threat surface (RLS UPDATE hole + missing negative tests catching it) — folded together in AC7 + Task 10. **Deferred as-STRONGs** to Dev Notes tightening rather than ACs: Winston-W-S1 (statement_timeout defensive posture — add code comment), Winston-W-S2 (deadlock ordering comment), Sally-S2 (reusedExistingInvite bool — already added in AC3 fold), Sally-S3 (invite_expired needs Story 3.1's read path — DEFER as FU-2-2-H), Sally-S4 (retry semantics not idempotent — dev-note only), Sally-S5 (autosave boundary — one-line clarification), Amelia-A-S1..A-S8 (impl-note; noted for reviewer). **Filed follow-up added**: FU-2-2-G (backfill FOR UPDATE + WITH CHECK on `center_members`, `invites`, `audit_logs` next time those migrations are touched — Winston-W-B1 fold-forward). FU-2-2-H (Story 3.1 read path computes `invite_expired` state — Sally-S3 punt). Net story-file delta: 496 → ~630 lines (+27%) — flagged for code-review reviewer attention (bmad-story-conventions 600-line ceiling exceeded by ~5%; density is load-bearing per party-mode rulings — ATDD test enumeration, error catalog, response payload contract are NOT prunable). Story stays `ready-for-dev`. Hand-off unchanged: `/bmad-tea AT 2-2` next (mandatory, R1 = 9), then `/bmad-dev-story 2-2`.
- 2026-07-02 — John: pre-dev context engine pass against baseline `26c569b` (Story 2-1 done). 12 ACs cover the 3 new endpoints (GET /api/templates, POST /api/templates, POST /api/templates/{id}/spawn) with FOUR backend-reality reframes pinned inline: (1) templates are dual-scope (system seeds `center_id IS NULL` + tenant-owned) via one table + dual-scope RLS policy; (2) spawn is atomic all-or-nothing (differs from R18/Story 2.7 CSV partial-success semantic — flagged for epic gate); (3) invite email is out-of-tx best-effort via `EmailRetryQueue` (reuse Story 1.4); (4) teacher assignment is decoupled from `center_members.role` — Founder auto-assign sets `classes.teacher_id`, not center role (mirrors Story 2.1 uniform-owner ruling per Sally-B1). **Risk score ≥6 check: R1 owns THREE new resource families (`class_templates`, `template_sessions`, `classes`) — J15 6-pattern grid × 3 files mandatory before backlog → in-progress.** ATDD red phase MANDATORY via `/bmad-tea AT 2-2` (Task 0). NEW `RequireCenterContext` middleware sits between `RequireVerifiedEmail` and rate limit, returning `403 CENTER_REQUIRED` for callers who finished Story 2.1's persona pick but never POSTed a center. NEW partial unique index `idx_invites_center_email_active` (Task 2.5) enforces per-center-per-email invite dedup at DB with belt-and-suspenders application-layer dedup in `ClassService.Spawn`. Four pre-built templates pinned with deterministic UUIDs for testability (Writing Bootcamp 6.5, Speaking Mastery 7+, Foundation Listening+Reading, Starter Band 5.5 All Skills) — down migration deletes by fixed UUID only. Six filed follow-ups: FU-2-2-A (template_sessions drift audit), FU-2-2-B (cross-center teacher borrow), FU-2-2-C (partial spawn), FU-2-2-D (full 12-session syllabus deferred to Epic 4), FU-2-2-E (claim-the-class on invite accept — Epic 7 Story 7.1), FU-2-2-F (user-keyed rate limit variant, shared with FU-2-1-E). Story file 480 lines — under bmad-story-conventions 600 ceiling. Sibling completion-notes file deferred to first dev pickup per docs/bmad-story-conventions.md. Hand-off sequence: `/bmad-tea AT 2-2` next (mandatory, R1 = 9), then `/bmad-dev-story 2-2`.
