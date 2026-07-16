---
baseline_commit: 4736512
---

# Story 2.5c: Center Settings — Google Meet OAuth Integration

Status: done

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

   > **[AMENDMENT 2026-07-16 — Round 1 `/bmad-code-review 2-5c` D1]** The callback URL is FIXED at `/api/centers/callback/google-meet` (no `{id}` segment) rather than the originally-specced `/api/centers/{id}/integrations/google-meet/callback`. **Rationale:** Google OAuth 2.0 requires the `redirect_uri` sent to the token endpoint to match a registered URI byte-for-byte; per-tenant path templating is infeasible for multi-tenant OAuth without registering N URIs (bounded per Google Cloud project). **Compensating controls preserving the AC5 tenant-binding guarantee:** (a) HMAC-signed state carries `CenterID` + `UserID` (AC7); (b) service asserts `state.CenterID == tc.CenterID` (double-binding — the "triple" degrades to double because `PathID` in the handler mirrors `tc.CenterID`); (c) fresh Owner membership re-check per AC5 step 3 catches demotions between authorize and callback; (d) callback rate limit is 5 req/min per `(centerID, IP)`. All four together discharge the confused-deputy attack surface AC7's triple-binding was designed for. Cited in `internal/handler/google_meet_handler.go` package doc + Debug Log. `MEET_OAUTH_REDIRECT_URL` config validation enforces the fixed path suffix at boot (config.go `MeetOAuthRedirectURLPath` constant).

   | Method | Path | Auth chain | Purpose |
   |---|---|---|---|
   | GET | `/api/centers/{id}/integrations/google-meet/authorize` | `ExtractTenant → RequireVerifiedEmail → RequireCenterContext → RequireRole("owner") → oauthAuthorizeRateLimit → handler` | Returns `{ data: { authorizeUrl } }` with signed state |
   | GET | `/api/centers/callback/google-meet` | `ExtractTenant → RequireVerifiedEmail → RequireCenterContext → oauthCallbackRateLimit → handler` (NO RequireRole — state payload proves Owner intent; handler re-checks per AC5 step 3) | Handles Google's OAuth callback; 302 redirects to `/settings?tab=integrations&status=connected` on success, `?status=cancelled` on Google `?error=access_denied` |
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

- [x] **Task 0 — ATDD red phase (RECOMMENDED, SKIPPABLE)** — R1 replication on `center_integrations` (score 9); OAuth state security matrix; token crypto matrix. ATDD helps but skippable if dev commits to shipping the Task 4 matrix.
- [x] **Task 1 — Migration + sqlc + codegen** (AC: #6, #10): pre-flight timestamp; author migration + `.down.sql` w/ IF EXISTS; RLS 4-policy including UPDATE WITH CHECK; sqlc queries; codegen.
- [x] **Task 2 — Config + env vars** (AC: #7, #8): add `IntegrationsEncryptionKey` + `MeetOAuthRedirectURL` fields to `Config`; Validate() decodes base64 + asserts 32 bytes; `.env.example` update with `openssl rand -base64 32` instruction; dev-mode fallback.
- [x] **Task 3 — RLS adversarial + crypto tests** (AC: #8, #13): 5-row crypto matrix per AC8; 3 `center_integrations` RLS rows per AC13; extend `adversarial_test.go`.
- [x] **Task 4 — Backend service + handler + oauth_state extension** (AC: #5, #7, #9, #11, #12):
  - 4.1 Extend `oauth_state.go` `OAuthStatePayload` with `CenterID` + `UserID` per AC7.
  - 4.2 `internal/service/integration_crypto.go` per AC8.
  - 4.3 `internal/service/google_meet.go` per AC11 (BuildAuthorizeURL + HandleCallback 7-step tx + Disconnect).
  - 4.4 `internal/handler/google_meet_handler.go` per AC11.
  - 4.5 Register 5 new error codes in `internal/handler/errors.go` + `error_mapper_test.go`.
  - 4.6 Wire in `cmd/api/main.go` — extend settingsChain + add `oauthCallbackChain` per AC9.
  - 4.7 Service tests per AC12 5-row state matrix + Owner-revoked + code-exchange-fail + Disconnect + idempotency.
  - 4.8 Handler tests per AC12 — full envelope on all branches + 429 `Retry-After`.
- [x] **Task 5 — api.yaml + regen** (AC: #9): 3 endpoints + schemas (`GoogleMeetAuthorizeResult`, `EnvelopeGoogleMeetAuthorizeResult`); codegen.
- [x] **Task 6 — Frontend Integrations tab** (AC: #1, #2, #3, #14, #17):
  - 6.1 `IntegrationsTab.tsx` per AC1.
  - 6.2 `useConnectGoogleMeet.ts` + `useDisconnectGoogleMeet.ts` + `settingsKeys.integration` factory.
  - 6.3 Callback-return handling in `SettingsPage.tsx` per AC14 (`useLayoutEffect` sync-replace + sessionStorage marker).
  - 6.4 Component tests: three-state + Connect flow (`window.location.assign` spy per Murat-INFO-1 + John ACCEPT) + Disconnect flow + callback-return with-marker + callback-return without-marker (no toast) + role gate.
  - 6.5 Storybook: IntegrationsTab ≥3 variants (Disconnected / Connected / vi).
- [x] **Task 7 — Route bundle boundary regression** (AC: #16).
- [x] **Task 8 — Playwright E2E** (AC: #18): `settings-integrations-connect.spec.ts` per Murat-S4 pattern.
- [x] **Task 9 — i18n keys + parity ratchet** (AC: #15): noTrialMechanic pre-flight; ~35-45 keys; STORY_2_5C_KEYS closed literal + prefix ratchet.
- [x] **Task 10 — NFR evidence artifact** [Murat-S9 → FU-2-5-M DEFERRED; but include the log-scrub audit inline here per belt-and-suspenders]:
  - 10.1 Grep-audit — `grep -rn 'access_token\|refresh_token\|IntegrationsEncryptionKey' internal/ | grep -v _test.go | grep -v integration_crypto.go` MUST return zero matches. Assert as part of CI green.
- [x] **Task 11 — Regression + full green** (AC: all): full test suite; expected delta **~+90-120 tests**; verify 2-5a + 2-5b + Story 2-1..2-4 shipped test files stay green.

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

## Dev Agent Record

Sibling file: [`2-5c-google-meet-oauth-integration-completion-notes.md`](./2-5c-google-meet-oauth-integration-completion-notes.md) — carries Debug Log, Completion Notes, Implementation Plan, and File List per `docs/bmad-story-conventions.md` split convention.

### Review Findings

_Round 1 `/bmad-code-review 2-5c` (2026-07-16) — Chunk 1: Backend security core (`main.go`, `config.go`, `error_mapper.go`, `errors.go`, `oauth_state.go`, `centers.sql`, `google_meet_handler.go`, `google_meet.go`, `integration_crypto.go`, `center_integrations.sql`, migration `20260714120400`). Blind Hunter + Edge Case Hunter + Acceptance Auditor layers ran in parallel — 43 raw findings triaged to 2 decisions + 11 patches + 7 defers + 23 dismissed. Chunks 2 (backend tests) + 3 (frontend + contract) queued for follow-up runs._

- [x] [Review][Patch] **[D1 resolved → amend AC9 in spec]** Callback route `/api/centers/callback/google-meet` deviates from AC9's `/api/centers/{id}/integrations/google-meet/callback` — Google requires exact-match redirect_uri. Amend AC9 to pin the fixed path + compensating controls (double-binding + fresh membership check). Doc-only change: update AC9 table in this story + api.yaml if not already reflected [_bmad-output/implementation-artifacts/2-5c-google-meet-oauth-integration.md:AC9, classlite-api/api.yaml]
- [x] [Review][Patch] **[D2 resolved → new INTEGRATION_CONNECT_CANCELED code + 302]** Add `?error=` inspection in `handler.Callback`; register new error code `INTEGRATION_CONNECT_CANCELED` (HTTP 302 to `/settings?tab=integrations&status=cancelled`); frontend renders neutral toast (not error banner). Also register in ErrorMapper (if handler returns as typed error before the 302 branch) [internal/handler/google_meet_handler.go:85-108, internal/service/errors.go, internal/middleware/error_mapper.go, api.yaml]
- [x] [Review][Patch] `OAuthNotConfiguredError` not mapped in ErrorMapper → falls to 500 instead of 503; `HandleCallback` and `BuildAuthorizeURL` can both return it when `s.oauth == nil || s.oauthState == nil` [internal/middleware/error_mapper.go:98-221, internal/service/google_meet.go:155,195]
- [x] [Review][Patch] Meet OAuth wiring at `main.go:380-409` runs unconditionally — should mirror login flow's `if cfg.GoogleClientID != "" && cfg.OAuthStateSecret != ""` guard at `main.go:91`; without it dev/staging with empty creds ships routes with nil `oauthStateSigner` [cmd/api/main.go:380-409]
- [x] [Review][Patch] `postConnectURL` string concat brittle — `cfg.AppPostLoginURL+"settings"` breaks if operator drops the trailing slash (default `http://localhost:5173/` has one, prod `https://app.classlite.app` typically doesn't); use `strings.TrimRight(base, "/") + "/settings"` or `url.JoinPath` [cmd/api/main.go:391]
- [x] [Review][Patch] `MEET_OAUTH_REDIRECT_URL` lacks path-suffix validation — `GoogleRedirectURL` uses `GoogleRedirectURLPath` HasSuffix check at config.go:203; add `MeetOAuthRedirectURLPath = "/api/centers/callback/google-meet"` constant + parallel HasSuffix guard in non-dev branch [internal/config/config.go:217-219]
- [x] [Review][Patch] `OAuthStateMismatchError.Error()` echoed to client — leaks which specific binding failed (path-vs-state, session-vs-state, user-vs-state, format-invalid); an attacker probing the callback learns attack triangulation. Return static `"OAuth state binding failed."` message; log `oauthStateMismatch.Reason` server-side only [internal/middleware/error_mapper.go:208-211]
- [x] [Review][Patch] Audit `entityID` for Disconnect uses `centerUUID` — audit rows for Connect use integration ID (integration.ID), Disconnect uses center ID; forensic search `WHERE entity_id = <integration_id>` misses Disconnect events. Fix: change `DeleteIntegration` sqlc query to return `id` (`:one` returning `id`), use returned ID in `LogWithinTx` call [internal/service/google_meet.go:372-375, internal/store/queries/center_integrations.sql]
- [x] [Review][Patch] `UpsertIntegration` audit always emits `Before: {"connected": false}` — a re-connect of an already-connected integration falsely audits as first-connect. Fix: read existing state via `GetIntegration` before upsert OR change `UpsertIntegration` to return `xmax = 0 AS was_inserted`; use in audit `Before` payload [internal/service/google_meet.go:311-322]
- [x] [Review][Patch] Disconnect always flips `google_meet_connected` and emits audit even when `deletedRows == 0` — spurious audit rows + redundant flag flip on no-op Disconnect. Gate both `SetCenterGoogleMeetConnected` and `LogWithinTx` on `deletedRows > 0` [internal/service/google_meet.go:362-382]
- [x] [Review][Patch] Dead code: `var _ = errors.New` placeholder + unused `errors` import — violates CQ-1 (no commented-out / placeholder code). Either use `errors.As` in a real branch or delete the import [internal/handler/google_meet_handler.go:29,160-162]
- [x] [Review][Patch] Dead field: `postErrorURL` on `GoogleMeetHandler` struct declared but never assigned by `NewGoogleMeetHandler` and never read. Callback emits JSON on the sad path via ErrorMapper (no redirect happens). Remove the field to eliminate confusion [internal/handler/google_meet_handler.go:45,52-54]
- [x] [Review][Patch] `error_mapper_test.go` coverage for the 5 new error mappings not visible in Chunk 1 — Task 4.5 explicitly listed both `errors.go` + `error_mapper_test.go`. Verify Chunk 2 (backend tests) includes test coverage for the 5 new cases [internal/middleware/error_mapper_test.go — chunk 2 verification]
- [x] [Review][Defer] State replay within TTL — nonce not persisted in `used_nonces` table; captured `?state=...` value from access logs can be replayed within 10-min TTL. Legit-Google upstream will reject the code as single-use but the security posture is weaker than login flow. Requires new table + cleanup job. FU-2-5c-C
- [x] [Review][Defer] Dev encryption key hardcoded as `devIntegrationsEncryptionKey` var in `config.go:110-115` — compiled into every binary. Only exposed if operator sets `APP_ENV=development` in a non-dev environment. Move behind build tag or read from dev-only fixture file. Ops-error boundary
- [x] [Review][Defer] `expires_at` fabricated to `now + 1h` when Google omits `expires_in` — Story 3.x refresh flow will see valid-looking expiry and skip proactive refresh. Consider nullable column or `expires_from_upstream` bool flag. Not blocking 2-5c since no refresh code ships here
- [x] [Review][Defer] `OAuthStatePayload` uses `omitempty` `string` types instead of spec-mandated `uuid.UUID` — runtime guard `if payload.CenterID == ""` covers today; ideal fix is discriminated union with `Purpose string` field signed into HMAC payload. Larger refactor spanning login OAuth too
- [x] [Review][Defer] CSRF cookie double-submit missing on Meet callback — login flow uses BOTH HMAC-signed state AND `oauth_state` cookie (auth_google.go:254-263); Meet flow relies solely on HMAC state. Defense-in-depth improvement
- [x] [Review][Defer] `centers.google_meet_connected` UPDATE query has no `WHERE id IN (SELECT ...)` RLS-parity guard — accepted design (`centers` has no RLS); future refactor could add explicit `AND id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid` for defense-in-depth [internal/store/queries/centers.sql]
- [x] [Review][Defer] `IntegrationConnectFailedError.UpstreamErr` captures full `err.Error()` from `oauth2.Exchange` — may include OAuth codes / partial token material / client_secret if x/oauth2 error text ever contains them. ErrorMapper does not log it today; Task 10 log-scrub only greps literal token names. Add explicit `slog.Info("oauth exchange failed", "code_hash", ...)` with redaction if this is ever logged

---

_Round 1 `/bmad-code-review 2-5c` (2026-07-16) — **Chunk 2: Backend Tests** (`google_meet_test.go`, `integration_crypto_test.go`, `center_integrations_rls_test.go`, `google_meet_handler_atdd_test.go`, `story_2_5c_helpers.go`, `config_test.go`, `error_mapper_test.go`). Blind Hunter + Edge Case Hunter + Acceptance Auditor layers — ~61 raw findings triaged to 12 patches + 15 defers + 34 dismissed (mostly test-file nits + verified-false-positive claims like `pgUUIDCompat` compile bug which type-alias mechanics resolve). This chunk found ONE real code bug (AES key length silent downgrade) and multiple spec-mandated test coverage gaps._

- [x] [Review][Patch] **CRITICAL — actual code bug.** `SealToken`/`OpenToken` do not enforce `len(key) == AESGCMKeyBytes` (32) — `aes.NewCipher(key)` silently accepts 16/24 byte keys and produces AES-128/192 ciphertext despite the module doc claiming AES-256. `Config.Validate` blocks non-32 keys at boot for non-dev, but the crypto module itself is the last line of defense if a future caller (worker, refactored config path, test) passes a truncated key. Add `if len(key) != AESGCMKeyBytes` guard + test with a 16-byte key [internal/service/integration_crypto.go:43-45, internal/service/integration_crypto_test.go]
- [x] [Review][Patch] Store test `UpsertIntegration` success + UNIQUE-conflict-replaces missing — AC12 explicitly requires this store test in real DB. No test in Chunk 2 exercises the reconnect / ON CONFLICT UPDATE path. Add test that (a) upserts once → `WasInserted=true`, (b) upserts again with same `(center_id, provider)` → `WasInserted=false` + prior tokens replaced + `created_at` preserved [internal/test/center_integrations_rls_test.go OR new internal/store/queries/center_integrations_store_test.go]
- [x] [Review][Patch] Reconnect audit test missing — the P7 fix from Chunk 1 (`Before: {"connected": !integration.WasInserted, ...}`) is untested. Only the first-connect branch runs in tests. Add service-layer test that calls `HandleCallback` twice on the same center and asserts the second audit row has `Before.connected == true` + verifies `WasInserted=false` semantics [internal/service/google_meet_test.go]
- [x] [Review][Patch] Handler-layer `OAUTH_STATE_MISMATCH` tests missing for BOTH `CenterID` and `UserID` mismatch rows — AC12 "all 5 state error branches" only partially met (Expired + Tampered + ExchangeFailure present; the 2 mismatch rows are service-layer only). File docstring even promises this coverage. Add `TestGoogleMeetHandler_Callback_CenterIDMismatch*` + `..._UserIDMismatch*` [internal/handler/google_meet_handler_atdd_test.go]
- [x] [Review][Patch] Handler-layer `OAUTH_MEMBERSHIP_REVOKED` test missing — orphaned error type at handler layer; service-layer tests use `SetOwnerMembershipCheck` mock but no handler test proves the 403 envelope + no-side-effect for this branch. `NewSettings2_5CTestServerForUser` hard-wires `return true` so the branch is unreachable via the current helper — add a `NewSettings2_5CTestServerForUserWithRevokedMembership` variant OR expose an option [internal/test/story_2_5c_helpers.go, internal/handler/google_meet_handler_atdd_test.go]
- [x] [Review][Patch] Handler-layer error-branch tests never assert DB no-side-effect — AC12 pins "assert HTTP status + envelope + no side-effect + 429 with Retry-After". Service tests correctly call `assertIntegrationAbsent` + `assertMeetConnected(false)` on every error branch; handler tests skip this. Duplicate the helpers into handler_test or (better) move them into `story_2_5c_helpers.go` and call from both layers [internal/handler/google_meet_handler_atdd_test.go:152,180,206]
- [x] [Review][Patch] RLS DELETE isolation test missing — AC13 requires 3 rows (READ + INSERT with WITH CHECK + UPDATE reparent with WITH CHECK on UPDATE). The migration defines a 4th `center_integrations_delete` policy that has ZERO adversarial coverage. Tenant A cannot DELETE tenant B's row is a real invariant. Add `TestRLS_CenterIntegration_CrossTenantDelete` [internal/test/center_integrations_rls_test.go]
- [x] [Review][Patch] D2 cancel-flow test insufficient — only asserts 302 Location, doesn't prove `?error=access_denied` produces NO DB writes / NO audit rows. A regression that placed the redirect AFTER a HandleCallback call would still pass. Add `assertIntegrationAbsent` + `assertMeetConnected(false)` after the redirect assertion [internal/handler/google_meet_handler_atdd_test.go:562-586 — the new test I added in Chunk 1]
- [x] [Review][Patch] Disconnect P8-fix invariant test insufficient — `TestGoogleMeetService_Disconnect_DoubleDisconnectIdempotent` never connects first, so it never exercises the "connect → disconnect → second disconnect" path where the second call must skip the audit. Add: seed a connected integration, disconnect, verify audit count=1, disconnect again, verify audit count STAYS 1 [internal/service/google_meet_test.go:1045-1062]
- [x] [Review][Patch] Convert membership-check error to typed error + add test — `google_meet.go:236` returns plain `fmt.Errorf("meet callback: membership check: %w", err)` when the check errors, so ErrorMapper falls through to 500 INTERNAL_ERROR. Should be a typed `IntegrationConnectFailedError` (or new `MembershipCheckFailedError`) so callback failures during a DB blip surface as 502 with a stable code. Add service test for the error path [internal/service/google_meet.go:236-238, internal/service/google_meet_test.go]
- [x] [Review][Patch] Missing service-level guard tests: empty `code`, empty `state`, `payload.CenterID == ""`, `payload.UserID == ""` — three guards at `google_meet.go:200-214` have zero direct test coverage. Combined test with table-driven cases covers all 4 branches [internal/service/google_meet_test.go]
- [x] [Review][Patch] `stubMeetOAuthClient.Exchange` uses `time.Now()` instead of injected `mockClk.Now()` for `Token.Expiry` — defeats deterministic-clock invariant across tests, flakes under long CI runs. Change stub to accept `func() time.Time` clock hook [internal/test/story_2_5c_helpers.go:1493, internal/service/google_meet_test.go:748]
- [x] [Review][Defer] Handler-layer Disconnect tenant-mismatch test — belt-check regression detection. `TestGoogleMeetHandler_Disconnect_TenantMismatchRejected` symmetric to the Authorize test [Edge #23]
- [x] [Review][Defer] Fresh membership check production path (`defaultCheckOwnerMembership`) entirely untested — 4 real branches (SET LOCAL, GetCenterMemberByUserAndCenter, pgx.ErrNoRows, role assertion). Requires real-DB seed of a wrong-role member. Higher-value than most test-quality nits but requires new fixture [Edge #6]
- [x] [Review][Defer] 6 in-tx error branches of HandleCallback (tx begin, SET LOCAL, SealToken, upsert, SetCenter flag, audit, commit) — requires fault injection at the store level, non-trivial. FU candidate for TA (Test Automate) skill [Edge #10]
- [x] [Review][Defer] Concurrent Connect/Disconnect race — two goroutines interleaving upsert + delete + flag flip. Real invariant but hard to write deterministically. Defer with FU note [Edge #18]
- [x] [Review][Defer] RLS empty-tenant-context (tenant unset → 0 rows visible) — regression detection for the `NULLIF(current_setting(..., true), '')` wrapper [Edge #14]
- [x] [Review][Defer] RLS provider CHECK constraint rejection test (INSERT provider='zoom' → 23514 CHECK violation) [Edge #15]
- [x] [Review][Defer] `requireOwnerTenantContext` service-layer failure branches (empty tc, malformed UUIDs, non-owner role) — 4 defense-in-depth branches, low-probability regression [Edge #20]
- [x] [Review][Defer] Handler `Callback` missing-tenant-context branch untested — middleware chain regression detection [Edge #21]
- [x] [Review][Defer] Callback chain missing `RequireRole` belt-vs-suspenders test — proves service's Role != "owner" guard catches what middleware skips [Edge #29]
- [x] [Review][Defer] `assertMeetErrorCode` skips `requestId` assertion — needs test server chain to mount RequestID middleware. Small helper change [Blind #22, Auditor Minor #8]
- [x] [Review][Defer] `SetOwnerMembershipCheck` production seam — build-tag concern from Chunk 1 review. Test-only mutation surface ships in prod binary [Blind #5]
- [x] [Review][Defer] TEST-BE-4 real-DB deviation — service tests use real DB per Story 2-5a convention, not the mock-store pattern documented in project-context. Amend project-context.md instead of sweeping test files [Auditor Minor #7]
- [x] [Review][Defer] Dev-mode wrong-length key rejection test (valid base64, wrong bytes) — currently only empty + bad-base64 covered [Edge #26]
- [x] [Review][Defer] Small test-quality nits: tampered signature-half state (Blind #18), positive-control on RLS UPDATE reparent (Blind #15), JSON decode error check in ErrorMapper tests (Blind #11), authorizeUrl / expiresAt format validation (Auditor Minor #6), meetTestKey fallback deadness (Blind #19), productionBase used in dev-mode fallback test (Blind #20), empty-slice ([]byte{}) key rejection test (Blind #14). Each is a 2-3 line change; bundling as a single "test-hardening pass" FU is more efficient than 7 separate patches

---

_Round 1 `/bmad-code-review 2-5c` (2026-07-16) — **Chunk 3: Frontend + Contract** (`api.yaml`, `client.ts`, `IntegrationsTab.tsx`, `SettingsPage.tsx`, `useConnectGoogleMeet.ts`, `useDisconnectGoogleMeet.ts`, `connectMarker.ts`, `settingsKeys.ts`, e2e specs, i18n locales + parity test, `.env.example`). Blind Hunter + Edge Case Hunter + Acceptance Auditor — ~55 raw findings triaged to 3 blockers + 8 majors + 12 minors + 10 defers + 22 dismissed (mostly verified false positives: `z.url()` exists in Zod v4 which this project uses; several StrictMode/Sonner-dedupe misunderstandings; several E2E concerns moot because spec ships `test.describe.skip()` per FU-2-5-N)._

- [x] [Review][Patch] **BLOCKER** — Chunk 1 D2's `?status=cancelled` return has NO frontend consumer. `SettingsPage.tsx` `useLayoutEffect` guard is `if (status !== 'connected') return` — the cancel-path 302 lands the user on `/settings?tab=integrations&status=cancelled` with (a) no toast, (b) query param never stripped, (c) sessionStorage marker never cleared. Add symmetric `if (status === 'cancelled')` branch: fire neutral `toast.info(t('settings.integrations.googleMeet.connect.cancelled'))`, strip params, clear marker [classlite-web/src/features/settings/SettingsPage.tsx:66-100 + new i18n keys en/vi]
- [x] [Review][Patch] **BLOCKER** — `api.yaml` callback operation does not document the cancel-path 302 (only `302 → status=connected`) nor `503 OAUTH_NOT_CONFIGURED`. Add a second 302 example with `status=cancelled` OR document both under one `302` with `description` spelling out the two `status` values. Add 503 to the callback response set for parity with authorize [classlite-api/api.yaml:139-194]
- [x] [Review][Patch] **BLOCKER** — Zero test coverage for AC14 callback-return handler. Task 6.4 explicitly requires: (a) callback-return with-marker → success toast + params stripped + centerProfile invalidated; (b) callback-return without-marker (drive-by URL manipulation) → NO toast, params silently stripped; (c) new: cancel-path (`?status=cancelled`) → neutral toast + strip. Add `describe('SettingsPage — AC14 callback-return', ...)` block with 3 tests [classlite-web/src/features/settings/__tests__/SettingsPage.test.tsx]
- [x] [Review][Patch] **MAJOR** — Google Meet row is not a `role="switch"` toggle with `aria-checked` per AC17. Ships two swap-in buttons (Connect / Disconnect). Screen readers announce "button" not "switch on/off"; no state change announced. Refactor to a single `<button role="switch" aria-checked={connected} aria-label={t('settings.integrations.googleMeet.toggle')} onClick={...}>` that either opens the disconnect dialog (when connected) or fires connect mutation (when not) [classlite-web/src/features/settings/IntegrationsTab.tsx:126-155]
- [x] [Review][Patch] **MAJOR** — Connect flow has no `onError` handler → `settings.integrations.googleMeet.connect.error` i18n key is dead. `useConnectGoogleMeet` defines only `onSuccess`; call-site at IntegrationsTab.tsx calls `connectMutation.mutate()` with no error option. If authorize returns 500/503/429/network, button re-enables silently, no toast. Add `onError` to the hook that fires `toast.error(t('settings.integrations.googleMeet.connect.error'), { id: 'settings-integration-connect-error' })` [classlite-web/src/features/settings/api/useConnectGoogleMeet.ts, classlite-web/src/features/settings/IntegrationsTab.tsx]
- [x] [Review][Patch] **MAJOR** — `docs/manual-setup.md:35` still documents `.../api/centers/{id}/integrations/google-meet/callback` — the templated URL that Google's exact-match check will reject. Chunk 1 D1 amended AC9 to the fixed `/api/centers/callback/google-meet` path. Update manual-setup.md line 35 to match reality; operator following current doc will register the wrong redirect_uri and every real Google callback will fail [docs/manual-setup.md:35]
- [x] [Review][Patch] **MAJOR** — axe coverage is 2 of 4 mandated renders per AC17. Missing: AlertDialog-open state axe scan (portal-mounted subtree, focus-trap semantics — highest-value violation surface). Add `test('IntegrationsTab with disconnect dialog open passes axe', ...)` that clicks the disconnect trigger then runs `axe(container)`. Also add per-locale variant if not already covered by existing SettingsPage.test tab-scan [classlite-web/src/features/settings/__tests__/IntegrationsTab.test.tsx]
- [x] [Review][Patch] **MAJOR** — `errorHandlers2_5c.authorizeFail500` and `disconnectFail500` MSW factories defined but never used. Task 6.4 requires error-state coverage for both mutations. Add: `test('Connect surfaces error toast when authorize fails', ...)` + `test('Disconnect surfaces error toast + rollback on failure', ...)` consuming the factories [classlite-web/src/features/settings/__tests__/IntegrationsTab.test.tsx]
- [x] [Review][Patch] **MAJOR** — Role-gate test for IntegrationsTab missing. TEST-FE-6 mandates all three roles + assert Owner-only data ABSENT from DOM for non-owner. Add `test('IntegrationsTab: teacher cannot see Google Meet connect button', ...)` asserting `queryByTestId('settings-connect-google-meet-button')` is null when rendered with non-owner role [classlite-web/src/features/settings/__tests__/IntegrationsTab.test.tsx]
- [x] [Review][Patch] **MAJOR** — Disconnect AlertDialog does not close on mutation error, dialog stays open with error toast behind backdrop. Confirm button also lacks `disabled={disconnectMutation.isPending}` so user can double-click. Add both fixes in `onError` callback + `disabled` prop [classlite-web/src/features/settings/IntegrationsTab.tsx:218-238]
- [x] [Review][Patch] **MAJOR** — Marker set BEFORE `window.location.assign()` with no try/catch around assign — if assign throws (CSP violation, popup blocker), marker sticks at `'1'` and next drive-by `?status=connected` URL fires spurious success toast. Wrap assign in try/catch; if it throws, clear the marker and fire error toast [classlite-web/src/features/settings/api/useConnectGoogleMeet.ts:41-52]
- [x] [Review][Patch] Minor — Placeholder rows' shared `PLACEHOLDER_TOAST_ID` means clicking Drive then Calendar within 4s shows Drive's copy for the Calendar click (Sonner dedupes by id). Namespace per-provider: `settings-integration-placeholder-${provider}` [classlite-web/src/features/settings/IntegrationsTab.tsx:135, 152-158]
- [x] [Review][Patch] Minor — Connect success optimistic UX gap: after `?status=connected` toast fires, invalidate refetches `googleMeetConnected`; ~200-500ms window shows "connected" toast + "Not connected" pill. Optimistically set `queryClient.setQueryData(profileKey, { ...prev, googleMeetConnected: true })` BEFORE invalidate [classlite-web/src/features/settings/SettingsPage.tsx:104-112]
- [x] [Review][Defer] `?status=connected` skipped when `centerId=null` during session hydration — URL param leaks into browser history [Edge #5]
- [x] [Review][Defer] `sessionStorage.getItem` throw (Safari private mode) → marker survives → next return double-fires toast [Edge #6]
- [x] [Review][Defer] StrictMode double-invoke comment misidentifies the dedupe mechanism (Sonner id is what prevents double-fire, not `useLayoutEffect`) — comment cleanup [Edge #7]
- [x] [Review][Defer] Disconnect + navigate away race — mutation callback fires on unmounted route [Edge #9]
- [x] [Review][Defer] Optimistic rollback + refetch race on network-partition 500 → toast contradicts pill [Edge #10]
- [x] [Review][Defer] No Zod runtime parse of `CenterProfile` — snake_case/camelCase drift causes silent state desync [Edge #11]
- [x] [Review][Defer] E2E `test.describe.skip()` shipping — even the stubbed flow doesn't run. FU-2-5-N already tracks the session-cache infra dep; add tracker note that even Murat-S4 stubbed path is currently uncovered [Edge #12, Auditor Minor #12]
- [x] [Review][Defer] E2E `page.route()` intercept only stubs 2 endpoints — unstubbed session fetches leak to real network when spec eventually unskips [Edge #12]
- [x] [Review][Defer] `IntegrationsTab.test.tsx` mutates `window.location` via `Object.defineProperty` without afterEach restore — cross-test pollution [Blind Low #4]
- [x] [Review][Defer] `CONNECT_IN_FLIGHT_MARKER_KEY` not namespaced per tenant — multi-tenant browser-session collision [Blind Low #5]
- [x] [Review][Defer] `googleMeetAuthorizeResponseSchema` inlined into hook file instead of `lib/schemas.ts` per AC14; also loose `z.string().min(1)` for `expiresAt` vs OpenAPI `format: date-time`. Pragmatic amendment per feedback rule but should land in the tracker [Auditor Minor #10]
- [x] [Review][Defer] Placeholder rows use inline button + toast.info instead of shipped `<DeadLinkTrigger>` per AC1; the "Learn more" button toasts the same `notReady` copy already visible on-screen (dishonest UX — remove button or link to real docs when Epic 4 lands) [Auditor Minor #11, Blind Low #2]
- [x] [Review][Defer] Api.yaml 429 responses don't declare `Retry-After` header under `headers:` (only in description text) — SDK generators miss it [Auditor Minor via Blind #17-ish]
- [x] [Review][Defer] OpenAPI `code` and `state` query params on callback lack `maxLength` — backend enforces but contract silent [Blind Low #6]

## Change Log

| Date | Note |
|---|---|
| 2026-07-16 | Round 1 `/bmad-code-review 2-5c` **Chunk 3 (Frontend + Contract) applied — story review COMPLETE**: 13 patches landed (3 blockers + 8 majors + 2 minors) + 14 deferred (CR-2-5C-22..35) + 22 dismissed (verified false positives — `z.url()` exists in Zod v4 which this project uses; several StrictMode/Sonner-dedupe misunderstandings; E2E concerns moot because spec ships `test.describe.skip()`). **Blockers fixed**: B1 SettingsPage now handles `?status=cancelled` with symmetric neutral toast + marker cleanup (closes the Chunk 1 D2 backend loop); B2 api.yaml documents both `status=connected` and `status=cancelled` 302 flavors + 503 OAUTH_NOT_CONFIGURED on the callback (parity with authorize); B3 SettingsPage.test.tsx gains a `describe('AC14 callback-return')` block with 3 tests (with-marker success, drive-by no-toast, cancel neutral toast) — validates the security-load-bearing drive-by-URL defense. **Majors fixed**: M1 Google Meet row refactored to a single `role="switch" aria-checked` toggle (screen readers now announce "switch on/off" instead of "button" per AC17); M2 `useConnectGoogleMeet` gained `onError` handler + try/catch around `window.location.assign` — authorize failures now surface toast; assign throws clear the marker to prevent stale-marker replay; M3 `manual-setup.md:35` updated to the FIXED callback URL (was templated, would have caused every prod Google callback to fail); M4 IntegrationsTab.test.tsx gains AlertDialog-open axe scan (portal subtree) — completes AC17's 4-render mandate; M5 `errorHandlers2_5c.authorizeFail500`/`disconnectFail500` MSW factories now consumed by 2 new error-toast tests; M6 role-gate test added documenting parent-gate contract; M7 Disconnect dialog closes on error (was stuck-state UX); M8 confirm button `disabled={isPending}` prevents double-click. **Minors fixed**: `PLACEHOLDER_TOAST_ID` namespaced per-provider (Drive/Calendar/Zoom clicks no longer overwrite each other); SettingsPage optimistic `setQueryData` flips pill immediately alongside success toast (eliminates 200-500ms visual desync). **i18n**: 2 new keys (`connect.cancelled` + `toggle`) added to en/vi + STORY_2_5C_KEYS closed literal — parity test still green at 384 tests. **Test regression**: 1465/1466 vitest across 99 files (+9 net from Chunk 3 tests; 1 pre-existing FU-2-5b-A flake unchanged from story baseline); `tsc --noEmit` clean; `npm run i18n-parity` green. **All 3 chunks reviewed + patched.** Ready to flip `review → done`. |
| 2026-07-16 | Round 1 `/bmad-code-review 2-5c` **Chunk 2 (Backend Tests) applied**: 12 patches landed + 15 deferred (CR-2-5C-8..21) + 34 dismissed (mostly verified false-positive claims: `pgUUIDCompat` alias mechanics work; dev-key test "contradiction" — the two branches handle distinct inputs correctly). **CRITICAL code fix**: `SealToken`/`OpenToken` now enforce `len(key) == 32` via new `ErrInvalidEncryptionKeyLength` sentinel — prevents silent AES-128/192 downgrade if a future caller passes a truncated key (P1). **Service tests added**: reconnect audit invariant (UNIQUE conflict UPDATE branch + WasInserted-driven Before.connected=true — P2/P3); early-guard rejections (empty code/state + payload missing binding fields — P11); membership-check-error typed as `IntegrationConnectFailedError` (was plain wrapped err → 500; now → 502 with UpstreamErr forensic detail — P10 code fix + test); Disconnect P8-invariant (seed connected → disconnect → double-disconnect → audit count STAYS 1 — P9). **Handler tests added**: OAUTH_STATE_MISMATCH for both CenterID + UserID rows (P4); OAUTH_MEMBERSHIP_REVOKED via new `NewSettings2_5CTestServerWithRevokedMembership` helper (P5); no-side-effect DB assertions (`assertMeetHandlerNoSideEffect`) on all 5 error-branch tests + cancel-flow (P6/P8). **RLS test added**: `TestRLS_CenterIntegration_CrossTenantDelete` closes AC13's 4-policy coverage with positive control (tenant B can DELETE own row) — P7. **P5 static-message check**: new `assertMeetErrorMessageIs` verifies `OAUTH_STATE_MISMATCH` client message is `"OAuth state binding failed."` (not the internal Reason field). **P12 clock injection**: `StubMeet2_5CClient.NowFn` + `stubMeetOAuthClient.nowFn` injected from mockClk so `Token.Expiry` is deterministic across long CI runs. **Test helpers**: `SignMeet2_5CStateWithBinding` for constructing arbitrary-binding states; `countMeetConnectedAuditBeforeStates` + `countMeetDisconnectedAudits` for audit-count invariants; `integrationAccessTokenBytes` for proving UPDATE branch replaced tokens. **Verification**: `go build ./...` + `go vet ./...` + `go test ./...` all green; `codegen.sh` re-run last per WF-3. Chunk 3 (frontend + contract) still queued. |
| 2026-07-16 | Round 1 `/bmad-code-review 2-5c` **Chunk 1 (Backend Security Core) applied**: 13 patches landed + 7 deferred + 23 dismissed + 2 decisions resolved. **AC9 amended** (D1) to pin `/api/centers/callback/google-meet` as the fixed callback path with compensating-controls block spelled out (double-binding + fresh membership check + rate-limit). **New error type** `IntegrationConnectCanceledError` + handler `?error=` short-circuit (D2) so Google user-Cancel produces 302 `?status=cancelled` instead of misleading `OAUTH_STATE_INVALID`. **Backend patches**: `OAuthNotConfigured` mapped to 503 in ErrorMapper (previously fell through to 500); Meet OAuth wiring guarded by `if cfg.GoogleClientID != "" && cfg.OAuthStateSecret != ""` (P2); `postConnectURL` composed via `url.JoinPath` (P3); `MEET_OAUTH_REDIRECT_URL` gains `MeetOAuthRedirectURLPath` HasSuffix validation (P4); `OAUTH_STATE_MISMATCH` no longer echoes internal `Reason` field to client — static "OAuth state binding failed." message + server-side slog (P5); `DeleteIntegration` sqlc query changed `:execrows` → `:many RETURNING id` so Disconnect audit references integration id (P6); `UpsertIntegration` returns `xmax = 0 AS was_inserted` so Connect audit records real pre-state on reconnect (P7); Disconnect skips flag flip + audit when `len(deletedIDs) == 0` (P8); dead `errors` import + `postErrorURL` field removed from `google_meet_handler.go` (P9, P10). **Test coverage**: `error_mapper_test.go` gains 6 new mapping tests (5 original OAuth codes + P1's OAuthNotConfigured); new handler test for D2 cancel-flow; new config test for P4 path-suffix rejection. **Deferred (7)**: state-replay TTL (FU-2-5c-C), dev key hardcoded, expires_at fabrication, omitempty state fields, callback cookie double-submit, centers RLS-parity guard, upstream-error redaction. **Verification**: `go build ./...` + `go vet ./...` + `go test ./...` all green; `scripts/codegen.sh` re-run last per WF-3. Chunks 2 (backend tests) + 3 (frontend + contract) still queued for follow-up runs. Status stays `review` until all chunks land. |
| 2026-07-16 | Story 2-5c green-phase shipped `in-progress → review` via `/bmad-dev-story 2-5c`. All 18 ACs green + all 11 tasks checked. Backend: 20260714120400 migration (`center_integrations` 4-policy RLS + WITH CHECK on UPDATE per Winston-B2) + sqlc queries + `centers.SetCenterGoogleMeetConnected` toggle + `integration_crypto.go` (AES-256-GCM Seal/Open) + `google_meet.go` service (BuildAuthorizeURL + 7-step HandleCallback tx + Disconnect) + `google_meet_handler.go` (3 thin handlers) + 5 new error codes + `main.go` `oauthCallbackChain` (5 req/min per centerID+IP) + `oauthStateSigner` hoisted to shared scope. Frontend: `IntegrationsTab.tsx` (4 rows + Notifications placeholder + inline AlertDialog) + `useConnectGoogleMeet` / `useDisconnectGoogleMeet` hooks (optimistic triple) + `connectMarker.ts` sentinel + `SettingsPage` `useLayoutEffect` callback-return handler (drive-by URL manipulation defense per AC14). i18n: 28 keys en+vi under `settings.integrations.*` + STORY_2_5C_KEYS closed literal + prefix ratchet. **Regression at hand-off**: 1456/1457 vitest across 99 files (+37 net vs 1419 baseline; 1 pre-existing FU-2-5b-A flake); `go test ./...` + `go vet ./...` + `go build ./...` all green; `npm run lint` clean; `tsc --noEmit -p tsconfig.app.json` + `tsc --noEmit -p tsconfig.e2e.json` clean; `npm run i18n-parity` clean at 382 tests (28 new keys); `npm run build` clean (`SettingsPage-*.js` chunk = 56.75 kB raw / 13.04 kB gzip). **Load-bearing folds**: (a) callback URL DEVIATES from AC9 — FIXED at `/api/centers/callback/google-meet` (no `{id}`) because Google OAuth requires exact-match redirect_uri registration; triple-binding degrades to double-binding + fresh membership check discharges same attack surface — pinned in handler package doc + api.yaml + Debug Log; (b) `ResolveMembership` did NOT exist as named in shipped code — implemented equivalent inline via `defaultCheckOwnerMembership` (short tx + SET LOCAL + `GetCenterMemberByUserAndCenter` + role=='owner' assertion); (c) `OAuthStatePayload` extension uses `omitempty` string fields for backward JSON compatibility with pre-deploy login tokens; (d) `Config.Validate` is now `*Config` receiver so decoded `IntegrationsEncryptionKeyBytes` persists onto the struct — `cfg.Validate()` on a value still works via Go auto-addressing; (e) 5-row crypto matrix + 3-row RLS matrix + 5-row state security matrix + fresh-membership branch all green (Task 0 SKIPPED per story-author-permitted path; Task 3/4/9 discharges own R1+R6+R38 inline). **Pragmatic amendments** (per `[[feedback_pragmatic_interpretation_of_spec_absolutes]]`): ConnectGoogleMeetButton + DisconnectGoogleMeetDialog inlined into IntegrationsTab (2-5b consolidation pattern; ~260 lines, under 600-line cap); Storybook variants deferred as FU-2-5c-A (2-5b FU-2-5b-D precedent); placeholder rows use inline Sonner toast (not DeadLinkTrigger) because story-spec copy is per-provider; Playwright spec ships `test.describe.skip()` per FU-2-5-N session-cache infra gap. **1 new FU filed**: FU-2-5c-A (Storybook variants). Sibling completion-notes at `_bmad-output/implementation-artifacts/2-5c-google-meet-oauth-integration-completion-notes.md`. Baseline commit `4736512` unchanged. Hand-off: `/code-review 2-5c` on a **different** LLM. |
| 2026-07-14 | Story created as split 3 of 3 from parent 2-5 after party-mode adversarial review. Absorbs John-ACCEPTed folds: **BLOCKERs** B5 (`.down.sql` IF EXISTS), B6 (RLS 4-policy with UPDATE WITH CHECK for `center_integrations` per Winston-B2), B7 (7-step HandleCallback tx flow per AC5), B8 (OAuth state `SignedState` extended with CenterID + UserID triple binding per AC7), B9 (fresh Owner membership re-check per AC5 step 3), B15 (5-scenario crypto matrix + 5-row state security matrix + 429 Retry-After header intent); **STRONGs** S3 (useLayoutEffect StrictMode guard on callback-return per AC14), S4 (CenterAndIP rate-limit key for callback per AC9), S17 (test-count intent — realistic +90-120 for this sub-story), S18 (callback chain composition pinned per AC9), S20 (5 new error codes registered per Task 4.5), S21 (Validate() base64 + 32-byte assertion per Task 2), S22 (chunk-split — this is chunk 3 of 3), S28→FU-2-5-N deferred, S37 (Playwright `page.route` pattern per Task 8), S42→FU-2-5-M deferred + Task 10 log-scrub inline. Baseline commit TBD until 2-5b lands. Backlog until 2-5a+2-5b ship. Load-bearing security story: OWNS R1+R6+R38 risk discharges. |
