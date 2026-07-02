# Story 2.1: Onboarding API — Persona Selection, Center Setup & Save/Resume

Status: ready-for-dev

<!-- Baseline commit: d528444 (Epic 1 fully closed, Epic 2 open, R1 mitigation shipped 2e49d4e). -->
<!-- Pre-dev context engine pass by John. Amelia (dev) picks this up next; /bmad-tea AT MUST run before backlog → in-progress transition (R1 score 9). -->

## Story

As a **newly-verified user completing onboarding**,
I want the server to persist my persona choice, the center I create, and my progress at every step,
so that I can close the browser mid-flow and resume exactly where I left off — and so my first center is bound to me as its Owner from the moment it exists.

## Response Envelope Contract (applies to every AC below)

Every 2xx response from THIS story's four endpoints returns:
```json
{ "data": <endpoint-specific>, "meta": { "serverTime": "<ISO-8601 UTC>" } }
```

`meta.serverTime` is the server's `now()` at response render time, ISO-8601 UTC (e.g. `2026-07-01T09:14:33.021Z`). The wizard uses it to compute "auto-saved Ns ago" client-side without trusting `Date.now()` (UX §8.1 line 450 — persistent auto-save affordance). Extract to a shared envelope helper (`internal/handler/response.go` — extend the existing `WriteJSON` or add `WriteEnvelope`). Cost: one line at write time; benefit: whole class of clock-skew UX bugs closed.

## Acceptance Criteria

1. **Persona persistence.** `POST /api/onboarding/persona` with `{ "persona": "operator" | "founder" | "solo_teacher" }` writes to `users.persona` for the authenticated caller and returns `200 { "data": { "persona": "<value>" }, "meta": { "serverTime": … } }`. Unknown persona values → `422 VALIDATION_ERROR`. Missing auth → `401 AUTH_REQUIRED`. Unverified email → `403 EMAIL_VERIFICATION_REQUIRED`. Idempotent: a repeat POST with the same value returns `200` (not `409`) — the wizard may re-hit this on browser back.

2. **Center creation with Owner binding.** `POST /api/centers` with `{ "name": string, "brandColor": string | null, "logoUrl": string | null }` — in a **single DB transaction** — inserts a row into `centers`, auto-generates a unique `short_code` (see AC5), inserts a `center_members` row with `role = 'owner'` for the caller, writes an `audit_logs` row `center.created`, and returns `201 { "data": { "id", "name", "shortCode", "brandColor", "logoUrl", "timezone", "role": "owner", "accessToken": "<fresh JWT with center+role claims>", "expiresAt": "<ISO-8601>" }, "meta": { "serverTime": … } }`. If the caller **already has a `center_members` row**, respond `409 USER_ALREADY_HAS_CENTER` (v1 supports one center per user — multi-center is deferred). Missing auth → `401`. Unverified email → `403 EMAIL_VERIFICATION_REQUIRED`. Validation failures → `422`. **Role is `owner` regardless of persona choice** — Solo Teacher / Founder / Operator all get `role=owner` in v1 because the creator IS the sole member. Persona drives UI labeling ("solo workspace" for Solo Teachers), NOT authorization. See `FU-2-1-F` for post-v1 reconsideration.

3. **Onboarding progress upsert.** `PUT /api/onboarding/progress` with `{ "currentStep": string, "payload": object }` upserts (INSERT ON CONFLICT) a single row per user in a NEW `onboarding_progress` table keyed by `user_id`. `currentStep` ∈ `{ "persona", "center", "template", "spawn", "solo_first_class", "done" }`. `payload` is a typed JSONB struct — `{ schemaVersion: 1, personaChoice: string|null, centerDraft: {name, brandColor, logoUrl}|null, templateDraft: object|null }`. Server captures `updated_at = now()`. Returns `200 { "data": { "currentStep", "payload", "updatedAt" }, "meta": { "serverTime": … } }`. Unknown `currentStep` → `422`.

4. **Onboarding progress read.** `GET /api/onboarding/progress` returns the caller's saved progress. Response shape: `200 { "data": { "currentStep": "<step>", "payload": <object|null>, "updatedAt": <ISO-8601|null>, "persona": <"operator"|"founder"|"solo_teacher"|null> }, "meta": { "serverTime": … } }`. `persona` is joined from `users.persona` (single query — `SELECT p.*, u.persona FROM onboarding_progress p LEFT JOIN users u ON u.id = p.user_id WHERE p.user_id = $1` OR two queries in one tx — dev's call). When no progress row exists, respond `200 { "data": { "currentStep": "persona", "payload": null, "updatedAt": null, "persona": <users.persona or null> } }` — never `404`; the wizard treats "no progress yet" as "start at persona pick," not as an error. `persona` non-null when the user has completed AC1 but never PUT progress — the wizard uses this to skip AC1's screen on resume.

5. **`short_code` auto-generation.** Server derives an initial short_code from `slugify(name)` (lowercase ASCII, hyphens, max 30 chars). If the slug collides with an existing `centers.short_code`, append `-<random 4-char base32>` and retry up to **5 times**. On the 5th failure, respond `500 INTERNAL_ERROR` — this is a signal something is wrong (e.g. slug too generic). `centers.short_code` **must remain globally unique** — the DB unique index enforces at the write boundary (EDGE-1). Race behavior: the retry sees the winner's row on the next attempt. Collision detection is **case-insensitive** — `Center A` and `CENTER A` both slugify to `center-a`; the second creator gets a suffix. Since `slugify` output is already lowercase and the DB index is on the lowercase form, case-sensitivity is handled at the slug layer, not by a functional index.

5b. **Vietnamese slugify canonical test set.** `Slugify` MUST produce exactly these outputs — the ATDD suite pins them as literal string assertions:

| Input | Required Output |
|---|---|
| `Trung tâm Anh ngữ Sài Gòn` | `trung-tam-anh-ngu-sai-gon` |
| `Anh Văn Hội Việt Mỹ` | `anh-van-hoi-viet-my` |
| `Trường Đại học FPT` | `truong-dai-hoc-fpt` |
| `ĐH Ngoại Ngữ` | `dh-ngoai-ngu` |
| `English & Beyond` | `english-beyond` |
| `   Multi   space   ` | `multi-space` |
| `!!!` (all-punctuation) | `` (empty — caller must retry with a random fallback slug) |

Vietnamese is ~90% of end-user input per project-context. Naïve `strings.Map(unicode.IsLower)` produces `trung-t-m-anh-ng-...`, which is unusable — the slugify implementation MUST preserve diacritic-stripped consonants + vowels correctly.

6. **Audit trail.** Every successful center creation writes an `audit_logs` row `{ action: 'center.created', center_id, user_id, entity_type: 'center', entity_id: <center_id>, changes: { before: null, after: { name, short_code, brand_color, logo_url } } }`. Persona changes and onboarding_progress upserts do **NOT** write to `audit_logs` — those are UI-state operations, not compliance-audited events (a business decision to keep the audit trail focused). The audit INSERT runs **inside the same transaction** as the center + center_members INSERTs so a failed audit rolls back the whole set (defensive: if audit_logs is broken we'd rather refuse the operation than lose the trail). The existing `service.AuditService.Log()` opens its own transaction — see the reality-check note in Dev Notes and Task 7.5 for the required `LogWithinTx` extraction.

7. **RLS enforcement on `onboarding_progress`.** The `onboarding_progress` table is scoped by `user_id`, not `center_id` (pre-center state) — RLS is NOT applied to this table. Isolation is enforced at the service layer via the `user_id` filter, mirroring the pattern used by `email_verifications` (see migration `20260601120000_create_auth_tables.up.sql` §4 header comment). AC10 asserts a cross-user read isolation test as compensation for the missing RLS. `centers` remains a global table with no RLS (unchanged from Epic 1). `center_members` insertion during POST /api/centers happens under the newly-created center's `app.current_tenant_id` (SET LOCAL after the INSERT INTO centers … RETURNING id).

8. **Middleware chain.** Onboarding + center endpoints all sit behind: `RequestID → ClientIP → Logger → CORS → OriginCheck → RateLimit → ExtractTenant → RequireVerifiedEmail → handler`. `RequireVerifiedEmail` is a NEW middleware introduced by this story that returns `403 EMAIL_VERIFICATION_REQUIRED` when `users.email_verified = false`. `ExtractTenant` passes cleanly with an empty `CenterID`/`Role` for pre-center users — do not add code that special-cases empty tenant. Per-route rate limit: 20 req/min per authenticated user (higher than login's 8/min — onboarding is a burst-y wizard, not a credential-guessing surface).

9. **R1 discharge (score 9) — J15 grid adapted for non-RLS `onboarding_progress`.** A new `onboarding_progress_rls_test.go` file, scaffolded from `internal/test/_TEMPLATE_rls_test.go`, MUST land the six adapted assertions BEFORE this story's backend transitions to `review`. Since `onboarding_progress` has NO RLS, each pattern targets a specific service-layer bug (not an RLS regression). **Six named patterns to land — each pattern MUST exist as its own `Test*` function so a red-phase reviewer can verify by checklist:**

   1. **P1-Read** `TestOnboardingProgress_ServiceForgetsUserIDFilter` — Setup: user A has progress. Call: `svc.GetProgress(ctx, userB)` after tenant/user-context has been set to A. Assert: returns userB's default state, NOT userA's row. Catches: service `SELECT * FROM onboarding_progress` (missing user_id filter).
   2. **P2-Insert** `TestOnboardingProgress_ServiceTrustsPayloadUserID` — Setup: valid user A context. Call: service accepts an input struct that includes `userID` in the payload set to userB's ID. Assert: writes for userA (context wins), not userB (payload lied). Catches: service using `input.UserID` instead of `ctxUserID`.
   3. **P3-Update** `TestOnboardingProgress_UpsertTrustsPayloadUserID` — Same shape as P2 but on the upsert path with an existing userA row. Assert: overwrites userA's row, leaves userB's row untouched. Catches: upsert-side variant of the P2 bug.
   4. **P4-Delete** N/A — this story ships no delete endpoint. **Document as N/A in the test file with a comment referencing this AC line** — do NOT silently omit; the omission is load-bearing evidence for the epic gate.
   5. **P5-NoAuthFallback** `TestOnboardingProgress_NoAuthContextRejects` — Call: handler invoked with request whose context has NO `TenantContext.UserID`. Assert: 500 `INTERNAL_ERROR` (mirrors `RequireRole`'s missing-context posture), NEVER falls back to a "default" or "system" user. Catches: handler with `if userID := tc.UserID; userID == "" { userID = someFallback }`.
   6. **P6-DefaultStateNoCache** `TestOnboardingProgress_DefaultStateFromPgxErrNoRowsDoesNotLeakPrior` — Setup: request 1 for user A returns real progress. Request 2 for user B (who has none) — service sees `pgx.ErrNoRows`, returns default state per AC4. Assert: the default-state response for B does NOT contain any fields from A's response (guards against service-level singleton / package-var cache bugs — real Go footgun given AC4's "return default not error" semantics).

   Additionally: `centers` is global — no J15 grid for centers itself. The **`center_members` one-per-user invariant** gets its own single test `TestCenterMembers_UserUniqueViolation` (Task 10.2). The **`centers.short_code` collision race** gets `TestCenters_SlugCollisionRegeneration` under `SetupRawPool` (Task 10.3, see B3 rewrite).

10. **Cross-user data isolation — three named attack-vector subtests.** Handler integration test (`internal/handler/onboarding_handler_test.go`) covering the realistic bug classes, each as its own `t.Run(...)` subtest. Mirrors `internal/test/auth_v15_adversarial_test.go` posture:

   - **`attack_vector_url_param_override`** — Attacker calls `GET /api/onboarding/progress?user_id=<victim>` (or any query param the handler might parse). Server MUST ignore the param and resolve UserID from `TenantContext` only. Assert: response contains attacker's default state, NOT victim's row.
   - **`attack_vector_body_field_override`** — Attacker calls `PUT /api/onboarding/progress` with `{ "userId": "<victim>", "currentStep": "done", "payload": {...} }`. Server MUST ignore the body's userId and write for the authenticated user. Assert: victim's `onboarding_progress` row is untouched; attacker's row is written.
   - **`attack_vector_header_spoof`** — Attacker calls with `X-User-ID: <victim>` (or `X-Center-ID`, `X-Onboarding-User`, any plausible header). Server MUST ignore custom headers — user identity is JWT-only. Assert: response reflects the authenticated user, not the header value.

   All three subtests use a real HTTP round-trip through `test.NewTestServer(pool)` so middleware order is exercised (per Murat's what-not-tested item on chain-order integration). Additionally: assert that `GET /api/onboarding/progress`'s response body does NOT contain any of user A's field values as a byte-level negative when called as user B (DOM-wide privacy ratchet pattern — mirrors Story 1.9c's REST-path ratchet).

## Tasks / Subtasks

- [ ] **Task 0 — ATDD red phase (MANDATORY per WF-8, R1 score 9)** (AC: #1–#10)
  - [ ] 0.1 Run `/bmad-tea AT 2-1` after this story is `ready-for-dev` and before Amelia flips it `in-progress`. Expected output: red-phase specimens under `classlite-api/internal/handler/*_atdd_test.go` covering AC1/AC2/AC4/AC8 happy + negative paths, AND `classlite-api/internal/test/onboarding_progress_rls_test.go` scaffolded from `_TEMPLATE_rls_test.go` covering AC9's six patterns.
  - [ ] 0.2 Verify red specimens actually fail on the pre-implementation branch (they SHOULD — no handler code exists yet). Commit the red suite BEFORE any green code lands.

- [ ] **Task 1 — API spec updates (WF-1 gate — edit only, no codegen here)** (AC: #1–#5, #8)
  - [ ] 1.1 Add to `classlite-api/api.yaml`: `POST /api/onboarding/persona`, `POST /api/centers`, `PUT /api/onboarding/progress`, `GET /api/onboarding/progress` with full request/response schemas, error responses (`401`, `403 EMAIL_VERIFICATION_REQUIRED`, `409 USER_ALREADY_HAS_CENTER`, `422`, `500`). Every 2xx response schema references a common `EnvelopeMeta` object with `serverTime: string (date-time)` — the shared envelope pattern from AC preamble. Follow existing conventions: `Envelope<Result>` shape, `ErrorEnvelope`, camelCase JSON fields.
  - [ ] 1.2 **No codegen here.** Codegen runs ONCE at Task 3.5 after both api.yaml AND `.sql` files land (per WF-3 "codegen must be the LAST script you run"). Running codegen twice generates the TS client against a schema whose backing DB migrations haven't shipped yet.

- [ ] **Task 2 — Migrations** (AC: #3, #7, #9)
  - [ ] 2.1 Create migration pair `{ts}_add_users_persona.up.sql` / `.down.sql`. Adds `users.persona text` (nullable) with a CHECK constraint restricting values to the three persona strings.
  - [ ] 2.2 Create migration pair `{ts}_create_onboarding_progress.up.sql` / `.down.sql`. Schema: `user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE`, `current_step text NOT NULL`, `payload jsonb NOT NULL`, `updated_at timestamptz NOT NULL DEFAULT now()`. **No RLS on this table** — write the "isolation enforced at service layer via user_id filter, mirrors email_verifications" comment at the top of the migration file exactly like `20260601120000_create_auth_tables.up.sql` §4 does. Add a CHECK constraint on `current_step`.
  - [ ] 2.3 Create migration pair `{ts}_add_center_members_user_unique.up.sql` / `.down.sql`. Adds `CREATE UNIQUE INDEX idx_center_members_user_id ON center_members(user_id);` — DB-level enforcement of the "one center per user in v1" invariant (AC2's 409 branch). Add rollback that drops the index. **Pre-migration data audit (Godoc header of the .up.sql file):** the migration MUST fail loudly if any existing row violates the invariant. Include this comment block at the top:
    ```sql
    -- Pre-flight audit — run before applying in any env:
    --   SELECT user_id, COUNT(*) FROM center_members GROUP BY user_id HAVING COUNT(*) > 1;
    -- Non-empty result = there's an existing user with >1 membership.
    -- Resolve by hand (typically a dev test fixture from Story 1.6 invite-accept)
    -- before running this migration. R50 (migration rollback drops data, score 6)
    -- guarantees a failed migration is safer than a coerced one.
    ```
    Do NOT add ON CONFLICT DO NOTHING or similar coercion — dropping violating rows silently would be a data-integrity incident under R50.
  - [ ] 2.4 Run the pre-flight audit query manually in dev + staging. If clean, run `scripts/migrate.sh` locally. Confirm all three migrations apply cleanly and roll back cleanly.

- [ ] **Task 3 — sqlc queries** (AC: #1–#5)
  - [ ] 3.1 Extend `internal/store/queries/users.sql` with `UpdateUserPersona` (params: `id`, `persona`). Returns nothing (`:exec`).
  - [ ] 3.2 Extend `internal/store/queries/centers.sql` with `CreateCenterFull` — takes name, short_code, brand_color, logo_url, returns full row. The existing `CreateCenter` only takes name + short_code; do NOT edit it (it's used by fixtures). Add a NEW query.
  - [ ] 3.3 Create `internal/store/queries/onboarding_progress.sql` with:
    - `GetOnboardingProgressByUser :one` — `WHERE user_id = $1`, returns `pgx.ErrNoRows` when absent.
    - `UpsertOnboardingProgress :one` — `INSERT ... ON CONFLICT (user_id) DO UPDATE SET current_step = EXCLUDED.current_step, payload = EXCLUDED.payload, updated_at = now() RETURNING …`.
  - [ ] 3.4 (SKIP — do NOT run codegen here; consolidated to Task 3.5 per WF-3.)
  - [ ] 3.5 **Run `scripts/codegen.sh` ONCE** — the sole codegen invocation per WF-3 ("codegen must be the LAST script you run"). Regenerates in one pass: (a) TS client `classlite-web/src/lib/api/client.ts` + Zod schemas from `api.yaml` (Task 1.1), (b) Go sqlc output `classlite-api/internal/store/generated/*.sql.go` from `.sql` files (Tasks 3.1–3.3). Verify: `onboarding_progress.sql.go` is newly created; `users.sql.go` includes `UpdateUserPersona`; `centers.sql.go` includes `CreateCenterFull`; TS types include the 4 new operations + `EnvelopeMeta`. **DO NOT hand-edit generated files** (XL-1).

- [ ] **Task 4 — Model: typed JSONB payload struct** (AC: #3)
  - [ ] 4.1 Create `internal/model/onboarding_payload.go` with `OnboardingPayload` struct — `SchemaVersion int`, `PersonaChoice *string`, `CenterDraft *CenterDraft`, `TemplateDraft *json.RawMessage` (template shape is Story 2.2's problem — carry it as opaque JSON now). Per GO-7: typed struct with `schemaVersion`, never `map[string]interface{}`.
  - [ ] 4.2 Add `Migrate(raw json.RawMessage) (OnboardingPayload, error)` helper that decodes and upgrades legacy versions (v1 only for now — helper is a forward-compat seam per GO-7).

- [ ] **Task 5 — Middleware: extend `TenantContext` + new `RequireVerifiedEmail`** (AC: #8)
  - [ ] 5.0 **Extend `model.TenantContext` with `EmailVerified bool`.** Update `internal/model/tenant.go`: add `EmailVerified bool` field. Update `internal/middleware/auth.go:98-102`: `ExtractTenant` already fetches the user row at line 59; extract `EmailVerified` from that same row (`user.EmailVerified`) and populate the new field when building the `TenantContext`. **DO NOT** add a second `GetUserByID` call — the existing one has everything we need. Update the test file `internal/middleware/extract_tenant_context_test.go` to assert the new field is populated correctly.
  - [ ] 5.1 Create `internal/middleware/require_verified_email.go`. Signature mirrors `RequireRole` exactly (`require_role.go:36-55`): `func RequireVerifiedEmail() func(http.Handler) http.Handler` — **no DB dependency**, pure context-check middleware. Reads `TenantContext.EmailVerified` from context (500 `INTERNAL_ERROR` if `TenantContext` absent — programming error, mirrors `RequireRole`'s pattern), rejects with `403 EMAIL_VERIFICATION_REQUIRED` when `EmailVerified == false`. Uses the same `writeMiddlewareJSON` helper. Add ATDD test `require_verified_email_atdd_test.go` covering three cases: verified passes, unverified rejects, missing-context 500s. **No AUTH_USER_GONE / transient-DB-error cases needed** — those live on `ExtractTenant` (this middleware never touches the DB).

- [ ] **Task 6 — Service: `OnboardingService`** (AC: #1, #3, #4)
  - [ ] 6.1 Create `internal/service/onboarding.go`. Struct `OnboardingService` with `db AuthDB` (reuse the AuthDB seam Epic 1 shipped — no new pool abstraction). Methods:
    - `UpdatePersona(ctx, userID uuid.UUID, persona string) error` — validates persona value, calls `UpdateUserPersona`. Returns `model.ValidationError` on unknown persona.
    - `GetProgress(ctx, userID uuid.UUID) (*OnboardingProgress, error)` — returns default-state struct when `pgx.ErrNoRows`. Does NOT propagate `pgx.ErrNoRows` upward.
    - `UpsertProgress(ctx, userID uuid.UUID, in UpsertProgressInput) (*OnboardingProgress, error)` — validates currentStep + payload (marshals through `OnboardingPayload` for type-check), calls sqlc upsert.
  - [ ] 6.2 Never use `context.Background()` in service methods (GO-4). Always propagate incoming `ctx`.
  - [ ] 6.3 Errors: use `model.ValidationError` for input problems, `model.NotFoundError` never (AC4 returns default state instead of 404), stdlib `fmt.Errorf("wrap: %w", err)` for infrastructure failures (GO-2 + CQ-5).

- [ ] **Task 7 — Service: `CenterService` + `AuthService.MintAccessToken`** (AC: #2, #5, #6, #7)
  - [ ] 7.1 Create `internal/service/center.go`. Struct `CenterService` accepts **interfaces at the constructor**, not concrete types:
    ```go
    type AuditLogger interface {
        LogWithinTx(ctx context.Context, tx pgx.Tx, tc model.TenantContext,
                    action, entityType string, entityID uuid.UUID, changes any) error
    }
    type accessTokenIssuer interface {
        MintAccessToken(ctx context.Context, userID uuid.UUID,
                        centerID *uuid.UUID, role string) (string, time.Time, error)
    }
    type CenterService struct {
        db          AuthDB
        clock       clock.Clock
        audit       AuditLogger
        tokenIssuer accessTokenIssuer
    }
    ```
    Production wires `*service.AuditService` (Task 7.5) as `AuditLogger` and `*service.AuthService` (Task 7.6) as `accessTokenIssuer`. Tests inject a `brokenAuditLogger` for Task 11.2's atomicity red test. Method: `CreateCenter(ctx, userID uuid.UUID, in CreateCenterInput) (*CreateCenterResult, error)` — result includes `AccessToken` + `ExpiresAt` (see AC2).
  - [ ] 7.2 **Rewritten transaction flow** (AC2 + AC6 + Winston-B2 fix). Center UUID is pre-generated in Go via `model.NewID()` (Task E) so `SET LOCAL` runs BEFORE any tenant-scoped write:
    1. `centerID := model.NewID()` — pre-generate Go-side.
    2. `BEGIN`.
    3. Pre-check: `SELECT count(*) FROM center_members WHERE user_id = $1`. If ≥1 → return `model.ConflictError{Code: "USER_ALREADY_HAS_CENTER"}` and rollback. (409 pre-check is the suspenders; the DB unique index from Task 2.3 is the belt for the race window — see step 5b remap.)
    4. `SET LOCAL app.current_tenant_id = '<centerID>'` (via `store.SetTenantContext(ctx, tx, model.TenantContext{CenterID: centerID.String()})`). This runs BEFORE any tenant-scoped INSERT so it protects the whole write path — and stays correct if `centers` ever gains RLS in Epic 5+.
    5. Slug loop (max 5 attempts): try `INSERT INTO centers (id, name, short_code, brand_color, logo_url) VALUES ($1, $2, $3, $4, $5) RETURNING …` with `centerID`. If `isUniqueViolation` on `idx_centers_short_code`, regenerate slug with `-<random>` suffix and retry. If unique-violation on any OTHER constraint, propagate (do not swallow).
    5b. Try `INSERT INTO center_members (user_id, center_id, role) VALUES ($1, $2, 'owner')`. If `isUniqueViolation` on `idx_center_members_user_id` (concurrent double-post that beat step 3's pre-check) → remap to `model.ConflictError{Code: "USER_ALREADY_HAS_CENTER"}` and rollback. Any other unique-violation propagates. Match the constraint name via the `pgconn.PgError.ConstraintName` field (pgx v5 idiom).
    6. `audit.LogWithinTx(ctx, tx, tc, "center.created", "center", centerID, model.Changes{Before: nil, After: {name, short_code, brand_color, logo_url}})` — same tx, atomic.
    7. `COMMIT`.
    8. AFTER commit: `tokenIssuer.MintAccessToken(ctx, userID, &centerID, "owner")` — outside the tx (Mint has no DB dependency). Return `(accessToken, expiresAt)` in `CreateCenterResult`.
  - [ ] 7.3 Rollback semantics: any error before step 7 → `tx.Rollback(context.WithoutCancel(ctx))` (mirrors `audit.go:97` pattern for request-cancel resilience). Task 11.2's atomicity test injects a `brokenAuditLogger{err: errors.New("simulated")}` via the constructor seam and asserts zero rows in `centers` + `center_members` after the failed CreateCenter call.
  - [ ] 7.4 **Slug generator (rewritten)** — extract to `internal/service/slug.go` (`func Slugify(name string) string`, `func RandomSuffix(n int) string`). Small pure functions; unit-test independently. **Approach:** (a) NFKC normalize input via `golang.org/x/text/unicode/norm.NFKC`; (b) decompose via `norm.NFD` to separate base characters from combining marks; (c) filter with `unicode.IsMark` to strip all combining marks (this handles á, à, ả, ã, ạ, ê→e, ô→o, ơ→o, ư→u, etc. — most Vietnamese tones are combining marks after NFD); (d) apply a small hard-coded map for characters that do NOT decompose in NFD: `đ→d`, `Đ→D`, `ø→o`, `Ø→O`, `æ→ae`, `Æ→ae` (~6-8 entries, verify empirically against the AC5b test set); (e) lowercase; (f) replace whitespace runs with `-`; (g) strip non-`[a-z0-9-]`; (h) collapse `--+` runs to single `-`; (i) trim leading/trailing `-`; (j) truncate to 30 chars; (k) trim trailing `-` again after truncation. Target ~30 lines. All AC5b entries MUST pass as literal string assertions. If `Slugify(input) == ""` (e.g. `!!!`), the caller in Task 7.2 falls back to `center-<random 6-char>`.
  - [ ] 7.5 Extract `AuditService.LogWithinTx(ctx context.Context, tx pgx.Tx, tc model.TenantContext, action, entityType string, entityID uuid.UUID, changes any) error` — a sibling to the existing `Log()` that takes an externally-managed `pgx.Tx` and does NOT open/commit its own transaction. Refactor `Log()` to call `LogWithinTx()` internally so the existing behavior is preserved bit-for-bit; add a unit test that a rollback on the outer tx also rolls back the audit row. **Necessary because** CenterService.CreateCenter needs the audit INSERT inside its own tx (AC6).
    - [ ] **7.5.1** — `LogWithinTx` MUST NOT call `store.SetTenantContext`. It trusts the caller's tx state and its SET LOCAL. The existing `Log()` keeps the `SetTenantContext` call because it owns the tx. **Godoc contract at the top of `LogWithinTx`:** `// LogWithinTx assumes the caller has already run SET LOCAL app.current_tenant_id on tx. It does NOT re-run SetTenantContext — doing so would either no-op (same value) or corrupt the caller's tx state (different value).` Add a unit test that asserts `LogWithinTx` does NOT touch `app.current_tenant_id` (spy on `tx.Exec`).
  - [ ] 7.6 **`AuthService.MintAccessToken` extraction** (NEW). Signature: `func (s *AuthService) MintAccessToken(ctx context.Context, userID uuid.UUID, centerID *uuid.UUID, role string) (accessToken string, expiresAt time.Time, err error)`. Location: `internal/service/auth.go` (add near `buildAccessToken` at line 315 but as a public sibling). **Do NOT delegate to `buildAccessToken`** — that helper does an implicit `SELECT COUNT(*) FROM center_members` heuristic (auth_login.go:336) which is a cross-tx race for the newly-inserted membership row this story writes. `MintAccessToken` signs claims directly from the passed arguments — no DB lookup, no derivation. When `centerID != nil`, sets `AccessClaims.CenterID` + `AccessClaims.Role`; when nil, emits a claims-less-of-center token (for pre-onboarding minting scenarios future stories may need). TTL = `AccessTokenTTL` (existing constant). Add unit test `TestMintAccessToken_WithCenterAndRole` asserting claims round-trip via `VerifyAccess`. Export `MintAccessToken` publicly so `CenterService` (via the `accessTokenIssuer` interface) can consume it.

- [ ] **Task 8 — Handlers: `OnboardingHandler` + `CenterHandler`** (AC: #1, #2, #3, #4, #8)
  - [ ] 8.1 Create `internal/handler/onboarding_handler.go`. Constructor `NewOnboardingHandler(svc *service.OnboardingService)`. Methods `SetPersona`, `GetProgress`, `PutProgress`. Signature pattern mirrors `AuthHandler.Register` — `func (h *…) X(w http.ResponseWriter, r *http.Request) error`, wrapped by `middleware.ErrorMapper` at the mux.
  - [ ] 8.2 Create `internal/handler/center_handler.go`. Constructor `NewCenterHandler(svc *service.CenterService)`. Method `Create`.
  - [ ] 8.3 Request DTOs — camelCase JSON tags, decode via `json.NewDecoder` with 16 KiB body cap (same `maxAuthRequestBodyBytes` const or a new one). Malformed JSON → `model.ValidationError{Fields: [{Field: "body", Message: "invalid JSON"}]}`.
  - [ ] 8.4 Response DTOs — camelCase, GO-5 (no `omitempty` on response fields). Explicit `null` for absent optional fields.
  - [ ] 8.5 All handlers are methods on typed structs (GFW-1). No free functions.

- [ ] **Task 9 — Wire the routes in `cmd/api/main.go`** (AC: #8)
  - [ ] 9.1 Instantiate services: `onboardingSvc := service.NewOnboardingService(pool)`, `centerSvc := service.NewCenterService(pool, clock.RealClock{})`.
  - [ ] 9.2 Instantiate handlers: `onboardingH := handler.NewOnboardingHandler(onboardingSvc)`, `centerH := handler.NewCenterHandler(centerSvc)`.
  - [ ] 9.3 Instantiate the new middleware: `requireVerified := middleware.RequireVerifiedEmail(pool)`. Instantiate the per-route rate limit: `onboardingLimit := middleware.RateLimitByKey("onboarding", rate.Every(60*time.Second), 20, middleware.IPKeyFn)` — for now key on IP; a user-scoped key would be ideal but adds a body-read shim. IP-keyed is fine for onboarding (attackers don't rate-limit-bypass their way through the wizard).
  - [ ] 9.4 Wire routes:
    ```
    onboardingChain := middleware.ExtractTenant(pool, authSvc.JWTSigner())(
        requireVerified(
            onboardingLimit(http.HandlerFunc(middleware.ErrorMapper(onboardingH.SetPersona))),
        ),
    )
    mux.Handle("POST /api/onboarding/persona", onboardingChain)
    // ... same chain for the other three routes
    ```
  - [ ] 9.5 Verify no route wires `RequireRole` — none of these endpoints have a role gate (persona sets the persona; center creation grants the role).

- [ ] **Task 10 — R1 discharge: J15 grid for `onboarding_progress` + `center_members` new invariants** (AC: #9)
  - [ ] 10.1 Copy `internal/test/_TEMPLATE_rls_test.go` → `internal/test/onboarding_progress_rls_test.go`. Adapt the six patterns per AC9 (since table has no RLS): read/insert/update/delete become "service-layer isolation" assertions calling the service methods with user A's context and asserting user B's rows are invisible/immutable. NullTenant/UnsetTenant collapse to a single "missing user_id filter never leaks" test.
  - [ ] 10.2 Extend `internal/test/adversarial_test.go` with `TestRLS_CenterMembers_UserUniqueViolation` — user creates two centers back-to-back, second attempt returns `USER_ALREADY_HAS_CENTER` and does NOT leave orphan center rows.
  - [ ] 10.3 Extend `internal/test/adversarial_test.go` with `TestCenters_SlugCollisionRegeneration` — two concurrent `CreateCenter` calls with identical names both succeed (one keeps the base slug, the OTHER gets `<slug>-<random>`). **MUST use `test.SetupRawPool(t)`, NOT `SetupDB(t)`** — `SetupDB` wraps in a single `pgx.Tx` that serializes goroutine writes, so no race can materialize. Pattern reference: `internal/service/refresh_atdd_test.go:235` (Story 1.5's concurrent-rotation ATDD test — the canonical raw-pool concurrent-write pattern in this codebase). Explicit cleanup via `t.Cleanup` since raw-pool tests leave residue on failure. **DO NOT assert which goroutine wins the base slug** — pool assignment is non-deterministic. Assert only: (a) both `CreateCenter` calls return nil error, (b) resulting `centers.short_code` values are the base slug AND `<slug>-<4-char-random>` in some order, (c) neither leaves a partial state (both tx commits succeeded).

- [ ] **Task 11 — Handler tests (integration, real middleware)** (AC: #1–#8)
  - [ ] 11.1 `internal/handler/onboarding_handler_test.go` — three cases per endpoint: happy path + AC10 cross-user isolation + unauthenticated. Use `test.NewTestServer(pool)` pattern from Epic 1's handler tests (TEST-BE-3).
  - [ ] 11.2 `internal/handler/center_handler_test.go` — happy path returns owner role + short_code + accessToken + expiresAt (see AC2 response shape); 409 `USER_ALREADY_HAS_CENTER` (sequential double-post — same user hits AC2's pre-check branch); 409 `USER_ALREADY_HAS_CENTER` from **concurrent double-post** (two goroutines via `SetupRawPool` — first passes pre-check + INSERT; second passes pre-check but hits `idx_center_members_user_id` unique-violation; MUST be remapped from raw `23505` to `USER_ALREADY_HAS_CENTER`, NOT surfaced as `INTERNAL_ERROR` — this is the 500-vs-409 race window Murat-S2 named); 422 validation; 403 `EMAIL_VERIFICATION_REQUIRED`; audit_logs row present after success with exact JSONB shape `{"before": null, "after": {...}}`; audit_logs write failure rolls back the center — inject `brokenAuditLogger{err: errors.New("simulated")}` via `CenterService`'s `AuditLogger` constructor seam (Task 7.1), assert zero rows in `centers` and `center_members` and NO orphan audit row.
  - [ ] 11.3 Assert full `{ data, meta }` envelope on success paths + `{ error: { code, message, requestId } }` on error paths (per TEST-BE-3).

- [ ] **Task 12 — Service tests (unit, mock the store interface)** (AC: #1–#7)
  - [ ] 12.1 `internal/service/onboarding_test.go` — persona validation matrix, progress default-when-missing behavior, upsert with typed payload roundtrip.
  - [ ] 12.2 `internal/service/center_test.go` — slug collision retry (mock returns unique-violation 4 times then success), one-center-per-user check, tx rollback on audit failure.
  - [ ] 12.3 `internal/service/slug_test.go` — Vietnamese input matrix, length truncation, edge cases (all-whitespace, all-punctuation, single-char).

## Dev Notes

### ATDD Artifacts (red-phase pre-loaded by `/bmad-tea AT 2-1` on 2026-07-01)

**Checklist:** `_bmad-output/test-artifacts/atdd-checklist-2-1-onboarding-api-persona-selection-center-setup-and-save-resume.md` — full test strategy, AC-to-file mapping, RED verification transcript, and green-phase task ordering.

**Generated red-phase files (5 files, ~34 Test\* functions):**

- `classlite-api/internal/handler/onboarding_handler_atdd_test.go` — AC1/AC3/AC4/AC8/AC10 (build-tagged)
- `classlite-api/internal/handler/center_handler_atdd_test.go` — AC2/AC6 (build-tagged)
- `classlite-api/internal/middleware/require_verified_email_atdd_test.go` — AC8 middleware (build-tagged)
- `classlite-api/internal/service/slug_atdd_test.go` — AC5b canonical Vietnamese set (build-tagged)
- `classlite-api/internal/test/onboarding_progress_rls_test.go` — AC9 J15 six-pattern grid + center_members uniqueness (NO build tag — permanent from day 1)

**Verification (2026-07-01):** `go build ./...` clean; `go test -count=1 ./internal/test/...` RED (6 undefined symbols in `onboarding_progress_rls_test.go`); `go test -tags atdd_red_phase -run NONE ./...` RED (14+ undefined identifiers across 4 tagged files). The RED signals are the acceptance contract — every undefined symbol maps 1:1 to a Task in this story (see the checklist's "RED signal → green-phase task mapping" table for the routing).

**Green-phase order (Amelia):** Task 5.0 → Task 7.4 → Tasks 3.1–3.5 → Task 6.1 → Task 7.1–7.6 → Task 8.1–8.2 → Task 9. Each `//go:build atdd_red_phase` tag is removed file-by-file once all tests in that file pass.

### Story context and epic position

This is the FIRST backend story in Epic 2. Epic 1 shipped the auth foundation (register / verify / login / OAuth / invite-accept) and the frontend auth UI. Epic 2 turns that authenticated-but-not-onboarded user into a Center Owner with a workable center. Story 2.1 is exclusively backend — the frontend UI half is Story 2.3a. Ship the API contract atomically (WF-4: since these are ALL new endpoints, this is additive, so API-first is fine — but hand off `api.yaml` diff to whoever picks up 2.3a).

**Downstream dependencies on this story:** 2.2 (class template + spawn) depends on 2.1 for center existence. 2.3a UI consumes these endpoints directly. 2.4 checklist reads `onboarding_progress.currentStep` to decide which tasks land on the dashboard. 2.5 center-settings reuses `centers` schema. 2.6 role enforcement uses `center_members.role` which THIS story writes for the first time via the API (Story 1.6 wrote it via invite-accept — same shape, different path in).

### Backend layout — what's new vs. what's touched

| Path | New? | Notes |
|---|---|---|
| `classlite-api/api.yaml` | UPDATE | Add 4 new operations + `EnvelopePersonaResult` / `EnvelopeCenterResult` / `EnvelopeOnboardingProgress` schemas. |
| `classlite-api/migrations/{ts}_add_users_persona.{up,down}.sql` | NEW | `persona text` + CHECK. |
| `classlite-api/migrations/{ts}_create_onboarding_progress.{up,down}.sql` | NEW | Table, no RLS, `PRIMARY KEY (user_id)`. |
| `classlite-api/migrations/{ts}_add_center_members_user_unique.{up,down}.sql` | NEW | Unique index — one center per user. |
| `classlite-api/internal/store/queries/users.sql` | UPDATE | `UpdateUserPersona`. |
| `classlite-api/internal/store/queries/centers.sql` | UPDATE | `CreateCenterFull` (do NOT touch existing `CreateCenter`). |
| `classlite-api/internal/store/queries/onboarding_progress.sql` | NEW | Get + Upsert. |
| `classlite-api/internal/store/generated/*` | REGEN | Never hand-edit; regenerate via `scripts/codegen.sh`. |
| `classlite-api/internal/model/onboarding_payload.go` | NEW | Typed JSONB struct (GO-7). |
| `classlite-api/internal/model/tenant.go` | UPDATE | Add `EmailVerified bool` field to `TenantContext` (Task 5.0). |
| `classlite-api/internal/model/id.go` | NEW | `NewID() uuid.UUID` — pre-generation for tx-first patterns (Task 7.2). |
| `classlite-api/internal/middleware/auth.go` | UPDATE | Populate `TenantContext.EmailVerified` from the existing `GetUserByID` result (Task 5.0). |
| `classlite-api/internal/middleware/require_verified_email.go` | NEW | Pure context-check middleware — no DB call. |
| `classlite-api/internal/middleware/require_verified_email_atdd_test.go` | NEW | ATDD unit. |
| `classlite-api/internal/service/onboarding.go` | NEW | Persona + progress. |
| `classlite-api/internal/service/center.go` | NEW | Transactional create + owner binding + audit. |
| `classlite-api/internal/service/slug.go` | NEW | `Slugify` + `RandomSuffix`, Vietnamese-aware. |
| `classlite-api/internal/service/audit.go` | UPDATE | Extract `LogWithinTx(ctx, tx, tc, ...)` sibling; refactor `Log()` to delegate. See Task 7.5. |
| `classlite-api/internal/handler/onboarding_handler.go` | NEW | 3 endpoints. |
| `classlite-api/internal/handler/center_handler.go` | NEW | 1 endpoint. |
| `classlite-api/cmd/api/main.go` | UPDATE | Wire services + handlers + middleware + routes. |
| `classlite-api/internal/test/onboarding_progress_rls_test.go` | NEW | J15 6-pattern grid (adapted for non-RLS table). |
| `classlite-api/internal/test/adversarial_test.go` | UPDATE | +2 tests (user-unique invariant, slug collision race). |

**Files to READ before touching anything else (per feedback: check prior story artifacts before generating):**
- `classlite-api/cmd/api/main.go` — route wiring pattern.
- `classlite-api/internal/middleware/auth.go` (`ExtractTenant`) — how tenant context is populated.
- `classlite-api/internal/middleware/require_role.go` — sibling middleware, same shape as new `RequireVerifiedEmail`.
- `classlite-api/internal/service/auth.go:686` — `isUniqueViolation` helper to reuse.
- `classlite-api/internal/service/auth_login.go:315-350` — `buildAccessToken` shows the existing single-membership heuristic that Story 2.1's `POST /api/centers` starts populating.
- `classlite-api/internal/test/_TEMPLATE_rls_test.go` — J15 template, copy-and-adapt for `onboarding_progress`.
- `classlite-api/internal/test/adversarial_test.go` — reference J15 patterns for `center_members`.
- `classlite-api/migrations/20260601120000_create_auth_tables.up.sql` — existing schema for `centers`, `center_members`, and the "no RLS on email_verifications" comment style to mirror in the new `onboarding_progress` migration.
- `classlite-api/tools/tenantcheck/tenantcheck.go` — the analyzer that will run over any new `*Store` types.

### R1 (score 9) discharge protocol

Per WF-8 hard rule: **ATDD red tests MUST land on the branch BEFORE this story transitions to `in-progress`.** The pre-flight sequence:

1. `create-story` marks 2-1 `ready-for-dev` (this doc).
2. `/bmad-tea AT 2-1` generates red specimens (Task 0.1).
3. Verify red (Task 0.2).
4. Amelia runs `/bmad-dev-story 2-1` — story flips to `in-progress`, dev turns red → green.

**R1 mitigation infrastructure is already shipped** (commit `2e49d4e`):
- `classlite-api/tools/tenantcheck/tenantcheck.go` — the go/analysis Analyzer that fails the build if any method on a `*Store` type is missing `context.Context + TenantContext` as its first two parameters. Runs in CI via `go run ./tools/tenantcheck/cmd/tenantcheck ./internal/store/...`.
- `classlite-api/internal/test/_TEMPLATE_rls_test.go` — the six-pattern J15 grid template. Copy + find-replace per resource family.
- `.golangci.yml` — standard linter set.

**Story 2.1's R1 obligations:**
- If Amelia introduces any new `*Store` types (e.g. `OnboardingStore`) in `internal/store/`, every method's second parameter MUST be `model.TenantContext`. The analyzer enforces this at compile-time.
- If Amelia continues the current Epic-1 pattern (direct sqlc queries in service, no hand-written Store wrappers), the analyzer stays vacuous — that's acceptable, but J15 grid coverage is still mandatory (Task 10.1).
- **Pragmatic recommendation**: continue direct sqlc calls in service for this story (Epic 1's pattern). The hand-written Store abstraction is aspirational per architecture doc and no story has introduced it yet; introducing it here would double the scope and doesn't improve R1 outcome — the J15 grid at the SQL layer catches the same class of bug.

### Founder vs Owner — no `center_members.role` mutation in Story 2.2

Story 2.2 (class template + spawn) has the flow "Founder persona → first class auto-assigned to Founder as teacher." That's a **class-membership** operation, NOT a `center_members.role` change. Founder's `center_members.role` stays `owner` — Owner already implies all authorities (create classes, teach classes, grade, invite, everything). If 2.2 or a later story feels tempted to `UpdateCenterMemberRole(founder_id, center_id, 'teacher')` to "reflect the founder is also teaching," DON'T — that demotes them from Owner and breaks their permissions. Teaching authority is derived from **class assignments**, not from `center_members.role`. If a case ever arises where a user needs multiple concurrent role capabilities within one center (Owner AND explicit-Teacher-of-Class-X), that's role-hierarchy work owned by Story 2.6 — extract a `class_members` or `class_teachers` table then.

### `internal/model/id.go` — Go-side UUID pre-generation

Task 7.2's rewritten tx flow requires the center UUID to exist before the `centers` INSERT so `SET LOCAL app.current_tenant_id` can run first. Ship `internal/model/id.go` with a single helper:

```go
package model

import "github.com/google/uuid"

// NewID returns a v4 UUID. Use this instead of pgx.UUID{} + gen_random_uuid()
// SQL defaults when a tx needs the ID before the INSERT (e.g. SET LOCAL runs
// against the new tenant ID before the row exists).
func NewID() uuid.UUID { return uuid.New() }
```

Scope: this story only. If Story 2.2's spawn path needs the same pattern (multiple classes created in one tx, each needing SET LOCAL before INSERT), promote to a project convention there — YAGNI on the convention doc until a second consumer exists.

### AuditService reality check — the `LogWithinTx` gap

`internal/service/audit.go:52` — the existing `AuditService.Log()` opens its **own** pgx transaction (`s.pool.Begin(ctx)` → `SetTenantContext` → `InsertAuditLog` → `tx.Commit`). That works for auth-audit calls that stand alone but breaks AC6's "audit INSERT inside the same tx as the center INSERT" contract — the CenterService's tx can't share its `pgx.Tx` with a second call that opens a fresh one, and the two txs can't atomically succeed/fail together. Task 7.5 extracts a `LogWithinTx(ctx, tx pgx.Tx, ...)` sibling and reshapes `Log()` to delegate to it — the existing signature is preserved, tests keep passing, and CenterService's transactional path gets its atomic audit. **Do NOT** shortcut this by moving the audit call outside the tx and log-and-continuing on failure — that's a real audit-trail integrity hole (silent audit drop after a public "your center was created" response is worse than a 500 on the rare audit_logs write failure).

### Auth flow reality — pre-center JWT semantics

The `AccessClaims` shape is `{ UserID, CenterID (omitempty), Role (omitempty) }`. For a newly-verified user with no center, login emits a token carrying **just `UserID`** — `CenterID` and `Role` are absent. `ExtractTenant` handles this correctly today: the `if claims.CenterID != ""` branch is skipped and `TenantContext{CenterID: "", UserID: <uid>, Role: ""}` gets injected. **DO NOT add "empty CenterID means unauthenticated" logic** — empty CenterID means "authenticated user without a center yet," which is exactly the state Story 2.1 works in.

After `POST /api/centers` succeeds, the user needs a **new access token** with the CenterID + Role claims populated so subsequent Epic 2 endpoints (2.2 templates, etc.) can bind to the new center. **The response body includes the new access token** — Task 8.2 must call `authSvc.MintAccessToken(userID, centerID, "owner")` and return it in the response envelope. If AuthService doesn't currently expose a public token-minting helper for this use case, expose one (`func (s *AuthService) MintAccessToken(userID uuid.UUID, centerID *uuid.UUID, role string) (string, error)`) — the existing `buildAccessToken` is unexported and does an implicit single-membership lookup that's wrong for this path (we want to force the claim, not derive it).

**Alternative considered and rejected**: force a re-login after center creation to pick up the new claims. Rejected because it's terrible UX — user just typed their password, they shouldn't have to type it again to see the center they just made. Ship the fresh token in the response body.

**Refresh cookie**: no change — refresh_tokens table doesn't carry center_id, and the next `/api/auth/refresh` call will re-derive the single-membership heuristic (which now correctly finds the new center_members row).

### Per-user rate limit design (accepted deviation from RequireVerifiedEmail-style)

The middleware chain wires `onboardingLimit` between `RequireVerifiedEmail` and the handler. It's IP-keyed for pragmatic simplicity — user-keyed would require reading the JWT before the rate-limit check (or plumbing UserID out of TenantContext into the RateLimitByKey key function), and neither adds much value for onboarding surfaces (no credential stuffing, no cost-sensitive AI calls). Login endpoints and forgot-password endpoints correctly rate-limit per-email; onboarding does not need to.

### Onboarding progress schema — why JSONB, not per-step columns

The wizard has 5 steps (persona, center, template, spawn, done). We could shape the table with a column per step's draft. Rejected because:
1. Story 2.2 will add template drafts with variable shapes (IELTS bands, custom sessions). Column-per-step doesn't compose.
2. Adding a step requires a migration. JSONB does not.
3. Legacy in-flight wizards after a schema change would blow up column-per-step (NOT NULL fights). JSONB with `schema_version` handles it via GO-7 migration path.

Story 2.2 will extend `OnboardingPayload.TemplateDraft` to carry `ClassTemplateDraft` — this story leaves it as opaque `*json.RawMessage`.

### Explicit non-goals (this story)

- **UI**. That's 2.3a/b/c.
- **Templates + class spawning**. That's 2.2 (POST /api/templates, POST /api/templates/{id}/spawn).
- **Role hierarchy + permissions matrix**. That's 2.6 (Owner > Admin > Teacher; students independent). This story hard-codes `role = 'owner'` for the center creator — the enum values `admin`/`teacher`/`student` aren't referenced.
- **Google Meet integration + timezone editing**. That's 2.5.
- **"Finish setting up" checklist card + first AI grade card**. That's 2.4.
- **Multi-center per user**. v1 = one center per user (AC2 409 branch + Task 2.3 unique index). Multi-center is deferred; if we regret this, we drop the unique index and remove the 409 branch — no data migration needed.
- **`X-Onboarding-Step` header contract** or any cross-store synchronization. The wizard is a single-user single-tab flow — no multi-tab conflict resolution needed.

### Testing standards inheritance

- **TEST-BE-1**: J15 grid mandatory (Task 10.1). Six patterns adapted for non-RLS table per AC9.
- **TEST-BE-2**: Store tests use real DB in transactions via `test.SetupDB(t)`. Never mock pgx. Task 11 handler tests use this too — TEST-BE-3 says handlers are integration tests with real middleware.
- **TEST-BE-3**: Full `{ data, meta }` envelope on success paths, `{ error: { code, message, requestId } }` on error paths.
- **TEST-BE-4**: Service tests mock the store interface (Task 12). Business rules live in service — that's where slug collision retry, one-center-per-user, and audit-tx rollback semantics get unit-tested.
- **beforeEach not beforeAll**: `SetupDB(t)` per test gives clean tx rollback. Never share fixtures across tests.
- **Per-story test coverage** for R38 discharge: N/A (backend story, no i18n keys added).

### Previous story intelligence — what to borrow, what to avoid

**From Story 1.3 (Auth DB schema + RLS security testing):**
- Reuse the `TestRLS_*_CrossTenantWrite` pattern for the J15 grid (Task 10.1). PostgreSQL doesn't error on `UPDATE` affecting 0 rows — the test must re-read as tenant B and assert the row is unchanged, not just that the UPDATE call didn't return an error.
- **Deterministic test tenant IDs**: `test.TenantAID` / `test.TenantBID` — do not generate random UUIDs for J15 tests, use these constants.

**From Story 1.4 (Register + verify):**
- The `emailVerified` gate pattern lives at the service layer today (`AuthService.Login` checks it). Story 2.1 moves that check to a **reusable middleware** (`RequireVerifiedEmail`) because Epic 2+ endpoints all need it. That extraction is not a refactor of 1.4 — it's a NEW middleware — leave `AuthService.Login`'s own check alone (defense in depth).

**From Story 1.5 (Login + JWT):**
- `AccessClaims` shape is stable — do NOT change it. The `omitempty` on CenterID + Role is load-bearing (empty means "no center yet"). The middleware handles this correctly.
- `buildAccessToken` is unexported and does implicit single-membership lookup. Story 2.1 needs a token WITH claims baked in — expose `MintAccessToken(userID, centerID *uuid.UUID, role string)` as a public helper. Do NOT reuse `buildAccessToken` — its heuristic is wrong for this path (we just wrote the center_members row in the same tx, and reading it back via a separate query is a race — the tx may not be committed yet).

**From Story 1.6 (Google OAuth + invite acceptance):**
- `UpsertCenterMemberWithRole` sqlc helper exists (`center_members.sql`) — Task 7.2 step 5 can use `CreateCenterMember` (simpler INSERT) since Story 2.1 knows there's no existing row (the 409 pre-check catches that path). Do NOT reuse `UpsertCenterMemberWithRole` — the upsert semantics are wrong for "new center + first member" and would mask an integrity bug.
- Invite acceptance shipped `UpdateCenterMemberRole` — irrelevant to Story 2.1 (there's no role change on center creation, the creator IS the owner).
- Audit_logs infrastructure shipped in Story 1.3b — reuse `service.NewPgAuditLogger` (if the pattern matches) or whatever the current audit-writer name is. Check `internal/service/audit.go` for the existing helper before writing a new one.

**From Story 1.9d (auth error states):**
- The user-facing error CODES matter. `EMAIL_VERIFICATION_REQUIRED` is a NEW error code introduced by this story's `RequireVerifiedEmail` middleware — add it to the frontend error catalog when 2.3a picks up. `USER_ALREADY_HAS_CENTER` is also new.
- **DO NOT** collapse these to generic `FORBIDDEN` or `CONFLICT` — the 1.9d review pass established that specific error codes are load-bearing for frontend routing/messaging (they drive which polished screen renders).

**From Story 1.10 (Astro landing):**
- No direct dependency. But note that the landing page's "logged_in=1" hint cookie is written by classlite-web on login (Story 1.10 discovered this was the missing dashboard-side write). Story 2.1 does not touch this — the user is already past login when they hit onboarding.

### Git intelligence — recent commit patterns

Last 5 commits (`git log --oneline -5`):
```
d528444 epic-1c: close gate advisories C1-C4 in-place
2e49d4e api: ship R1 mitigation (TenantContext analyzer + J15 grid template)  ← LOAD-BEARING for this story
71d1813 test-design: flag R1 mitigation gap before Epic 2 (pre-epic blocker memo)
38976b0 epic-1c: close gate (PASS-with-CONCERNS) + wire Lighthouse CI + harden E2E waits
701f410 landing+web: close Story 1-10 astro landing page with code review applied
```

Commit `2e49d4e` shipped both the `tenantcheck` analyzer AND the `_TEMPLATE_rls_test.go` J15 grid template. Both are directly consumed by this story (Tasks 3 + 10). Read the commit message before starting — it explains the allowlist mechanism (`// tenantcheck:allow` Godoc directive) that you'll need if any Store method is genuinely tenant-independent (unlikely in this story).

Commit `71d1813` is the memo that triggered the R1 mitigation. Read it if you want the "why did we ship the analyzer JUST before Story 2.1" context.

### Latest tech considerations (Jan 2026 cutoff — current-versions sanity check)

- **Go 1.22+** `ServeMux` method routing + path params is the pattern used throughout the API. New routes (Task 9.4) use `"POST /api/onboarding/persona"` string form; **DO NOT** use `chi`/`gin`/`echo`/`fiber` (project-context Go stack constraint).
- **pgx v5** — the transaction pattern is `pool.Begin(ctx)` then `tx.Commit(ctx)` / `tx.Rollback(ctx)`. `tx.Commit` after a rollback is a no-op. See existing patterns in `internal/service/auth.go`. Do not use `database/sql` (GO-6).
- **sqlc v1.31.1** (per generated header comment). Query annotations we use: `:one`, `:exec`, `:execrows`, `:many`. For the upsert helper, use `:one` with `RETURNING`.
- **golang-jwt/v5** — already wired via `internal/service/jwt.go`. HS256 only.
- **golangci-lint** now runs via `.golangci.yml` (shipped in `2e49d4e`). Any lint failure blocks CI.

### Architectural debt acknowledged (do NOT fix in this story)

1. **`AuthService` is monolithic** — it owns register, login, refresh, OAuth, invite-accept, force-logout. Adding onboarding would push it past ~1500 lines. Explicit non-goal: keep onboarding logic in a NEW `OnboardingService`, do NOT bolt it onto `AuthService`.
2. **`AuthDB` interface is auth-flavored** — Story 2.1 reuses it (Task 6.1) because introducing a new DB seam adds noise. This is a load-bearing choice: if later stories genuinely need a separate `OnboardingDB` seam, extract then, not now (YAGNI on abstractions).
3. **No hand-written Store wrappers exist in `internal/store/`** — the tenantcheck analyzer is currently vacuous. This is an accepted state: the J15 grid at the sqlc level is the real R1 protection today. Story 2.1 does not change this — introducing hand-written wrappers is a cross-story refactor, not part of the persona/center/onboarding feature.
4. **Vietnamese diacritic mapping in slug** is a small in-repo mapper for this story. If Epic 3+ needs more thorough Vietnamese normalization (search, sort), extract to a shared `internal/text/vi` package then.

### Filed follow-ups (NOT this story's work)

- **`FU-2-1-A`** — Extract the `google_meet_connected` / `timezone` columns on `centers` to a `center_settings` join table (schema pressure will hit at Story 2.5). Owner: Backend lead. Priority: P3. Trigger: 2.5 pickup.
- **`FU-2-1-B`** — Story 2.6 (roles + permissions) will need a role enum type — this story hardcodes `role = 'owner'` as a string. When 2.6 introduces the role enum, migrate `center_members.role` from `text` to the enum. Owner: Backend lead. Priority: P2. Trigger: 2.6 pickup.
- **`FU-2-1-C`** — The `Slugify` Vietnamese diacritic mapper is a naive character-by-character table. For robust Vietnamese normalization (used in search Epic 8), replace with `golang.org/x/text/transform` + a Unicode-normalized approach. Owner: Backend lead. Priority: P3. Trigger: Epic 8 pickup.
- **`FU-2-1-D`** — The `USER_ALREADY_HAS_CENTER` 409 is an accepted product ceiling for v1. When multi-center becomes a real ask, drop the unique index + 409 branch, add a `POST /api/centers` variant for additional centers. Owner: Product + Backend. Priority: P2. Trigger: post-launch demand signal.
- **`FU-2-1-E`** — Onboarding rate limit is IP-keyed at 20/min. Behind heavy NAT (school computer lab, corporate proxy), legitimate simultaneous wizard users will collide and see 429. Deliverable: (a) add a Playwright/integration test asserting the 429 surface is `RATE_LIMITED` code with a `Retry-After` header, (b) prototype a user-keyed variant (requires body-read shim before rate-limit middleware) if we see NAT-collision reports post-launch. Owner: Backend. Priority: P3. Trigger: first customer support ticket citing "wizard blocked, we're all on the same wifi."
- **`FU-2-1-F`** — Persona → role branching. v1 hardcodes `role=owner` for the center creator regardless of persona per Sally-B1 ruling. If UX/product regrets this after 2.6 (role hierarchy) ships and Solo Teachers report the "solo workspace" labeling feels dissonant with the DB truth, branch the write: Solo Teacher → seeds a `role='teacher'` + a new `workspace_mode='solo'` field on `centers`. Owner: Product + Backend. Priority: P3. Trigger: post-2.6 UX regression signal from Solo Teacher persona.

### Testing evidence checklist for gate review

Per the WF-8 per-epic gate, this story contributes evidence to:
- **R1 discharge**: J15 grid file (`onboarding_progress_rls_test.go`), user-uniqueness test in `adversarial_test.go`, slug-collision-race test in `adversarial_test.go`.
- **P0-431..435** (Bulk CSV — R18): N/A this story, that's 2.7. Called out because Epic 2's handoff row `R1, R18` might confuse a reader.
- **P0-441..445** (secret-in-logs): No new secrets introduced by this story. Existing CI scanner covers it.
- **P1-141..165** (secondary critical journeys): E2E `onboarding.spec.ts` referenced in architecture line 900 is NOT owned by this story (owned by 2.3a-c). This story ships the API contract that E2E will exercise.

### Project Structure Notes

The full monorepo directory tree lives in `_bmad-output/planning-artifacts/architecture.md` lines 547–903. The parts touched by this story:
- `classlite-api/internal/handler/` — add `onboarding_handler.go`, `center_handler.go`.
- `classlite-api/internal/service/` — add `onboarding.go`, `center.go`, `slug.go`, and their `_test.go` siblings.
- `classlite-api/internal/middleware/` — add `require_verified_email.go` + `_atdd_test.go`.
- `classlite-api/internal/model/` — add `onboarding_payload.go`.
- `classlite-api/internal/store/queries/` — add `onboarding_progress.sql`, extend `users.sql` + `centers.sql`.
- `classlite-api/internal/store/generated/` — never hand-edit (XL-1).
- `classlite-api/internal/test/` — add `onboarding_progress_rls_test.go`, extend `adversarial_test.go`.
- `classlite-api/migrations/` — three new migration pairs.
- `classlite-api/api.yaml` — extend with 4 operations.
- `classlite-api/cmd/api/main.go` — wire routes + middleware + services (~40 lines added).

**No frontend changes in this story.** The `classlite-web/src/features/onboarding/` directory is scaffolded per the architecture doc but NO code lands there in this story — that's 2.3a.

### References

- [Source: `_bmad-output/planning-artifacts/epics/epic-02.md#Story 2.1`] — canonical epic-level ACs (this story elaborates them).
- [Source: `_bmad-output/planning-artifacts/ux-design-specification.md#8.1 Onboarding`] — persona/center/save-resume UX contract.
- [Source: `_bmad-output/planning-artifacts/architecture.md#4.1 Onboarding` (line 978)] — onboarding routing overview.
- [Source: `_bmad-output/planning-artifacts/architecture.md#Structure Patterns` (line 547–903)] — full directory tree.
- [Source: `_bmad-output/test-artifacts/test-design/test-design-architecture.md#R1` (line 122)] — R1 risk register entry (score 9).
- [Source: `_bmad-output/test-artifacts/test-design/classlite_new-handoff.md#Epic 2` (line 49)] — Epic 2 → R1, R18 mapping.
- [Source: `_bmad-output/test-artifacts/test-design/pre-epic-2-blockers-2026-06-30.md`] — R1 mitigation gap memo (now closed by commit `2e49d4e`).
- [Source: `docs/project-context.md#GO-1`] — TenantContext hard constraint.
- [Source: `docs/project-context.md#GO-7`] — Typed JSONB structs, no `map[string]interface{}`.
- [Source: `docs/project-context.md#WF-1`, `WF-3`, `WF-8`] — API change sequence, codegen gate, per-story testing workflow.
- [Source: `docs/project-context.md#SEC-1`, `EDGE-1`, `EDGE-2`] — service-layer role revalidation, DB-level uniqueness, JWT staleness.
- [Source: `docs/project-context.md#TEST-BE-1..4`] — Backend test conventions.
- [Source: `classlite-api/tools/tenantcheck/tenantcheck.go`] — R1 compile-time analyzer.
- [Source: `classlite-api/internal/test/_TEMPLATE_rls_test.go`] — J15 grid template.
- [Source: `classlite-api/internal/middleware/auth.go`] — `ExtractTenant` reference implementation.
- [Source: `classlite-api/internal/middleware/require_role.go`] — `RequireRole` pattern for the new `RequireVerifiedEmail`.
- [Source: `classlite-api/internal/service/auth_login.go:315-350`] — `buildAccessToken` reference (do NOT reuse for center-creation path).
- [Source: `classlite-api/internal/service/auth.go:686`] — `isUniqueViolation` helper (reuse for slug collision).
- [Source: `classlite-api/internal/test/adversarial_test.go`] — reference J15 grid for `center_members`.
- [Source: commit `2e49d4e`] — R1 mitigation shipped 2026-07-01.
- [Source: commit `71d1813`] — pre-Epic-2 blocker memo.

## Dev Agent Record

### Agent Model Used

_To be populated by Amelia at first `/bmad-dev-story 2-1` pickup._

### Debug Log References

_To be populated by Amelia._

### Completion Notes List

_To be populated by Amelia. Sibling completion-notes file (`2-1-...-completion-notes.md`) deferred to first dev pickup per `docs/bmad-story-conventions.md`._

### File List

_To be populated by Amelia._
