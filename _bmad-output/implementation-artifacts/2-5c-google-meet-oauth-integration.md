---
baseline_commit: TBD-after-2-5b
---

# Story 2.5c: Center Settings — Google Meet OAuth Integration

Status: backlog

<!-- Split 3 of 3 from parent story 2-5. Depends on 2-5a shipping the /settings shell + Profile tab; 2-5b optionally shipped first (Rooms tab consumes google_meet_connected flag for synthetic-row visibility). Baseline commit updates at pickup. -->
<!-- Ships the FIRST cross-tenant OAuth token storage in the codebase: AES-GCM sealed-tokens per center + Google Meet Connect/Disconnect flow + Integrations tab body replacing 2-5a's placeholder. Backend: 1 new tenant-scoped table (`center_integrations`) with RLS 4-policy + AES-GCM crypto helpers + Google Meet OAuth service (separate from shipped login OAuth) + 3 new endpoints. Frontend: Integrations tab + Connect/Disconnect UI + callback-return handling. -->
<!-- Absorbs John-ACCEPTed BLOCKERs B7 (HandleCallback tx atomicity), B8 (OAuth state confused-deputy — CenterID+UserID in payload with triple binding), B9 (fresh membership re-check at callback), plus 8 related security STRONGs. This is the load-bearing security story of the 2-5 split. -->

## Story

As a **center Owner**,
I want to **connect Google Meet from `/settings?tab=integrations` so scheduled sessions can auto-generate Meet links (Epic 3 consumer)**,
so that **virtual classes have working meeting URLs without me manually creating them each session**.

## Response Envelope Contract

Inherits shipped envelopes. OAuth callback uses HTTP 302 redirect (not JSON envelope) — Google's redirect target.

## Acceptance Criteria

1. **Integrations tab replaces the 2-5a placeholder** (mockup s49:7054-7118). Renders 4 rows:
   - **Google Meet** (real) — active toggle + `Connected` / `Not connected` state pill + Connect/Disconnect flow per AC2.
   - **Google Drive** / **Google Calendar** / **Zoom** — placeholder rows with disabled toggle + `<DeadLinkTrigger>` (v1 ships Meet only per PRD assumption at `prd.md:293`). Copy per shipped `<DeadLinkTrigger>` pattern — `t('settings.integrations.<provider>.notReady')`.
   - Notifications section (mockup :7098-7118) — deferred to Epic 10 (Notifications), rendered as placeholder empty state in this story (`t('settings.integrations.notifications.pending')`).

2. **Google Meet Connect flow** — real OAuth 2.0.
   1. Owner clicks "Connect Google Meet" button.
   2. Client calls `GET /api/centers/{id}/integrations/google-meet/authorize` → server returns `{ data: { authorizeUrl } }`.
   3. Client calls `window.location.assign(authorizeUrl)` (browser navigates to Google's authorization page).
   4. Owner authenticates on Google + grants `calendar.events` scope.
   5. Google 302-redirects back to `GET /api/centers/{id}/integrations/google-meet/callback?code=...&state=...`.
   6. Callback handler runs the tx flow per AC5.
   7. On success: 302 redirect to `/settings?tab=integrations&status=connected`. Frontend detects the query param on mount + fires success toast + replaces URL via `useLayoutEffect` synchronously to prevent StrictMode double-invoke [Sally-S3 + John ACCEPT].

3. **Google Meet Disconnect flow.** Click the on toggle → confirmation `<AlertDialog>` → on confirm `DELETE /api/centers/{id}/integrations/google-meet` → server clears `center_integrations` row + sets `google_meet_connected = false` + audits `center.integration.google_meet.disconnected`. UI flips row to `Not connected`. **Does NOT** call Google's token-revoke endpoint in v1 (FU-2-5-B P3).

4. **Zero synchronous Meet-link creation in this story.** Story 2-5c only stores tokens + connected-flag; Story 3.x (session scheduling) consumes both to generate per-session Meet links on session insert.

5. **`HandleCallback` transactional atomicity** [Winston-B3 + John ACCEPT — pin the 7-step tx flow]:

   ```
   1. Handler receives GET callback with ?code=...&state=...
   2. Validate state signature + expiry (AC7) — reject early on any failure with 400 OAUTH_STATE_INVALID / OAUTH_STATE_EXPIRED / OAUTH_STATE_MISMATCH
   3. Fresh Owner membership re-check per Winston-B5 + John ACCEPT — call authSvc.ResolveMembership(state.UserID, state.CenterID); reject with 403 OAUTH_MEMBERSHIP_REVOKED if user is no longer Owner of that center (force-logout-between-authorize-and-callback defense)
   4. BEGIN tx
   5. SET LOCAL app.current_tenant_id = state.CenterID (Winston-B2 defensive; center_integrations RLS INSERT requires this)
   6. googleOAuthClient.Exchange(code) → *oauth2.Token (access + refresh + expiry) — on error ROLLBACK + return 502 INTEGRATION_CONNECT_FAILED
   7. SealToken(access_token, encryption_key) + SealToken(refresh_token, encryption_key) (AES-GCM sealed-box; nonce prepended per AC8)
   8. UpsertIntegration(ctx, tx, {center_id, provider='google_meet', access_token_encrypted, refresh_token_encrypted, expires_at, scope}) — via sqlc-generated query
   9. UPDATE centers SET google_meet_connected = true WHERE id = state.CenterID — belt vs suspenders (query WHERE id must match; centers has NO RLS)
   10. AuditLogger.LogWithinTx(ctx, tx, tc, "center.integration.google_meet.connected", "center_integration", integration.ID, changes) — audit row in same tx
   11. COMMIT — on any error above (steps 6-10) ROLLBACK + return 500 INTEGRATION_CONNECT_FAILED
   12. Respond 302 redirect to /settings?tab=integrations&status=connected
   ```

   Test coverage per AC12 covers each step's error branch.

6. **`center_integrations` migration — `20260714120400_create_center_integrations`.** Tenant-scoped table with FULL 4-policy RLS per Winston-B2 + John ACCEPT. `.down.sql` uses `DROP TABLE IF EXISTS`.

   ```sql
   CREATE TABLE center_integrations (
       id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
       center_id                 uuid        NOT NULL REFERENCES centers (id) ON DELETE CASCADE,
       provider                  text        NOT NULL CHECK (provider IN ('google_meet')),  -- ASSUMPTION: FU-2-5-D/E amend when Drive/Zoom ship
       access_token_encrypted    bytea       NOT NULL,
       refresh_token_encrypted   bytea       NOT NULL,
       scope                     text        NOT NULL,
       expires_at                timestamptz NOT NULL,
       created_at                timestamptz NOT NULL DEFAULT now(),
       updated_at                timestamptz NOT NULL DEFAULT now(),
       UNIQUE (center_id, provider)  -- ASSUMPTION: one Google account per center; multi-account v2+
   );
   CREATE INDEX idx_center_integrations_center_id ON center_integrations (center_id);
   ALTER TABLE center_integrations ENABLE ROW LEVEL SECURITY;
   ALTER TABLE center_integrations FORCE ROW LEVEL SECURITY;
   -- 4 policies (SELECT/INSERT/UPDATE/DELETE) mirror class_templates.up.sql:29-55 verbatim.
   -- UPDATE explicitly includes WITH CHECK to close the reparent-to-tenantB attack surface per Winston-B2:
   CREATE POLICY center_integrations_update ON center_integrations FOR UPDATE
       USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
       WITH CHECK (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
   ```

   Pre-flight `ls migrations/ | tail -5` for timestamp collision.

7. **OAuth state — `SignedState` extended with CenterID + UserID** [Winston-B4 + John ACCEPT — real security fix]. Amend `internal/service/oauth_state.go`:
   ```go
   type OAuthStatePayload struct {
       Nonce            string    // existing
       InviteTokenHash  string    // existing (login flow only, empty for Meet)
       RedirectTo       string    // existing
       IssuedAt         time.Time // existing
       // NEW for Story 2-5c Meet OAuth:
       CenterID         uuid.UUID // required for Meet flow, uuid.Nil for login flow
       UserID           uuid.UUID // required for Meet flow, uuid.Nil for login flow
   }
   ```
   HMAC signature + TTL (10 min per shipped) validation unchanged. On Meet callback: verify `payload.CenterID == pathParam{id} == tc.CenterID` AND `payload.UserID == tc.UserID` — **triple binding**. Any mismatch → 403 `OAUTH_STATE_MISMATCH`. TTL expired → 400 `OAUTH_STATE_EXPIRED`.

   **`INTEGRATIONS_ENCRYPTION_KEY` env var**. 32-byte key base64-encoded. Config.Validate() decodes + asserts `len(decoded) == 32` in non-dev per Winston-S12 + John ACCEPT; dev-mode fallback to fixed-seed test key with boot warning. Add to `.env.example` with generation instruction `openssl rand -base64 32`.

8. **AES-GCM sealed-token crypto — `internal/service/integration_crypto.go`.** Only code that touches raw tokens.
   - `SealToken(plaintext []byte, key []byte) ([]byte, error)` — random 12-byte nonce via `crypto/rand.Read`; returns `nonce || ciphertext || authTag` (standard AES-GCM sealed-box format).
   - `OpenToken(ciphertext []byte, key []byte) ([]byte, error)` — splits nonce (first 12 bytes) + AES-GCM decrypts + validates auth tag; returns plaintext or error.
   - **5-scenario unit test matrix** [Murat-B4 + John ACCEPT compromise — 5 rows not 9]:
     1. Round-trip happy path — Seal → Open → plaintext matches.
     2. Ciphertext tamper (auth-tag rejection) — mutate 1 byte in ciphertext body → OpenToken returns error.
     3. Nonce tamper — mutate 1 byte in prepended nonce → OpenToken returns error.
     4. Wrong-key rejection — Seal with key A → Open with key B → error (key rotation scenario: existing rows must fail to open after rotation).
     5. Empty-key init rejection — `SealToken` with 0-byte key returns error (guards operator config-load bug).

9. **Backend API — 3 new endpoints in `api.yaml`.**

   | Method | Path | Auth chain | Purpose |
   |---|---|---|---|
   | GET | `/api/centers/{id}/integrations/google-meet/authorize` | `ExtractTenant → RequireVerifiedEmail → RequireCenterContext → RequireRole("owner") → oauthAuthorizeRateLimit → handler` | Returns `{ data: { authorizeUrl } }` with signed state |
   | GET | `/api/centers/{id}/integrations/google-meet/callback` | `ExtractTenant → RequireVerifiedEmail → RequireCenterContext → oauthCallbackRateLimit → handler` (NO RequireRole — state payload proves Owner intent; handler re-checks per AC5 step 3) | Handles Google's OAuth callback; 302 redirects to `/settings?tab=integrations&status=connected` |
   | DELETE | `/api/centers/{id}/integrations/google-meet` | Same as authorize | Disconnects — deletes `center_integrations` row + clears flag + audits |

   **Rate limits** [Winston-S4 + John REJECT but bump per compromise]: authorize + disconnect use `settings` bucket (60 req/min per user). Callback uses `oauthCallbackRateLimit = 5 req/min per (state.CenterID, IP)` — key by `(centerID, IP)` per Winston-S4 to avoid shared-NAT collision (5 legitimate Owners in the same building all connecting simultaneously). All 429 responses include `Retry-After` header per Murat-B6 + John ACCEPT.

   **Callback chain composition pinned** per Winston-S9 + John ACCEPT.

10. **Sqlc queries — `internal/store/queries/center_integrations.sql`** (NEW file):
    - `GetIntegration` — fetch by (center_id, provider); returns encrypted-token blob.
    - `UpsertIntegration` — `INSERT ... ON CONFLICT (center_id, provider) DO UPDATE SET access_token_encrypted = EXCLUDED..., refresh_token_encrypted = EXCLUDED..., expires_at = EXCLUDED..., updated_at = now()` — atomic upsert; triggers UPDATE RLS policy which enforces WITH CHECK per AC6.
    - `DeleteIntegration` — DELETE WHERE (center_id, provider).

11. **Backend services + handler** — new packages.
    - `internal/service/google_meet.go` — `GoogleMeetService.BuildAuthorizeURL(ctx, tc) → (string, error)`: constructs `oauth2.Config` (calendar.events scope), signs state with `SignedState{Nonce, CenterID: tc.CenterID, UserID: tc.UserID, IssuedAt: now}`, returns Google authorize URL. `HandleCallback(ctx, code, state) → error`: runs the 7-step tx flow per AC5. `Disconnect(ctx, tc) → error`: deletes row + clears flag + audits.
    - `internal/service/oauth_state.go` (UPDATE) — extend `OAuthStatePayload` per AC7. Existing login callers pass `uuid.Nil` for CenterID/UserID; Meet callers pass real UUIDs. Signature format bumped or backward-compatible — dev's call at pickup.
    - `internal/service/integration_crypto.go` (NEW) — AES-GCM helpers per AC8.
    - `internal/handler/google_meet_handler.go` (NEW) — 3 thin HTTP handlers. Authorize + Disconnect assert `{id} == tc.CenterID` (Owner tenant-binding). Callback delegates to service (which re-verifies state → tc → path triple binding).
    - New error codes registered in `internal/handler/errors.go` [Winston-S11 + John ACCEPT]: `OAUTH_STATE_INVALID` (400), `OAUTH_STATE_EXPIRED` (400), `OAUTH_STATE_MISMATCH` (403), `OAUTH_MEMBERSHIP_REVOKED` (403), `INTEGRATION_CONNECT_FAILED` (502).
    - Wire in `cmd/api/main.go` — extend `settingsChain` for authorize/disconnect; add new `oauthCallbackChain` per AC9 composition.

12. **Backend test coverage** — per TEST-BE-1/2/3/4:
    - **Store tests** (real DB in tx): `center_integrations` RLS adversarial matrix per Task 3. UpsertIntegration success + UNIQUE conflict → replaces prior row (not error).
    - **Service tests** (mock `GoogleOAuthClient` + `AuditLogger` + `IntegrationStore` interfaces): 
      - `BuildAuthorizeURL` — state signed correctly + URL contains `client_id`, `redirect_uri`, `scope=calendar.events`, `state=<signed>`.
      - `HandleCallback` **5-row state security matrix** per Murat-S2 + John ACCEPT compromise:
        1. Valid state + valid code → 302 + tokens persisted + flag flipped + audit row.
        2. Expired state (Clock advanced past 10min) → 400 `OAUTH_STATE_EXPIRED`, no DB writes.
        3. state.CenterID mismatch with path{id} → 403 `OAUTH_STATE_MISMATCH`, no DB writes.
        4. state.UserID mismatch with tc.UserID → 403 `OAUTH_STATE_MISMATCH`, no DB writes.
        5. Tampered HMAC signature → 400 `OAUTH_STATE_INVALID`, no DB writes.
      - `HandleCallback` Owner membership revoked (state valid but user no longer Owner of center) → 403 `OAUTH_MEMBERSHIP_REVOKED`, no DB writes.
      - `HandleCallback` code exchange fails (mock returns error) → 502 `INTEGRATION_CONNECT_FAILED`, tx rolled back.
      - `Disconnect` happy path + double-disconnect (row already absent) → idempotent success.
    - **Handler tests** via `test.NewTestServer`: full envelope on authorize + callback 302 redirect on success + all 5 state error branches assert HTTP status + envelope + no side-effect + 429 with `Retry-After` header.
    - **Crypto tests** per AC8 5-row matrix.
    - **Timezone parity test** shipped in 2-5a — no change here.

13. **RLS adversarial matrix — extend `internal/test/adversarial_test.go` per Task 2** (Story 2.2 shipped pattern; consolidated with 2-5b's tables — this story adds 2-3 rows for `center_integrations`):
    - Cross-tenant READ (Tenant A cannot see Tenant B's `center_integrations` row) — 1 test.
    - Cross-tenant INSERT (Tenant A cannot insert row with Tenant B's center_id — WITH CHECK guard) — 1 test.
    - Cross-tenant UPDATE reparent (Tenant A cannot UPDATE Tenant B's row to change center_id — WITH CHECK on UPDATE guard per Winston-B2) — 1 test.

14. **Frontend — Integrations tab replaces 2-5a placeholder.**
    - `src/features/settings/IntegrationsTab.tsx` — 4 rows per AC1. Google Meet row shows Connected/Not connected state pill + toggle.
    - `src/features/settings/components/ConnectGoogleMeetButton.tsx` — button that fires `useConnectGoogleMeet` mutation.
    - `src/features/settings/components/DisconnectGoogleMeetDialog.tsx` — AlertDialog confirmation.
    - `src/features/settings/api/useConnectGoogleMeet.ts` — mutation:
      1. Calls `GET /api/centers/{id}/integrations/google-meet/authorize` via `apiFetch`.
      2. On success: sets `sessionStorage.setItem('meet-connect-in-flight', '1')` marker.
      3. Calls `window.location.assign(authorizeUrl)` — browser navigates to Google.
    - `src/features/settings/api/useDisconnectGoogleMeet.ts` — mutation DELETE + optimistic triple invalidating `settingsKeys.centerProfile(centerId)`.
    - `src/features/settings/lib/schemas.ts` — extend with `googleMeetAuthorizeResponseSchema` (hand-authored).
    - `src/features/settings/api/settingsKeys.ts` — extend: `integration: (centerId: string, provider: string) => [...settingsKeys.all, 'integration', centerId, provider] as const`.
    - `SettingsPage.tsx` (UPDATE) — replace IntegrationsTab placeholder with real component.
    - **Callback-return handling** — on `SettingsPage` mount, if `?status=connected` present AND `sessionStorage.getItem('meet-connect-in-flight') === '1'`:
      1. `useLayoutEffect` synchronously calls `useNavigate(location.pathname + '?tab=integrations', { replace: true })` BEFORE the toast subscription mounts [Sally-S3 + John ACCEPT — prevents StrictMode double-invoke].
      2. Fires success toast `t('settings.integrations.googleMeet.connect.success')` with fixed id `settings-integration-connected` (queue-of-one).
      3. Clears `sessionStorage` marker.
      4. Invalidates `settingsKeys.centerProfile(centerId)` so the toggle re-reads.
    - If `?status=connected` present WITHOUT the sessionStorage marker (drive-by URL manipulation) → NO toast, silently strip the query param.

15. **i18n — pinned `STORY_2_5C_KEYS` closed literal.** Append `describe('Story 2-5c i18n parity (R38)', () => { ... })` to `i18n-parity-coverage.test.ts`. Prefix ratchet: `settings.integrations.` (or shared `error.*`). Est **~35-45 keys** (4 integration row × ~5 keys + Connect/Disconnect flow copy + AlertDialog + toast + error branches + notifications placeholder). `assertI18nInterpolationParity` covers ALL keys. VN per Ducdo ownership per feedback rule.

    **noTrialMechanic pre-flight** per Amelia-B2 — no `trial`/`dùng thử` in Zoom placeholder copy or any integrations copy.

16. **Route bundle boundary** — extend `e2e/route-bundle-boundaries.spec.ts`: `SettingsPage-*.js` chunk now includes `data-testid="settings-tabpanel-integrations"` + `settings-connect-google-meet-button` substrings; no cross-chunk leakage. Google OAuth libs live in the API tree, not the web bundle.

17. **Accessibility — axe zero violations across IntegrationsTab × 2 locales + AlertDialog-open state = 4 renders total.** WAI-ARIA compliance per Sally-S8 + John ACCEPT (inherited from 2-5a). Toggle uses `<button role="switch" aria-checked>`. Sonner success toast uses `role="status"` (aria-live polite).

18. **Playwright E2E** — Task 8:
    - `settings-integrations-connect.spec.ts` — `page.route()` intercept per Murat-S4 + John ACCEPT pattern:
      ```ts
      await page.route('**/api/centers/*/integrations/google-meet/authorize', route =>
        route.fulfill({ json: { data: { authorizeUrl: 'https://fake-google/auth?state=stub' } } })
      );
      // Owner clicks Connect → assert window.location.assign called with fake URL
      // Then simulate callback return by navigating to /settings?tab=integrations&status=connected
      // Assert toast fires + toggle flips
      ```
    - Full backend OAuth round-trip stays out of e2e (deferred per FU-2-5-N — same session-cache infra concern as FU-2-4-J).
    - Extended `route-bundle-boundaries.spec.ts` per Task 7.

## Tasks / Subtasks

- [ ] **Task 0 — ATDD red phase (RECOMMENDED, SKIPPABLE)** — R1 replication on `center_integrations` (score 9); OAuth state security matrix; token crypto matrix. ATDD helps but skippable if dev commits to shipping the Task 4 matrix.
- [ ] **Task 1 — Migration + sqlc + codegen** (AC: #6, #10): pre-flight timestamp; author migration + `.down.sql` w/ IF EXISTS; RLS 4-policy including UPDATE WITH CHECK; sqlc queries; codegen.
- [ ] **Task 2 — Config + env vars** (AC: #7, #8): add `IntegrationsEncryptionKey` + `MeetOAuthRedirectURL` fields to `Config`; Validate() decodes base64 + asserts 32 bytes; `.env.example` update with `openssl rand -base64 32` instruction; dev-mode fallback.
- [ ] **Task 3 — RLS adversarial + crypto tests** (AC: #8, #13): 5-row crypto matrix per AC8; 3 `center_integrations` RLS rows per AC13; extend `adversarial_test.go`.
- [ ] **Task 4 — Backend service + handler + oauth_state extension** (AC: #5, #7, #9, #11, #12):
  - 4.1 Extend `oauth_state.go` `OAuthStatePayload` with `CenterID` + `UserID` per AC7.
  - 4.2 `internal/service/integration_crypto.go` per AC8.
  - 4.3 `internal/service/google_meet.go` per AC11 (BuildAuthorizeURL + HandleCallback 7-step tx + Disconnect).
  - 4.4 `internal/handler/google_meet_handler.go` per AC11.
  - 4.5 Register 5 new error codes in `internal/handler/errors.go` + `error_mapper_test.go`.
  - 4.6 Wire in `cmd/api/main.go` — extend settingsChain + add `oauthCallbackChain` per AC9.
  - 4.7 Service tests per AC12 5-row state matrix + Owner-revoked + code-exchange-fail + Disconnect + idempotency.
  - 4.8 Handler tests per AC12 — full envelope on all branches + 429 `Retry-After`.
- [ ] **Task 5 — api.yaml + regen** (AC: #9): 3 endpoints + schemas (`GoogleMeetAuthorizeResult`, `EnvelopeGoogleMeetAuthorizeResult`); codegen.
- [ ] **Task 6 — Frontend Integrations tab** (AC: #1, #2, #3, #14, #17):
  - 6.1 `IntegrationsTab.tsx` per AC1.
  - 6.2 `useConnectGoogleMeet.ts` + `useDisconnectGoogleMeet.ts` + `settingsKeys.integration` factory.
  - 6.3 Callback-return handling in `SettingsPage.tsx` per AC14 (`useLayoutEffect` sync-replace + sessionStorage marker).
  - 6.4 Component tests: three-state + Connect flow (`window.location.assign` spy per Murat-INFO-1 + John ACCEPT) + Disconnect flow + callback-return with-marker + callback-return without-marker (no toast) + role gate.
  - 6.5 Storybook: IntegrationsTab ≥3 variants (Disconnected / Connected / vi).
- [ ] **Task 7 — Route bundle boundary regression** (AC: #16).
- [ ] **Task 8 — Playwright E2E** (AC: #18): `settings-integrations-connect.spec.ts` per Murat-S4 pattern.
- [ ] **Task 9 — i18n keys + parity ratchet** (AC: #15): noTrialMechanic pre-flight; ~35-45 keys; STORY_2_5C_KEYS closed literal + prefix ratchet.
- [ ] **Task 10 — NFR evidence artifact** [Murat-S9 → FU-2-5-M DEFERRED; but include the log-scrub audit inline here per belt-and-suspenders]:
  - 10.1 Grep-audit — `grep -rn 'access_token\|refresh_token\|IntegrationsEncryptionKey' internal/ | grep -v _test.go | grep -v integration_crypto.go` MUST return zero matches. Assert as part of CI green.
- [ ] **Task 11 — Regression + full green** (AC: all): full test suite; expected delta **~+90-120 tests**; verify 2-5a + 2-5b + Story 2-1..2-4 shipped test files stay green.

## Dev Notes

### Story context

Story 2-5c is the third sub-story from split 2-5. Ships the OAuth security surface separately from the CRUD surfaces (2-5a Profile + 2-5b Terms/Rooms) so security review is focused. Baseline updates to whatever 2-5b lands as `done` (or 2-5a `done` if dev picks up 2-5c before 2-5b). Rooms tab (2-5b) consumes `google_meet_connected` flag for synthetic row visibility per 2-5b AC2 — 2-5c makes that flag toggleable.

### Google Meet OAuth — separate flow from login OAuth

Shipped `auth_google.go` handles **login-time Google OAuth** — scope `openid email profile`, callback `/api/auth/google/callback`, downstream mints app JWT. Story 2-5c's Meet OAuth is a **second, per-center OAuth flow** — scope `https://www.googleapis.com/auth/calendar.events` (write access for Meet-link creation on Calendar events), callback `/api/centers/{id}/integrations/google-meet/callback`, downstream `center_integrations` row + `google_meet_connected = true`.

**Reused from `auth_google.go`:**
- `oauth_state.go` HMAC signing + TTL validation pattern (extended with CenterID + UserID per AC7).
- `GoogleOAuthClient` interface at `auth_google.go:76-80` — mockable for tests. Real Meet flow uses only Exchange, not UserInfo.

**Env vars added** (Task 2):
- `INTEGRATIONS_ENCRYPTION_KEY` — 32-byte base64. Required in non-dev; Validate() rejects invalid.
- `MEET_OAUTH_REDIRECT_URL` — mirrors `GOOGLE_REDIRECT_URL` but for Meet-specific callback. If deployed at fixed domain, MAY equal `AppInviteURLBase + '/api/centers/callback'` synthesized; explicit env var is safer for staging vs prod split.

### AES-GCM sealed-token format

- 12-byte nonce (random from `crypto/rand`) prepended to ciphertext.
- Ciphertext body from `aes.NewCipher(key)` + `cipher.NewGCM(block)` + `.Seal(nonce, nonce, plaintext, nil)`.
- Standard sealed-box format: consumers split first 12 bytes as nonce, remainder as GCM-sealed body.
- Never log tokens. Never return tokens in API responses (only `google_meet_connected` boolean surfaces).
- **No `key_version` column in v1** per Winston-S11 + John DEFER → FU-2-5-L. Key rotation runbook is documented but the schema doesn't support graceful rotation (loss-of-key requires manual Disconnect + Connect per center).

### OAuth state — triple binding

Per Winston-B4 + John ACCEPT:
```
Callback validates:
  payload.CenterID == pathParam{id} == tc.CenterID   (all three must match)
  payload.UserID   == tc.UserID                       (fresh-user match)
  HMAC(payload) verifies
  payload.IssuedAt + 10min > clock.Now()
```

Any mismatch → 403 `OAUTH_STATE_MISMATCH` (or 400 `OAUTH_STATE_INVALID` / `OAUTH_STATE_EXPIRED`). Closes the confused-deputy attack surface where Owner A initiates Connect on Center A + attacker intercepts + swaps in Center B's path via `{id}`.

### Fresh Owner membership check per Winston-B5

Per Winston-B5 + John ACCEPT (folded into B8): before persisting tokens, callback calls `authSvc.ResolveMembership(state.UserID, state.CenterID)` to confirm user is still Owner of that center. If demoted or removed between authorize and callback (10-min window), reject with 403 `OAUTH_MEMBERSHIP_REVOKED`, no token persistence, no audit row.

### `centers.google_meet_connected` write — outside RLS scope

`centers` is a global table (no RLS). The 7-step tx flow's step 9 (`UPDATE centers SET google_meet_connected = true WHERE id = state.CenterID`) uses `state.CenterID` (verified against tc.CenterID and path{id} by AC5 step 2) as the WHERE parameter — belt vs suspenders per Winston-S3.

### Files to touch — inventory

| Path | New? | Notes |
|---|---|---|
| `classlite-api/api.yaml` | UPDATE | Task 5 — 3 endpoints + 2 schemas |
| `classlite-api/migrations/20260714120400_create_center_integrations.up.sql` + `.down.sql` | NEW | Task 1 |
| `classlite-api/internal/store/queries/center_integrations.sql` | NEW | Task 1 |
| `classlite-api/internal/service/integration_crypto.go` + `_test.go` | NEW | Task 4.2 |
| `classlite-api/internal/service/google_meet.go` + `_test.go` | NEW | Task 4.3 |
| `classlite-api/internal/service/oauth_state.go` | UPDATE | Task 4.1 — extend payload w/ CenterID + UserID |
| `classlite-api/internal/handler/google_meet_handler.go` + `_test.go` | NEW | Task 4.4 |
| `classlite-api/internal/handler/errors.go` + `error_mapper_test.go` | UPDATE | Task 4.5 — 5 new error codes |
| `classlite-api/cmd/api/main.go` | UPDATE | Task 4.6 — settingsChain + oauthCallbackChain extensions |
| `classlite-api/internal/config/config.go` | UPDATE | Task 2 — env vars |
| `classlite-api/internal/test/adversarial_test.go` | UPDATE | Task 3 — 3 center_integrations RLS rows |
| `classlite-web/src/lib/api/*` | AUTOGEN | Task 5 — codegen regen |
| `classlite-web/src/features/settings/SettingsPage.tsx` | UPDATE | Task 6 — replace Integrations placeholder + AC14 callback-return handling |
| `classlite-web/src/features/settings/IntegrationsTab.tsx` + `.stories.tsx` + `__tests__/IntegrationsTab.test.tsx` | NEW | Task 6 |
| `classlite-web/src/features/settings/components/ConnectGoogleMeetButton.tsx` + `DisconnectGoogleMeetDialog.tsx` | NEW | Task 6 |
| `classlite-web/src/features/settings/api/useConnectGoogleMeet.ts` + `useDisconnectGoogleMeet.ts` + tests | NEW | Task 6 |
| `classlite-web/src/features/settings/api/settingsKeys.ts` | UPDATE | Task 6 — extend with `integration` factory |
| `classlite-web/src/features/settings/lib/schemas.ts` | UPDATE | Task 6 — `googleMeetAuthorizeResponseSchema` |
| `classlite-web/src/features/settings/api/__tests__/handlers.ts` | UPDATE | Task 6 — 3 more MSW factories per Amelia-S10 |
| `classlite-web/src/locales/en.json` + `vi.json` | UPDATE | Task 9 — ~35-45 keys |
| `classlite-web/src/lib/test/__tests__/i18n-parity-coverage.test.ts` | UPDATE | Task 9 — STORY_2_5C_KEYS block |
| `classlite-web/e2e/route-bundle-boundaries.spec.ts` | UPDATE | Task 7 |
| `classlite-web/e2e/settings-integrations-connect.spec.ts` | NEW | Task 8 |
| `.env.example` | UPDATE | Task 2 |

**Files to READ before touching**:

- `_bmad-output/implementation-artifacts/2-5a-backend-and-profile-tab.md` — sibling sub-story (Profile + shell shipped).
- `_bmad-output/implementation-artifacts/2-5b-terms-holidays-rooms-tabs.md` — sibling (Rooms tab consumes `google_meet_connected`).
- `_bmad-output/implementation-artifacts/2-5-superseded-see-2-5a-b-c.md` — parent shared context.
- `classlite-api/internal/service/auth_google.go` — Google OAuth login reference.
- `classlite-api/internal/service/oauth_state.go` — HMAC signing pattern (Task 4.1 extends).
- `classlite-api/internal/service/audit.go` — `AuditLogger.LogWithinTx` pattern.
- `classlite-api/internal/service/auth.go` — `ResolveMembership` (per Winston-B5).
- `classlite-api/internal/config/config.go` — Validate() pattern for env vars (mirror `OAUTH_STATE_SECRET` at line 41).
- `classlite-api/internal/store/queries/class_templates.sql` — sqlc UPSERT pattern reference.
- `classlite-api/migrations/20260703120000_create_class_templates.up.sql:29-55` — RLS 4-policy pattern (INCLUDES WITH CHECK on UPDATE).
- `docs/classlite-entry/05-cross-role.html:7042-7118` — s49 mockup Integrations tab.
- `docs/project-context.md#SEC-1..11 (esp. SEC-8 R2 presigned + SEC-10 rate limits)`.

### WF-8 ATDD applicability

Story 2-5c owns THREE risk score ≥6 concerns:
- R1 (RLS cross-tenant, score 9) — new tenant-scoped table `center_integrations`. Task 3 discharges via 3-row adversarial matrix per Story 2.2 shipped pattern.
- R6 (Google OAuth callback tenant binding, score 6) — Task 4 discharges via 5-row state security matrix + fresh-membership check.
- R38 (i18n parity, score 6) — Task 9 discharges via STORY_2_5C_KEYS block.

**ATDD RECOMMENDED**. Task 0 skippable; Task 3/4/9 are mandatory regardless.

### NFR evidence

Task 10 log-scrub audit inline. `docs/security/integration-encryption.md` runbook deferred to FU-2-5-M (Epic 2 close activity per John DEFER — not blocking).

### Filed follow-ups

- **`FU-2-5-B`** — Google Meet Disconnect calls Google's token-revoke endpoint. v1 only deletes local row. Priority: P3.
- **`FU-2-5-D`** — Google Drive integration. Deps Knowledge Hub (Story 4.4). Priority: P3.
- **`FU-2-5-E`** — Zoom integration. Priority: P4.
- **`FU-2-5-L`** — Encryption key rotation runbook + `key_version` column migration. Priority: P3.
- **`FU-2-5-M`** — `docs/security/integration-encryption.md` NFR evidence doc. Priority: P2 for Epic 2 close.
- **`FU-2-5-N`** — Playwright session-cache seeding infra for full OAuth E2E. Mirror of FU-2-4-J. Priority: P3.

### References

- [Source: `_bmad-output/implementation-artifacts/2-5-superseded-see-2-5a-b-c.md`] — parent shared context.
- [Source: `_bmad-output/implementation-artifacts/2-5a-backend-and-profile-tab.md`] — sibling: /settings shell + Profile.
- [Source: `_bmad-output/implementation-artifacts/2-5b-terms-holidays-rooms-tabs.md`] — sibling: Terms/Rooms/Holidays.
- [Source: `classlite-api/internal/service/auth_google.go`] — Google OAuth login reference.
- [Source: `classlite-api/internal/service/oauth_state.go`] — HMAC state signing (Task 4.1 extends).
- [Source: `classlite-api/migrations/20260703120000_create_class_templates.up.sql:29-55`] — RLS 4-policy pattern.
- [Source: `classlite-api/internal/service/audit.go`] — audit-log-within-tx pattern.
- [Source: `docs/classlite-entry/05-cross-role.html:7042-7118`] — s49 Integrations mockup.
- [Source: `docs/project-context.md#SEC-1..11`] — auth + tenant security invariants.

## Definition of Done

1. All 18 ACs green.
2. `npm run test` clean — expected delta **~+90-120 tests**; no regression on 2-5a + 2-5b + Story 2-1..2-4 shipped test files.
3. `npm run lint` + `tsc` clean.
4. `npm run i18n-parity` clean — pinned `STORY_2_5C_KEYS` (~35-45) + ratchet.
5. `axe-core` zero violations per AC17.
6. Storybook: IntegrationsTab ≥3 variants.
7. `go test ./...` + `go vet ./...` + `golangci-lint run` clean; RLS adversarial + crypto matrix + OAuth state matrix all green.
8. `git status` shows only backend + frontend + story artifacts + sprint-status + `.env.example`. `codegen.sh` last script per WF-3.
9. `npm run build` clean.
10. Playwright `settings-integrations-connect.spec.ts` green per Task 8 pattern (mocked authorize URL — full backend round-trip deferred FU-2-5-N).
11. Task 10 log-scrub audit passes — no plaintext token / encryption key references outside crypto module.
12. Sibling completion-notes at `_bmad-output/implementation-artifacts/2-5c-google-meet-oauth-integration-completion-notes.md`.
13. Change Log updated with fold citations.
14. Sprint-status `2-5c-google-meet-oauth-integration` flipped `backlog → ready-for-dev → in-progress → review` — dev picks up after 2-5a (and ideally 2-5b) ships.

## Out of Scope

- Google Drive integration — FU-2-5-D.
- Zoom integration — FU-2-5-E.
- Meet-link creation on session insert — Epic 3 (Story 3.4/3.5).
- Google token-revoke on Disconnect — FU-2-5-B.
- Encryption key rotation + `key_version` column — FU-2-5-L.
- `docs/security/integration-encryption.md` NFR doc — FU-2-5-M.
- Full backend OAuth Playwright round-trip — FU-2-5-N.
- Notifications section body (mockup :7098-7118) — Epic 10.

## Change Log

| Date | Note |
|---|---|
| 2026-07-14 | Story created as split 3 of 3 from parent 2-5 after party-mode adversarial review. Absorbs John-ACCEPTed folds: **BLOCKERs** B5 (`.down.sql` IF EXISTS), B6 (RLS 4-policy with UPDATE WITH CHECK for `center_integrations` per Winston-B2), B7 (7-step HandleCallback tx flow per AC5), B8 (OAuth state `SignedState` extended with CenterID + UserID triple binding per AC7), B9 (fresh Owner membership re-check per AC5 step 3), B15 (5-scenario crypto matrix + 5-row state security matrix + 429 Retry-After header intent); **STRONGs** S3 (useLayoutEffect StrictMode guard on callback-return per AC14), S4 (CenterAndIP rate-limit key for callback per AC9), S17 (test-count intent — realistic +90-120 for this sub-story), S18 (callback chain composition pinned per AC9), S20 (5 new error codes registered per Task 4.5), S21 (Validate() base64 + 32-byte assertion per Task 2), S22 (chunk-split — this is chunk 3 of 3), S28→FU-2-5-N deferred, S37 (Playwright `page.route` pattern per Task 8), S42→FU-2-5-M deferred + Task 10 log-scrub inline. Baseline commit TBD until 2-5b lands. Backlog until 2-5a+2-5b ship. Load-bearing security story: OWNS R1+R6+R38 risk discharges. |
