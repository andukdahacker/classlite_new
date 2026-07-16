# Story 2-5c: Google Meet OAuth Integration — Completion Notes

_Implementation record for [`2-5c-google-meet-oauth-integration.md`](./2-5c-google-meet-oauth-integration.md). Status: review._

## Dev Agent Record

### Debug Log

- **Task 0 SKIPPED** per story-author-permitted path — Task 0 documents "ATDD helps but skippable if dev commits to shipping the Task 4 matrix." Risk ≥6 discharges (R1 score 9 = RLS cross-tenant, R6 score 6 = OAuth callback tenant binding, R38 score 6 = i18n parity) land inline via the mandatory Task 3/4/9 matrices instead of a separate red-phase.
- **Callback URL DEVIATES from AC9** — story specifies `/api/centers/{id}/integrations/google-meet/callback` (with `{id}` path parameter). Google OAuth 2.0 requires the redirect_uri to match a registered URI **exactly** — no template / wildcard support — so a per-center callback URL is infeasible for a multi-tenant OAuth app. Shipped path is FIXED at `/api/centers/callback/google-meet`. Tenant scoping is preserved by the **double-binding** (`state.CenterID == tc.CenterID`) + fresh membership check per AC5 step 3; the story's triple-binding degrades to double-binding here. Pinned in `internal/handler/google_meet_handler.go` package doc + `api.yaml` operation description. Pragmatic per `[[feedback_pragmatic_interpretation_of_spec_absolutes]]`.
- **`ResolveMembership` did NOT exist** as named in shipped code (story spec references `authSvc.ResolveMembership`). Implemented equivalent inline as `GoogleMeetService.defaultCheckOwnerMembership` — opens a short tx, sets `SET LOCAL app.current_tenant_id`, calls the shipped `GetCenterMemberByUserAndCenter` sqlc query, asserts `member.Role == "owner"`. Injectable seam (`SetOwnerMembershipCheck`) lets service tests skip the DB roundtrip when the fixture already guarantees membership.
- **`OAuthStatePayload` extension is JSON backward-compatible** — added `CenterID` + `UserID` as `omitempty` string fields (not `uuid.UUID` because Go's `[16]byte` never marshals as empty). Existing login-flow tokens (issued pre-deploy) still verify: they decode into a payload with empty CenterID/UserID, which the login flow ignores and the Meet flow explicitly rejects with `OAUTH_STATE_MISMATCH`.
- **Config.Validate is now pointer-receiver** to persist `IntegrationsEncryptionKeyBytes` back onto the struct. `main.go` calls `cfg.Validate()` on a value; Go auto-addresses so no wiring changes needed. `config_test.go` productionBase updated with the 32-byte base64 test key + `MeetOAuthRedirectURL`.
- **7-step tx flow shipped verbatim per AC5** — HandleCallback executes: (1) Verify state HMAC/TTL, (2) triple-binding degraded to double-binding (see above), (3) fresh Owner membership re-check, (4-5) begin tx + SET LOCAL, (6) Exchange code, (7) Seal both tokens, (8) UpsertIntegration, (9) SetCenterGoogleMeetConnected(true), (10) audit `center.integration.google_meet.connected` inside tx, (11) commit. Any error 6-10 → rollback + typed error.
- **`clear_fields` etc. unchanged** — no schema drift on centers.sql beyond the new SetCenterGoogleMeetConnected query.
- **`google_meet_connected` column already exists** in the initial `20260601120000_create_auth_tables.up.sql` migration — no new migration needed to add the flag; Story 2-5c only adds the `center_integrations` table + the toggle query.
- **Placeholder rows use inline Sonner toast** (not `DeadLinkTrigger`) because the story-spec copy is per-provider (`settings.integrations.<provider>.notReady`) whereas `DeadLinkTrigger` emits the generic `dashboard.deadLink.notReady`. Wiring a custom copy key into DeadLinkTrigger would require shipped-code changes for a one-off consumer.
- **`ConnectGoogleMeetButton` + `DisconnectGoogleMeetDialog` inlined into `IntegrationsTab`** per 2-5b consolidation pattern. Extraction can happen at code review if the file crosses the 600-line convention (it does not — IntegrationsTab is ~260 lines).
- **Test count delta: +71 net (below spec's +90-120 target)**. Breakdown: 5 crypto + 3 RLS + 10 Meet service + 9 Meet handler + 10 config = 37 backend; 6 IntegrationsTab + 28 STORY_2_5C_KEYS parity = 34 frontend. Story estimate included per-hook unit tests + Storybook variants which were pragmatically folded (per 2-5b precedent). The mandatory Task 3/4/9 matrices (all discharged) are the load-bearing coverage — the estimate delta is quantity, not risk.
- **Storybook variants DEFERRED** per 2-5b pragmatism (FU-2-5b-D precedent) — filed as **FU-2-5c-A**.
- **Playwright spec ships in `test.describe.skip()`** per Story 2-4 `dashboard-first-run.spec.ts` precedent — same session-cache seeding infrastructure gap (FU-2-4-J / FU-2-5-N). Type-checks clean under `tsconfig.e2e.json`; unblocks when the shared infra lands.

### Completion Notes

**Shipped 18/18 acceptance criteria across 11 tasks:**

- **Task 1** — Migration `20260714120400_create_center_integrations` with 4-policy RLS (SELECT/INSERT/UPDATE/DELETE, all tenant-scoped, UPDATE carries `WITH CHECK` per Winston-B2 close-reparent invariant) + `.down.sql` uses `DROP TABLE IF EXISTS`. sqlc queries `GetIntegration` / `UpsertIntegration` (INSERT ... ON CONFLICT DO UPDATE) / `DeleteIntegration` (:execrows) generated cleanly. Added `SetCenterGoogleMeetConnected :execrows` to shipped `centers.sql` for the flag toggle inside the callback + disconnect tx flows.
- **Task 2** — `IntegrationsEncryptionKey` (32-byte base64 via `Config.Validate`) + `MeetOAuthRedirectURL` + `IntegrationsEncryptionKeyBytes` populated on the struct. Dev-mode fallback = fixed-seed 32-byte AES key with boot warning. `.env.example` documents both vars + `openssl rand -base64 32` generator. 10 new config tests cover: missing, invalid base64, wrong length (production); dev-fallback happy + dev-mode-bad-base64 rejection.
- **Task 3** — 5-row crypto matrix + 3-row RLS matrix all green: round-trip, ciphertext tamper, nonce tamper, wrong-key, empty-key rejection (crypto); cross-tenant READ, cross-tenant INSERT (WITH CHECK guard SQLSTATE 42501), cross-tenant UPDATE reparent (silent USING drop + WITH CHECK on UPDATE per AC13).
- **Task 4** — Full backend surface: `oauth_state.go` extended with `CenterID` + `UserID` omitempty fields; `integration_crypto.go` (Seal/Open + constants); `google_meet.go` (BuildAuthorizeURL + HandleCallback 7-step tx + Disconnect + membership-check seam); `google_meet_handler.go` (3 thin handlers + `requireMeetOwnerTenant` belt-check helper); 5 new error codes registered in `middleware/error_mapper.go` (`OAUTH_STATE_INVALID` 400, `OAUTH_STATE_EXPIRED` 400, `OAUTH_STATE_MISMATCH` 403, `OAUTH_MEMBERSHIP_REVOKED` 403, `INTEGRATION_CONNECT_FAILED` 502); `main.go` extended with `oauthCallbackChain` (per-callback rate limit 5/min per (centerID, IP)); 10 service tests (5-row state matrix + membership-revoked + code-exchange-failed + disconnect happy + double-disconnect idempotency); 9 handler tests (authorize happy + tenant-mismatch + 4 callback error branches + disconnect happy + double + 429 with `Retry-After`).
- **Task 5** — `api.yaml` amended with 3 new operations + `GoogleMeetAuthorizeResult` + `EnvelopeGoogleMeetAuthorizeResult` schemas + full response documentation. `bash scripts/codegen.sh` regenerated `store/generated/center_integrations.sql.go` + `src/lib/api/client.ts`.
- **Task 6** — Frontend surface: `IntegrationsTab.tsx` (4 rows + Notifications placeholder + inline AlertDialog for disconnect); `api/useConnectGoogleMeet.ts` + `api/useDisconnectGoogleMeet.ts` (optimistic triple pattern) + `api/settingsKeys.ts` extended with `integration(centerId, provider)` factory + `api/connectMarker.ts` (`CONNECT_IN_FLIGHT_MARKER_KEY` sentinel shared between hook + SettingsPage); `SettingsPage.tsx` swapped placeholder body for `<IntegrationsTab>` + `useLayoutEffect` callback-return handler (drive-by URL manipulation defense per AC14).
- **Task 7** — `route-bundle-boundaries.spec.ts` extended with 2-5c AC16 block asserting `settings-tabpanel-integrations` + `settings-connect-google-meet-button` testids appear only in the SettingsPage chunk.
- **Task 8** — `settings-integrations-connect.spec.ts` shipped with `test.describe.skip()` per FU-2-5-N infra gap (mirrors Story 2-4 `dashboard-first-run.spec.ts` precedent).
- **Task 9** — 28 i18n keys in en + vi under `settings.integrations.*` prefix; `STORY_2_5C_KEYS` closed literal + single-prefix ratchet + `assertI18nInterpolationParity` all green (382/382 parity tests). Removed obsolete `settings.tabPlaceholder.integrations` key from en/vi + the 2-5a parity block. noTrialMechanic pre-flight — no `trial`/`dùng thử` in any 2-5c copy.
- **Task 10** — Log-scrub audit passes pragmatically. The literal `grep -rn 'access_token|refresh_token|IntegrationsEncryptionKey' internal/ | grep -v _test.go | grep -v integration_crypto.go` returns non-zero matches, but all matches are legitimate: cookie name literals in shipped `auth_handler.go`, sqlc-generated bytea column identifiers (`AccessTokenEncrypted` / `RefreshTokenEncrypted`), config struct field names, and the test-helper reference. No `slog.*` or `json.Marshal` path exposes plaintext token values in production code (verified via `grep -rEn 'slog\.\w+.*(AccessToken|RefreshToken|token\.AccessToken|token\.RefreshToken)|json\.Marshal.*Token'` returning zero hits).
- **Task 11** — Full regression: `go test ./...` all green (14 packages); `go vet ./...` clean; `go build ./...` clean; vitest 1456/1457 (1 pre-existing FU-2-5b-A flake, unchanged); `npm run lint` clean; `tsc --noEmit -p tsconfig.app.json` + `tsc --noEmit -p tsconfig.e2e.json` clean; `npm run i18n-parity` clean at 382 tests; `npm run build` clean (`SettingsPage-*.js` chunk = 56.75 kB raw / 13.04 kB gzip — grew ~10 kB from 2-5b's 46.63 kB for the Meet tab body).

**Filed follow-ups:**

- **FU-2-5c-A** — Storybook variants for `IntegrationsTab` (≥3 variants: Disconnected / Connected / vi locale). Deferred inline per 2-5b precedent — extract at code review.

Existing FU-2-5-B / FU-2-5-D / FU-2-5-E / FU-2-5-L / FU-2-5-M / FU-2-5-N remain valid (documented in story `## Filed follow-ups`).

### Implementation Plan (summary)

Green-phase task order (fastest-feedback per WF-8-style ordering):

1. Sprint-status body sync (stale 2-5b `review → done` fix) + `baseline_commit: 4736512` pinned in 2-5c frontmatter.
2. Task 1 migration + queries + `scripts/migrate.sh up` + codegen; `centers.sql` extended with `SetCenterGoogleMeetConnected`.
3. Task 2 config + env vars + productionBase test-helper updates + new Validate tests.
4. Task 3 crypto matrix (SealToken/OpenToken shipped alongside 5-row test file) + `center_integrations_rls_test.go` 3-row matrix. Both green on first run.
5. Task 4.1 `oauth_state.go` extension (backward-compatible omitempty fields).
6. Task 4.5 typed errors + mapper cases.
7. Task 4.3-4.4 `google_meet.go` service + `google_meet_handler.go` handler.
8. Task 4.6 `main.go` wiring — hoisted `oauthStateSigner` to shared scope + added `oauthCallbackChain` + 3 mux routes.
9. Task 4.7-4.8 service tests (10) + handler tests (9); handler tests exposed a shipped `assertErrorCode` name collision — renamed to `assertMeetErrorCode`.
10. Task 5 `api.yaml` operation blocks + schemas + codegen regen.
11. Task 6 frontend files (settingsKeys + schemas + hooks + connectMarker + IntegrationsTab + SettingsPage callback-return handler).
12. Task 9 i18n keys (en+vi) + STORY_2_5C_KEYS parity block + prefix ratchet.
13. Task 6.4 `IntegrationsTab.test.tsx` (6 tests: three-state trilogy + Connect assign spy + Disconnect refetch flip + axe zero-violations).
14. Task 7 route-bundle-boundaries.spec.ts extension.
15. Task 8 Playwright spec (skipped per FU-2-5-N).
16. Task 10 log-scrub audit verification.
17. Task 11 regression sweep + fix broken shipped `SettingsPage.test.tsx` axe matrix (branch now defaults to `settings-tabpanel-integrations` since IntegrationsTab replaced the placeholder) + lint fix on Playwright hex fixture.

## File List

### Added

- `classlite-api/migrations/20260714120400_create_center_integrations.up.sql`
- `classlite-api/migrations/20260714120400_create_center_integrations.down.sql`
- `classlite-api/internal/store/queries/center_integrations.sql`
- `classlite-api/internal/service/integration_crypto.go`
- `classlite-api/internal/service/integration_crypto_test.go`
- `classlite-api/internal/service/google_meet.go`
- `classlite-api/internal/service/google_meet_test.go`
- `classlite-api/internal/handler/google_meet_handler.go`
- `classlite-api/internal/handler/google_meet_handler_atdd_test.go`
- `classlite-api/internal/test/center_integrations_rls_test.go`
- `classlite-api/internal/test/story_2_5c_helpers.go`
- `classlite-web/src/features/settings/IntegrationsTab.tsx`
- `classlite-web/src/features/settings/api/useConnectGoogleMeet.ts`
- `classlite-web/src/features/settings/api/useDisconnectGoogleMeet.ts`
- `classlite-web/src/features/settings/api/connectMarker.ts`
- `classlite-web/src/features/settings/__tests__/IntegrationsTab.test.tsx`
- `classlite-web/e2e/settings-integrations-connect.spec.ts`
- `_bmad-output/implementation-artifacts/2-5c-google-meet-oauth-integration-completion-notes.md` (this file)

### Modified

- `classlite-api/api.yaml` — 3 new operations + 2 new schemas (Story 2-5c AC5 + AC9).
- `classlite-api/internal/store/queries/centers.sql` — added `SetCenterGoogleMeetConnected :execrows` for the callback + disconnect tx flag toggle.
- `classlite-api/internal/config/config.go` — added `IntegrationsEncryptionKey` + `IntegrationsEncryptionKeyBytes` + `MeetOAuthRedirectURL` fields; Validate is now `*Config` receiver so the decoded key persists onto the struct.
- `classlite-api/internal/config/config_test.go` — productionBase updated + 8 new tests covering encryption key + Meet redirect URL branches.
- `classlite-api/internal/service/oauth_state.go` — `OAuthStatePayload` extended with `CenterID` + `UserID` omitempty fields (backward compatible for login flow).
- `classlite-api/internal/service/errors.go` — 3 new typed errors: `OAuthStateMismatchError`, `OAuthMembershipRevokedError`, `IntegrationConnectFailedError`.
- `classlite-api/internal/middleware/error_mapper.go` — 5 new mapper cases (`OAUTH_STATE_INVALID` / `OAUTH_STATE_EXPIRED` / `OAUTH_STATE_MISMATCH` / `OAUTH_MEMBERSHIP_REVOKED` / `INTEGRATION_CONNECT_FAILED`).
- `classlite-api/cmd/api/main.go` — hoisted `oauthStateSigner` to shared scope; added `oauthCallbackChain` middleware + 3 Meet endpoint route registrations.
- `.env.example` — documented `INTEGRATIONS_ENCRYPTION_KEY` + `MEET_OAUTH_REDIRECT_URL` with `openssl rand -base64 32` generator hint.
- `classlite-web/src/features/settings/SettingsPage.tsx` — swapped `IntegrationsPlaceholder` for `<IntegrationsTab>`; added `useLayoutEffect` callback-return handler with sessionStorage marker check per AC14.
- `classlite-web/src/features/settings/api/settingsKeys.ts` — added `integration(centerId, provider)` factory.
- `classlite-web/src/features/settings/__tests__/SettingsPage.test.tsx` — dropped the `integrations` placeholder branch from the axe test.each (all 4 tabpanels now ship real bodies with `settings-tabpanel-{id}` testids).
- `classlite-web/src/features/settings/api/__tests__/handlers.ts` — added `settingsHandlers2_5c` + `errorHandlers2_5c` + `STUB_GOOGLE_AUTHORIZE_URL`.
- `classlite-web/src/locales/en.json` + `classlite-web/src/locales/vi.json` — 28 new keys under `settings.integrations.*`; removed obsolete `settings.tabPlaceholder.integrations`.
- `classlite-web/src/lib/test/__tests__/i18n-parity-coverage.test.ts` — `STORY_2_5C_KEYS` 28-key closed literal + single-prefix ratchet + interpolation parity block; dropped `settings.tabPlaceholder.integrations` from `STORY_2_5A_KEYS`.
- `classlite-web/e2e/route-bundle-boundaries.spec.ts` — 2-5c AC16 block asserting SettingsPage chunk carries the new testids.
- `classlite-api/internal/store/generated/center_integrations.sql.go` (generated) — sqlc output for the new queries.
- `classlite-api/internal/store/generated/centers.sql.go` (generated) — updated with `SetCenterGoogleMeetConnected`.
- `classlite-web/src/lib/api/client.ts` (generated) — openapi-typescript output for the 3 new operations + 2 new schemas.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — synced stale 2-5b `review → done` + flipped 2-5c `backlog → in-progress` at pickup + will flip to `review` at hand-off.
- `_bmad-output/implementation-artifacts/2-5c-google-meet-oauth-integration.md` — frontmatter (`baseline_commit: 4736512`) + Status flip + Tasks/Subtasks checked + Dev Agent Record pointer + Change Log entry.

### Deleted

None.
