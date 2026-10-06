# Story 9.4: User Profile Management

Status: done

<!-- Validation optional. Run validate-create-story before dev-story if desired. -->

---
baseline_commit: a7dfa1b
epic: 9
story: 9.4
fr: FR-68 (email-change portion deferred -> FU-9-4-EMAIL-CHANGE)
size: M
audience: full-stack
depends_on: [1.5, 1.2e, 1.7c]
wf8_hard_gate: partial   # no epic-owned risk >=6; but AC9 PUT-path guard is NET-NEW max-impact -> red-phase that one assertion (D13). Rest inline P1.
---

## Story

As a **user** (any role — Owner, Admin, Teacher, Student),
I want **to manage my own profile settings — name, avatar, password, language, and notification preferences**,
so that **I can keep my personal information current and control how ClassLite behaves and contacts me.**

---

## Context & Reuse Map (READ FIRST — this story is mostly wiring over shipped substrate)

9.4 is the "Account" slice of Epic 9 (the billing stories 9-1…9-3 are done). **Most of the substrate already exists.** Do NOT rebuild it. The genuinely net-new surface is small — but see the **Post-review decisions** below, several of which correct connective-tissue gaps the first draft glossed.

### Already shipped — REUSE, do not rebuild

| Capability | Where it lives | Note |
|---|---|---|
| `users.avatar_url`, `users.language_pref` columns | migration `migrations/20260601120000_create_auth_tables.up.sql`; model `internal/store/generated/models.go:601-613` | **Columns already exist.** `full_name` too. `language_pref` NOT NULL default `'vi'`, **no CHECK constraint** (validate in service — D9). `users` is **global / no-RLS**. |
| Avatar presign → R2 path | handler `internal/handler/upload_handler.go`; allowlist `internal/service/upload_allowlist.go` (`AllowedFeatures["avatars"]=true`); size caps `internal/service/size_caps.go`; key build `Presign` ~line 155 | `avatars` feature **already allowlisted**. Key = `{center_id}/{feature}/{uuid}{ext}` → `{center_id}/avatars/{uuid}.{ext}`. Presign expiry 5 min. Presign route on `knowledgeChain` (`cmd/api/main.go:889-903`, **requires center** — D11 edge). ⚠️ **Avatar flow currently skips `POST /api/uploads/confirm`, so the SEC-8 prefix guard AND the layer-4 `HeadObject` size/MIME re-check in `Confirm` do NOT run for avatars** — D6/D7 address this. MIME allowlist is **global-per-extension, not per-feature** (D8). |
| bcrypt hashing (cost 12) + password-verify idiom | `internal/service/hasher.go` (`BcryptHasher{Cost:12}`); compare idiom `internal/service/auth_login.go` (~224, `bcrypt.CompareHashAndPassword`) | Reuse `s.hasher.Hash(...)` for new password; reuse compare for current-password verify. **Hash OUTSIDE any DB tx** (~250 ms CPU each — D10). |
| `UpdateUserPassword` sqlc query | `internal/store/queries/users.sql` (`SET password_hash=$2, updated_at=now() WHERE id=$1`) | Reuse verbatim for change-password. |
| Password-RESET flow (the CONTRAST) | `internal/service/auth_reset.go` — `ResetPassword()` calls `q.DeleteAllRefreshTokensForUser(...)` (~line 187) | **Change-password MUST NOT call `DeleteAllRefreshTokensForUser`** (AC4/AC10). Reuse its validation constants: `MinPasswordLength`, `MaxPasswordBytes`, whitespace-only check. |
| Language store → cross-domain cookie → i18n bridge | `classlite-web/src/stores/languageStore.ts`; `src/hooks/useLanguageInit.ts`; `src/lib/language-cookie.ts` (`lang` cookie, `Domain=.classlite.app`); `src/components/shared/LanguageToggle.tsx`; `src/lib/i18n.ts` | **The cross-domain cookie + instant re-render ALREADY SHIP** (AC3). 9.4 adds ONLY user-record persistence on top; keep driving `setLanguage()`, do NOT reimplement the cookie. |
| Optimistic-triple + session-cache-write mutation | `classlite-web/src/features/settings/api/useUpdateCenterProfile.ts` | **Canonical template** for the profile mutation: FW-2 triple + imperative `queryClient.setQueryData(authKeys.session(), …)` → pill re-renders WITHOUT refetch. **Sends a FULL object** — mirror that (D5 full-snapshot semantics). |
| Password form + schema + inputs | `src/features/auth/ResetPasswordPage.tsx`; `src/features/auth/lib/resetPasswordSchema.ts` (`useMemo([t])`); `PasswordInput.tsx`; `PasswordStrengthBar` | Reuse RHF+zodResolver+shadcn `Form`. Add a `currentPassword` field (net-new). |
| Presign+transfer FE primitives | `src/features/knowledge-hub/api/uploadKnowledgeFile.ts` (`presignKnowledgeUpload` → `transferToStorage` XHR-PUT-with-progress+abort → `finalize…`) | Reuse `presign` + `transferToStorage` for avatar. `UploadFeature` enum already includes `"avatars"`. **Do NOT reuse `finalizeKnowledgeUpload`** (creates a `files` row). |
| Session cache + `useAuth` | `src/hooks/useAuth.ts`; key `['auth','session']`; `Session` type `src/features/auth/api/authKeys.ts:76-100`; `NewSessionHandler` (`cmd/api/main.go:605`) | `Session.user` = `UserSummary` `{id,email,fullName,emailVerified}` (generated `src/lib/api/client.ts:3516-3523`). **Extending `UserSummary` is an app-wide blast radius** (every session reader) — additive only; no consumer may assert exact-shape equality (D12). |
| Sidebar user pill | `src/components/domain/UserPill.tsx` (renders `avatarUrl` **raw as `<img src>`**, ~line 56); fed a PLACEHOLDER at `src/components/shared/AppLayout.tsx:139` (`TODO(1-8)`) | **9.4 closes `TODO(1-8)`.** Raw-render means `avatarUrl` must be a **stable, directly-loadable URL** — drives D6. |
| `/profile` nav target | `src/components/domain/MobileTabBar.tsx` ("Me" → `/profile`) | Nav target exists; **no page/route mounted**. No desktop `/profile` entry in `sidebarNavConfig.tsx` — add one. |
| Switch primitive, `Form` shadcn, i18n parity harness | `src/components/ui/switch.tsx`; `src/components/ui/form`; `src/lib/test/i18n-parity.ts` (`assertI18nParity`) | Every new key → BOTH `en.json`+`vi.json` (CI-enforced). |

### Net-new — THIS story builds

- **Backend:** `notification_settings jsonb` column (migration + sqlc regen); `UpdateUserProfile` store query (full-replace of 4 editable fields — D5); user **service** + **handler** + routes; `GET /api/users/me` (D1), `PUT /api/users/me`, `POST /api/users/me/change-password`; **per-feature MIME+size allowlist mechanism** for avatars (D8) + global `.webp` (D8) + avatar `HeadObject` re-check path (D7); extend the session wire shape with `avatarUrl`+`languagePref` (D12).
- **Frontend:** `/profile` route (all-roles, under `AppLayout`, NO `RouteRoleGate`); `ProfilePage`/`ProfileSettingsShell` (account / preferences / notifications sections — D5 save model); self-profile feature folder; `currentPassword` field; avatar upload UX (D6); wire real user into the pill (closes `TODO(1-8)`); role-appropriate content (band pill + enrolment footnote — D14).
- **Infra (D6-A):** make the R2 `avatars/` prefix publicly readable via a stable base URL (config) so a stored avatar URL renders in the raw `<img>` pill.

### Post-review decisions (party-mode 2026-10-06 — Winston / Murat / Sally / John; folded)

> These RESOLVE gaps the first draft left open. Each is a default — override at dev pickup if warranted.

- **D5 — `PUT /api/users/me` is FULL-SNAPSHOT replace of the 4 editable fields** (`fullName, avatarUrl, languagePref, notificationSettings`), not a partial PATCH. The client ALWAYS sends the current full profile (read from the `useProfile` cache); the avatar flow MERGES `avatarUrl` into the cached snapshot before sending. Server **requires all four fields present** and rejects a missing/empty `fullName` with 422 — this prevents the full-SET **clobber/self-blank** bug (an avatar-only PUT nulling name/language/notif). `notificationSettings` rides the contract but the UI does not mutate it in 9.4 (D2).
- **D6 — Avatar URL serving model = (A) public R2 base.** The `avatars/` prefix is served from a stable public base URL (new config, e.g. `R2_PUBLIC_AVATAR_BASE`); `PUT /api/users/me` stores/returns the **full stable URL**. This matches the raw-render pill and the existing Google-OAuth external-URL case; presigned-GET (option B) is rejected — it expires inside the long-lived session cache. **Prefix validation (AC9) runs on the KEY portion**, and must tolerate the bimodal column (Google external URLs have no center prefix — only validate R2-origin keys).
- **D7 — Avatar persistence re-validates server-side.** Because the flow skips `/uploads/confirm`, `PUT /api/users/me` (or a thin avatar-confirm step) performs a `HeadObject` on the R2 key to enforce real stored size (≤5 MB) and content-type BEFORE persisting the URL — the client-declared `SizeBytes` at presign is not trusted. If `HeadObject` wiring is deemed out of scope at dev, the no-authoritative-size-check risk must be accepted **in writing** in completion notes.
- **D8 — Per-feature MIME is NET-NEW mechanism, not a one-liner.** Add a `FeatureAllowedExtensions[feature][ext]→mime` structure (the current allowlist is global-per-ext); thread it into `Presign` so `avatars` ⊆ {png, jpeg, webp} and SVG is rejected for avatars WITHOUT loosening SVG for knowledge. Add `.webp→image/webp` globally (currently absent → presign rejects webp today). Add an `avatars` 5 MB branch to `MaxUploadBytes` (mirror `FeatureSpeaking`).
- **D9 — `languagePref` validated `∈ {vi, en}`** in the service → 422 on anything else (column has no CHECK).
- **D10 — bcrypt runs OUTSIDE any DB tx.** ChangePassword = one read + one idempotent self-scoped write; needs **no tx** (no RLS, no multi-row). Do NOT wrap it in a tx to satisfy PERF-1 — that would pin a pooled connection across ~500 ms of CPU hashing on a rate-limited endpoint.
- **D11 — Avatar upload requires center; degrade, don't error.** A no-center / membership-limbo user reaches `/profile` but presign (center-required) 403s. The avatar control disables gracefully with a note; the rest of the page works. AC9's prefix check is degenerate when `CenterID` is empty → reject avatar-set for a caller with no center.
- **D12 — Session `UserSummary` gains `avatarUrl`+`languagePref` (additive, app-wide).** Flag to all session readers; no exact-shape assertions.
- **D13 — Red-phase ONLY the AC9 PUT-path guard.** The presign-path half of AC9 is inherited/shipped → inline green. The client-supplied-key guard on `PUT /api/users/me` is NET-NEW code at MAX impact (cross-tenant object reference) → write it `//go:build atdd_red_phase` red-first. AC10 (auth) stays inline P1 (its failure mode is fail-safe over-revoke, not a breach).
- **D14 — Role-appropriate content (Sally).** The shell is shared; the identity/context strip is role-specific: **student** gets the target-band pill + the enrolment footnote ("enrolment is managed by your center — contact your Admin"); staff/owner get a role/center line. The account/preferences/password sections are common to all roles.
- **D15 — Notification toggles ship DISABLED-with-note (Sally/John).** Render the section with controls disabled + a bilingual "arrives with your inbox (coming soon); your choices save for then" note. The column persists sensible defaults now; **Epic 10 wires the live consumer and treats the persisted values as authoritative.** No dark-pattern inert-but-enabled switch.
- **D16 — Email is the login identity → display-only needs an escape hatch to SUPPORT (John; Ducdo 2026-10-06 "go with email").** Login resolves by email (`GetUserByEmail`, `auth_login.go`) and email is GLOBAL (a center admin cannot change another user's login email), so the escape hatch routes to a **support email** (`support@classlite.app`, i18n/config-driven — the Resend sending domain), NOT "contact your center admin" and NOT "coming soon." FR-68's email-change portion is a tracked deferral → `FU-9-4-EMAIL-CHANGE`.
- **D17 — Document the D4 server-email locale bug as KNOWN (John).** Server-originated emails (9-3 dunning, invites, password-changed) ignore `language_pref` until a server path reads the column — an EN user can get VN security mail TODAY. Not fixed here (JWT-locale deferred, D4); documented loudly + `FU-9-4-EMAIL-LOCALE` scopes the cheap fix (email render reads `users.language_pref`).

### Do NOT

- Do NOT conflate with `src/features/settings/ProfileTab.tsx` — that is the **CENTER** profile (Owner-only, `PATCH /api/centers/{id}`, s49). Different entity.
- Do NOT add the JWT `Locale` claim (D4 — deferred → `FU-9-4-JWT-LOCALE`; avoid the auth mint hot path).
- Do NOT invalidate other refresh tokens on change-password (AC4).
- Do NOT allow SVG avatars (D8); do NOT trust client-declared upload size (D7).
- Do NOT send a partial `PUT /api/users/me` that omits editable fields (D5 — it blanks them).

---

## Acceptance Criteria (BDD)

### AC1 — Profile page renders all fields, three sections (FR-68, s38)
**Given** any authenticated (verified — D11) user navigating to `/profile` (s38)
**When** the page renders
**Then** it shows three sections: **Account** (full name [editable], avatar [upload/change], email [read-only — AC7]), **Preferences** (language VI/EN toggle), **Notifications** (toggles — disabled per D15); plus **Change password** (AC4)
**And** it implements the UX-1 trilogy for the initial `GET /me` load: skeleton mirroring the form shape; human error message + one retry on failure.

### AC2 — All-roles, rendered in the caller's role shell
**Given** a user of ANY role
**When** they open `/profile`
**Then** the page renders inside **their current role's** shell (resolved by `useRole()` via `AppLayout`), with NO role gate (all roles reach it).
**Note:** the page sits behind the verified-email gate (`onboardingChain` shape carries `requireVerified`) — unverified users do not reach it. Confirmed intended.

### AC3 — Language: immediate re-render + user-record persistence + shared cookie
**Given** a user toggling language (VI↔EN)
**When** the toggle changes
**Then** the UI re-renders immediately via the existing `setLanguage()` → cookie → `i18n.changeLanguage` bridge (do not reimplement)
**And** the preference is persisted to `users.language_pref` via `PUT /api/users/me` (validated `∈ {vi,en}` — D9)
**And** a round-trip proves durability: `GET /api/users/me` and the session payload reflect the new value so next login honors it.

### AC4 — Change password (does NOT invalidate other sessions)
**Given** `POST /api/users/me/change-password` `{ currentPassword, newPassword }`
**When** processed
**Then** the current password is verified (`bcrypt.CompareHashAndPassword`; hashing OUTSIDE any tx — D10)
**And** on mismatch → a typed `InvalidCurrentPasswordError` → the structured `{error:{code,…}}` shape (401/403), no change applied
**And** on success the new password is validated (shared reset constants) then hashed (cost 12) and stored via `UpdateUserPassword`
**And** **all OTHER refresh tokens are left intact** — `DeleteAllRefreshTokensForUser` is NOT called; the user stays logged in on other sessions
**And** an **OAuth-only user** (`password_hash` NULL — guard on `pgtype.Text.Valid` BEFORE compare) gets a typed `PasswordNotSetError` (409/422), never a 500.

### AC5 — Avatar upload (presigned R2, server-revalidated, pill updates)
**Given** a user selecting an avatar image
**When** they upload
**Then** the flow is: client **pre-checks** size (≤5 MB) + type (png/jpeg/webp) and rejects instantly in-language → `POST /api/uploads/presign` `feature:"avatars"` → direct PUT to R2 (progress shown, cancelable) → persist via `PUT /api/users/me` (full snapshot + merged `avatarUrl` — D5)
**And** the server enforces the cap/type authoritatively (D7 `HeadObject` / presign allowlist D8); SVG is rejected (D8); the R2 key follows `{center_id}/avatars/{uuid}.{ext}`
**And** on a persist-step failure the optimistic update rolls back (pill reverts, old avatar intact — persistence is a separate step from transfer)
**And** on success the **sidebar pill updates to the new avatar with no refetch flicker** (session-cache write)
**And** the fallback (no avatar) renders gradient initials derived from the name, updating live as the name field edits.

### AC6 — `GET` + `PUT /api/users/me` contract (D1, D5)
**Given** the self-profile API
**When** `GET /api/users/me` is called
**Then** it returns the caller's `{ id, email, fullName, avatarUrl, languagePref, notificationSettings, emailVerified }` in the `{data}` envelope (GO-5: `avatarUrl` null serializes as `null`, key present)
**And** `PUT /api/users/me` accepts **all four** editable fields `{ fullName, avatarUrl, languagePref, notificationSettings }` as a full-snapshot replace (D5), requiring non-empty `fullName`, `languagePref ∈ {vi,en}` (D9), a well-formed `notificationSettings` → else `422 VALIDATION_ERROR` with field errors
**And** both resolve the target from `TenantContext.UserID` only — **no user-id path/body param**; a user can only read/update their OWN record
**And** `PUT` does NOT accept an `email` field (AC7).

### AC7 — Email is display-only + escape hatch (D16)
**Given** the email field
**When** rendered
**Then** it is read-only with copy "this is your login email — to change it, contact support at `support@classlite.app`" (a SUPPORT email, NOT "contact your center admin" — email is the GLOBAL login identity and a center admin cannot change another user's login email; NOT "coming soon"). The address is i18n/config-driven (default `support@classlite.app`, the Resend sending domain) — dev confirms the inbox exists or makes it a config value.
**And** `PUT /api/users/me` with an `email` field does NOT mutate email (ignored or 422 — negative test required)
**And** an **OAuth-only** account surfaces a single explanatory state ("You sign in with Google") covering BOTH the locked email and the disabled password control — not two unexplained dead controls.

### AC8 — Session carries self avatar/language; cache write drives the shell (D12)
**Given** a successful name / avatar / language update
**When** the mutation settles
**Then** `['auth','session']` is updated imperatively (name, avatarUrl, languagePref) → pill + topbar re-render without a refetch
**And** the session wire shape / `UserSummary` is extended (additive) to include `avatarUrl` + `languagePref` for the self user.

### AC9 — (R9; PUT-path RED-PHASE per D13) Cross-tenant avatar key rejected
**Given** a user whose JWT resolves to center A
**When** an avatar key under another center's prefix (`{centerB}/avatars/…`) is submitted
**Then** the presign/confirm path rejects it (SEC-8 `R2_KEY_PREFIX_MISMATCH` 403 — inherited, inline)
**And** `PUT /api/users/me` re-validates the KEY-portion prefix against the caller's `center_id` and does **NOT** persist a cross-tenant or (when `CenterID` empty) any R2 key (D11) — **this PUT-path assertion is written red-first** (`//go:build atdd_red_phase`), store/handler level, returns 403/422 and persists nothing
**And** Google external avatar URLs (no center prefix) are tolerated (D6 bimodal column — validate only R2-origin keys).

### AC10 — (auth, inline P1) Change-password negatives + session survival (store-state, no live /refresh)
**Given** change-password
**When** tested
**Then** (a) wrong current password → reject + typed code, no mutation; (b) **session survival proven at store state** — a service test asserts `DeleteAllRefreshTokensForUser` is NOT called (mock-store seam), AND a store/handler test seeds two `refresh_tokens` rows (two `family_id`s), runs change-password, and asserts **both rows still present with `revoked_at IS NULL`** (NEVER exercise `POST /api/auth/refresh` — that green-washes + flakes); (c) a user cannot change another user's password (self-scoped, no param); (d) OAuth-null-hash → typed non-500.

### AC11 — i18n parity, a11y, role coverage
**Given** the new UI
**When** tests run
**Then** every new key exists in BOTH `en.json`+`vi.json` (`assertI18nParity` green); the profile page passes `axe` with zero violations in BOTH the loading-skeleton and loaded states; and it renders for all four roles — asserting all roles see the same **self** account fields (no role-gated leakage) while the **shell differs**, and the student-only band pill/footnote (D14) is **absent** for owner/admin/teacher.

### AC12 — Notification settings persist as typed jsonb, UI disabled (D2, D15)
**Given** the notifications section
**When** rendered
**Then** its controls are **disabled** with a bilingual "arrives with your inbox (coming soon); your choices save for then" note (no inert-but-enabled switch — D15)
**And** the column stores a **typed jsonb with `schemaVersion:1`** (GO-7 — no `map[string]interface{}`), a small fixed boolean set (canonical set named in Dev Notes), defaulted at migration
**And** a read of an older/unknown `schemaVersion` upcasts-with-defaults, never 500
**And** the story records that the live consumer (inbox event routing) lands in **Epic 10**, which treats these persisted values as authoritative.

### AC13 — Save model + dirty state (D5, Sally)
**Given** the profile form
**When** the user edits
**Then** the save model is explicit: **Account** section (name + avatar) has its own Save; **language** applies instantly (no save button — AC3); **password** is its own submit (AC4); **notifications** are disabled (AC12)
**And** switching language (instant) does NOT discard an unsaved name edit (independent surfaces)
**And** a failed Account save shows an inline, human, per-section error with the entered value preserved (not silently reverted).

### AC14 — Role-appropriate profile content (D14)
**Given** a **student** on `/profile`
**Then** the identity strip shows the target-band pill + the enrolment footnote ("enrolment is managed by your center — contact your Admin")
**And** for **owner/admin/teacher** those student-only elements are **absent** (asserted — AC11), replaced by a role/center line.

---

## Tasks / Subtasks

> Strict order per WF-1/WF-3: migration → `migrate.sh` → `.sql` queries → `api.yaml` → `codegen.sh` → backend → frontend. `codegen.sh` is the LAST codegen step.

- [x] **Task 0 — Red-phase AC9 PUT guard (D13)** — authored `//go:build atdd_red_phase` service test (`user_profile_avatar_key_atdd_test.go`), verified it compile-fails on the `service.NewUserService` seam, then stripped the tag at green. Cross-tenant key → `KeyPrefixMismatchError` (403), avatar_url stays NULL.

- [x] **Task 1 — Migration: `notification_settings` on `users`** (AC12)
  - [x] New pair `{ts}_add_users_notification_settings.up/.down.sql`: `ADD COLUMN notification_settings jsonb NOT NULL DEFAULT '{"schemaVersion":1,"emailOnSubmission":true,"emailOnQuestion":true,"emailOnAnnouncement":true}'::jsonb` (canonical set — Dev Notes). Down drops. No RLS change. `migrate.sh`; verify up→down→up + default backfills existing rows.

- [x] **Task 2 — Store queries** (AC4, AC6)
  - [x] `users.sql`: ensure `GetUserByID`/a profile read selects the new column; add `UpdateUserProfile` = full-replace `SET full_name=$2, avatar_url=$3, language_pref=$4, notification_settings=$5, updated_at=now() WHERE id=$1 RETURNING …` (D5 — client always sends full snapshot; server requires all four). Reuse `UpdateUserPassword`.

- [x] **Task 3 — api.yaml contract** (AC6, AC7, AC8) — atomic cross-service (WF-4)
  - [x] Add `GET`/`PUT /api/users/me`, `POST /api/users/me/change-password`. Schemas: `UserProfile`, `UpdateUserProfileRequest` (4 fields, NO email), `ChangePasswordRequest`, typed `NotificationSettings` (`schemaVersion`+booleans). **Extend the session user shape with `avatarUrl`+`languagePref` (D12 — additive, app-wide; flag all readers).** Mirror `avatarUrl`/`languagePref` descriptions from `StaffMemberDetail`/`StudentProfile`.
  - [x] `scripts/codegen.sh` (Go + `client.ts` + zod). Atomic commit spans api.yaml + both generated trees + impl.

- [x] **Task 4 — Backend: upload allowlist + size (D7, D8)**
  - [x] Add `.webp→image/webp` globally. Build `FeatureAllowedExtensions[feature][ext]` + thread into `Presign` so `avatars`⊆{png,jpeg,webp}, SVG rejected for avatars only. Add `avatars` 5 MB branch to `MaxUploadBytes`. Add the `HeadObject` re-check on avatar persist (or accept-in-writing — D7).

- [x] **Task 5 — Backend: user service + handler + routes** (AC4, AC6, AC7, AC9, AC10, D10, D11)
  - [x] `internal/service/user_service.go`: `GetProfile`, `UpdateProfile` (self-scoped; require 4 fields; `languagePref∈{vi,en}` D9; reject cross-tenant/empty-center avatar key D6/D11), `ChangePassword` (null-hash guard BEFORE compare; hash OUTSIDE tx D10; do NOT touch refresh tokens). Custom errors (GO-2): `InvalidCurrentPasswordError`→401/403, `PasswordNotSetError`→409/422, `ValidationError`→422.
  - [x] `internal/handler/user_handler.go` (GFW-1/GFW-5): `GetMe`, `UpdateMe`, `ChangePassword`; caller via `model.TenantFromContext`.
  - [x] Register on a NEW chain copying the `onboardingChain` SHAPE (`extractTenant → requireVerified → ErrorMapper`, no `requireCenter`) + a `UserAndIPKeyFn` rate limit; change-password gets its own tighter bucket with a named numeric limit (SEC-10 — not IP-only; shared-NAT brute-force).

- [x] **Task 6 — Backend: session payload + avatar public base** (AC8, D6)
  - [x] `NewSessionHandler` returns self `avatarUrl`+`languagePref`. Add `R2_PUBLIC_AVATAR_BASE` config; avatar persist stores/returns the full stable public URL (D6-A).

- [x] **Task 7 — Frontend: self-profile feature folder** (AC3, AC4, AC5, AC6, AC8, D5)
  - [x] `src/features/profile/`: `api/profileKeys.ts` (TS-3), `api/useProfile.ts` (explicit `staleTime`), `api/useUpdateProfile.ts` (optimistic triple + `setQueryData(authKeys.session())`; **sends full snapshot from cache** D5 — copy `useUpdateCenterProfile.ts`), `api/useChangePassword.ts`, `api/uploadAvatar.ts` (reuse `presignKnowledgeUpload`+`transferToStorage` `feature:"avatars"`, client pre-check size/MIME, progress/cancel, then merge `avatarUrl` into the cached snapshot and call update). Zod schema in `lib/` (mirror `resetPasswordSchema` + `currentPassword`).

- [x] **Task 8 — Frontend: ProfilePage + route + pill + role content** (AC1, AC2, AC5, AC7, AC12, AC13, AC14)
  - [x] `ProfilePage`/`ProfileSettingsShell`: Account (name+avatar+email-readonly+OAuth explanatory state AC7), Preferences (reused `LanguageToggle`), Notifications (disabled Switches + note D15), ChangePasswordForm (`PasswordInput`/`PasswordStrengthBar`). Per-section save model (D5/AC13). UX-1 trilogy + form states. Student identity strip = band pill + enrolment footnote; staff/owner = role/center line (D14/AC14). Avatar-disabled-when-no-center note (D11).
  - [x] Mount `/profile` in `src/routes.tsx` under `AppLayout`, NO `RouteRoleGate`, lazy. Add `/profile` to `sidebarNavConfig.tsx` (all roles). Close `TODO(1-8)` in `AppLayout.tsx:139` — feed `UserPill` the real `useAuth()` user.

- [x] **Task 9 — i18n + tests** (AC9, AC10, AC11, AC12, AC13)
  - [x] `profile.*` keys BOTH locales; parity.
  - [x] FE (MSW — **mock BOTH presign AND the R2 PUT host**, else flake): three-state `useProfile`; language toggle re-render + persistence; avatar success/client-reject/abort/transfer-fail-rollback/pill-no-refetch; change-password validation; role render all four + band-pill-absent-for-staff (AC14); axe loading+loaded; store `reset()` + `lang` cookie + BroadcastChannel reset in `beforeEach` (keep `--no-experimental-webstorage` + Storage polyfill).
  - [x] BE: service (AssertNotCalled `DeleteAllRefreshTokensForUser`; wrong-current typed; null-hash typed; `languagePref` 422); store/handler real-DB-in-tx (**avatar-only-intent preserves name/lang/notif** — the clobber test, D5; two refresh rows survive AC10b; cross-tenant key reject AC9; GO-5 null-value-scan; email-field-ignored AC7; notif jsonb v1 round-trip + unknown-schemaVersion default AC12); handler envelope + 422 shape; 429 on change-password (SEC-10); migration backfill.

---

### Review Findings (code review 2026-10-06 — 3 adversarial Opus-4.8 layers: Blind / Edge / Auditor)

_24 raw findings → 12 after dedup/dismiss. 2 dismissed as noise, 2 deferred (see deferred-work.md). 2 decision-needed RESOLVED by Ducdo + 8 patches ALL APPLIED (10 total). Green: gofmt/build/vet · service+handler go test -p1 · codegen (client.ts regen, sqlc no drift) · tsc -b 0 · FE full suite 3727/3727. baseline a7dfa1b._

**Decision-needed (RESOLVED 2026-10-06 by Ducdo → both became patches):**

- [x] [Review][Patch] (ex-Decision, HIGH) avatarUrl full-URL / external-URL branches bypass the AC9/D11 cross-tenant guard AND all avatar type/size/content caps — `user_service.go:305-310`. Lines 305 (our-base prefix) and 309 (any http/https) store the value verbatim; the center-prefix guard (line 319), png/jpeg/webp check, 5 MB cap, and D7 HeadObject re-check all live below on the bare-KEY branch only. A PUT with `avatarUrl:"https://anything..."` or `{ourBase}/{otherCenter}/avatars/x.png` is persisted raw → session.user.avatarUrl (D12) → rendered raw as `<img src>` app-wide. **RESOLUTION: tolerate an external/our-base-prefixed URL ONLY when it exactly equals the caller's currently-stored avatar_url (genuine full-snapshot no-op re-send); reject any NEW external URL (→ KeyPrefixMismatch/validation). Requires reading the current value in resolveAvatarURL.**
- [x] [Review][Patch] (ex-Decision, MEDIUM) partial PUT silently clears avatar — handler guards notificationSettings presence but not avatarUrl — `user_handler.go:121-126`. Omitted/null `avatarUrl` → `resolveAvatarURL(nil)` clears the column. **RESOLUTION: require the `avatarUrl` key be present in the PUT body (mirror the notif nil→422 guard), while still allowing an explicit `null` to intentionally clear the avatar.**

**Patch:**

- [x] [Review][Patch] D7 HeadObject re-check fails OPEN on empty Content-Type + reject path has zero tests [MEDIUM] [classlite-api/internal/service/user_service.go:339] — fail closed on empty/unverifiable content-type + add FileTooLarge/ContentTypeMismatch/empty-CT/HeadObject-error tests.
- [x] [Review][Patch] language toggle: store flips but PUT failure is swallowed (no revert, no error UI, UX-1) [MEDIUM] [classlite-web/src/features/profile/components/PreferencesSection.tsx:28-37] — add onError → revert setLanguage + retryable error.
- [x] [Review][Patch] test gaps: AC11 axe missing for loading-skeleton state + AC8 pill-no-refetch untested [MEDIUM] [classlite-web/src/features/profile/__tests__/ProfilePage.test.tsx] — add skeleton-state axe test + session-cache-write/pill-no-refetch assertion.
- [x] [Review][Patch] 401/403 doc + codegen drift for INVALID_CURRENT_PASSWORD [LOW] [classlite-api/internal/service/user_errors.go + classlite-web/src/features/profile/api/useChangePassword.ts + classlite-web/src/lib/api/client.ts:4102] — correct 2 comments + re-run codegen (401 drops the code, 403 carries it).
- [x] [Review][Patch] empty R2_PUBLIC_AVATAR_BASE persists broken root-relative URL "/{center}/avatars/.." [LOW] [classlite-api/internal/service/user_service.go:343] — fail closed / clear instead of persisting "/"+key.
- [x] [Review][Patch] optimistic cache write stores raw R2 KEY into avatarUrl (momentary cache poison) [LOW] [classlite-web/src/features/profile/api/useUpdateProfile.ts] — keep previous.avatarUrl (or preview), not the key.
- [x] [Review][Patch] AvatarField leaks object URLs + no abort-on-unmount + no abort test [LOW] [classlite-web/src/features/profile/components/AvatarField.tsx] — revoke on replace/unmount + cleanup abort + abort/cancel test.
- [x] [Review][Patch] GET and PUT /api/users/me share one 60/min rate-limit bucket [LOW] [classlite-api/cmd/api/main.go:335-357] — give GET its own limiter.

**Deferred:**

- [x] [Review][Defer] json.Decoder lacks DisallowUnknownFields — client field typos silently dropped/written [classlite-api/internal/handler/user_handler.go:115] — deferred, project-wide decoding convention not story-specific (AC7 intentionally tolerates `email`).
- [x] [Review][Defer] ChangePassword allows new==current (no-op success); length checked after bcrypt compare [classlite-api/internal/service/user_service.go:238] — deferred, minor hardening, not a bug.

**Dismissed (noise):** cross-surface avatar clobber (false positive — pending avatar in AccountSection local state survives a language toggle; independent surfaces are the AC13 design); languagePref enum violation from session (column is NOT NULL DEFAULT 'vi' + service validates {vi,en}).

---

## Dev Notes

### WF-8 / testing posture (updated per party-mode)
- **Hybrid gate (D13):** AC9's presign half is inherited (inline); AC9's **PUT-path client-key guard is net-new at max impact → red-phase first** (Task 0). AC10 (auth) stays inline P1 — its failure mode is fail-safe (over-revoke = UX regression, not breach).
- Every-epic bar still applies: P0 100% / P1 ≥95% / axe-zero / `assertI18nParity` green. Post-dev `/bmad-tea TA` expands P2/P3 + fault injection.
- **Murat's clobber test is load-bearing** (D5): the full-SET `UpdateUserProfile` + avatar-only call = silent data loss of name/language/notif. The store test proving avatar-intent preserves the other fields is NOT optional.
- **AC10(b) must be store-state, never live `/refresh`** — see AC10. Green-washes + flakes otherwise.

### Key implementation guards
- **Change-password ≠ reset.** Copy `auth_reset.go`'s validation + hashing, NOT its `DeleteAllRefreshTokensForUser` call (~line 187). Hash OUTSIDE any tx (D10); ChangePassword needs no tx.
- **Avatar URL is a full stable public URL (D6-A), stored verbatim.** The pill renders it raw as `<img src>`. Validate only the KEY-portion prefix for R2-origin uploads; tolerate Google external URLs (bimodal column). Reject cross-tenant / empty-center keys (D11).
- **Avatar is server-revalidated (D7)** — don't trust client `SizeBytes`; `HeadObject` enforces real ≤5 MB + content-type, or accept-in-writing.
- **Per-feature MIME is net-new (D8).** The global allowlist can't express "SVG for knowledge but not avatars" — build `FeatureAllowedExtensions`. `.webp` is unallowlisted today; add it.
- **Self-scoping (AC6/AC10c):** no id param; `users` is no-RLS so self-scoping is a service/handler responsibility — assert it. The real hazard is self-blanking via partial PUT (D5), not cross-user.
- **Session cache write drives the pill (FW-2/FW-6).** Mutation callback only, never a Zustand action. Copy `useUpdateCenterProfile.ts` (snapshot/rollback/settled + `setQueryData` + empty-cache `refetchQueries` fallback).
- **Language: persist AND bridge (AC3).** Keep `setLanguage()` for instant cross-domain re-render; additionally `PUT languagePref`. Independent.
- **notification_settings canonical set (v1):** `{ schemaVersion:1, emailOnSubmission, emailOnQuestion, emailOnAnnouncement }` — all bool, default true. Typed Go struct (GO-7) + generated TS must agree with the migration literal + the disabled Switch list. Unknown/older `schemaVersion` → upcast-with-defaults, never 500. Epic 10 finalizes the exact event→toggle mapping and is authoritative over these persisted values.
- **GO-5:** no `omitempty`; `avatarUrl` null → `null`.
- **Route-chain edges (D11):** profile is verified-gated (document in AC2); avatar presign is center-required → degrade; change-password rate limit is `UserAndIP`-keyed + tight numeric (SEC-10), not IP-only.
- **Session `UserSummary` extension is app-wide (D12)** — additive; no exact-shape assertions anywhere.

### Dependencies delivered upstream (do not rebuild)
- **1.5:** bcrypt cost-12 + `Hasher` + compare + `UpdateUserPassword` + refresh-token family/rotation (the thing AC4 leaves alone).
- **1.2e:** avatar presign/R2 path + `avatars` allowlist + SEC-8 prefix guard (confirm-path, skipped by the avatar flow → D7).
- **1.7c / i18n:** language store + cross-domain cookie + parity harness.

### References
- [Source: epics/epic-09.md#Story-9.4] (ACs 216–259); [Source: prds/…/prd.md#FR-68]
- [Source: ux-design-specification.md:500] (s38 "Profile" — band pill + enrolment footnote + notif toggles); component-inventory.md:178 (`ProfileSettingsShell`)
- [Source: docs/project-context.md] GO-1..7, GFW-1/5, SEC-7/8/10, PERF-1, FW-2/4/6/7, UX-1..4, TS-3/4/8, CQ-3, TEST-FE-*/TEST-BE-*
- [Source: docs/bmad-story-conventions.md] split + 600-line cap
- Backend: `classlite-api/internal/{service/hasher.go,service/auth_reset.go,service/auth_login.go,service/auth_google.go,handler/upload_handler.go,service/upload_allowlist.go,service/size_caps.go,service/file_service.go,store/queries/users.sql}`; `cmd/api/main.go`
- Frontend: `classlite-web/src/{stores/languageStore.ts,hooks/useLanguageInit.ts,lib/language-cookie.ts,components/shared/LanguageToggle.tsx,features/settings/api/useUpdateCenterProfile.ts,features/auth/{ResetPasswordPage.tsx,lib/resetPasswordSchema.ts,components/PasswordInput.tsx},features/knowledge-hub/api/uploadKnowledgeFile.ts,components/domain/UserPill.tsx,components/shared/AppLayout.tsx,hooks/useAuth.ts,routes.tsx}`

### Project Structure Notes
- New: `internal/service/user_service.go`, `internal/handler/user_handler.go`; `src/features/profile/`. No conflict with owner-only `src/features/settings/` (center profile).
- Variance: epic API AC lists only PUT + change-password; D1 adds `GET /api/users/me` (self fields not all in the session). D6 adds an infra config (`R2_PUBLIC_AVATAR_BASE`) not in the original epic.

---

## Definition of Done

- All 14 ACs met and demonstrated.
- Task 0 red-phase AC9-PUT authored, verified red, then green.
- `migrate.sh` up→down→up clean + default backfill; `codegen.sh` run, generated trees committed, no hand-edits (XL-1).
- Backend: `go build ./...`+`vet`+`gofmt` clean; `go test -p 1 ./...` green incl. clobber-preservation, session-survival (store-state), cross-tenant-key reject, notif round-trip.
- Frontend: `tsc -b`=0; profile + AppLayout + session suites green; `axe` zero (loading+loaded); `assertI18nParity` green; MSW mocks presign AND R2 host; store/cookie/BroadcastChannel reset in `beforeEach`.
- Atomic cross-service commit (WF-4).
- Change-password verified to NOT revoke other sessions (store-state) + OAuth-null-hash typed non-500.
- Avatar: client pre-check + server re-check (D7); SVG rejected; cross-tenant key rejected; pill updates without refetch; renders from the public base URL.
- Notification section disabled-with-note (D15); email read-only + escape hatch + OAuth explanatory state (AC7/D16).
- Sidebar pill shows real user (TODO(1-8) closed).
- Known-bug note for server-email locale (D17) recorded in completion notes.
- Sibling `9-4-user-profile-management-completion-notes.md` created at dev pickup. Story file ≤ 600 lines.

---

## Out of Scope / Follow-ups

- **Email change / verification flow** — display-only in MVP (AC7/D16). FR-68 email portion deferred → **`FU-9-4-EMAIL-CHANGE`** (amend FR-68 tracking; email is the login identity, so this is a real deferral not a silent descope).
- **JWT `Locale` claim (PERF-4)** — D4 → **`FU-9-4-JWT-LOCALE`**.
- **Server-email locale bug (D17)** — server-originated emails (9-3 dunning, invites, password-changed) ignore `language_pref` until fixed → **`FU-9-4-EMAIL-LOCALE`** (scope: email render paths read `users.language_pref`). **Known bug, documented — not a clean deferral.**
- **"Log out everywhere" / active sessions** (John) — the JTBD twin of AC4; `DeleteAllRefreshTokensForUser` already exists → **`FU-9-4-LOGOUT-ALL`**.
- **Password-changed confirmation email** (John) — security hygiene for a credential mutation (Resend + templates already ship) → **`FU-9-4-PW-CHANGED-EMAIL`**.
- **Live notification dispatch / inbox routing** — Epic 10 (consumer of AC12's persisted values; `event/bus.go` unwired).
- **Avatar content-sniff spoofing** (png header, SVG/HTML bytes) — if `HeadObject` type-check (D7) is not byte-sniffing, note residual risk → **`FU-9-4-AVATAR-SNIFF`** (only material if avatars ever serve inline from our origin).
- **Avatar cropping/resizing; account deletion** — not in FR-68.

---

## Change Log

| Date | Change | By |
|---|---|---|
| 2026-10-06 | Story created (/bmad-create-story 9-4). 3-agent recon. 4 initial rulings: D1 GET /api/users/me · D2 persist typed notification_settings · D3 avatar 5MB png/jpeg/webp no-SVG · D4 defer JWT locale. baseline a7dfa1b. | Amelia |
| 2026-10-06 | **Party-mode pre-dev review folded (Winston/Murat/Sally/John).** +13 decisions D5–D17 + ACs 1→14 + Task 0 red-phase. HEADLINE fixes: D5 full-snapshot PUT kills Murat's full-SET **clobber/self-blank** data-loss bug · D6 avatar URL serving model ruled = public R2 base (Winston: presigned-GET expires in session cache; no public base existed) + D7 server re-validate (confirm-path guards bypassed) · D8 per-feature MIME is net-new mechanism + `.webp` absent today · D13 red-phase AC9 PUT-path (net-new max-impact) · D15 notification toggles DISABLED-with-note (Sally/John: inert-enabled switch = dark pattern) · D16 email=login-identity → escape hatch (John: silent FR-68 descope) · D17 server-email locale KNOWN BUG (collides with 9-3 dunning) · D10 bcrypt-outside-tx · D11 empty-CenterID avatar edge + verified-gate · D14 role-specific band pill/footnote (were dropped from ACs) · AC10b rewritten to store-state (no live /refresh green-wash). 5 new FUs (EMAIL-CHANGE/EMAIL-LOCALE/LOGOUT-ALL/PW-CHANGED-EMAIL/AVATAR-SNIFF). Stays ready-for-dev. | Amelia |
| 2026-10-06 | **Implemented all 14 ACs → review** (/bmad-dev-story 9-4). All 10 tasks done. Backend: migration (backfill 450 rows) + GetUserProfile/UpdateUserProfile + UserService/handler/routes + typed errors (INVALID_CURRENT_PASSWORD→**403** not 401 to dodge the TS-5 silent-refresh hijack) + D8 per-feature MIME + session userSummary (D12 made avatarUrl/languagePref **optional** — truly additive, unblocked 63 fixtures). **D7 HeadObject re-check IS enforced** (not accepted-in-writing). FE: self-profile feature folder + ProfilePage (UX-1 trilogy) + role strip (D14) + all 4 sections + /profile route/nav + closed TODO(1-8) pill. VERIFY GREEN: go build/vet/gofmt clean · go test -p 1 ./... 16 pkgs · migrate up→down→up + backfill · codegen clean · tsc -b 0 · profile 21/21 · 758-test FE regression sweep. D17 server-email locale KNOWN BUG recorded (FU-9-4-EMAIL-LOCALE). Completion notes + File List in sibling file. See 9-4-user-profile-management-completion-notes.md. | Amelia |
