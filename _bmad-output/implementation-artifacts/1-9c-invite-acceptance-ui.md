---
baseline_commit: 3824af5
---

# Story 1.9c: Invite Acceptance UI

Status: done

> **Why this story matters.** Stories 1-1..1-9b shipped the dashboard's pre-auth surface for *self-initiated* accounts (registration / verification / login / password reset). Story 1-6 landed the backend invite-acceptance endpoint (`POST /api/auth/accept-invite`) + the Google-OAuth invite-threading endpoint (`GET /api/auth/google?inviteToken=...`) months ago — the full email-mismatch, expired, already-accepted, malformed-token, and password-not-allowed-for-oauth-user error matrix is pinned by Story 1-6's ATDD suite. 1-9c is the **dashboard surface** that lets an invited user click an emailed link, land at `/invite/{token}`, and join the center in one step. UX-DR10 frames this as the highest-value conversion node in the product — each accepted invite is a switching-cost multiplier — so the screen must foreground the *center's* identity (not ClassLite's) and offer Google as the dominant action.
>
> **One risk score ≥6 check: NONE owned.** R6 (Google OAuth callback skips tenant binding) is owned and pinned by Story 1-6's ATDD suite. R38 (i18n parity) inherits from 1-7c's CI gate via a new `STORY_1_9C_KEYS` block. R-NEW=12 (redirect-race) doesn't recur — the invite success path uses the same `setQueryData(authKeys.session(), ...)` + `navigate('/dashboard', {replace: true})` shape as 1-8's `useLogin` (no countdown, no aria-live hold). WF-8 ATDD red phase is **NOT required**.

> **Scaffold reality check (READ FIRST — three reframes against Epic 1C's wireframe-driven AC).**
>
> The Epic 1C AC for Story 1.9c (`_bmad-output/planning-artifacts/epics/epic-01c-frontend-landing.md:319-358`) was written before Story 1-6 shipped, against a wireframe that assumed a backend endpoint that doesn't exist. Three reframes pinned inline so the dev agent doesn't chase the spec into a wall:
>
> 1. **No `GET /api/auth/invites/{token}/preview` endpoint exists.** Epic AC line 332-338 describes the InviteCard as showing "Center logo or auto-generated lettermark / inviter name + center name heading / role badge" *before* the user clicks anything. That implies a preview endpoint. Backend has only `POST /api/auth/accept-invite` (returns 200 with `{accessToken, user, center: {id, name}, role}` on success; returns `centerName` / `inviterEmail` in error envelope **details** on 410 / 409). **The `/invite/{token}` page therefore CANNOT round-trip for center identity pre-acceptance — but it CAN render a `?c=centerName` query-string ribbon embedded by the center owner in the email template itself** (Sally party-mode 2026-06-26 catch — the asymmetry between humanized error states and an anonymous happy path was an unacceptable conversion bleed for the trust-critical moment). The center owner controls the email; they embed `?c=IELTS%20Academy`. The page sanitizes (regex `[\p{L}\p{N}\s\-'.]{1,60}`, Unicode NFC normalize, reject anything else → fallback to generic) and renders `t('auth.invite.titleWithCenter', { centerName })` in the H1 (e.g. "Tham gia IELTS Academy" / "Join IELTS Academy"). **NO backend probe, NO anti-enumeration surface, NO form-field pre-fill** — pure cosmetic ribbon. Center logo / lettermark / inviter name / role badge / dynamic preview still deferred to Epic 7. **Default — Pragmatic deviation flagged for John PM Epic AC amendment** per `[[feedback_pragmatic_interpretation_of_spec_absolutes]]`: the Epic AC's full InviteCard composition is a PRD/Epic defect (preview-endpoint-dependent). The amended Epic line reads "Static InviteCard component (avatar, inviter name, role badge) deferred to Epic 7; center name shown via sanitized `?c=` query param as the conversion-critical bridge."
> 2. **No new-user vs existing-user pre-detection.** Epic AC line 339-345 describes three branches the page renders distinctly: new-user (Google + collapsed form locked to invite email), existing-user-logged-in (single confirm button), existing-user-not-logged-in (login form). The backend infers branch from `getUserByEmail(invite.email)` server-side; the frontend learns the branch only AFTER submission. **Default — single unified form**: render fullName + password fields (the new-user shape) + Google OAuth primary. On submit: backend chooses branch silently. Existing user with a password? Backend ignores password, accepts membership. Existing OAuth-only user with a password supplied? Backend returns 409 `PASSWORD_NOT_ALLOWED_FOR_OAUTH_USER` and we render the inline "Continue with Google" CTA per AC6. Already-logged-in user clicks an invite link? They still see the form, hit Google or fill the email form — the backend silently joins them on submit. The 1-click "Join [center] as [role]?" UX from Epic AC is deferred (Story 2-1 may revisit once dashboard-side session is hydrated).
> 3. **Invite email is NOT echoed back pre-acceptance** (anti-enumeration, mirrors Story 1-9a's verify flow + Story 1-9b's reset flow). Epic AC line 337 says "email field locked to the invite address" — but the backend will not echo `invite.email` until acceptance succeeds. The email field is therefore **omitted from the form entirely**: backend authoritatively uses `invite.email` from the token row. Form is `{inviteToken, fullName, password}` — the user types name + password. No locked email field exists.
>
> Beyond the three reframes, the scaffold reality is encouraging:
>
> - `classlite-web/src/features/auth/components/GoogleOAuthButton.tsx:29-46` ALREADY accepts an optional `searchParams?: Record<string, string>` prop with the JSDoc "Story 1.9c will pass `{ inviteToken: '...' }`". 1-9c consumes this verbatim — no new prop wiring needed.
> - `classlite-web/src/features/auth/AuthLayout.tsx:5-7` JSDoc explicitly lists "invite acceptance" as a pre-auth page that mounts under AuthLayout. New route lands as a child entry in `routes.tsx`.
> - `classlite-web/src/features/auth/components/AuthCard.tsx` — shipped from 1-8, used by Login/Register/VerifyEmail/ForgotPassword/ResetPassword. 1-9c composes the same `regionLabel` / `heading` / `body` / `footer` slots.
> - `classlite-web/src/features/auth/components/PasswordInput.tsx` — shipped from 1-8. 1-9c consumes verbatim.
> - `classlite-web/src/features/auth/components/CollapsibleEmailForm.tsx` — shipped from 1-8. 1-9c composes for the "Accept with email and password" reveal beneath the Google button (UX-DR7 Google-first pattern).
> - `classlite-web/src/features/auth/api/authKeys.ts:50-76` — 1-9c extends with one new `acceptInviteMutation()` entry (mirrors `registerMutation` / `loginMutation` shape).
> - `classlite-web/src/test/mocks/handlers.ts` does NOT carry a default handler for `POST /api/auth/accept-invite`. 1-9c adds it + extracts `MSW_ACCEPT_INVITE_DEFAULT` constant with `satisfies AcceptInviteResult` typecheck (mirrors 1-9b's `MSW_FORGOT_PASSWORD_DEFAULT` + `MSW_RESET_PASSWORD_DEFAULT` pattern).
> - `classlite-web/src/lib/api/client.ts` is **stale** — it does NOT include the Story 1-6 endpoints (`/api/auth/accept-invite`, `/api/auth/google`, `/api/auth/google/callback`) even though `classlite-api/api.yaml` defines them. Per project-context WF-3 + WF-7, **Task 0 (pre-flight) re-runs `scripts/codegen.sh`** to land the missing types (`AcceptInviteRequest`, `AcceptInviteResult`, `InviteCenter`, `InviteExpiredDetails`, `InviteAlreadyAcceptedDetails`, `InviteEmailMismatchDetails`). No `api.yaml` modification — 1-6 already shipped the schema; the output drifted. The regenerated `client.ts` rides in the same commit as Task 2.
> - `classlite-web/src/features/auth/LoginPage.tsx:73-78` — `deriveBannerKey()` priority chain is `reset > verified > oauth-error`. Story 1-6's OAuth callback redirects on invite failure to `APP_LOGIN_ERROR_URL_BASE?error=invite_email_mismatch | invite_expired | invite_already_accepted | invite_unknown_error`. The existing `oauth-error` branch already catches these — the generic `auth.login.error.oauthGeneric` copy is the fallback. **1-9c deliberately does NOT branch the OAuth-error variant into invite-specific dedicated screens** — Story 1-9d AC2 (OAuth Email Mismatch Screen, UX-DR20) owns the polished dual-recovery-path version. 1-9c leaves the generic alert in place + flags the invite-code fan-out as 1-9d work.
> - `classlite-web/src/routes.tsx:67-70` — the index `loader: () => redirect('/login')` does NOT preserve query params. Story 1-6's OAuth success path redirects to `APP_POST_LOGIN_URL=http://localhost:5173/?invited=true`, which the index loader currently flattens to `/login` (losing `?invited=true`). 1-9c amends the index loader to forward `location.search` to the redirect destination so the `?invited=true` query param survives → LoginPage's bannerKey deriver gets a new branch.
> - Backend post-OAuth-success contract per `classlite-api/internal/handler/auth_handler.go:611-617` + `internal/config/config.go:68`: success → `APP_POST_LOGIN_URL?invited=true` (the `center` name is intentionally NOT echoed — privacy / SEC-11 line 590-597). 1-9c's `?invited=true` LoginPage banner therefore carries **center-name-free** copy ("You've joined your center.") — the user lands on dashboard moments later via Layer A redirect + silent-refresh hydration, where Story 2-1's dashboard-side toast surfaces the center name from the hydrated session.
> - `_bmad-output/test-artifacts/msw-handler-catalog-auth.md` line 5 lists `1-9c-invite-acceptance-ui` in `target_stories` but no `POST /api/auth/accept-invite` section exists in the catalog. 1-9c adds the section + bumps `last_updated` + appends a Change Log row (mirrors the 1-9b catalog touch).

> **Out of scope (explicit deferrals — each owned by a specific later story).**
>
> - **Polished `?error=invite_email_mismatch` dedicated screen with dual recovery (try-different-Google + email-fallback)** — **Story 1.9d AC2** (UX-DR20 OAuth Email Mismatch Screen). 1-9c surfaces the invite_email_mismatch on the inline `/invite/{token}` error region for the REST path and the generic `auth.login.error.oauthGeneric` copy on the OAuth path. 1-9d will replace the OAuth-path generic with the dedicated screen.
> - **Expired invite "Contact [inviter]" mailto CTA with rendered inviter avatar** — Epic AC line 349 implies a polished screen. 1-9c renders the inline expired state with `inviterEmail` exposed in a `mailto:` link + the heading "Invitation to {{centerName}} expired" + body copy. **Story 1.9d** can revisit if the polished error-state component library lands there.
> - **Already-accepted auto-redirect to dashboard** — Epic AC line 353 says "the user is redirected to the dashboard with a notification confirming they have already joined the center." That implies *the page itself redirects* on first paint (before submit). Since the backend does NOT expose a preview endpoint, we cannot detect the already-accepted state at mount time. **Default — surface the already-accepted state after submit** (the inline error region offers a `<Link to="/login">` CTA "Sign in to {{centerName}}"). True page-mount auto-redirect requires the preview endpoint — deferred to a backend follow-up, likely **Epic 7** (real staff-invite delivery).
> - **Center logo / lettermark on the InviteCard** — Epic AC line 333 mandates a 56×56 lettermark above the heading. Without a preview endpoint we don't have a center logo URL pre-acceptance. The lettermark surfaces post-acceptance on the dashboard (Story 2-1). **Default — generic ClassLite wordmark only** (inherited from AuthLayout) for 1-9c. Center NAME (text only, not logo) is rendered via the sanitized `?c=` ribbon when the email-template embeds it — see AC4 + the Sally party-mode bridge above.
> - **Role badge ("Giáo viên" / "Teacher") in amber above the form** — Epic AC line 335 + the AUTH-05 wireframe at `ux-design-directions.html:1705`. Without preview, no role known pre-acceptance. **No, we are NOT extending the `?c=` ribbon to also carry role** — that crosses the line from "cosmetic bridge" to "trust-establishing claim," and a malicious or copy-pasted link could spoof a higher-privilege role and bait a recipient into expecting owner access. The badge surfaces post-acceptance on the dashboard. **Default — omit the role badge from the pre-acceptance form.**
> - **One-click "Join [center] as [role]?" flow for existing-user-logged-in branch** — Epic AC line 339-341. Requires (a) preview endpoint AND (b) hydrated session at mount time. Deferred to **Epic 7** alongside real staff-invite delivery.
> - **`/invite` index page (no token)** — out of scope; the path-param route `/invite/:token` requires the token. A no-token visit falls through to the `path: '*'` catch-all NotFound from 1-7c (intentional — the invite link should always carry the token).
> - **BroadcastChannel `invite-accepted` cross-tab signal** — sibling tabs on `/login` (or the now-stale `/invite/{token}` page they came from) don't get a real-time "you're now in [center]" notification. Sibling tabs will pick up the new session on next silent-refresh + `useAuth` cache hydration — acceptable UX. 1-9d may revisit if the session-expired screen scope changes.
> - **`scripts/i18n-parity.mjs` namespace-coverage extension** for `auth.invite.*` — same gap 1-9a/1-9b punted. Per-key parity via `STORY_1_9C_KEYS` is clean; namespace-level orphan-key gate stays owned by **Story 1-9d** per Murat 2026-06-26.
>
> **Filed follow-ups (party-mode 2026-06-26 — tracked OUTSIDE 1-9c):**
>
> - **Codegen-drift CI gate** (Winston catch — `client.ts` diverged from `api.yaml` for 3 stories before 1-9c needed an invite type). Owner: DevOps via Winston. Priority: P2. Target: 2 sprints (before Epic 1C closes). Shape: CI step that runs `scripts/codegen.sh` then `git diff --exit-code` on the generated paths; fails red on drift. 1-9c's Task 0 closes THIS incident; the CI gate closes the CLASS.
> - **`traceability-matrix-epic-1c.md`** (Murat catch — `traceability-matrix-epic-1b.md` exists; nothing for Epic 1C frontend stories 1-7a/b/c, 1-8, 1-9a/b/c/d). Owner: Murat. Target: pre-1-9d-merge. Cross-epic matrix bleed obscures audit — land a fresh Epic-1C-scoped matrix instead of extending the 1B one.
> - **`nfr-assessment-epic-1c.md`** (Murat catch — same rationale). Owner: Murat. Target: pre-1-9d-merge.
> - **Story 2-1 move of `?invited=true` banner ownership to dashboard** (Winston catch — the LoginPage banner is a transitional flash-of-200ms before Layer A redirects; semantically the dashboard owns the toast). Owner: 2-1. Target: when 2-1 ships. Shape: change backend `APP_POST_LOGIN_URL=http://localhost:5173/dashboard?invited=true` + drop LoginPage's `invited` BannerKey branch + drop the index-loader query-forward amendment + dashboard renders the toast directly with the hydrated session's centerName.
> - **`<Banner variant>` discriminated-union refactor** (Winston catch — gate for 1-9d). Owner: 1-9d. Target: pre-1-9d-merge IF 1-9d adds a 5th BannerKey variant. Four branches is a smell; five is a defect. Cannot ship 1-9d with the 5-variant chain in place.

## Story

As a teacher (or admin/student) who received an emailed invite link from a center owner,
I want to click the link, land on a trust-loaded "you've been invited" page, choose Google OAuth or set a password, and join my center in one step,
so that I feel expected (not like a stranger signing up cold) and I'm in the center dashboard within 30 seconds — and on the rare edge cases (expired link / already accepted / wrong Google email / malformed token) I see a clear, recovery-focused error state, not a generic 500.

## Acceptance Criteria (BDD)

> **Risk-score ≥6 check (per WF-8).** This story owns NO risk score ≥6. R6 (Google OAuth callback skips tenant binding) is owned and pinned by Story 1-6's ATDD suite. R38 (i18n parity) inherits from 1-7c's CI gate; discharge is the `STORY_1_9C_KEYS` block in `src/lib/test/__tests__/i18n-parity-coverage.test.ts`. WF-8 ATDD red phase NOT required.

### AC1: `/invite/:token` path-param route added to AuthLayout children (lazy-loaded) + bundle-boundary verified

**Given** the file `classlite-web/src/routes.tsx`,
**When** inspecting the AuthLayout children array after this story lands,
**Then** the array contains ONE new entry appended after the `'reset-password'` entry:
- `{ path: 'invite/:token', lazy: async () => { const { default: InviteAcceptancePage } = await import('@/features/auth/InviteAcceptancePage'); return { Component: InviteAcceptancePage } } }`

**And** the Playwright spec at `e2e/route-bundle-boundaries.spec.ts` is extended with a new `test('Story 1-9c — auth chunk includes InviteAcceptancePage; dashboard chunks do NOT', ...)` using the same shape as 1-9b — vacuous-pass guard on `inviteChunks.length > 0`, then iterated negative assertions across `studentContents` and `teacherContents`.

**And** the new page is the lazy default export from a NEW file `classlite-web/src/features/auth/InviteAcceptancePage.tsx`.

**And** the index route loader at `routes.tsx:67-70` is amended to forward `location.search` to the redirect target:

```ts
{
  index: true,
  loader: ({ request }) => {
    const url = new URL(request.url)
    return redirect('/login' + url.search)
  },
},
```

So Story 1-6's OAuth-success redirect to `APP_POST_LOGIN_URL?invited=true` survives the bounce to `/login?invited=true`.

### AC2: Codegen re-run lands Story 1-6 invite types (one-time scaffold catch-up)

**Given** `classlite-api/api.yaml` defines `AcceptInviteRequest`, `AcceptInviteResult`, `InviteCenter`, `InviteExpiredDetails`, `InviteAlreadyAcceptedDetails`, `InviteEmailMismatchDetails` (lines 833-930) but `classlite-web/src/lib/api/client.ts` does NOT include them or any `/api/auth/accept-invite` / `/api/auth/google` path,
**When** the dev agent runs `scripts/codegen.sh` (per project-context WF-3 + WF-7 boundary),
**Then** `classlite-web/src/lib/api/client.ts` regenerates with the missing types and paths — verified via `grep -c '/api/auth/accept-invite' classlite-web/src/lib/api/client.ts` returning `1` (not 0) post-regeneration.

**And** the regenerated `client.ts` rides in the SAME commit as Task 2's `useAcceptInvite` hook (so the type imports compile against the same artifact diff).

**And** `npx tsc -b` stays green across the api.yaml-derived type surface — if codegen introduces breaking renames on existing consumed types (it should not — 1-6's schemas are additive), the dev agent stops and escalates rather than patching call sites silently.

### AC3: i18n keys — every new string in both en + vi, parity asserted (R38 inheritance)

**Given** the files `classlite-web/src/locales/en.json` and `classlite-web/src/locales/vi.json`,
**When** running `npm test -- i18n-parity-coverage`,
**Then** both files contain every key in the union below, and a new `STORY_1_9C_KEYS` const + `describe('Story 1-9c i18n parity (R38)', ...)` block lands in `src/lib/test/__tests__/i18n-parity-coverage.test.ts`.

| Key | en seed | vi seed | Notes |
|---|---|---|---|
| `auth.invite.title` | "You've been invited" | "Bạn được mời tham gia" | AUTH-05 — **★ REVIEWER-MANDATORY (vi)** — active voice "được mời tham gia" (are invited to join) replaces the passive "đã được mời" (have been invited); warmer, present-tense, mirrors the wireframe's "Linh đã mời bạn tham gia" rhythm (Sally party-mode 2026-06-26). |
| `auth.invite.titleWithCenter` | "Join {{centerName}}" | "Tham gia {{centerName}}" | **NEW — Sally party-mode 2026-06-26 `?c=centerName` ribbon**. Rendered as the H1 (replacing `auth.invite.title`) when the URL carries a sanitized `?c=` query param (e.g. `/invite/abc123?c=IELTS%20Academy` — emailed by the center owner). Center name comes from the SENDER-controlled email template, NOT the backend — no preview-endpoint round-trip, no anti-enumeration probe. Falls back to `auth.invite.title` if `?c=` is absent or sanitization rejects. See AC4 sanitization regex below. |
| `auth.invite.body` | "Continue with Google or set a password to accept your invitation." | "Tiếp tục với Google hoặc đặt mật khẩu để chấp nhận lời mời." | AUTH-05 |
| `auth.invite.googleCta` | "Continue with Google" | "Tiếp tục với Google" | Matches `auth.login.googleCta` seed — duplicated key for screen-scoped lookup (TS-3 / CQ-4) |
| `auth.invite.emailCollapse` | "Accept with email and password" | "Chấp nhận bằng email và mật khẩu" | UX-DR7 collapse |
| `auth.invite.emailFormExpandedAnnouncement` | "Email form expanded" | "Đã mở form email" | **NEW — Sally party-mode 2026-06-26 a11y pin**. `aria-live="polite"` region announces the state change on CollapsibleEmailForm expand so screen reader users hear what tab+space-toggle just did. Mirrors UX-DR15 + TEST-UX-2 ("aria-live regions announce async content changes"). |
| `auth.invite.fullNameLabel` | "Your full name" | "Họ và tên" | |
| `auth.invite.passwordLabel` | "Create a password" | "Tạo mật khẩu" | |
| `auth.invite.submit` | "Join your center" | "Tham gia trung tâm" | AUTH-05 |
| `auth.invite.backToLogin` | "Already have an account? Sign in" | "Đã có tài khoản? Đăng nhập" | Footer link |
| `auth.invite.error.notFound.heading` | "Invitation no longer valid" | "Lời mời không còn hợp lệ" | UX-DR16 part 1 — 404 INVITE_NOT_FOUND. |
| `auth.invite.error.notFound.body` | "This invite link is broken or has been revoked. Ask the person who invited you to send a new one." | "Link lời mời đã hỏng hoặc đã bị thu hồi. Hãy yêu cầu người mời gửi lại link mới." | UX-DR16 part 2 + 3. |
| `auth.invite.error.expired.heading` | "Invitation expired" | "Lời mời đã hết hạn" | 410 INVITE_EXPIRED. |
| `auth.invite.error.expired.body` | "Your invitation to {{centerName}} has expired. Ask {{inviterEmail}} to send a new one." | "Lời mời tham gia {{centerName}} đã hết hạn. Hãy yêu cầu {{inviterEmail}} gửi lại lời mời mới." | **★ REVIEWER-MANDATORY (vi)** — uses `centerName` + `inviterEmail` from the 410 error envelope `details` payload. |
| `auth.invite.error.expired.contactCta` | "Email {{inviterEmail}}" | "Gửi email cho {{inviterEmail}}" | Renders as `<a href="mailto:{{inviterEmail}}">`. |
| `auth.invite.error.alreadyAccepted.heading` | "You've already joined {{centerName}}" | "Bạn đã tham gia {{centerName}}" | 409 INVITE_ALREADY_ACCEPTED. |
| `auth.invite.error.alreadyAccepted.body` | "Sign in to continue to your center." | "Đăng nhập để tiếp tục đến trung tâm của bạn." | |
| `auth.invite.error.alreadyAccepted.cta` | "Sign in" | "Đăng nhập" | Routes to `/login`. |
| `auth.invite.error.emailMismatch.heading` | "Wrong account" | "Sai tài khoản" | 409 INVITE_EMAIL_MISMATCH (REST path — rare; OAuth path lands on `/login?error=invite_email_mismatch` and the polished UX is owned by 1-9d). |
| `auth.invite.error.emailMismatch.body` | "This invite was sent to a different email address. Sign in with the account the invite was sent to, or ask the inviter for a new link." | "Lời mời này được gửi đến một địa chỉ email khác. Hãy đăng nhập bằng tài khoản nhận được lời mời, hoặc yêu cầu người mời gửi link mới." | **★ REVIEWER-MANDATORY (vi)** — does NOT echo `invitedEmail` (privacy: matches Story 1-6's redirect-no-email contract at handler `auth_handler.go:590-597`). |
| `auth.invite.error.passwordNotAllowed.heading` | "This account uses Google sign-in" | "Tài khoản này dùng Google" | 409 PASSWORD_NOT_ALLOWED_FOR_OAUTH_USER. |
| `auth.invite.error.passwordNotAllowed.body` | "Continue with Google to accept this invite — the password field doesn't apply." | "Tiếp tục với Google để chấp nhận lời mời này — không cần đặt mật khẩu." | |
| `auth.invite.error.invalidToken.heading` | "Invite link malformed" | "Link lời mời không hợp lệ" | 400 INVALID_INVITE_TOKEN (over-cap) + the missing-token render path. |
| `auth.invite.error.invalidToken.body` | "This link can't be read — check your email for the correct one, or ask the inviter to send a new one." | "Không thể đọc link này — hãy kiểm tra email để lấy link đúng, hoặc yêu cầu người mời gửi link mới." | |
| `auth.invite.error.emailAlreadyRegistered.heading` | "Email already in use" | "Email đã được sử dụng" | 409 EMAIL_ALREADY_REGISTERED (rare race during new-user branch). |
| `auth.invite.error.emailAlreadyRegistered.body` | "An account for this email already exists. Sign in and the invite will be applied to your account." | "Đã có tài khoản với email này. Đăng nhập và lời mời sẽ được áp dụng vào tài khoản của bạn." | **★ REVIEWER-MANDATORY (vi)**. |
| `auth.invite.error.rateLimited` | "Please wait {{seconds}}s before trying again." | "Vui lòng chờ {{seconds}}s trước khi thử lại." | 429. |
| `auth.invite.error.generic` | "Something went wrong. Please try again." | "Đã có lỗi xảy ra. Vui lòng thử lại." | 422 / 5xx / network. |
| `auth.invite.error.fullNameRequired` | "Enter your full name." | "Nhập họ và tên của bạn." | Client-side Zod refine on the form. |
| `auth.login.banner.invited` | "Welcome — you've joined your center. Sign in to continue." | "Chào mừng bạn đến với trung tâm. Đăng nhập để tiếp tục." | **★ REVIEWER-MANDATORY (vi)** — surfaces on `/login?invited=true` after OAuth-path success; copy is center-name-free per Story 1-6's redirect privacy contract (`auth_handler.go:590-597`). **Active-voice rewrite (Sally party-mode 2026-06-26)**: drops the awkward em-dash + the passive-victim "bạn đã tham gia" (you-have-joined) shape; "Chào mừng bạn đến với" (welcome you to) reads as a warm hand-off in Vietnamese register without claiming an action the user did not consciously trigger via Google. |

**And** the 7 ★ REVIEWER-MANDATORY Vietnamese keys are flagged in the PR description for VN-fluent reviewer pass before merge: `invite.title` (active-voice rewrite), `login.banner.invited` (active-voice rewrite), `invite.error.expired.body`, `invite.error.emailMismatch.body`, `invite.error.emailAlreadyRegistered.body`, `invite.titleWithCenter` (Vietnamese interpolation order), and (one to watch) `invite.error.passwordNotAllowed.body`.

**Total: 29 new keys** (28 `auth.invite.*` + 1 `auth.login.banner.invited`).

### AC4: InviteAcceptancePage — token from URL params, form on mount, single submit lands the accept-invite POST

**Given** an unauthenticated user navigates to `/invite/abc123` (optionally with `?c=IELTS%20Academy` for the sender-embedded center-name ribbon),
**When** the page first paints,
**Then** the rendered region (`data-testid="invite-form"`) inside `AuthCard` contains:
- `<h1 data-testid="invite-heading">` rendering EITHER `t('auth.invite.titleWithCenter', { centerName })` when the sanitized `?c=` ribbon is present, OR `t('auth.invite.title')` (fallback) when absent or sanitization rejects.
- Body paragraph rendering `t('auth.invite.body')`.
- `<GoogleOAuthButton label={t('auth.invite.googleCta')} searchParams={{ inviteToken: token }}>` as the dominant primary action — its existing `searchParams` prop threads the invite token through `/api/auth/google?inviteToken=...` per Story 1-6's contract.
- `<CollapsibleEmailForm open={emailFormOpen} onOpenChange={setEmailFormOpen} triggerLabel={t('auth.invite.emailCollapse')}>` revealing the new-user form:
  - `<Input data-testid="invite-fullname-input">` bound to RHF `name="fullName"`.
  - `<PasswordInput data-testid="invite-password-input">` bound to RHF `name="password"`.
  - `<Button type="submit" data-testid="invite-submit">` rendering `t('auth.invite.submit')`.
- Footer `<Link to="/login" data-testid="invite-back-link">` rendering `t('auth.invite.backToLogin')`.

**And** the `?c=centerName` ribbon is read via `useSearchParams().get('c')` and sanitized through a pure `sanitizeCenterName(raw: string | null): string | null` helper at `src/features/auth/lib/sanitizeCenterName.ts`:
- `null` / empty / whitespace-only → return `null` (renders fallback `auth.invite.title`).
- `.trim()` → Unicode `.normalize('NFC')` → reject if `!/^[\p{L}\p{N}\s\-'.]{1,60}$/u.test(value)` → return `null`.
- Otherwise return the sanitized string.
- Co-located `__tests__/sanitizeCenterName.test.ts` — 8 tests minimum: happy ASCII, happy Vietnamese diacritics, happy mixed-case with `&` (rejected), happy with apostrophe / period / hyphen (accepted), HTML-tag injection (rejected), emoji (rejected), null-byte / control-char (rejected), >60 chars (rejected).

**And** the token is read via `useParams<{ token: string }>()` reactively on every render. If `token == null` OR `token.trim() === ''` (defensive — the path-param route shape makes both branches unreachable from React Router v7, but guard them so a hand-typed `/invite/%20` doesn't fall through to a 500), render the `invalidToken` state per AC5 with NO network call (assert MSW request count is zero).

**And** the CollapsibleEmailForm honors UX-DR15 a11y contract on expand (Sally party-mode 2026-06-26 — pin contract for 1-9c, do NOT rely on tacit 1-8 inheritance):
- `aria-expanded` reflects open state on the trigger button.
- On `open === true` transition, focus moves programmatically to `<Input data-testid="invite-fullname-input">` within the same render commit (use `useEffect` keyed on `emailFormOpen` with a `ref.current?.focus()` call — RAF wrapper if Radix portal mounting introduces a timing race).
- An `aria-live="polite"` region near the trigger announces "Email form expanded" via `t('auth.invite.emailFormExpandedAnnouncement')` (NEW i18n key — see AC3) so screen reader users hear the state change.

**And** the form uses a new `useInviteSchema()` builder hook at `src/features/auth/lib/inviteSchema.ts` — `useMemo(t)` Zod schema mirroring `useRegisterSchema`. PASSWORD_MIN = 8, PASSWORD_MAX = 72, fullName required + max 200 chars per `AcceptInviteRequest` schema in `api.yaml:843-844`. Validation runs `onBlur`; `reValidateMode: 'onChange'` so the user sees errors before submit re-fires.

**And** on a valid submit, the page calls `useAcceptInvite().mutate({ inviteToken: token, fullName, password })`. On 200 success:
- The mutation hook populates `authKeys.session()` cache with `{ user: result.user, accessToken: result.accessToken }` so `useAuth().isAuthenticated` flips true on the next render.
- Calls `broadcastLoginSucceeded({ user, accessToken })` so sibling tabs hydrate (same shape as `useLogin` at `api/login.ts:51-69`).
- Navigates immediately via `navigate('/dashboard', { replace: true })`. The center name / role from the response is NOT used for an in-page hint — the dashboard-side rendering (Story 2-1) is the canonical surface.

**Pinned test contracts** (`features/auth/__tests__/InviteAcceptancePage.test.tsx`, MSW seam):
- `renders form on initial paint with token in URL` — render with `/invite/abc123`; assert `invite-form` PRESENT and `invite-not-found` / `invite-expired` / `invite-already-accepted` / `invite-email-mismatch` / `invite-password-not-allowed` / `invite-invalid-token` / `invite-email-already-registered` ALL ABSENT (TEST-FE-6 negative).
- `renders invalid-token state when path token is whitespace-only` — render with `/invite/%20%20`; assert `invite-invalid-token` IN DOM + zero MSW request count.
- `Google CTA carries the inviteToken in href` — **Murat party-mode tightening**: assert (a) `token.length > 0` BEFORE the `endsWith` check (vacuous-pass guard against empty-token state); (b) `getByTestId('google-oauth-cta').href` ends with `/api/auth/google?inviteToken=abc123`; (c) the rendered element is an `<a>` with an `href` attribute, NOT a React Router `<Link>` (assert via `tagName.toLowerCase() === 'a'` + no `data-discover` attribute that RR `<Link>` would set). Locks the top-level-navigation escape-hatch shape against future "let's make it consistent with the rest of the buttons" refactors.
- `Google CTA is NOT rendered when token is empty or whitespace-only` — companion to the test above; the invalid-token state path should NOT render a Google button that would 302 to `?inviteToken=` (empty query). Assert `queryByTestId('google-oauth-cta') === null` in the `invalidToken` state.
- `submits {inviteToken, fullName, password} to API + flips auth + navigates to /dashboard on 200` — MSW returns 200 with a typed `AcceptInviteResult`; assert request body deep-equals `{ inviteToken: 'abc123', fullName: 'Linh Nguyen', password: 'goodPass123' }`; assert `useAuth().isAuthenticated` post-success is true (verified via a `<Route path="/dashboard" element={<p data-testid="dashboard-reached" />}>` sibling — `findByTestId('dashboard-reached')` resolves).
- `submit disabled while mutation pending`.
- `full-name validation: empty submit → inline error from t('auth.invite.error.fullNameRequired') + zero MSW request count`.
- `password validation: 5-char submit → inline error from t('auth.common.validation.passwordMin') + zero MSW request count`.
- `?c= ribbon: renders titleWithCenter H1 when sanitized centerName present` — render with `?c=IELTS%20Academy`; assert `getByTestId('invite-heading').textContent === i18n.t('auth.invite.titleWithCenter', { centerName: 'IELTS Academy' })`.
- `?c= ribbon: falls back to title H1 when ?c is absent` — render without `?c`; assert H1 textContent equals `i18n.t('auth.invite.title')`.
- `?c= ribbon: falls back to title H1 when ?c is whitespace-only or fails sanitization` — render with `?c=%20%20` then with `?c=%3Cscript%3Ealert(1)%3C%2Fscript%3E`; both assert H1 falls back to `auth.invite.title` (NO XSS, NO partial render).
- `CollapsibleEmailForm expand: focus moves to fullName input` — render Default; `userEvent.click(triggerButton)`; assert `document.activeElement === getByTestId('invite-fullname-input')`. Sally party-mode a11y pin.
- `CollapsibleEmailForm expand: aria-live region announces expand` — assert the polite-live node textContent transitions from empty to `i18n.t('auth.invite.emailFormExpandedAnnouncement')` after `userEvent.click(triggerButton)`.

### AC5: Invite error states — 404 INVITE_NOT_FOUND / 410 INVITE_EXPIRED / 409 INVITE_ALREADY_ACCEPTED / 409 INVITE_EMAIL_MISMATCH / 409 PASSWORD_NOT_ALLOWED_FOR_OAUTH_USER / 409 EMAIL_ALREADY_REGISTERED / 400 INVALID_INVITE_TOKEN / 429 / 5xx

**Given** InviteAcceptancePage submits to `POST /api/auth/accept-invite`,
**When** the response is `404 INVITE_NOT_FOUND`, the page swaps the form region to `data-testid="invite-not-found"`:
- Heading `t('auth.invite.error.notFound.heading')`. Body `t('auth.invite.error.notFound.body')`.
- Footer `<Link to="/login">` rendering `t('auth.invite.backToLogin')`.

**And** `410 INVITE_EXPIRED` → `data-testid="invite-expired"`:
- Inline 40×40 clock SVG (reuse 1-9b inline monoline pattern).
- Heading `t('auth.invite.error.expired.heading')`. Body `t('auth.invite.error.expired.body', { centerName, inviterEmail })` — pulling `centerName` + `inviterEmail` from `ApiError.details` (typed via `InviteExpiredDetails`).
- Primary CTA `<a data-testid="invite-expired-contact-cta" href={`mailto:${inviterEmail}`}>` rendering `t('auth.invite.error.expired.contactCta', { inviterEmail })`.
- Footer `<Link to="/login">` rendering `t('auth.invite.backToLogin')`.

**And** `409 INVITE_ALREADY_ACCEPTED` → `data-testid="invite-already-accepted"`:
- Inline 40×40 check-circle SVG (`stroke="var(--cl-status-success)"` — visually differentiates the "good outcome" terminal state from the "dead link" ones; Sally party-mode 2026-06-26 catch — every other terminal region is heading + body + CTA with identical visual treatment, so a user landing on `alreadyAccepted` reads "this is fine" before reading the heading instead of reading "another error" by analogy with `notFound` / `emailMismatch`).
- Heading `t('auth.invite.error.alreadyAccepted.heading', { centerName })` — pulling `centerName` from `ApiError.details` (typed via `InviteAlreadyAcceptedDetails`).
- Body `t('auth.invite.error.alreadyAccepted.body')`.
- Primary CTA `<Link to="/login" data-testid="invite-already-accepted-cta">` rendering `t('auth.invite.error.alreadyAccepted.cta')`.

**And** `409 INVITE_EMAIL_MISMATCH` → `data-testid="invite-email-mismatch"`:
- Heading `t('auth.invite.error.emailMismatch.heading')`. Body `t('auth.invite.error.emailMismatch.body')` — does NOT echo `details.invitedEmail` (privacy mirror of Story 1-6's redirect contract).
- Footer `<Link to="/login">` rendering `t('auth.invite.backToLogin')`.

**And** `409 PASSWORD_NOT_ALLOWED_FOR_OAUTH_USER` → `data-testid="invite-password-not-allowed"`:
- Heading `t('auth.invite.error.passwordNotAllowed.heading')`. Body `t('auth.invite.error.passwordNotAllowed.body')`.
- Primary action — render `<GoogleOAuthButton label={t('auth.invite.googleCta')} searchParams={{ inviteToken: token }}>` again (the only viable recovery path).
- Footer `<Link to="/login">` rendering `t('auth.invite.backToLogin')`.

**And** `409 EMAIL_ALREADY_REGISTERED` → `data-testid="invite-email-already-registered"`:
- Heading `t('auth.invite.error.emailAlreadyRegistered.heading')`. Body `t('auth.invite.error.emailAlreadyRegistered.body')`.
- Primary CTA `<Link to="/login">` rendering `t('auth.invite.error.alreadyAccepted.cta')` (reuse "Sign in").
- Footer is omitted (primary CTA already routes to /login).

**And** `400 INVALID_INVITE_TOKEN` → `data-testid="invite-invalid-token"`:
- Heading `t('auth.invite.error.invalidToken.heading')`. Body `t('auth.invite.error.invalidToken.body')`.
- Footer `<Link to="/login">` rendering `t('auth.invite.backToLogin')`.

**And** `429 RATE_LIMIT_EXCEEDED` → `<div role="alert" data-testid="invite-error-alert">` with `t('auth.invite.error.rateLimited', { seconds: error.retryAfterSeconds ?? 60 })` — submit stays disabled for that many seconds via a local countdown (reuse `useResendCountdown` from `hooks/useResendCountdown.ts`). Clamped via `Math.min(MAX_COUNTDOWN_SECONDS, Math.max(MIN_RATE_LIMIT_SECONDS, requested))` with named constants (Winston pattern, mirrors 1-9b code-review P7 + P8 — defensive against backend `Retry-After: 0` clock-skew edge case).

**And** 422 / 5xx / network → the same form-level alert with `t('auth.invite.error.generic')`. The form stays in input mode on every transient error path — user can retry. Terminal states (404 / 410 / 409 / 400) replace the form region entirely (no retry — the token is dead).

**Pinned test contracts** — **TEST-FE-6 compliance: every terminal-state test asserts the OTHER seven terminal regions are absent**:
- `renders 404 not-found state + footer link routes to /login` — `invite-not-found` IN, other six terminal regions OUT, `invite-form` OUT.
- `renders 410 expired state with centerName + inviterEmail + mailto CTA` — `invite-expired` IN, other six terminal regions OUT; assert `getByTestId('invite-expired-contact-cta').href` equals `mailto:linh@example.com`.
- `renders 409 already-accepted state with centerName` — `invite-already-accepted` IN, others OUT.
- `renders 409 email-mismatch state (REST path)` — `invite-email-mismatch` IN, others OUT, body copy does NOT contain the `details.invitedEmail` value (privacy ratchet).
- `renders 409 password-not-allowed state with Google CTA re-rendered` — `invite-password-not-allowed` IN, others OUT, `getByTestId('google-oauth-cta')` IS present in the error region.
- `renders 409 email-already-registered state with sign-in CTA` — `invite-email-already-registered` IN, others OUT.
- `renders 400 invalid-token state` — `invite-invalid-token` IN, others OUT.
- `renders 429 rate-limited inline alert + disables submit + countdown ticks` — `invite-error-alert` IN, `invite-form` IN (form stays!), terminal regions OUT; assert submit `disabled` true; advance fake timer 30s + assert submit still disabled; advance another 30s + assert submit re-enabled.
- `renders 429 with missing Retry-After defaults to 60s`. (NOTE: the lower-bound clamp test `429 with Retry-After=0 clamps to MIN_RATE_LIMIT_SECONDS=5` is **dropped from this file** per Amelia party-mode 2026-06-26 — that contract belongs on `hooks/useResendCountdown.test.ts` where the clamp constant lives, not on the page. The page test only asserts "0 → countdown active for some positive duration.")
- `5xx renders generic alert + form stays on input mode` (TEST-FE-6: assert `invite-form` IN DOM, terminal regions OUT).
- `422 renders generic alert + form stays on input mode` (TEST-FE-6 same).
- **Privacy ratchet — Amelia party-mode 2026-06-26**: `clicking footer Sign-in link from ANY terminal state does NOT land on /login?invited=true` — for each of the 7 terminal regions with a footer back-to-login link, click the link inside a `MemoryRouter` + sibling `<Route path="/login" element={<UrlProbe />}>` and assert `UrlProbe` reports `searchParams.get('invited') === null`. Closes the leak where a future dev wires `?invited=true` to error footers "for consistency" and accidentally triggers the LoginPage `?invited=true` banner from a failure path.

**ATDD specimens (Murat party-mode 2026-06-26 — pinned BEFORE green per the discipline-ratchet rationale 1-9b established):**

- **Email-leak rejection ratchet for 409 INVITE_EMAIL_MISMATCH** (P=3, I=2 → score 6 — the privacy contract from `auth_handler.go:590-597` SEC-11 evaporates if a future UX-improvement PR surfaces `details.invitedEmail` or `details.oauthEmail` in the error region body):
  ```
  arrange: MSW handler for POST /api/auth/accept-invite returns
    409 INVITE_EMAIL_MISMATCH with details: { invitedEmail: 'leak-invited@example.com', oauthEmail: 'leak-oauth@example.com' }
  act: render InviteAcceptancePage with valid token + submit form
  assert (positive): screen.getByTestId('invite-email-mismatch') IN DOM
  assert (RATCHET — negative): screen.queryByText('leak-invited@example.com') === null
  assert (RATCHET — negative): screen.queryByText('leak-oauth@example.com') === null
  assert (RATCHET — DOM-wide): container.textContent does NOT include 'leak-invited@example.com' OR 'leak-oauth@example.com'
    (catches the case where a future dev renders the emails in an aria-label / title / tooltip / data attribute the visible-text query misses)
  ```
  Locks the pragmatic deviation that the invited / oauth emails ride in the response payload BUT never reach the DOM. A future dev wiring "Expected: {invitedEmail}, Got: {oauthEmail}" copy for UX clarity must consciously override this ratchet and the PR review hits the privacy-contract trigger.

- **Token-change-resets-errorState ratchet** (P=2, I=2 → score 4 MONITOR — 1-9b shipped this as a P1 patch AT code review; pin pre-dev for 1-9c so it lands green-first instead of as patch debt):
  ```
  arrange: MSW handler returns 410 INVITE_EXPIRED with details: { centerName: 'Old Center', inviterEmail: 'old@example.com' }
  act: render InviteAcceptancePage at /invite/oldToken
  assert: screen.getByTestId('invite-expired') IN DOM (terminal state reached)
  act: rerender with new path /invite/freshToken (simulates URL-bar edit OR email-client preview re-click)
  assert (POSITIVE): screen.getByTestId('invite-form') IN DOM (form region returns)
  assert (TEST-FE-6 NEGATIVE): screen.queryByTestId('invite-expired') === null
  assert (TEST-FE-6 NEGATIVE): screen.queryByTestId('invite-error-alert') === null
  assert (TEST-FE-6 NEGATIVE): formError state cleared (no rate-limit countdown active)
  ```
  The implementation contract: `useEffect(() => { setErrorState(null); setFormError(null); acceptInvite.reset() }, [token])` — 4 lines. Without this ratchet, a fresh-token visit after a stale-token terminal state silently shows the OLD error page, trapping the user.

### AC6: LoginPage `?invited=true` success banner (Google-OAuth success landing)

**Given** Story 1-6's OAuth-success redirect lands the user at `/?invited=true` (per `APP_POST_LOGIN_URL` default + the redirected query param from `auth_handler.go:614`),
**And** AC1's index-loader amendment forwards the query to `/login?invited=true`,
**When** LoginPage mounts with `?invited=true`,
**Then** the existing `deriveBannerKey()` selector at `LoginPage.tsx:73-78` is extended to recognize a new `'invited'` variant:

```ts
type BannerKey = 'invited' | 'reset' | 'verified' | 'oauth-error' | null

function deriveBannerKey(searchParams: URLSearchParams): BannerKey {
  if (searchParams.get('invited') === 'true') return 'invited'  // NEW
  if (searchParams.get('reset') === '1') return 'reset'
  if (searchParams.get('verified') === '1') return 'verified'
  if (searchParams.get('error') !== null) return 'oauth-error'
  return null
}
```

**Priority: `invited > reset > verified > oauth-error`.** Invited beats reset because the invite path is the highest-value conversion node (UX-DR10) — if a user somehow lands both signals, the invite banner is the load-bearing one.

**And** the URL-clear effect at `LoginPage.tsx:199-210` is extended to drop `?invited=true` alongside the existing trio (one `next.delete('invited')` line).

**And** the new banner variant renders as:
- Visual: success variant (same border/bg/text classes as the `reset` variant — `border-[color:var(--cl-status-success)]/40 bg-[color:var(--cl-status-success)]/10 text-[color:var(--cl-status-success)]`).
- Inline 16×16 checkmark glyph (reuse the existing `CHECKMARK_SVG` constant at `LoginPage.tsx:80-97`).
- Copy: `t('auth.login.banner.invited')` — center-name-free per Story 1-6's redirect privacy contract.

**And** the banner gate matches the existing pattern: `!isAuthenticated && bannerKey === 'invited' && !emailFormOpen`.

**And** there is NO session-cache invalidation on the `invited` branch — unlike `reset`, an invite acceptance ISSUES a session (via the OAuth callback's `refresh_token` cookie + the subsequent silent-refresh hydration). The `wipedRef` ref + the `useEffect` at `LoginPage.tsx:139-145` stay scoped to the `reset` branch only.

**Pinned tests in `LoginPage.test.tsx`** (+4 tests):
- `renders invited banner with checkmark glyph when ?invited=true lands` — assert `getByRole('alert')` text matches `t('auth.login.banner.invited')` AND the inline `<svg aria-hidden="true">` checkmark IS present.
- `clears ?invited=true from URL after mount` — assert `searchParams.get('invited') === null` post-mount via the extended `UrlProbe` (extend it to include `invited` per the 1-9b P6 pattern).
- `prefers invited banner over reset banner when both ?invited=true&reset=1` — assert rendered banner copy matches `t('auth.login.banner.invited')`, NOT reset.
- **Winston party-mode 2026-06-26**: `prefers invited banner over oauth-error when both ?invited=true&error=invite_email_mismatch` — render with the dual signal (user-mutable URL — hand-typed or stale link), assert rendered banner copy matches `t('auth.login.banner.invited')` NOT `t('auth.login.error.oauthGeneric')`, AND assert `searchParams.get('error') === null` post-URL-clear (the swallowed oauth-error param is wiped alongside `invited`). Ratchets future priority-chain flips against silent oauth-error suppression.

**Pinned test in `routes.test.tsx`** (NEW file — 1 test):
- **Murat party-mode 2026-06-26 BLOCKER**: `index-loader forwards ?invited=true query to /login` — create a `createMemoryRouter(routes, { initialEntries: ['/?invited=true'] })`, render under `<RouterProvider>`, wait for the redirect to settle, assert the rendered URL pathname is `/login` AND searchParams contains `invited=true` (read via the inline `UrlProbe` helper at LoginPage mount, OR via `router.state.location.search`). 4-line test. WITHOUT this test, a future "let me clean up that weird `+ url.search`" PR on the index loader silently kills the entire OAuth-success → invited banner pipeline AND zero CI tests fire. This is the only frontend-side test that exercises the routes.tsx loader; the test belongs on the routes seam, not on LoginPage (which only sees the post-redirect URL).

### AC7: Storybook coverage — co-located stories per `storybook-conventions.md` § 2

**Given** the files `InviteAcceptancePage.stories.tsx` and one new variant added to `LoginPage.stories.tsx`,
**When** running `npm run storybook:build` + `npm run storybook:test` (axe project),
**Then** the canonical variants ship:

**InviteAcceptancePage stories (16):**
- `Default` (en, valid token, form mode collapsed, NO `?c=` ribbon — generic `auth.invite.title` H1)
- `DefaultWithCenterRibbon` (en, valid token, `?c=IELTS%20Academy` ribbon → "Join IELTS Academy" H1 — exercises Sally's bridge happy-path)
- `LocaleVi` (vi, valid token, form mode collapsed)
- `LocaleViWithCenterRibbon` (vi, valid token, `?c=IELTS%20Academy` → "Tham gia IELTS Academy" H1)
- `EmailFormOpen` (en, valid token, CollapsibleEmailForm expanded — verifies focus lands on fullName + aria-live announcement node present)
- `NotFound` (404 INVITE_NOT_FOUND)
- `Expired` (410 with `centerName: 'IELTS Academy', inviterEmail: 'linh@ielts-academy.vn'`)
- `AlreadyAccepted` (409 with `centerName: 'IELTS Academy'` — check-circle SVG visually distinguishes good-outcome from dead-link)
- `EmailMismatch` (409 REST-path INVITE_EMAIL_MISMATCH)
- `PasswordNotAllowed` (409 PASSWORD_NOT_ALLOWED_FOR_OAUTH_USER — Google CTA visible in the error region)
- `EmailAlreadyRegistered` (409 EMAIL_ALREADY_REGISTERED)
- `InvalidToken` (400 INVALID_INVITE_TOKEN OR token missing from path)
- `ErrorGeneric` (5xx — form stays input)
- `RateLimited` (429 with Retry-After=45)
- `Mobile390` (Default at 390px)
- `Mobile390EmailFormOpen` (en, valid token, CollapsibleEmailForm expanded at 390×844 — **Sally party-mode 2026-06-26 catch**: verifies the happy-path mobile fold (Google + divider + fullName + password + submit + back-link + footer) does not push the submit CTA below the iOS Safari keyboard when password field is focused; this is the conversion-critical mobile shape and the wireframe only covers the easier Expired state)
- `Mobile390Expired` (Expired at 390px — clock SVG + heading + body + mailto CTA + footer must fit above the fold on 390×844)

**LoginPage stories (+1 variant):**
- `InvitedBanner` — `/login?invited=true` mount renders the success banner with the inline checkmark glyph + invited copy. Mirrors the 1-9a `VerifiedBanner` / 1-9b `ResetBanner` precedent. Axe-zero decorative-svg check (`aria-hidden="true"`).

**And** every story has a `play` function asserting either `screen.getByTestId(<region>)` or `screen.getByRole('alert')` exists; axe-zero per existing storybook-axe Playwright project.

**And** the Storybook React Router decorator (1-8/1-9a/1-9b precedent) is configured per story to set the `useParams.token` value — same shape Reset uses for `searchParams`.

### AC8: MSW catalog amend — add accept-invite section + bump last_updated

**Given** `_bmad-output/test-artifacts/msw-handler-catalog-auth.md` already lists `1-9c-invite-acceptance-ui` in `target_stories` but no section for `POST /api/auth/accept-invite` exists,
**When** the dev agent appends a new section to the catalog,
**Then** the section documents:
- Happy path 200 with the `AcceptInviteResult` shape (using `MSW_USER` constants for `user` + a synthetic `center: { id, name }` + `role: 'teacher'`).
- 404 INVITE_NOT_FOUND variant (no details).
- 410 INVITE_EXPIRED variant with `details: { centerName: 'IELTS Academy', inviterEmail: 'linh@ielts-academy.vn' }` envelope.
- 409 INVITE_ALREADY_ACCEPTED variant with `details: { centerName: 'IELTS Academy' }`.
- 409 INVITE_EMAIL_MISMATCH variant with `details: { invitedEmail: '...', oauthEmail: '...' }`.
- 409 PASSWORD_NOT_ALLOWED_FOR_OAUTH_USER variant (no details).
- 409 EMAIL_ALREADY_REGISTERED variant (no details).
- 400 INVALID_INVITE_TOKEN variant (no details).
- 429 RATE_LIMIT_EXCEEDED variant with `Retry-After: 45` header.
- 422 VALIDATION_ERROR variant with `details: { fields: [{ field: 'fullName', message: 'required' }] }`.

**And** `last_updated` frontmatter is bumped to the current date.

**And** a Change Log row is appended: `2026-MM-DD | Consumer added: Story 1-9c-invite-acceptance-ui. Added POST /api/auth/accept-invite section with 10 variants (1 happy + 9 error). MSW response constant MSW_ACCEPT_INVITE_DEFAULT extracted with satisfies typecheck.`

## Tasks / Subtasks

> **Commit-sequence discipline:**
> 1. Codegen re-run lands FIRST (smallest blast radius — just regenerates the types).
> 2. i18n keys land SECOND (atomic en + vi).
> 3. MSW handler + catalog touch ride with the API hook.
> 4. InviteAcceptancePage + its route entry land as ONE atomic commit (1-9b precedent — otherwise `npx playwright test` on the intermediate commit fails because the bundle-boundary spec asserts the chunk exists).
> 5. LoginPage `?invited=true` banner amendment lands LAST (smallest blast radius).
> 6. Storybook stories land alongside their pages (per `storybook-conventions.md`).

### Task 0 — Pre-flight: codegen re-run + smoke audit

- [x] 0.1 From `classlite-web/`, run `../scripts/codegen.sh` (or the project's equivalent — check `package.json` scripts first). Confirm `src/lib/api/client.ts` regenerates with `/api/auth/accept-invite`, `/api/auth/google`, `/api/auth/google/callback`, `/api/auth/logout-all` paths AND the corresponding `AcceptInviteRequest` / `AcceptInviteResult` / `InviteCenter` / `InviteExpiredDetails` / `InviteAlreadyAcceptedDetails` / `InviteEmailMismatchDetails` schemas.
- [x] 0.2 Run `npx tsc -b` at the web root — confirm no breaking type changes against existing consumers (1-6 schemas are additive; this should be a no-op for compile errors).
- [x] 0.3 Commit the regenerated `client.ts` standalone with message `web: regenerate openapi client to land Story 1-6 invite + OAuth types`. This commit is small + reversible if codegen surfaces an unexpected regression.

### Task 1 — i18n keys (atomic en + vi)

- [x] 1.1 Add 29 keys per AC3 to `classlite-web/src/locales/en.json` under `auth.invite.*` + `auth.login.banner.invited` (includes the party-mode additions: `auth.invite.titleWithCenter` for the `?c=` ribbon + `auth.invite.emailFormExpandedAnnouncement` for the aria-live a11y pin).
- [x] 1.2 Add the same 29 keys to `classlite-web/src/locales/vi.json` with the seed copy per AC3 (7 ★ REVIEWER-MANDATORY vi keys flagged in PR description — includes the active-voice rewrites on `auth.invite.title` + `auth.login.banner.invited` per Sally party-mode 2026-06-26).
- [x] 1.3 Append `STORY_1_9C_KEYS` + `describe('Story 1-9c i18n parity (R38)', ...)` to `src/lib/test/__tests__/i18n-parity-coverage.test.ts`.
- [x] 1.4 Run `npm test -- i18n-parity-coverage` — green.

### Task 2 — Auth API extensions (authKeys + 1 hook + MSW response constant)

- [x] 2.1 Extend `src/features/auth/api/authKeys.ts`: add `acceptInviteMutation()` mutation key. Extend `authKeys.test.ts` with a matching contract assertion.
- [x] 2.2 Create `src/features/auth/api/acceptInvite.ts` — `useAcceptInvite()` mutation hook. Mirrors `useLogin` precedent at `api/login.ts:30-74`: on success populate `authKeys.session()` cache + call `broadcastLoginSucceeded()` + navigate. NO internal `onError` (page owns error UX). Type the request as `components['schemas']['AcceptInviteRequest']` and the result as `components['schemas']['AcceptInviteResult']`.
- [x] 2.3 **MSW response constant with `satisfies` typecheck** — extract in `classlite-web/src/test/mocks/handlers.ts` alongside `MSW_FORGOT_PASSWORD_DEFAULT` + `MSW_RESET_PASSWORD_DEFAULT`:
  ```ts
  export const MSW_ACCEPT_INVITE_DEFAULT = {
    accessToken: 'msw.invite.jwt',
    user: { ...MSW_USER, emailVerified: true },
    center: { id: '00000000-0000-0000-0000-msw0000ctr01', name: 'MSW Center' },
    role: 'teacher',
  } as const satisfies AcceptInviteResult
  ```
  The `satisfies` clause forces a typecheck against the generated schema — if codegen evolves the response shape, the fixture fails to compile.
- [x] 2.4 Add the default `http.post('/api/auth/accept-invite', ...)` handler returning `MSW_ACCEPT_INVITE_DEFAULT` inside an `Envelope<AcceptInviteResult>` with `status: 200` AND the `Set-Cookie: refresh_token=msw-invite-refresh-token; ...` header (mirrors the login handler at `handlers.ts:81-97`).
- [x] 2.5 Co-located `__tests__/acceptInvite.test.tsx` — 3 tests (happy / 404 / 429).

### Task 3 — Form schema (Zod builder hook)

- [x] 3.1 Create `src/features/auth/lib/inviteSchema.ts` — `useInviteSchema()` returning a Zod schema with `fullName` (min 1, max 200, `.refine(s => s.trim().length >= 1, { message: t('auth.invite.error.fullNameRequired') })`) + `password` (min PASSWORD_MIN=8, max PASSWORD_MAX=72 bytes, `.refine(v => v.trim().length >= PASSWORD_MIN)` — mirrors 1-9b code-review D2 decision). Reuses `auth.common.validation.password*` keys for password validation.
- [x] 3.2 Co-located `__tests__/inviteSchema.test.ts` — 4 tests (empty fullName / whitespace-only fullName / short password / valid pair).
- [x] 3.3 Create `src/features/auth/lib/sanitizeCenterName.ts` — pure `sanitizeCenterName(raw: string | null): string | null` per AC4 sanitization contract (Sally `?c=` ribbon). Regex `/^[\p{L}\p{N}\s\-'.]{1,60}$/u` after `.trim()` + Unicode `.normalize('NFC')`.
- [x] 3.4 Co-located `__tests__/sanitizeCenterName.test.ts` — 8 tests: null, empty, whitespace-only, happy ASCII ("IELTS Academy"), happy Vietnamese diacritics ("Trung tâm IELTS Hà Nội"), HTML-tag injection (`<script>` rejected), emoji rejected, >60 chars rejected, control-char / null-byte rejected.

### Task 4 — InviteAcceptancePage (single atomic commit: page + route + index-loader amendment)

- [x] 4.1 Create `src/features/auth/InviteAcceptancePage.tsx`. Local state: `errorState` (discriminated union for terminal states), `formError` (string for transient alerts), plus `useResendCountdown()` for the 429 path. Composes AuthCard with the right slots.
- [x] 4.2 Read `token` reactively via `useParams<{ token: string }>()` (NOT `useSearchParams` — 1-9c uses path-param routing per Epic AC + AUTH-05 wireframe). If `token == null` OR `token.trim() === ''`, set `errorState='invalidToken'` and short-circuit (NO network call). Guarded via a `useMemo(() => token?.trim() ?? null, [token])`.
- [x] 4.2b Read `centerName` ribbon: `const centerName = useMemo(() => sanitizeCenterName(searchParams.get('c')), [searchParams])` — drives the H1 between `auth.invite.titleWithCenter` (when non-null) and `auth.invite.title` (fallback). NO network call. NO form-field pre-fill.
- [x] 4.2c **Token-change-resets-errorState ratchet (Murat ATDD specimen, pin pre-dev per discipline-ratchet — implementation = 4 lines)**: `useEffect(() => { setErrorState(null); setFormError(null); acceptInvite.reset() }, [token])` immediately after the form setup. Prevents the stale-terminal-state trap when the URL-bar token changes after a 410/409/404 landing.
- [x] 4.3 Wire form (RHF + `useInviteSchema()`, `mode: 'onBlur'`, `reValidateMode: 'onChange'`). On valid submit, `useAcceptInvite().mutate({ inviteToken: token, fullName, password })`. `onSuccess` is owned by the mutation hook (navigates to /dashboard). `onError` branches into the `errorState` setter:
  - `error.status === 404 && error.code === 'INVITE_NOT_FOUND'` → `errorState='notFound'`.
  - `error.status === 410 && error.code === 'INVITE_EXPIRED'` → `errorState={kind: 'expired', centerName, inviterEmail}` (extract from `error.details` typed as `InviteExpiredDetails`).
  - `error.status === 409 && error.code === 'INVITE_ALREADY_ACCEPTED'` → `errorState={kind: 'alreadyAccepted', centerName}` (extract from `error.details` typed as `InviteAlreadyAcceptedDetails`).
  - `error.status === 409 && error.code === 'INVITE_EMAIL_MISMATCH'` → `errorState='emailMismatch'` (do NOT echo `details.invitedEmail`).
  - `error.status === 409 && error.code === 'PASSWORD_NOT_ALLOWED_FOR_OAUTH_USER'` → `errorState='passwordNotAllowed'`.
  - `error.status === 409 && error.code === 'EMAIL_ALREADY_REGISTERED'` → `errorState='emailAlreadyRegistered'`.
  - `error.status === 400 && error.code === 'INVALID_INVITE_TOKEN'` → `errorState='invalidToken'`.
  - `error.status === 429 && error.code === 'RATE_LIMIT_EXCEEDED'` → set `formError` to a rate-limited variant + `countdown.start(clamped)` where `clamped = Math.min(MAX_COUNTDOWN_SECONDS, Math.max(MIN_RATE_LIMIT_SECONDS=5, error.retryAfterSeconds ?? 60))`.
  - default (422 / 5xx / network) → set `formError` to generic.
- [x] 4.4 Inline 40×40 clock SVG (reuse 1-9b's inline JSX from `ResetPasswordPage.tsx` — copy verbatim into the expired-state branch). Inline 40×40 check-circle SVG in the `invite-already-accepted` branch with `stroke="var(--cl-status-success)"` per AC5 (Sally party-mode 2026-06-26 — visually differentiates the good-outcome state).
- [x] 4.4b **CollapsibleEmailForm a11y pin (Sally party-mode 2026-06-26)** — `useEffect(() => { if (emailFormOpen) fullNameRef.current?.focus() }, [emailFormOpen])` (RAF-wrapped if Radix portal timing surfaces a race in `EmailFormOpen` story). Render the `aria-live="polite"` region with the `auth.invite.emailFormExpandedAnnouncement` key conditionally mounted on `emailFormOpen === true`.
- [x] 4.5 **In the SAME commit**, append the route entry to `src/routes.tsx` AuthLayout children (path: `'invite/:token'`) AND amend the index-loader to forward `url.search` per AC1's snippet. Page file + route registration + loader amend must land together — otherwise the bundle-boundary spec on the intermediate commit fails.
- [x] 4.6 Co-located `__tests__/InviteAcceptancePage.test.tsx` — covers all pinned contracts from AC4 + AC5 (~19 tests including the new `?c=` ribbon trio + a11y focus + aria-live + Murat's email-leak rejection ratchet + Murat's token-change-resets-errorState ratchet + Amelia's privacy-ratchet across 7 terminal regions + the Murat-tightened Google CTA pair). Use the `MemoryRouter + sibling Route` navigate-spy pattern from `VerifyEmailPage.test.tsx:75-96`: sibling `<Route path="/dashboard" element={<p data-testid="dashboard-reached" />}>` and `<Route path="/login" element={<UrlProbe />}>`.
- [x] 4.7 **NEW** — create `classlite-web/src/__tests__/routes.test.tsx` with Murat's BLOCKER index-loader query-forward test (AC6). 4-line `createMemoryRouter` test. NOT part of `LoginPage.test.tsx` — the loader is owned by routes.tsx, not LoginPage.

### Task 5 — LoginPage `?invited=true` banner amendment

- [x] 5.1 Open `src/features/auth/LoginPage.tsx`. Extend `BannerKey` type to include `'invited'`. Extend `deriveBannerKey()` to recognize `?invited=true` with priority `invited > reset > verified > oauth-error` per AC6.
- [x] 5.2 Extend the URL-clear effect at `LoginPage.tsx:199-210` to drop `?invited=true` alongside the existing trio (one `next.delete('invited')` line + extend the `hasInvited` presence check).
- [x] 5.3 Add a new banner render branch for `bannerKey === 'invited'`. Reuse the success variant classes (border / bg / text) + the existing `CHECKMARK_SVG` constant. Copy is `t('auth.login.banner.invited')`. Gate on `!isAuthenticated && bannerKey === 'invited' && !emailFormOpen` per the existing pattern.
- [x] 5.4 Add 4 pinned tests to `LoginPage.test.tsx` per AC6 (banner + checkmark, URL-clear, priority collision `invited > reset`, **Winston priority-escalation collision `invited > oauth-error` swallowing oauth-error param** — party-mode 2026-06-26 addition).
- [x] 5.5 Extend the existing `UrlProbe` helper in `LoginPage.test.tsx` to emit the `invited` param alongside `error` / `verified` / `reset` (per 1-9b code-review P6 — vacuous-pass closer).

### Task 6 — Storybook coverage

- [x] 6.1 Create `src/features/auth/InviteAcceptancePage.stories.tsx` per AC7 — 16 stories (party-mode 2026-06-26 additions: `DefaultWithCenterRibbon` + `LocaleViWithCenterRibbon` for the `?c=` bridge; `Mobile390EmailFormOpen` for the unverified happy-path mobile fold; existing 13 retained including the check-circle-differentiated `AlreadyAccepted`). Use the Storybook React Router decorator to set `useParams.token` AND `searchParams.c` per story.
- [x] 6.2 Extend `src/features/auth/LoginPage.stories.tsx` with a new `InvitedBanner` variant mirroring the `ResetBanner` / `VerifiedBanner` precedent.
- [x] 6.3 Run `npm run storybook:build` + `npm run storybook:test` (axe project) — green.

### Task 7 — MSW catalog amend + bundle-boundary extension

- [x] 7.1 Open `_bmad-output/test-artifacts/msw-handler-catalog-auth.md`. Append a new section per AC8 with all 10 variants documented verbatim. Bump `last_updated` to the current date. Append a Change Log row.
- [x] 7.2 Extend `e2e/route-bundle-boundaries.spec.ts` per AC1 — 1 vacuous-pass guard on `inviteChunks.length > 0` + 1 iterated negative loop across `studentContents` and `teacherContents`. Hard-string match on the chunk basename `/^InviteAcceptancePage-[\w-]+\.js$/`.

### Task 8 — CI matrix green + chunk-size budget

- [x] 8.1 `npm run lint` clean.
- [x] 8.2 `npm run lint:css` clean.
- [x] 8.3 `npm test` clean.
- [x] 8.4 `npx playwright test` clean — `route-bundle-boundaries.spec.ts` confirms the new chunk lands in `dist/assets` AND the negative cross-chunk assertions pass.
- [x] 8.5 `npm run build` clean. **Chunk-size budget assertion** (Winston 1-9b pattern, hardened at party-mode 2026-06-26): the script lives at `classlite-web/scripts/check-chunk-size.mjs` (extend the 1-9b version that already covers ForgotPasswordPage + ResetPasswordPage with a new entry for `InviteAcceptancePage-*.js`). The script greps `dist/assets/` for chunks matching `/^InviteAcceptancePage-[\w-]+\.js$/`, gzips each, and `process.exit(1)` if any exceeds 8192 bytes. Reported in `npm run build` post-step (call from `package.json` script `"build:check"` or wire as a CI step). NOT aspirational copy — the script path is the enforcement seam.
- [x] 8.6 `npm run storybook:build` clean.
- [x] 8.7 `npx tsc -b` clean — including the new `satisfies` typecheck on `MSW_ACCEPT_INVITE_DEFAULT`.

### Review Findings

_Code review pass 2026-06-29 — three parallel layers (Blind Hunter / Edge Case Hunter / Acceptance Auditor) on Opus 4.7 (1M ctx) fresh context. 86 raw findings → 13 unique actionable (2 decisions + 11 patches) + 8 deferred + ~50 dismissed as noise._

- [x] [Review][Decision-Resolved] `emailAlreadyRegistered` terminal CTA i18n key → **dedicated key** chosen; folded into P12 below
- [x] [Review][Decision-Resolved] `emailAlreadyRegistered` footer back-link → **keep omission + lock with negative test** chosen; folded into P13 below
- [x] [Review][Patch] (P12 — from D1) Add dedicated `auth.invite.error.emailAlreadyRegistered.cta` key to `en.json` ("Sign in") + `vi.json` ("Đăng nhập") + extend `STORY_1_9C_KEYS` in `i18n-parity-coverage.test.ts` + flip `InviteAcceptancePage.tsx:570` to use the new key. Decouples the two terminal CTAs so a future copy change to `alreadyAccepted.cta` does not silently flip the wrong-context button. ★ REVIEWER-MANDATORY vi count 7→8. [`InviteAcceptancePage.tsx:570`, `locales/{en,vi}.json`, `i18n-parity-coverage.test.ts`]
- [x] [Review][Patch] (P13 — from D2) Add a negative test asserting `invite-back-link` is ABSENT for `emailAlreadyRegistered` and `alreadyAccepted` terminal regions (the two whose primary CTA already routes to /login). Locks the intentional design + documents the asymmetry vs the other 5 footer-bearing regions. [`InviteAcceptancePage.test.tsx`, new test block]
- [x] [Review][Patch] **BLOCK-MERGE** — `routes.test.tsx` re-implements the index loader inline as `harnessRoutes` instead of importing the real `routes` array from `routes.tsx`; the Murat BLOCKER contract is hollow — a future `routes.tsx` loader edit (the exact scenario the test was written to catch) is NOT detected because the test exercises its own copy. [`classlite-web/src/__tests__/routes.test.tsx:43-52`]
- [x] [Review][Patch] Rate-limit alert text interpolates the static `clamped` int instead of `countdown.remaining`; the displayed seconds do NOT tick down as the countdown runs. Same defect 1-9b patched as P7 — apply the same fix here. [`classlite-web/src/features/auth/InviteAcceptancePage.tsx:311-313`]
- [x] [Review][Patch] Privacy-ratchet test (`'footer Sign-in link from any terminal state does NOT land on /login?invited=true'`) covers only `notFound` + `invalidToken` — 2 of the 5 footer-bearing terminal regions. Extend the loop to also exercise `expired`, `emailMismatch`, `passwordNotAllowed`. [`classlite-web/src/features/auth/__tests__/InviteAcceptancePage.test.tsx:707-732`]
- [x] [Review][Patch] `MIN_RATE_LIMIT_SECONDS=5` defensive floor (Retry-After:0 clock-skew guard) has no test on either side — the spec deferred the test to `useResendCountdown.test.ts`, but the constant lives in `InviteAcceptancePage.tsx`, not the hook. Add a page-level test: `429 with Retry-After: 0 → countdown.start receives ≥5s`. [`classlite-web/src/features/auth/InviteAcceptancePage.tsx:97-107`]
- [x] [Review][Patch] `MSW_ACCEPT_INVITE_DEFAULT.center.id` is `'00000000-0000-0000-0000-msw0000ctr01'` — the `msw0000ctr01` segment contains non-hex characters (`m`/`s`/`w`/`c`/`t`/`r`), violating the schema-declared `Format: 'uuid'`. Replace with a valid UUID like `'00000000-0000-0000-0000-000000000001'`. [`classlite-web/src/test/mocks/handlers.ts:72`]
- [x] [Review][Patch] `sanitizeCenterName.test.ts` contains a literal NUL byte at offset 1952 (inside `'Center\0X'` test fixture); `file(1)` reports the file as binary `data` and `git diff` treats it as binary (zero-line patch in the review surface). Replace the literal NUL with the ` ` escape sequence — preserves the test semantics, restores the file to readable UTF-8. [`classlite-web/src/features/auth/lib/__tests__/sanitizeCenterName.test.ts`]
- [x] [Review][Patch] Index-loader appends `url.search` to the redirect target but drops `url.hash`. The loader explicitly fixes the silent-flatten bug class for query params — reintroducing it for hash fragments is the same pattern. Change to `return redirect('/login' + url.search + url.hash)`. [`classlite-web/src/routes.tsx`, index loader]
- [x] [Review][Patch] Token-change `useEffect` calls `acceptInvite.reset()` but does NOT guard against the stale in-flight mutation's `onSuccess` firing for the previous token — if user edits URL bar mid-flight, `setQueryData(authKeys.session(), ...)` + `navigate('/dashboard')` can still fire for the WRONG invite/center. Either compare token-at-mutate against current token in `onSuccess`, OR thread an AbortController through `apiFetch`. [`classlite-web/src/features/auth/InviteAcceptancePage.tsx:204-212`]
- [x] [Review][Patch] All 7 terminal regions (`notFound`/`expired`/`alreadyAccepted`/`emailMismatch`/`passwordNotAllowed`/`emailAlreadyRegistered`/`invalidToken`) lack `role="alert"` / `aria-live` — screen-reader users do not hear the state transition from form → terminal. Wrap each terminal `data-testid="invite-*"` container with `role="alert"`. [`classlite-web/src/features/auth/InviteAcceptancePage.tsx`, all 7 terminal blocks]
- [x] [Review][Patch] `MAX_RATE_LIMIT_SECONDS = 300` in `InviteAcceptancePage.tsx:99` is a literal duplicate of `MAX_COUNTDOWN_SECONDS = 300` in `useResendCountdown.ts:24` (CQ-3 magic-value drift). Import the hook constant and rename for single source of truth. [`classlite-web/src/features/auth/InviteAcceptancePage.tsx:99`]
- [x] [Review][Patch] Hardcoded `text-amber-600` Tailwind utility on the expired-state clock icon bypasses the `--cl-status-*` design-token system that other status surfaces in the page already use. Switch to a design token (`text-[var(--cl-status-warning)]` or equivalent). [`classlite-web/src/features/auth/InviteAcceptancePage.tsx:75` (approx — expired-state clock icon)]
- [x] [Review][Defer] LoginPage `?invited=true` check is case-sensitive (`?invited=TRUE` ignored) — deferred, Story 2-1 moves the banner to dashboard
- [x] [Review][Defer] `useAcceptInvite` onSuccess hard-navigates to `/dashboard` regardless of role — deferred, dashboard routing is Story 2-1's concern (student/teacher/owner split lands when dashboard ships)
- [x] [Review][Defer] `sanitizeCenterName` uses NFC normalization; NFKC would fold compatibility/fullwidth confusables and tighten the phishing-string defense — deferred, security hardening, not a regression
- [x] [Review][Defer] `<TerminalRegion>` component refactor (7 near-duplicate JSX blocks on InviteAcceptancePage = anti-pattern same shape as the spec-flagged 5-variant `<Banner variant>` 1-9d gate) — deferred, 1-9d gate per spec preamble
- [x] [Review][Defer] `forgotPassword.test.tsx` has TS module-resolution diagnostics (`@/test/msw-server`, `@/lib/query-client`, etc.) — deferred, pre-existing from 1-9b, unrelated to 1-9c surface
- [x] [Review][Defer] `build:check` not wired into `ci-web.yml` — deferred, acknowledged in completion notes; 1-line CI PR planned with the codegen-drift CI gate follow-up
- [x] [Review][Defer] BroadcastChannel `invite-accepted` cross-tab signal absent — deferred, spec explicit deferral; sibling tabs hydrate on next silent-refresh tick
- [x] [Review][Defer] `passwordNotAllowed` terminal offers no "try email again" recovery path and no test pins the UX absence — deferred, intentional per spec design; pin contract only if 1-9d revisits

## Dev Notes

### File structure after 1-9c

```
classlite-web/src/features/auth/
├── AuthLayout.tsx              (unchanged)
├── LoginPage.tsx               (Task 5 — extend BannerKey + deriveBannerKey + URL-clear + render branch)
├── LoginPage.stories.tsx       (+1 variant — Task 6.2 InvitedBanner)
├── LoginPage.test.tsx          (+3 tests — Task 5.4 + extended UrlProbe per Task 5.5)
├── RegisterPage.tsx            (unchanged)
├── VerifyEmailPage.tsx         (unchanged)
├── ForgotPasswordPage.tsx      (unchanged)
├── ResetPasswordPage.tsx       (unchanged)
├── InviteAcceptancePage.tsx    (NEW — Task 4)
├── InviteAcceptancePage.stories.tsx (NEW — Task 6.1)
├── api/
│   ├── authKeys.ts             (extended — Task 2.1)
│   ├── acceptInvite.ts         (NEW — Task 2.2)
│   └── __tests__/
│       ├── authKeys.test.ts    (extended)
│       └── acceptInvite.test.tsx (NEW)
├── lib/
│   ├── inviteSchema.ts         (NEW — Task 3.1)
│   ├── sanitizeCenterName.ts   (NEW — Task 3.3 — party-mode `?c=` ribbon)
│   └── __tests__/
│       ├── inviteSchema.test.ts (NEW)
│       └── sanitizeCenterName.test.ts (NEW — Task 3.4)
└── __tests__/
    └── InviteAcceptancePage.test.tsx (NEW — Task 4.6)

classlite-web/src/__tests__/
└── routes.test.tsx             (NEW — Task 4.7 — Murat BLOCKER index-loader query-forward test)

classlite-web/src/lib/api/
└── client.ts                   (regenerated — Task 0.1 — adds 1-6 endpoints + schemas)

classlite-web/src/test/mocks/
└── handlers.ts                 (extended — Task 2.3 + 2.4)

classlite-web/src/routes.tsx    (Task 4.5 — invite route + index-loader query-forward amendment)

classlite-web/scripts/
└── check-chunk-size.mjs        (extended — Task 8.5 — adds InviteAcceptancePage entry)

classlite-web/e2e/
└── route-bundle-boundaries.spec.ts (extended — Task 7.2)
```

### Reuse map — verified citations

| Need | Reuse from | Verification |
|---|---|---|
| Card shell | `features/auth/components/AuthCard` | Verbatim slots |
| Google OAuth primary | `features/auth/components/GoogleOAuthButton` | **Already accepts `searchParams` prop scaffolded for 1-9c** at GoogleOAuthButton.tsx:29-46 |
| Collapse-reveal email form | `features/auth/components/CollapsibleEmailForm` | 1-8 precedent |
| PasswordInput eye-toggle | `features/auth/components/PasswordInput` | React 19 ref-as-prop |
| Password validation keys | `auth.common.validation.password*` | Existing keys |
| 60-second countdown (rate-limit) | `features/auth/hooks/useResendCountdown` | clamp [1, 300], NaN→60 (extended pattern adds MIN_RATE_LIMIT_SECONDS=5 lower bound per 1-9b code-review P8) |
| API envelope unwrapping | `lib/api-fetch.apiFetch` + `ApiError.retryAfterSeconds` + `ApiError.code` + `ApiError.details` | 1-8/1-9a/1-9b precedent |
| Mutation key factory | `features/auth/api/authKeys` | Extend with 1 new mutation key |
| Mutation hook shape | `features/auth/api/login.ts` | Verbatim shape — populate `authKeys.session()`, call `broadcastLoginSucceeded()`, `navigate('/dashboard', { replace: true })` |
| MSW default response constant pattern | `test/mocks/handlers.ts:46-58` MSW_FORGOT_PASSWORD_DEFAULT / MSW_RESET_PASSWORD_DEFAULT | Verbatim `satisfies` typecheck pattern |
| MSW handler catalog | `_bmad-output/test-artifacts/msw-handler-catalog-auth.md` | Add new section + bump last_updated |
| i18n parity block | `lib/test/__tests__/i18n-parity-coverage.test.ts` STORY_1_9B_KEYS | Mirror with STORY_1_9C_KEYS |
| LoginPage banner slot | `LoginPage.tsx` `bannerKey` derived state | Extend the priority chain — `invited > reset > verified > oauth-error` |
| Navigate assertion in tests | `VerifyEmailPage.test.tsx:75-96` | **MemoryRouter + sibling `<Route element={<p data-testid />}>`** — NOT `vi.mock('react-router')` |
| Inline 40×40 clock SVG | `ResetPasswordPage.tsx` expired-state pattern | Re-render same JSX |

### Architectural Debt Acknowledged (Winston party-mode 2026-06-26)

Two transitional shapes that 1-9c is taking on by choice — call them out so they're not mistaken for end-state architecture:

1. **LoginPage owns the `?invited=true` banner — transitional only.** The semantically correct redirect target post-OAuth-invite-success is `/dashboard?invited=true` (the user IS authenticated; Layer A redirects them there within ~200ms anyway). 1-9c is carrying LoginPage churn (BannerKey extension + URL-clear extension + 4 new tests + 1 Storybook variant + 1 new routes.test.tsx file) for a banner the user sees for one paint before being bounced. The right shape lands in **Story 2-1**: change backend `APP_POST_LOGIN_URL=http://localhost:5173/dashboard?invited=true`, let the dashboard own the toast directly, drop the LoginPage `?invited=true` branch and the index-loader query-forward amendment. Defensible scope for 1-9c (the OAuth-success path is not UX-naked between 1-9c and 2-1 shipping), but track the move-to-dashboard as Story 2-1 cleanup work, not "permanent layered architecture."

2. **Stale sibling-tab on `?invited=true` relies on next silent-refresh tick to hydrate `useAuth`.** A sibling tab on `/login` from before the invite-acceptance OAuth dance still has a cached `authKeys.session()` from a previous session (or no session). The `?invited=true` banner renders fine; `useAuth` doesn't auto-refetch. The TanStack Query default `staleTime` + the boot-probe on next mount + the broadcast-channel hydrate covers the gap on next user action. NOT a free lunch — it's an architectural assumption that holds because of the existing silent-refresh contract, not because the banner branch does anything clever. Same assumption applies to the existing `verified` banner branch from 1-9a.

### 1-9d BannerKey gate — pre-merge refactor mandate

If 1-9d adds a 5th BannerKey variant (session-expired is the likely candidate per Epic 1C AC line 397-403), **the `deriveBannerKey` priority chain MUST be refactored to a `<Banner variant={...}>` discriminated-union component PRE-MERGE**. Four discriminated branches in a function is a smell; five is a defect — once the priority chain becomes unreadable, the bug surface shifts from "which signal wins?" to "did I drop a signal in the chain?" Winston party-mode 2026-06-26 catch. 1-9c ships the 4-variant chain knowingly; 1-9d cannot ship the 5-variant chain without the refactor.

### LoginPage `?invited=true` — why the variant lands NOW, not in 1-9d

Story 1-6's OAuth callback redirects on invite-acceptance success to `APP_POST_LOGIN_URL?invited=true`. Without a frontend banner for that query param, the user lands at `/login` (after the index-loader forwards) with no acknowledgment that anything happened — silent confusion. The 4-line `deriveBannerKey()` extension + 1-line URL-clear extension is small, the test set is +3 tests, and the alternative is shipping 1-9c and leaving the OAuth-success path UX-naked until 1-9d. Cheap to land here.

Note that the `reset > verified > oauth-error` priority chain in 1-9b's `deriveBannerKey()` is extended to `invited > reset > verified > oauth-error`. The justification: a user encountering both `?invited=true` AND `?reset=1` simultaneously (vanishingly rare — a fresh-from-OAuth invite + a forced password reset in the same session) sees the invite banner because the invite is the higher-value-conversion node (UX-DR10). The `reset` banner's session-wipe semantics still fire — only the visible banner copy changes.

### Pragmatic interpretation of the Epic 1C "InviteCard with center logo / role badge" AC

Epic 1C AC line 332-338 mandates the InviteCard show "Center logo or auto-generated lettermark (56×56), inviter name + center name heading, role badge in amber" *before* the user clicks anything. This requires a backend `GET /api/auth/invites/{token}/preview` endpoint that does NOT exist. Three options weighed:

1. **Add the preview endpoint as part of 1-9c.** Cost: a new `GET` route + service method + sqlc query + 5 new error envelopes + an ATDD test suite — scope creep from a frontend story into a 1-6 backend gap. Anti-enumeration surface widens (each random invite-token guess now returns center identity to the unauthenticated probe).
2. **Render 1-9c without the InviteCard preview surface.** Cost: degrades the trust-loaded UX. User sees "You've been invited" + the form instead of "Linh đã mời bạn tham gia IELTS Academy."
3. **Defer to Epic 7 (real staff-invite delivery).** Cost: Story 1-9c ships with the degraded UX; Epic 7 adds the preview endpoint + retrofits 1-9c later.

**Default: Option 2 + 3 + a sender-embedded ribbon bridge** — ship 1-9c with the static InviteCard composition deferred to Epic 7, BUT close the asymmetry-of-anonymity that Sally caught at party-mode review by rendering a sanitized `?c=centerName` query-param ribbon as the H1 when the email template embeds it (see AC4 sanitization regex). The center owner controls the email template; they own the embed. No backend probe, no anti-enumeration surface, no form pre-fill. Per `[[feedback_pragmatic_interpretation_of_spec_absolutes]]`, the Epic AC is amended (the durable doc) to drop the InviteCard avatar + role-badge + dynamic-preview mandate from 1-9c, citing the anti-enumeration cost; the amendment adds the sanitized `?c=` ribbon as the conversion-critical bridge. Story 1-9c remains a complete, shippable conversion node — and the trust hand-off between the email ("Linh đã mời bạn tham gia IELTS Academy") and the landing page ("Tham gia IELTS Academy") is preserved at the H1 word, even without the lettermark / inviter / role.

### Why the email field is omitted from the form (not "hidden + locked")

Epic 1C AC line 337 says "a collapsed email form with the email field locked to the invite address." We do not know the invite address until acceptance succeeds (the same anti-enumeration constraint as the preview-endpoint discussion above). Two options:

1. Render a disabled/locked email field with placeholder copy ("Hidden — invite uses your email"). Cost: a phantom field that doesn't carry data. Visual / cognitive noise. RHF schema would need a stub field with no validation.
2. **Omit the email field entirely.** The backend authoritatively uses `invite.email` from the token row — the frontend can't override it anyway. Form shape becomes `{inviteToken, fullName, password}` — the user types name + password.

Default: Option 2. The field doesn't add user value; it adds visual debt. The PR description notes the spec-vs-implementation gap so the reviewer doesn't read the omission as an oversight.

### Backend response: center info available POST-acceptance but NOT consumed for in-page UX

`AcceptInviteResult` (api.yaml:864-876) carries `{accessToken, user, center: {id, name}, role}`. The frontend can read `result.center.name` + `result.role` in the `useAcceptInvite.onSuccess` callback. We deliberately do NOT use these for an in-page hint ("Welcome to IELTS Academy as Teacher!") because the navigate to `/dashboard` fires immediately and the user lands on Story 2-1's dashboard surface, which is the canonical place for "Welcome to your center" framing. Threading the center name through a transient toast on `/invite/{token}` before the navigate would be redundant and would race the navigate animation.

### MSW handler defaults — adversarial against the "happy-path-only" trap

Per TEST-FE-2 (three-state coverage mandatory) AND TEST-FE-6 (test what's absent), every InviteAcceptancePage test asserts the OTHER seven terminal regions are absent when one terminal region is rendered. The 14 stories at AC7 cover the same surface in Storybook + axe. Together, this closes the silent-pass-via-positive-only-assertion trap that 1-9b's code review surfaced (Murat BLOCKER P-fix for AC6).

The 8 distinct `data-testid` values (`invite-form` / `invite-not-found` / `invite-expired` / `invite-already-accepted` / `invite-email-mismatch` / `invite-password-not-allowed` / `invite-email-already-registered` / `invite-invalid-token`) are intentionally distinct — there is NO "render a generic error region" code path. Each backend error code maps to a dedicated DOM region with a TEST-FE-6 negative assertion ratchet.

### Bundle size expectations

InviteAcceptancePage ~3-5 KB gzipped (shares the auth chunk with PasswordInput + CollapsibleEmailForm + GoogleOAuthButton + AuthCard + RHF + Zod from 1-8). The auth chunk after 1-9c lands sits at ~25-30 KB gzipped — well within the bundle discipline budget for an unauthenticated-first-paint surface. Task 8.5 enforces an **8 KB gzipped ceiling per new chunk**.

### Codegen-drift catcher: why Task 0.3 commits the regenerated client.ts standalone

Per project-context WF-3 ("codegen.sh — when to run, when not to"), the codegen output is a consequence, not a starting point. The 1-6 endpoint drift in `client.ts` is a 3-story-old bug (the Story 1-6 dev should have re-run codegen) that 1-7c / 1-8 / 1-9a / 1-9b never tripped over because none of them touched the invite or Google paths. The standalone regen commit isolates the drift fix from the 1-9c feature commits — if the regenerated `client.ts` introduces an unexpected breaking rename on an existing consumed type (it shouldn't — 1-6's schemas are additive), the dev agent stops at Task 0.2 and escalates rather than patching call sites silently.

### `useParams<{ token: string }>()` reactive read — path-param routing vs the 1-9b query-param pattern

Story 1-9b reads `token` via `useSearchParams().get('token')` because the reset-password URL is `{base}?token={raw}` (query param) per `auth_reset.go:102` + `config.go:62`. Story 1-9c uses the path-param route `/invite/:token` per Epic 1C AC line 330 + the AUTH-05 wireframe ("my.classlite.app/invite/abc123"). The reactivity property is the same: React Router v7's `useParams` re-renders on path-segment changes, so a same-tab `/invite/A → /invite/B` URL-bar edit triggers a re-derivation. The `useMemo(() => token?.trim() ?? null, [token])` shape mirrors 1-9b's `useMemo` extractor.

### Backend redirect URL chain — confirmed end-to-end

Reproduced from `classlite-api/internal/config/config.go:68-69` + `classlite-api/internal/handler/auth_handler.go:601-617`:

```
Dev defaults:
  APP_POST_LOGIN_URL        = "http://localhost:5173/"
  APP_LOGIN_ERROR_URL_BASE  = "http://localhost:5173/login"

Story 1-6 OAuth callback success path:
  → http://localhost:5173/?invited=true              (NO center name echoed — privacy SEC-11)

Story 1-6 OAuth callback invite-error paths (each renders inline error code):
  → http://localhost:5173/login?error=invite_email_mismatch
  → http://localhost:5173/login?error=invite_expired
  → http://localhost:5173/login?error=invite_already_accepted
  → http://localhost:5173/login?error=invite_unknown_error
```

With AC1's index-loader query-forward amendment, `/?invited=true` becomes `/login?invited=true` and triggers the new bannerKey branch. The four `?error=invite_*` codes continue to land on the existing `oauth-error` bannerKey variant (generic `auth.login.error.oauthGeneric` copy) — 1-9d AC2 (OAuth Email Mismatch Screen) will replace the generic with dedicated copy.

If a future deploy changes `APP_POST_LOGIN_URL` to a path that does NOT round-trip through the index loader (e.g. `https://my.classlite.app/dashboard`), the query-forward amendment in `routes.tsx` is a no-op for that environment — the production redirect goes straight to the dashboard. This is fine; the banner is dev-environment polish.

## Definition of Done

- [x] AC1: `/invite/:token` route lazy-loads from the auth chunk; bundle-boundary spec passes vacuous-pass guard + iterated negative loops. Index-loader query-forward amendment shipped.
- [x] AC2: `scripts/codegen.sh` re-run lands the Story 1-6 invite + OAuth types in `client.ts`; `npx tsc -b` clean against existing consumers.
- [x] AC3: 29 new i18n keys land in BOTH `en.json` + `vi.json` (includes party-mode additions `auth.invite.titleWithCenter` + `auth.invite.emailFormExpandedAnnouncement`); `STORY_1_9C_KEYS` block green via `assertI18nParity`. 7 ★ REVIEWER-MANDATORY vi keys flagged in PR description for VN-fluent sign-off.
- [x] AC4: InviteAcceptancePage renders form on first paint with reactive `useParams` token read AND reactive `useSearchParams('c')` ribbon read (Sally party-mode bridge); submits `{inviteToken, fullName, password}` to `/api/auth/accept-invite`; on 200 success populates `authKeys.session()` + broadcasts + navigates to `/dashboard`. Google CTA threads `?inviteToken=...` via the existing `GoogleOAuthButton.searchParams` prop. CollapsibleEmailForm a11y honored (focus → fullName on expand + aria-expanded + aria-live announcement). Token-change-resets-errorState `useEffect` wired (Murat ATDD specimen).
- [x] AC5: 404 / 410 / 409 (all four codes) / 400 each render the right dedicated terminal region inside `AuthCard`, with the OTHER seven regions assert-absent (TEST-FE-6 compliance, not "just renders X"); 429 / 422 / 5xx keep form in input mode with `invite-error-alert` inline. 429 countdown ticks via `useResendCountdown` with `MIN_RATE_LIMIT_SECONDS=5` lower-bound clamp. `invite-already-accepted` carries inline 40×40 check-circle SVG. Murat's email-leak rejection ratchet + token-change-resets-errorState ATDD specimens green.
- [x] AC6: LoginPage `?invited=true` success banner renders with inline checkmark glyph (axe-zero `aria-hidden`); URL cleared on mount; banner prefers over reset/verified/oauth-error on collision (including Winston's `invited > oauth-error` swallowing-ratchet test). `BannerKey` type extended; `UrlProbe` test helper extended. Murat's BLOCKER `routes.test.tsx` index-loader query-forward test green.
- [x] AC7: All 17 stories ship + axe-zero in the storybook-axe Playwright project (16 InviteAcceptancePage + 1 LoginPage `InvitedBanner`).
- [x] AC8: MSW handler catalog `last_updated` bumped + 1-9c Change Log row appended + new `POST /api/auth/accept-invite` section documents 10 variants. `MSW_ACCEPT_INVITE_DEFAULT` extracted with `satisfies` typecheck.
- [x] `npm run lint`, `npm run lint:css`, `npx tsc -b`, `npm test`, `npx playwright test`, `npm run build`, `npm run storybook:build` all clean.
- [x] **Chunk-size budget green**: `InviteAcceptancePage-*.js` ≤ 8 KB gzipped (reported in PR description; build fails if exceeded).
- [x] John has filed the Epic 1C AC amendment for 1.9c per AC3 + AC4 reframes:
  - Drop the "InviteCard with center logo + inviter heading + role badge" mandate (no preview endpoint).
  - Drop the "email field locked to invite address" mandate (anti-enumeration — backend cannot echo invite email pre-acceptance).
  - Drop the "new-user vs existing-user vs already-accepted distinct branches at mount time" mandate (no preview endpoint).
  - Cite the durable-doc rationale + the Epic 7 owner for the missing preview endpoint.
  - **Add (party-mode 2026-06-26)**: sanitized `?c=centerName` query-param ribbon as the conversion-critical bridge — center owner embeds in email template, page sanitizes + renders in H1, no backend probe.
- [x] Sibling completion-notes file authored at first dev pickup per `docs/bmad-story-conventions.md` (this story stays ≤600 lines).

## Out of Scope

See the "Out of scope" block at the top of this file.

## Change Log

| Date | Note |
|---|---|
| 2026-06-27 | Status transitioned in-progress → review. All 8 ACs + DoD satisfied. Implementation transcript / file list / debug log moved to sibling [`1-9c-invite-acceptance-ui-completion-notes.md`](./1-9c-invite-acceptance-ui-completion-notes.md) per `docs/bmad-story-conventions.md`. CI matrix green: lint / lint:css / tsc -b / vitest 500/500 / playwright route-bundle-boundaries 6/6 / npm run build / npm run build:check (3 auth chunks under 8 KB ceiling — 1704 / 1979 / 3094 bytes gzipped) / npm run storybook:build. Pragmatic deviations flagged: (a) `useInviteSchema` uses `.regex(/\S/)` not `.refine` (same coverage, no ZodEffects wrapping that bit zodResolver); (b) `scripts/check-chunk-size.mjs` created fresh (the 1-9b reference in the spec was aspirational — script wasn't actually shipped); (c) `build:check` not yet wired into CI workflow (1-line add for a future CI-touching PR). 7 ★ REVIEWER-MANDATORY vi keys flagged in PR description for VN-fluent sign-off. Ready for `code-review` on a fresh-context, different-LLM model. |
| 2026-06-26 | **Party-mode review amendments folded** (Sally / Winston / Amelia / Murat, each spawned as an independent subagent; John ruled the calls). 9 ACCEPTS landed, 5 DEFER-with-named-owner filings, 0 REJECTS. **AC3**: i18n key count 27→29 — added `auth.invite.titleWithCenter` (Sally `?c=` ribbon) + `auth.invite.emailFormExpandedAnnouncement` (Sally a11y); rewrote 2 vi seed copy: `auth.invite.title` active voice "Bạn được mời tham gia" (was passive "Bạn đã được mời"), `auth.login.banner.invited` "Chào mừng bạn đến với trung tâm" (was the awkward em-dash + passive "Chào mừng — bạn đã tham gia trung tâm"); ★ count bumped 5→7. **AC4**: added the sanitized `?c=centerName` ribbon reading + `sanitizeCenterName` helper contract + CollapsibleEmailForm a11y focus/aria-live pin + token-change-resets-errorState `useEffect` (Murat ATDD specimen, pin pre-dev not at code review like 1-9b did). **AC5**: added check-circle SVG to `invite-already-accepted` (Sally visual differentiation of good-outcome vs dead-link); **dropped** `429 with Retry-After=0 clamps to MIN_RATE_LIMIT_SECONDS=5` page test (Amelia — belongs on `useResendCountdown.test.ts`); **added** privacy-ratchet "footer Sign-in link from terminal state does NOT land on /login?invited=true" across 7 regions (Amelia); **added** email-leak rejection ratchet ATDD specimen for 409 INVITE_EMAIL_MISMATCH — DOM-wide negative against `details.invitedEmail` + `details.oauthEmail` (Murat STRONG, mirrors 1-9b precedent). **AC4 test list**: **dropped** "Google CTA does NOT navigate via React Router" (Amelia — covered by `GoogleOAuthButton.test.tsx` from 1-8); **tightened** "Google CTA carries inviteToken" to assert (a) token non-empty AND (b) rendered `<a href>` not RR `<Link>` (Murat vacuous-pass guard); **added** companion "Google CTA NOT rendered when token empty/whitespace" + the trio of `?c=` ribbon happy/fallback/sanitization-reject tests + the focus + aria-live a11y tests. **AC6**: added Winston's `invited > oauth-error` priority-escalation test (`?invited=true&error=invite_email_mismatch` → invited wins + oauth-error param wiped post-URL-clear); added Murat's BLOCKER `routes.test.tsx` index-loader query-forward test at `/?invited=true` → `/login?invited=true` (NEW file, separate from `LoginPage.test.tsx` since the loader is owned by routes.tsx not LoginPage). **AC7**: story count 14→16 — added `DefaultWithCenterRibbon` + `LocaleViWithCenterRibbon` (Sally `?c=` happy-path en + vi) + `Mobile390EmailFormOpen` (Sally — happy-path mobile fold was unverified; wireframe only covered the easier Expired state). **Dev Notes** new sections: Architectural Debt Acknowledged (Winston — LoginPage banner is transitional; Story 2-1 moves toast to dashboard; stale sibling-tab on `?invited=true` relies on next silent-refresh tick), 1-9d BannerKey gate (Winston — 5th variant forces `<Banner variant>` discriminated-union refactor pre-merge). **Task 8.5**: chunk-size CI script path documented at `classlite-web/scripts/check-chunk-size.mjs` (Winston enforcement-seam catch). **Out-of-Scope filed follow-ups (NOT 1-9c work)**: (1) codegen-drift CI gate → DevOps/Winston, P2, 2 sprints; (2) `traceability-matrix-epic-1c.md` → Murat, pre-1-9d-merge; (3) `nfr-assessment-epic-1c.md` → Murat, pre-1-9d-merge; (4) Story 2-1 `?invited=true` toast move to dashboard; (5) 1-9d `<Banner variant>` refactor mandate. **DEFAULTS confirmed by Ducdo**: invite token alphabet base64url (no `+`/`/` URL-encoding tests needed); Murat owns `traceability-matrix-epic-1c.md` + `nfr-assessment-epic-1c.md` pre-1-9d-merge; codegen-drift CI ticket P2/2 sprints/DevOps owner. **Net file delta**: +~135 lines (3 new test ATDD specimens + 5 new test contracts + 2 new i18n keys + 3 new task subtasks + 2 new Storybook entries + Architectural Debt section + Filed Follow-ups bullets + amended reframe + Sanitization helper task) − ~10 lines (2 dropped page tests). Total: ~682 lines. **EXCEEDS the 600-line bmad-story-conventions.md ceiling by ~13%** — flagged for code-review reviewer attention; the addition density is load-bearing per party-mode rulings (ATDD specimens / a11y contracts / architectural debt acknowledgment are NOT prunable), and the deferred sibling completion-notes file at first dev pickup will move the implementation transcript out. If the count is contested at code review, the candidates for cut are the verbose Filed Follow-ups bullets (move to a separate doc) or the Architectural Debt section (move to project-context). Hand-off to Amelia (dev) for `/bmad-dev-story 1-9c`. |
| 2026-06-26 | Story scaffolded backlog → ready-for-dev. John's pre-dev context engine pass against baseline `3824af5` (1-9b done). 8 ACs map to UX-DR5/DR7/DR10/DR15/DR16/DR17 with **three backend-reality reframes** pinned inline against the Epic 1C wireframe-driven AC: (1) no `GET /api/auth/invites/{token}/preview` endpoint exists — InviteCard center-logo + inviter-heading + role-badge surface deferred (Epic AC amendment filed); (2) the new-user / existing-user / existing-not-logged-in / already-accepted branch distinction at mount time requires the preview endpoint — single unified form covers all branches via backend-side branch inference; (3) the email field is omitted entirely (not "hidden + locked") — backend authoritatively uses `invite.email` from the token row, anti-enumeration blocks pre-acceptance echo. Risk score ≥6 check: NONE owned (R6 owned by Story 1-6, R38 inherits from 1-7c). WF-8 ATDD not required. R38 discharged via `STORY_1_9C_KEYS` block (27 new keys) in `i18n-parity-coverage.test.ts`. Inheritance from 1-8/1-9a/1-9b: reuses AuthLayout / AuthCard / CollapsibleEmailForm / PasswordInput / GoogleOAuthButton (its pre-staged `searchParams` prop) / useResendCountdown verbatim; extends `authKeys` with `acceptInviteMutation` per the 1-9b mutation-key split; consumes the regenerated openapi types from a pre-flight `scripts/codegen.sh` re-run (1-6 endpoints + schemas were missing from `client.ts` — Task 0 fixes the 3-story-old drift); adds the first NEW default MSW handler since 1-9b (the catalog explicitly lists 1-9c as a target story but no `POST /api/auth/accept-invite` section exists yet). LoginPage extension extends `BannerKey` with `'invited'` (priority `invited > reset > verified > oauth-error`) + extends the URL-clear effect to drop `?invited=true` (one-line additive). Index-loader at `routes.tsx:67-70` amended to forward `url.search` so Story 1-6's `/?invited=true` redirect survives the bounce to `/login?invited=true`. Pragmatic-scope deviations acknowledged: (a) Epic AC's InviteCard center-foregrounding theater rejected pending the preview endpoint (Epic 7 owner); (b) `useParams` path-param routing chosen over `?token=` query-param to match Epic AC line 330 + AUTH-05 wireframe; (c) form omits the email field entirely (backend uses `invite.email` from token row). Out-of-scope deferrals each owned by a specific later story: polished error screens → 1-9d; expired-state contact-inviter polished screen → 1-9d; already-accepted page-mount auto-redirect → Epic 7 (needs preview endpoint); 1-click "Join as [role]" flow for existing-user-logged-in → Epic 7; namespace-coverage i18n-parity extension → 1-9d. Sibling completion-notes file deferred to first dev pickup per `docs/bmad-story-conventions.md`. Hand-off to Amelia (dev) for `/bmad-dev-story 1-9c`. |
