# Story 9-4: Completion Notes

_Implementation record for [`9-4-user-profile-management.md`](./9-4-user-profile-management.md). Status: review._

## Dev Agent Record

### Debug Log
- **sqlc row-type blast radius.** Adding `notification_settings` to the `users` table made the existing full-row queries (`GetUserByID`/`GetUserByEmail`/`GetUserByGoogleID`/`CreateUser`) no longer select every column, so sqlc emitted bespoke `*Row` types instead of `generated.User` — breaking ~9 call sites. Fixed by appending `notification_settings` to those four queries' column lists so they return `generated.User` again (the correct behavior — full-row reads should include the new column). `GetUserProfile`/`UpdateUserProfile` stay bespoke rows (different column order) by design.
- **D12 UserSummary — required → optional.** Making `avatarUrl`+`languagePref` REQUIRED on the session `UserSummary` broke ~63 pre-existing test fixtures that build a `Session.user` literal. Per D12 ("additive only; no exact-shape assertions"), changed them to OPTIONAL in the api.yaml contract — the Go side still always emits them (GO-5, no omitempty), so live session data always carries them, but TS fixtures that omit them keep compiling. `tsc -b` then went 63→0.
- **Wrong-current-password 401 → 403.** A 401 for `INVALID_CURRENT_PASSWORD` was being hijacked by the frontend's silent-token-refresh path (TS-5 treats every 401 as session expiry), which would bounce the user to `/login` instead of showing the inline error. AC4 explicitly allows 401/403, so mapped it to **403** (a business rejection, not an expired session). FE maps `403 INVALID_CURRENT_PASSWORD` inline on the currentPassword field.
- **FE test seams.** (1) `userEvent.upload` honors the input `accept` filter and silently drops a non-matching file — the SVG-reject test uses `fireEvent.change` to exercise the component's own pre-check. (2) The dual-cache seam: `useRole` reads the global queryClient singleton while `useAuth`/mutations read the Provider client, so tests seed the session into BOTH. (3) MSW mocks BOTH presign AND the R2 PUT host for the avatar transfer (else the XHR flakes). (4) jsdom has no `URL.createObjectURL` — stubbed per-test.

### Completion Notes
Shipped the full Account slice of Epic 9 — all 14 ACs met, mostly wiring over shipped substrate per the reuse map.

- **Backend:** migration `20261006130000_add_users_notification_settings` (typed jsonb, schemaVersion-stamped, all-true default, backfills 450 rows); `GetUserProfile`/`UpdateUserProfile` store queries (full-snapshot replace, D5); `UserService` (`GetProfile`/`UpdateProfile`/`ChangePassword`) with the bimodal avatar resolver (D6 public-URL / Google-URL verbatim / fresh-key validate+rewrite), the AC9/D11 cross-tenant+empty-center key guard, D9 languagePref gate, D10 bcrypt-outside-tx + no-session-nuke; typed `InvalidCurrentPasswordError` (403) + `PasswordNotSetError` (409); `UserHandler` (GET/PUT/change-password) on a verified-gated, center-optional chain with a tighter change-password rate bucket (SEC-10); per-feature MIME allowlist (`FeatureAllowedExtensions`, D8) + global `.webp` + avatars 5 MB cap; session `userSummary` extended with avatarUrl+languagePref (D12); `R2_PUBLIC_AVATAR_BASE` config (D6-A).
- **D7 — avatar HeadObject re-check IS enforced** (not accepted-in-writing): `UserService.resolveAvatarURL` runs `storage.HeadObject` on a fresh key before persisting, rejecting over-5MB / wrong-content-type (fail-closed on an unverifiable object). Storage is always wired (R2 in prod, mock in dev), so the check always runs.
- **Frontend:** `src/features/profile/` — `useProfile` (three-state), `useUpdateProfile` (optimistic triple + session-cache write, AC8), `useChangePassword`, `uploadAvatar` (pre-check → presign `feature:avatars` → XHR transfer with progress/cancel); `changePasswordSchema`; `ProfilePage` (UX-1 trilogy) + role-specific identity strip (D14) + Account / Preferences (instant+persist language, AC3) / Notifications (disabled-with-note, D15) / Change-password sections; `/profile` route (all-roles, no RouteRoleGate, lazy); `/profile` in all four role nav sets; **closed `TODO(1-8)`** — AppLayout now feeds the pill the real `useAuth()` user + avatar.
- **i18n:** 49 `profile.*` + `sidebar.*.profile` keys in BOTH locales (parity test green).

**Known bug carried forward (D17 — documented, not fixed):** server-originated emails (9-3 dunning, invites, future password-changed) ignore `users.language_pref` until an email render path reads the column — an EN user can receive VN security mail today. JWT-locale is deferred (D4). Scoped as `FU-9-4-EMAIL-LOCALE`.

**Deferrals (unchanged from spec):** `FU-9-4-EMAIL-CHANGE` (email is display-only), `FU-9-4-JWT-LOCALE`, `FU-9-4-LOGOUT-ALL`, `FU-9-4-PW-CHANGED-EMAIL`, `FU-9-4-AVATAR-SNIFF` (HeadObject checks Content-Type, not magic bytes), live notification dispatch → Epic 10. The student target-band pill is the structural affordance + enrolment guidance (D14); the live band VALUE is not part of the 9.4 self-profile contract (band lives on the Epic-8 performance surface).

### Implementation Plan (summary)
Executed in WF-1/WF-3 order: Task 0 red (AC9 PUT guard) → migration + migrate.sh → store queries → api.yaml → codegen.sh → upload allowlist/size → user errors/service/handler/routes + error-mapper → session userSummary + config → FE feature folder → FE page/route/nav/pill → i18n + tests. Verified: `go build`/`vet`/`gofmt` clean, `go test -p 1 ./...` 16 pkgs pass, migrate up→down→up + backfill clean, codegen clean, `tsc -b` 0 errors, profile suite 21/21, 758-test regression sweep green.

## File List

### Added
- `classlite-api/migrations/20261006130000_add_users_notification_settings.up.sql` / `.down.sql` — notification_settings column.
- `classlite-api/internal/service/user_service.go` — UserService (profile read/update/change-password + avatar resolver + notif codec).
- `classlite-api/internal/service/user_errors.go` — InvalidCurrentPasswordError, PasswordNotSetError.
- `classlite-api/internal/handler/user_handler.go` — GET/PUT /api/users/me + change-password.
- `classlite-api/internal/service/user_service_test.go` — change-password unit tests (no-delete seam, wrong-current, null-hash, validation).
- `classlite-api/internal/service/user_service_integration_test.go` — clobber (D5), empty-center (D11), languagePref (D9), notif round-trip + upcast (AC12), AC10b store-state.
- `classlite-api/internal/service/user_profile_avatar_key_atdd_test.go` — AC9 cross-tenant key reject (authored red, now green).
- `classlite-api/internal/service/avatar_allowlist_test.go` — D8 per-feature MIME + 5 MB cap.
- `classlite-api/internal/handler/user_handler_test.go` — envelope/422 shape, AC7 email-ignored, SEC-10 429.
- `classlite-api/internal/test/story_9_4_helpers.go` — user-route test server.
- `classlite-web/src/features/profile/` — `api/{profileKeys,useProfile,useUpdateProfile,useChangePassword,uploadAvatar}.ts`, `lib/changePasswordSchema.ts`, `ProfilePage.tsx`, `components/{ProfileIdentityStrip,AccountSection,AvatarField,PreferencesSection,NotificationsSection,ChangePasswordSection}.tsx`, `__tests__/{ProfilePage,AvatarField}.test.tsx`.

### Modified
- `classlite-api/api.yaml` — GET/PUT /api/users/me + change-password paths; UserProfile / UpdateUserProfileRequest / ChangePasswordRequest / NotificationSettings / EnvelopeUserProfile schemas; UserSummary +avatarUrl +languagePref (optional, D12).
- `classlite-api/internal/store/queries/users.sql` — +notification_settings on 4 full-row queries; +GetUserProfile +UpdateUserProfile.
- `classlite-api/internal/service/upload_allowlist.go` — FeatureAvatars, +.webp, FeatureAllowedExtensions + FeatureAllowsExtension (D8).
- `classlite-api/internal/service/size_caps.go` — avatarImageMaxBytes 5 MB + avatars branch.
- `classlite-api/internal/handler/upload_handler.go` — per-feature extension check in Presign.
- `classlite-api/internal/handler/auth_handler.go` — userSummary +avatarUrl +languagePref + userSummaryFromUser; threaded at login/refresh/accept-invite.
- `classlite-api/internal/middleware/error_mapper.go` — INVALID_CURRENT_PASSWORD (403) + PASSWORD_NOT_SET (409) cases.
- `classlite-api/internal/config/config.go` — R2PublicAvatarBase.
- `classlite-api/cmd/api/main.go` — UserService/UserHandler wiring + user routes + rate buckets.
- `classlite-api/internal/store/generated/*` — regen (sqlc).
- `classlite-web/src/lib/api/client.ts` — regen (openapi-typescript).
- `classlite-web/src/components/shared/AppLayout.tsx` — closed TODO(1-8): real user pill.
- `classlite-web/src/components/domain/sidebarNavConfig.tsx` — /profile for all four roles.
- `classlite-web/src/routes.tsx` — /profile route (all-roles, no gate, lazy).
- `classlite-web/src/locales/en.json` + `vi.json` — 49 profile/sidebar keys.
- `.env.example` — R2_PUBLIC_AVATAR_BASE.

### Deleted
- None.
