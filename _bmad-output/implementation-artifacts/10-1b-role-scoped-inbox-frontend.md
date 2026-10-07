# Story 10.1b: Role-Scoped Inbox — Frontend

Status: done

<!-- Validation optional. Run validate-create-story before dev-story if desired. -->

---
baseline_commit: f850adc
epic: 10
story: 10.1b
fr: FR-56, FR-57, FR-58, FR-59 (frontend slice; backend substrate shipped in 10-1a)
size: L
audience: full-stack (FE-heavy — one thin net-new BE route)
depends_on: [10-1a inbox+notifications backend (done, f850adc), 1d-4 inbox chrome (InboxListShell/InboxRow/badge slots, done), 7.4a/7.4b Q&A reply (done), 8-1b role-dispatcher pattern (done)]
split_from: 10-1
sibling: 10-1c-teacher-work-queue (backlog — RELEASE-COUPLED: the inbox feature does not ship until BOTH 10-1b and 10-1c are done)
wf8_hard_gate: lightweight-red-first   # Backend ≥6 (R1/R3/R15) owned+gated in 10-1a, cannot reopen. BUT 10-1b MAPS to two FE-side ≥6 (cross-role mis-render via mapper/chip-config drift; R38 i18n-parity via ~8 new key families + relativeTime). Full ceremony waived; coverage NOT — mapper-golden + role-negative chip-derivation (AC8) + STORY_10_1B_KEYS parity array (AC10) ship RED-FIRST per ATDD convention, then green. Confirm at /bmad-tea AT.
ducdo_rulings: "DR1 EXPAND actions — bounded to Mark-all-read (thin BE route) + Teacher reply (reuses existing POST /api/questions/{id}/replies — FE-only); Snooze/calendar/approve-enrollment/AI-suggest/rules DEFERRED to FUs; all pure-navigation actions ship free via the row `link`. DR2 10-1b OWNS a functional inbox Loading/Empty/Error trilogy (role-toned s56 empty); 10-3/10-4 polish later. DR3 mobile = responsive + tap buttons; swipe-to-act → FU-10-1-SWIPE."
---

## Story

As **a teacher / admin / owner / student**,
I want **a role-scoped `/inbox` screen that renders my notification rows with the right actions, plus an unread badge on my Inbox nav item**,
so that **I see only the signals relevant to my role, can act on them (open, archive, mark read, and — as a teacher — reply to questions), and know at a glance when something new has arrived.**

This is the **frontend** half of Story 10.1, consuming the **frozen 10-1a backend contract** (`done`). The data layer, RLS, event fan-out, and role-scope-at-write invariant are all shipped and MUST NOT be reopened. 10-1b wires the already-built inbox **chrome** (Story 1d-4 — `InboxListShell`, `InboxRow`, sidebar/mobile badge slots, `inboxRow.*`/`inboxList.*` i18n keys) to the generated client, adds one thin `POST /api/inbox/read-all` route, and reuses the existing Q&A reply mutation for the teacher's reply action.

---

## Context & Reuse Map (READ FIRST — the inbox is heavily pre-scaffolded)

Story 1d-4 already shipped the inbox **presentational chrome** (behavior-less) and all its i18n keys; 10-1a shipped the **backend**. 10-1b is predominantly *wiring*. Do NOT rebuild any of the below.

### Already shipped — REUSE, do not rebuild

| Capability | Where it lives | Note |
|---|---|---|
| **Inbox list chrome** | `classlite-web/src/components/domain/InboxListShell.tsx` — props `{rows, role, filters: InboxFilterChip[], activeFilters, onToggleFilter, onRowPrimaryAction, onRowArchive}`; renders filter-chip bar (`:67-99`), row list, empty slot `inboxList.empty` (`:117-125`); testids `inbox-list-shell`, `inbox-list-shell-filter-{key}`, `inbox-list-shell-empty` | Chrome only — no data, no state. The role views feed it mapped rows + chip config. Composer is NOT in the shell (see DD5). |
| **Inbox row chrome** | `classlite-web/src/components/domain/InboxRow.tsx` — `InboxRowData {id, type: InboxRowType, mainTextKey, mainTextVars, metaKey, metaVars, occurredAt (ISO), occurredAtLabel?, unread?}`; per-type icon/tone/action maps (`:71-111`); renders `<time dateTime={occurredAt}>` (`:161-163`) + primary/archive buttons | **`InboxRowType` is the 1d-4 DISPLAY taxonomy (`question\|submission\|mention\|reply\|grade\|assignment\|schedule\|enrolment\|staff\|billing\|integration`), NOT the backend `NotificationType` (7-enum). A mapping layer is REQUIRED (DD2).** Row renders via i18n keys + vars (NOT the server's EN title/body — DD3). |
| **Sidebar badge slot** | `src/components/domain/SidebarNavItem.tsx:43-46,66-96` (`badgeCount?: number` → renders `Badge` when `>0`, aria `sidebar.nav.unreadAria`); threaded through `SidebarShell.tsx:28-29,105` | **UNWIRED** — `AppLayout.tsx:137-149` passes static `SIDEBAR_NAV_BY_ROLE[role]` with no `badgeCount`. Wiring = feed the count onto the `/inbox` item. |
| **Mobile tab badge slot** | `src/components/domain/MobileTabBar.tsx:75-79,193` (`unreadByTab?: Partial<Record<string, boolean\|number>>` keyed by tab slug + DEV typo-guard); `MobileTab.tsx:17-20,36-55` (capped `"9+"` via `clampUnreadCount`, aria `mobileTab.unreadAria`) | **UNWIRED** — `AppLayout.tsx:167` calls `<MobileTabBar role activeHref />` with no `unreadByTab`. |
| **Role-dispatcher pattern** | `src/features/dashboard/DashboardRoute.tsx` — `lazy()` per-role components (`:24-34`, Rolldown per-role chunk), `if (roleLoading) return <DashboardChecking/>` (`:56`), settled-null → `<Navigate to="/login"/>` (`:60-62`), single `Suspense` + role branch (`:64-73`). Dir: `DashboardRoute.tsx` + `OwnerDashboard/TeacherDashboard/StudentDashboard.tsx` + `components/` + `api/` + `__tests__/` | **The exact template for `src/features/inbox/`.** Inbox route has NO `RouteRoleGate` (every role has an inbox — matches 10-1a DD5 "open chain"). |
| **`useRole()` / `useRoleLoading()`** | `src/hooks/useRole.ts:98-107,128-140` — `Role\|null`, `useSyncExternalStore` on the module `queryClient`; `Role = 'owner'\|'admin'\|'teacher'\|'student'` | Never inline `if role===` in JSX (UX-3). Branch once in the dispatcher. |
| **Envelope-aware fetch** | `src/lib/api-fetch.ts` — `apiFetch<T>` unwraps `{data}` (`:166-206`); **`apiFetchWithMeta<T,M>`** keeps `{data, meta}` (`:214-264`) | Use `apiFetchWithMeta` for `GET /api/inbox` (read `meta.pagination`); `apiFetch` for `/count` and the mutations. Raw `fetch`/`axios` = ESLint hard error. |
| **Optimistic-triple exemplar** | `src/features/settings/api/useRooms.ts:35-72` — `onMutate` cancel+snapshot, `onError` rollback, `onSettled` invalidate; typed `useMutation<Result,Error,Input,Ctx>` | Template for mark-read / archive / mark-all-read (optimistically flip `readAt` / drop the row + decrement the `count` query key). |
| **`refetchInterval`-function poller** | `src/features/grading/hooks/useAiGradeJob.ts:260-271` — `staleTime:0`, `refetchInterval: (q) => ms\|false`, `refetchIntervalInBackground`, hidden-tab multiplier | **The badge-count poller pattern.** Keeps the count in the Query cache so the badge reads from cache (FW-4: server state stays in Query — do NOT use `usePolling` for the count, that bypasses the cache). |
| **Teacher reply mutation** | `src/features/questions/` barrel (`index.ts`) exports **`useReplyToQuestion()`** (`api/useQuestionActions.ts:40-58`) — `useMutation<QuestionReply, ApiError, {questionId: string; body: ReplyRequest}>` → existing `POST /api/questions/{id}/replies` | **Teacher reply is pure FE reuse** (TS-7: import from `@/features/questions`, never deep). The endpoint is teacher-of-class-only — aligns with who gets `question_asked`. |
| **Trilogy exemplar** | `src/features/dashboard/components/DashboardStates.tsx` — `DashboardSkeleton` (row-shaped `animate-pulse`, testid, `aria-busy`, never a spinner) + `DashboardErrorAlert` (inline `role="alert"` + single `onRetry`, i18n keys, never full-page) | Build `src/features/inbox/components/InboxStates.tsx` the same way. Base primitive: `src/components/ui/skeleton.tsx`. |
| **i18n keys (already ship, both locales + ratchet)** | `src/locales/en.json` + `vi.json`: `inboxRow.*` (`en:774-797` — actions `reply/grade/view/open/review/archive`, per-type `.main` templates w/ `{{student}}/{{exercise}}/{{band}}/{{title}}`, `.meta.classTime/.time`), `inboxList.*` (`en:798-813` — `regionLabel`, `filters.label`, `empty`, filter labels), `sidebar.nav.unreadAria`, `mobileTab.unreadAria` | Parity-enforced via `src/lib/test/__tests__/i18n-parity-coverage.test.ts`. **NEW keys (page title, mark-all CTA, relative-time, error copy, role-toned empty, reply composer) go in BOTH locales AND a new `STORY_10_1B_KEYS` array wired into the ratchet** (pattern: `src/features/search/__tests__/searchI18nKeys.ts`). |
| **VN date formatter** | `src/lib/i18n.ts` registers `{{val, vnDate}}`→`formatVnDate` (`dd/MM/yyyy`) + `{{val, vnDateLong}}` | Reuse for absolute timestamps. Relative-time ("2h ago") does NOT exist — net-new (DD4). |
| **Query defaults** | `src/lib/query-client.ts` — `DEFAULT_STALE_TIME_MS = 30_000`; mutations `retry:false`; global 401 handling | — |

### Net-new — THIS story builds

- **BE (the ONLY backend work):** `POST /api/inbox/read-all` — a handler method `InboxHandler.MarkAllRead` calling the **existing** `NotificationService.MarkAllRead(ctx, tc)` (`notification_service.go:681`) over the **existing** `MarkAllReadForUser` sqlc query; register on the open `questionChain`; add the api.yaml path (reuse a small ack envelope) + run `codegen.sh`. **No migration, no new sqlc, no service change** (DD6).
- **FE feature slice** `src/features/inbox/`: `InboxRoute.tsx` (role dispatcher, no gate), `{Owner,Admin,Teacher,Student}Inbox.tsx` views, `api/inboxKeys.ts`, `api/useInbox.ts` (paginated list), `api/useInboxCount.ts` (poller), `api/useInboxActions.ts` (mark-read / archive / mark-all-read, optimistic), `components/InboxStates.tsx`, `lib/notificationMapping.ts` (type→display + metadata→vars + link→nav), `lib/relativeTime.ts`, `__tests__/inboxI18nKeys.ts`.
- **Route:** `/inbox` child under the `AppLayout` group in `routes.tsx` (lazy, no `RouteRoleGate`).
- **Badge wiring:** feed the count query onto the sidebar `/inbox` `badgeCount` + `MobileTabBar unreadByTab` in `AppLayout.tsx`.
- **Relative-time formatter** registered on i18n (`{{val, relativeTime}}` wrapping `Intl.RelativeTimeFormat` for `en`/`vi`).
- **Teacher inline reply composer** at the feature layer (intercepts the `question` row primary action), reusing `useReplyToQuestion`.

---

## The Frozen 10-1a Contract (consume verbatim — do NOT change)

Generated into `classlite-web/src/lib/api/client.ts` at `f850adc`. `components['schemas'][…]`:

- **`NotificationType`** = `"grade_released" | "assignment_created" | "enrollment_changed" | "question_asked" | "schedule_changed" | "payment_failed" | "storage_threshold"`.
- **`Notification`** = `{ id (uuid), type: NotificationType, title: string, body: string, link: string, metadata: NotificationMetadata, readAt: string|null, archivedAt: string|null, createdAt: string }`.
- **`NotificationMetadata`** = typed superset: `schemaVersion: number` (always) + nullable `actorId, submissionId, assignmentId, assignmentTitle, className, dueAt, questionId, studentId, studentName, sessionId, action, fromClassId, toClassId, enrollmentId, usedBytes (int64), limitBytes (int64)`.
- **`EnvelopeNotificationList`** = `{ data: Notification[], meta: { serverTime, pagination: {page,pageSize,total,totalPages} } }`.
- **`EnvelopeUnreadCount`** → after unwrap: `{ unread: number }`.
- **`EnvelopeNotificationAck`** → after unwrap: `{ id, status }`.

Endpoints: `listInbox` `GET /api/inbox?type&unread_only&page&page_size` (**snake_case query keys**); `getInboxUnreadCount` `GET /api/inbox/count`; `markNotificationRead` `POST /api/inbox/{id}/read` (idempotent 200; foreign id → **404 `NOTIFICATION_NOT_FOUND`**); `archiveNotification` `POST /api/inbox/{id}/archive` (same 404). Reply endpoint (existing): `replyToQuestion` `POST /api/questions/{id}/replies` (body `ReplyRequest {content, visibility, resolve}`; teacher-of-class only → 403/404 otherwise).

### Who receives what (role-scope is WRITE-time — the read API just returns "my rows")

| `NotificationType` | Recipient role(s) (10-1a DD3) | Display (`InboxRowType`) | Nav `link` (stored) |
|---|---|---|---|
| `grade_released` | **student** | `grade` | `/...` (grading/result) |
| `assignment_created` | **student** (active enrolled) | `assignment` | assignment deep-link |
| `schedule_changed` | **student** (active enrolled) | `schedule` | schedule deep-link |
| `question_asked` | **teacher** | `question` | Q&A thread |
| `enrollment_changed` | **admin + owner** | `enrolment` | enrollment/people |
| `payment_failed` | **owner only** | `billing` | billing settings |
| `storage_threshold` | **owner only** | `integration` (system-alert lane) | `/settings/storage` |

⇒ v1 per-role row types: **student** = grade/assignment/schedule · **teacher** = question (only — 10-1c fills the grading queue) · **admin** = enrolment · **owner** = enrolment/billing/integration. The FE never re-filters by role (the server already scoped at write); it only maps + renders what arrives.

---

## Design Decisions (engineering calls — override at dev pickup only with written reason)

- **DD1 — One route, four lazy role views (the dashboard pattern).** `/inbox` → `InboxRoute.tsx` dispatcher (no `RouteRoleGate`): `roleLoading` → checking card; settled-null → `<Navigate to="/login"/>`; else `lazy()`-mount one of `OwnerInbox/AdminInbox/TeacherInbox/StudentInbox` (Rolldown per-role chunk — a student never ships owner billing code). Each view owns its **chip config** + any role-specific action (teacher: reply composer) and feeds mapped rows into the shared `InboxListShell`. Shared data hooks live in `api/`.
- **DD2 — The `NotificationType → InboxRowType` + metadata→vars mapping layer (`lib/notificationMapping.ts`) = an anti-corruption seam.** A pure function `toInboxRow(n: Notification): InboxRowData` that: (a) maps `type`→`InboxRowType` per the table above (`storage_threshold`→`integration` is the system-alert lane — a reasonable v1 default but a semantic collision with the Google-reauth lane; leave a code-level `TODO(10-1b): dedicated storage glyph`, not just a story note); (b) selects the right `inboxRow.*` `mainTextKey`/`metaKey` and builds `mainTextVars`/`metaVars` from `metadata` (e.g. `grade_released` → `{student: metadata.studentName, title: metadata.assignmentTitle}`); (c) sets `occurredAt = n.createdAt`, `occurredAtLabel` = relativeTime(createdAt); (d) `unread = n.readAt == null`. **The `type`→display switch MUST be compile-time exhaustive — a `never`-typed default arm (`assertNever`) — so a revived/added `NotificationType` (10-1c submission, `FU-10-1-MENTIONS`) fails `tsc -b` instead of silently falling through to a fallback row. This is the real anti-drift lever, not test coverage (Winston).** Unit-test the mapper per the golden matrix in DD3/AC3 (not one-per-type).
- **DD3 — Render via i18n keys, NOT the server's EN `title`/`body` (UX-2 VN co-primary is a HARD rule).** The server `title`/`body` are an EN snapshot for the email channel + a degraded fallback only (10-1a DD1). The inbox renders from `type` + `metadata` through the bilingual `inboxRow.*` catalog. **Graceful degradation (FU-10-1-METADATA-ENRICH):** fields the ruled event payloads don't carry are `null` today — `grade_released.bandPreview`, `schedule_changed.oldTime/newTime/changeKind`, `question_asked.questionPreview`, and class **names** for `schedule_changed`/`enrollment_changed` (ids only). The mapper MUST handle null vars (omit the band clause, render the generic "A session was changed" variant, reference the class by a neutral label when the name is null) — never render `undefined`/empty interpolation (assert on rendered VALUES, not keys — the GO-5 wire sends explicit `null`). `schedule_changed` carries NO `action` today (10-1a defer), so the mapper renders ONE generic variant for reschedule/cancel/delete alike — do not assert a kind-specific string the payload cannot produce. Where metadata is too thin for ANY i18n template, fall back to the server `body` — but **flag that branch so it is greppable, never silent** (it is the ONE path rendering the EN snapshot into a VN UI — a conscious i18n-model escape hatch; P0-tested in both locales). **Mapper note:** treat every metadata field as runtime-nullable regardless of DD1b "required" wording until `FU-10-1-METADATA-ENRICH` lands — TS only forces the null-check while the generated type stays nullable (Winston). Do NOT block on the enrichment FU.
- **DD4 — Badge count = TanStack Query `refetchInterval`, configurable const (FR-59, architecture.md:247).** `useInboxCount()` = `useQuery({ queryKey: inboxKeys.count(), queryFn: () => apiFetch<{unread:number}>('/api/inbox/count'), refetchInterval: INBOX_POLL_INTERVAL_MS, refetchIntervalInBackground: false, staleTime: 0 })`. `INBOX_POLL_INTERVAL_MS` is a **named constant (default 45_000, in the 30–60s band) — NOT hardcoded inline** (CQ-3; AC explicitly requires configurable). The badge reads the count from the Query cache; mark-read/archive/mark-all optimistically decrement it (DD5) so the badge drops instantly without waiting for the next poll. Relative-time "2h ago" — new `{{val, relativeTime}}` i18n formatter wrapping `Intl.RelativeTimeFormat('en'|'vi')`, registered beside `vnDate` in `src/lib/i18n.ts` (keeps the TS-6 ISO-until-formatter rule); `lib/relativeTime.ts` holds the threshold logic (just-now / Nm / Nh / Nd / falls back to `vnDate` past ~7 days).
- **DD5 — Mutations: optimistic triple on BOTH the list AND the count keys.** `useInboxActions` exposes `markRead(id)`, `archive(id)`, `markAllRead()`. Each uses the `useRooms` triple: `onMutate` cancels + snapshots the **list** page(s) and the **count**, optimistically applies (mark-read → set that row's `readAt`, decrement count; archive → drop the row from the active page, decrement count if it was unread; mark-all → set every row `readAt`, count→0), `onError` rolls both back, `onSettled` invalidates both `inboxKeys.list*` and `inboxKeys.count()`. A foreign/absent id → 404 surfaces as a rolled-back no-op (non-disclosure; don't special-case). Mark-read is idempotent server-side (200), so a double-fire is safe. **Harder than the single-key `useRooms` exemplar — pin these (Winston/Murat):** (1) `onMutate` snapshots BOTH keys into `ctx` (`{prevList, prevCount}`) and `onError` restores both — a partial snapshot leaves the badge diverged from the list after a failure. (2) the optimistic count is floored at `max(0, n-1)` — it must NEVER render negative (archiving the last unread row + a racing poll is the classic underflow). (3) guard the decrement on the row's current `readAt` so a rapid double mark-read nets ONE decrement, not two. (4) **archive shows an undo toast** ("Archived · Undo") — the drop is already optimistic-with-rollback, so undo is that rollback user-triggered; there is no archived-items view in v1, so without undo an accidental archive is silent data-loss (§6.4 recovery ethos). **Accepted-cosmetic for v1 (document, do NOT fix):** the 45s poll can briefly clobber the optimistic count (an in-flight poll returns the pre-mutation value → badge blinks → `onSettled` invalidation is the authority and re-settles within the window); and paginated rollback is partial (archiving a page-1 row can't pull page-2's first row up → stale `total` until `onSettled` refetches). Do NOT client-recompute the count to paper over either.
- **DD6 — Mark-all-read is the only net-new backend (thin, atomic WF-4).** Add `InboxHandler.MarkAllRead(w,r)` → `svc.MarkAllRead(ctx, tc)` (exists) → `WriteEnvelope{status:"ok"}`; register `POST /api/inbox/read-all` on `questionChain` (open — every role); api.yaml path returns a **NET-NEW `EnvelopeStatusAck`** (`{data:{status:string}}`, NO `id` — `EnvelopeNotificationAck` carries a single-row `id` and does NOT fit; do not pretend this is a reuse — Winston). `MarkAllReadForUser` already stamps only `read_at IS NULL AND archived_at IS NULL` rows for the caller (the 10-1a BH7 code-review patch) — inherits 10-1a RLS, caller-scoped. **api.yaml + regenerated `client.ts` ship in ONE commit with the FE (WF-4).**
- **DD7 — Actions scope (DR1, bounded).** Row/topbar actions in v1: **Open** (navigate via `n.link`), **Archive**, **mark-read = read-on-view** (visiting `/inbox` marks the rows on the rendered page read after a short debounce — these are glanceable rows, not emails you "open"; a mark-read trigger left undefined would nag the badge forever on mobile where you read in place — Sally), **Mark all read** (topbar, the "don't even scroll" shortcut), and **Teacher Reply** (question rows → inline composer reusing `useReplyToQuestion`). **The composer MUST expose the `visibility` toggle** ("Shared with your class" vs private) — the frozen `ReplyRequest` carries `{content, visibility, resolve}` and visibility is student-visible; hardcoding it is a privacy regression vs the full Q&A surface that uses the same endpoint (Sally). `resolve` defaults off. The teacher reply posts an answer; it does **not** create a student-facing "teacher replied" notification (no `question.answered` event exists) — so after replying, optimistically mark the question row read and let the composer collapse; do not expect a new inbox row. **RULED OD1 (Ducdo):** the one-directional inbox loop is accepted for v1; the student instead sees an **"answered" state on their own "My questions" surface (s36/s29)** so the reply isn't a black hole — that is `FU-10-1-QA-ANSWERED`, lives OUTSIDE 10-1b (on the Q&A student surface, no inbox badge). The full question.answered → inbox-row path stays `FU-10-1-QA-REPLY`. **Deferred to FUs:** Snooze (`FU-10-1-SNOOZE` — needs the `snoozed_until` column 10-1a deliberately did not add), Add-to-calendar (`FU-10-1-CALENDAR` — blocked on schedule `newTime` enrichment), approve/decline enrollment (`FU-10-1-ENROLL-ACTION`), ✦AI-suggest reply (`FU-10-1-AI-REPLY`), notification rules (`FU-10-1-RULES`). All pure-nav actions (Grade→grading, Open assignment, View thread, Upgrade→billing, Re-auth Google) ride `n.link` for free.
- **DD8 — Filter chips derive from the role's AVAILABLE v1 types (no permanently-empty chips).** Chips = `All` + `Unread` + one chip per `NotificationType` the role actually receives. Each type chip sets the server `type` param; `Unread` sets `unread_only=true` — **server-side filtering keeps pagination honest** (do NOT client-filter a page — it corrupts `total`/counts). Grouped UX chips ("Class" = assignment ∪ schedule) are deferred — single-type chips in v1. Per role: student `All/Unread/Grades/Assignments/Schedule`; teacher `All/Unread/Questions` (10-1c adds Submissions/Late); admin `All/Unread/People`; owner `All/Unread/People/Billing/Alerts`.
- **DD9 — Trilogy owned here (DR2).** `InboxStates.tsx`: list-shaped skeleton rows (never a spinner, `aria-busy`), inline `role="alert"` error with a single retry re-issuing the list query (never full-page). Empty: feed role-toned copy into the shell's empty slot per s56 — student "Nothing new yet" (encouragement), teacher "When students start working… things land here" (activation), owner/admin "All caught up · the center is humming along" (reassurance). Each empty follows the §6.4 canon — a ghosted circular icon echoing the Inbox nav glyph + a Fraunces headline with exactly ONE italic-accent word (e.g. "Nothing *new yet*", the `<em>` is the brand signature) + the muted one-liner — NOT centered gray text (that is the generic "No data" AC2 forbids, and the empty inbox is a new student's day-one first impression — Sally). Both are cheap (one styled `<em>`, one echoed nav glyph). New i18n keys for the three role variants. **Suppress the "N unread · M total" header when `total === 0`** (no "0 unread · 0 total" gravestone over an encouraging empty).
- **DD10 — Mobile (DR3).** Responsive layout (flat chronological rows, date dividers, **horizontally-scrolling** filter chips, ≥44px touch targets / 48px buttons, ≥16px inputs), detail via **full-screen push not modal**. Row actions are visible **tap buttons** (same Open/Archive/Reply). True swipe-to-act (s75/s84) → `FU-10-1-SWIPE`. Reuse Tailwind responsive prefixes (UX-4) — no magic pixels.

---

## Acceptance Criteria (BDD)

**AC1 — `/inbox` route + role dispatch (no gate)**
**Given** an authenticated user of any role navigates to `/inbox`,
**When** the route resolves,
**Then** `InboxRoute` shows the role-checking card while `useRoleLoading()`, then lazy-mounts exactly the caller's role view (`Owner/Admin/Teacher/StudentInbox`), a settled-null role redirects to `/login`, and no `RouteRoleGate` is applied (every role has an inbox),
**And** the student view code is a separate Rolldown chunk from the owner view.

**AC2 — list render over the frozen contract (three-state, TEST-FE-2)**
**Given** `GET /api/inbox` (MSW at the HTTP boundary — never mock Query),
**When** the inbox renders,
**Then** loading shows list-shaped skeleton rows (`aria-busy`, no spinner), success renders rows newest-first via `InboxListShell`/`InboxRow` with unread rows highlighted and the page header "N unread · M total", and a network failure renders an inline `role="alert"` with a working retry (no full-page error),
**And** an empty active queue renders the role-toned empty state (DD9 — ghosted nav-glyph icon + Fraunces headline with one italic-accent word + muted line, the header count suppressed at `total===0`), not a generic "No data".

**AC3 — type→display mapping + i18n render (DD2/DD3, VN co-primary)**
**Given** one `Notification` of each of the 7 types,
**When** `toInboxRow` maps it,
**Then** each maps to the correct `InboxRowType`, selects the right `inboxRow.*` key, builds vars from `metadata`, and renders through i18n in BOTH `en` and `vi` (assert key resolution, never hardcoded English — TEST-FE-4),
**And** a row whose metadata lacks an optional field (e.g. `grade_released` with `bandPreview=null`, `schedule_changed` with null times/class-name) renders a graceful variant with NO empty/`undefined` interpolation,
**And** the golden covers the **per-field null matrix** (each optional field independently null, not just per-type), the ALL-thin case falls back to the server `body` **and that fallback is explicitly flagged/greppable (P0)**, and BOTH `en` and `vi` resolve for the degraded variants.

**AC4 — unread badge wiring + polling (FR-59, DD4)**
**Given** `GET /api/inbox/count` returns `{unread:K}`,
**When** the shell mounts,
**Then** the sidebar `/inbox` `SidebarNavItem` shows `badgeCount=K` (hidden when 0) and the mobile Inbox tab shows the capped badge, both reading from the Query cache,
**And** the count query refetches on `INBOX_POLL_INTERVAL_MS` (a named const in 30–60s, not an inline literal — assert the value is referenced, not magic),
**And** a `0` count renders no badge (negative assertion),
**And** the poller does NOT fire when the tab is hidden (`refetchIntervalInBackground:false`), is a SINGLE query instance across all consumers (badge reads from cache — FW-4, not one fetch per role view + AppLayout), and is DISABLED for a null/guest role (no `/count` 401-storm on a logged-out shell).

**AC5 — mark-read / archive optimistic (DD5, FW-2 triple)**
**Given** a rendered inbox with unread rows,
**When** the user marks a row read / archives a row,
**Then** the row's unread highlight clears / the row leaves the active list immediately (optimistic), the unread badge decrements without waiting for the poll, a server error rolls BOTH the list and the count back, and `onSettled` invalidates both keys,
**And** marking an already-read row is a safe no-op (idempotent 200),
**And** the optimistic count is floored at `max(0,…)` (never renders negative), a failure rolls back BOTH list and count from a two-key `ctx` snapshot, archive surfaces an **undo** affordance ("Archived · Undo"), and visiting `/inbox` marks the rendered page read-on-view (debounced).

**AC6 — mark-all-read (DD6 — the one net-new route, full-stack)**
**Given** the topbar "Mark all read" control,
**When** it is activated,
**Then** `POST /api/inbox/read-all` is called, every active row optimistically clears unread and the badge drops to 0, an error rolls back,
**And** the api.yaml path + regenerated `client.ts` are present and `tsc -b` passes, no generated file hand-edited (XL-1),
**And** a handler test exercises the route through the real middleware chain returning the `{data:{status}}` envelope (TEST-BE-3), caller-scoped,
**And** that test proves (i) an **archived-but-unread** row keeps `read_at = null` after read-all (the 10-1a BH7 `archived_at IS NULL` regression guard — a revert must fail here), and (ii) a **different-tenant** caller's rows are untouched (RLS inheritance, not merely the `user_id` predicate — this verb was never in 10-1a's AC2 grid, so its cross-tenant 0-row behavior needs its own assertion).

**AC7 — teacher reply (DD7 — reuse existing endpoint, FE-only)**
**Given** a teacher inbox with a `question_asked` row,
**When** the teacher opens the inline reply composer and sends,
**Then** `useReplyToQuestion` posts to the existing `POST /api/questions/{id}/replies` with `metadata.questionId`, the composer validates non-empty content (RHF + zod, FW-8), **exposes the `visibility` toggle (shared/private) — not hardcoded, because it is student-visible and the frozen `ReplyRequest` carries it**, on success collapses and the question row is optimistically marked read,
**And** no new inbox row is expected (no `question.answered` event — documented),
**And** the inbox test suite registers the `POST /api/questions/{id}/replies` MSW handler (cross-feature reuse — easy to omit),
**And** the composer, visibility toggle, and send button are reachable by i18n-resolved labels (TEST-FE-5).

**AC8 — role lanes correct & no cross-role mis-render (FE-OWNED risk-6; TEST-FE-6, UX-3)**
_A happy-path "admin fixture has no billing row → assert none renders" is VACUOUS — it tests the MSW fixture, not the code (Murat). This AC must bite adversarially:_
**Given** the mapper + per-role chip derivation,
**When** exercised adversarially,
**Then** (a) `toInboxRow` routes `payment_failed`→`billing` and `storage_threshold`→`integration` lanes correctly (golden), (b) the **admin** chip config derives to NO Billing/Alerts chip and the **owner** config DOES (assert the DD8 derivation, so widening it later fails a test), (c) feeding `AdminInbox` a HOSTILE fixture that includes a `payment_failed` row **renders it faithfully** (RULED OD6: FAITHFUL-renderer with a total mapper — the FE does not re-enforce authz; cross-role **authz** non-leak is owned by 10-1a AC7 write-time scope, NOT re-litigated here),
**And** only the teacher view mounts the Reply action,
**And** role rendering uses `useRole()`/separate components, never inline `if role===` in JSX.

**AC9 — mobile responsive (DD10, TEST-UX-4)**
**Given** the inbox at 390px,
**When** rendered,
**Then** rows are flat chronological with date dividers, filter chips horizontally scroll (no wrap), touch targets ≥44px, and row actions are tap buttons; detail opens as a full-screen push (not a modal),
**And** swipe-to-act is NOT implemented (deferred — no regression if absent).

**AC10 — i18n parity + a11y**
**Given** all new keys (page title, "N unread · M total", mark-all CTA, relative-time units, three role-toned empties, reply composer labels/errors),
**When** the parity ratchet runs,
**Then** every new key exists in BOTH `en.json` and `vi.json` and is enumerated in `STORY_10_1B_KEYS` wired into `i18n-parity-coverage.test.ts`,
**And** the inbox view passes `axe` with no violations and the list region/badge expose correct aria (`inboxList.regionLabel`, `sidebar.nav.unreadAria`, `mobileTab.unreadAria`).

---

## Tasks / Subtasks

**Task 1 — Mark-all-read route (BE; AC6; WF-1/WF-4 — do FIRST so the client regenerates before FE wiring)**
- [x] 1.1 `InboxHandler.MarkAllRead(w,r) error` → `h.svc.MarkAllRead(r.Context(), tc)` (service exists) → `WriteEnvelope(w, map{"status":"ok"})`. Mirror the existing `MarkRead`/`Archive` handler shape (`inbox_handler.go`).
- [x] 1.2 Register `mux.Handle("POST /api/inbox/read-all", questionChain(inboxHandler.MarkAllRead))` in `cmd/api/main.go` beside the other 4 inbox routes (`:809-812`).
- [x] 1.3 api.yaml: add `/api/inbox/read-all` POST → a NET-NEW `EnvelopeStatusAck` (`{data:{status:string}}`, no `id` — not `EnvelopeNotificationAck`; reuse `EnvelopeMeta` for `meta`). Run `scripts/codegen.sh` (openapi-typescript) — verify `client.ts` gains `markAllRead` + path; no sqlc change (WF-3: no `.sql`/migration touched). No generated hand-edit.
- [x] 1.4 Handler integration test (TEST-BE-3) through real middleware: seed caller with unread+archived rows → `POST /api/inbox/read-all` → 200 `{data:{status:"ok"}}`; assert caller unread → 0; **an archived-but-unread row keeps `read_at = null` (BH7 regression guard — must fail on a revert of the `archived_at IS NULL` patch)**; a **different-tenant** caller's rows untouched (RLS inheritance — not just a same-center other-user).

**Task 2 — Inbox data hooks (`src/features/inbox/api/`; AC2/AC4/AC5)**
- [x] 2.1 `inboxKeys.ts` — hierarchical factory `{ all: ['inbox'], list: (f) => [...all,'list',f], count: () => [...all,'count'] }` (TS-3).
- [x] 2.2 `useInbox(filters, page)` — `useQuery` via `apiFetchWithMeta<Notification[], EnvelopeMetaPagination>('/api/inbox?…')`, snake_case params (`type`, `unread_only`, `page`, `page_size`), explicit `staleTime` (FW-3), returns rows + pagination.
- [x] 2.3 `useInboxCount()` — poller per DD4 (`refetchInterval: INBOX_POLL_INTERVAL_MS` const in 30-60s, `refetchIntervalInBackground:false`, `staleTime:0`, `enabled: role != null`). Tests: hidden-tab no-fire, single-instance across consumers (MSW + `vi.useFakeTimers()`, NOT a hook mock — Murat), disabled-for-null-role.
- [x] 2.4 `useInboxActions()` — `markRead`/`archive`/`markAllRead` mutations, each the full optimistic triple on `inboxKeys.list*` + `inboxKeys.count()` (DD5; template `useRooms.ts` is single-key — extend to two-key `ctx` snapshot + `max(0,…)` count floor + `readAt`-guarded decrement). Tests: rollback-on-404 restores BOTH keys; count-underflow floor; double-fire nets one decrement; mark-all/single interleave converges to 0; stale-page archive invalidates ALL `list*` keys.

**Task 3 — Mapping + relative-time (`src/features/inbox/lib/`; AC3)**
- [x] 3.1 `notificationMapping.ts` — `toInboxRow(n): InboxRowData` (DD2), **compile-time-exhaustive switch with a `never` default (`assertNever`)** + null-safe var builders per type (DD3). Golden test = the matrix (DD3/AC3): 7 types × {all-present, each-optional-null, all-thin→`body`-fallback-flagged} × {en, vi}, value-scan for no `"undefined"`/empty-interpolation/dangling connective.
- [x] 3.2 `relativeTime.ts` + register `{{val, relativeTime}}` on i18n (`src/lib/i18n.ts`, beside `vnDate`) wrapping `Intl.RelativeTimeFormat` for `en`/`vi`; falls back to `vnDate` past ~7 days.

**Task 4 — Role views + route (`src/features/inbox/`; AC1/AC8)**
- [x] 4.1 `InboxRoute.tsx` dispatcher (DD1 — mirror `DashboardRoute`): role-checking card, settled-null→`/login`, lazy per-role mount, single `Suspense`. NO `RouteRoleGate`.
- [x] 4.2 `StudentInbox/TeacherInbox/AdminInbox/OwnerInbox.tsx` — each: its chip config (DD8), consumes `useInbox` + `useInboxActions`, maps rows via `toInboxRow`, feeds `InboxListShell` (`rows`, `role`, `filters`, `activeFilters`, `onToggleFilter`, `onRowPrimaryAction`→navigate(`n.link`)/role-action, `onRowArchive`→archive), topbar "Mark all read".
- [x] 4.3 `routes.tsx` — add `/inbox` lazy child under the `AppLayout` group (the `/dashboard` sibling pattern, no gate).

**Task 5 — Teacher reply composer (AC7)**
- [x] 5.1 At `TeacherInbox` level, intercept the `question` row primary action → open an inline/expanded reply composer (RHF + zod non-empty, FW-8) reusing `useReplyToQuestion` from `@/features/questions` (TS-7). **Expose the `visibility` toggle (shared/private), `resolve` default-off.** On success: collapse + optimistically `markRead` the row. No student notification expected (doc). Register the `POST /api/questions/{id}/replies` MSW handler in the inbox suite. Three-state + a11y labels via i18n.

**Task 6 — Badge wiring (`AppLayout.tsx`; AC4)**
- [x] 6.1 Read `useInboxCount()` in `AppLayout`; feed `badgeCount` onto the `/inbox` `SidebarNavItem` (via the nav config or a per-item merge) and `unreadByTab={{ inbox: count }}` on `<MobileTabBar>`. Hidden at 0. The count query is `enabled: role != null` (assert disabled for guest/null — no `/count` 401-storm). Note: `/count` is global-unread, intentionally NOT filtered by the active type chip (DD4/DD8) — do not "fix" the badge to track the chip.
- [x] 6.2 **Fix the stale `src/hooks/usePolling.ts:11` header** — it still names "Epic 10 inbox unread badge" as its consumer, now false (the badge uses Query `refetchInterval`, DD4). One-line edit in THIS commit so the next engineer doesn't "reconcile" it back into cache-incoherence (Winston).

**Task 7 — Trilogy + mobile + i18n (AC2/AC9/AC10)**
- [x] 7.1 `components/InboxStates.tsx` — skeleton rows + inline error+retry (DD9; template `DashboardStates`). Archive **undo toast** ("Archived · Undo") wired to the DD5 rollback.
- [x] 7.2 Role-toned empty (s56) into the shell's empty slot (DD9) — ghosted nav-glyph icon + Fraunces headline with one italic `<em>` word + muted line; suppress the header count at `total===0`.
- [x] 7.3 Mobile responsive polish (DD10) — scrolling chips, 44px targets, full-screen push detail, tap-button actions. **Do the 390px action math:** Open+Archive+Reply at ≥44px each ≈132px before any text — collapse to icon-only/overflow at narrow width; Reply (opens a full composer) should not sit as a peer button next to Archive (Sally).
- [x] 7.4 Add ALL new keys to `en.json` + `vi.json` (incl. `relativeTime` per-unit keys, the three role-toned empties, mark-all CTA, reply-composer + visibility labels/errors, undo toast); create `src/features/inbox/__tests__/inboxI18nKeys.ts` (`STORY_10_1B_KEYS`) + wire into `i18n-parity-coverage.test.ts` **RED-FIRST** (import/compile-fail before the keys exist, per the ATDD convention — this is the lightweight WF-8 control, Murat).

**Task 8 — Verify (DoD)**
- [x] `tsc -b` green (checks test files — not `tsc --noEmit`); full web vitest green (0 regressions) incl. the new three-state / role-negative / mapping / parity / axe tests; ESLint clean (no raw fetch, no cross-feature deep imports, no useEffect data-fetch); backend `gofmt`/`vet`/`go test -p 1 ./...` green for the mark-all-read handler; `codegen.sh` clean (api.yaml→client.ts only, no sqlc drift); api.yaml + `client.ts` + FE committed together (WF-4).

---

## Review Findings

_Code review 2026-10-07 (`/bmad-code-review 10-1b`, Amelia; 3 adversarial Opus-4.8 layers — Blind Hunter, Edge Case Hunter, Acceptance Auditor; all verified against source). 2 decision-needed, 10 patch, 3 defer, 1 dismissed._

### Decision-needed (RESOLVED 2026-10-07 — Ducdo)

- [x] [Review][Patch] **Concurrent optimistic rollback clobbers the whole list/count cache → surgical restore (RULED 1a: fix now)** — `restore()` blindly `setQueryData`s the ENTIRE snapshot (`useInboxActions.ts:46-56`), used by `markRead.onError:133`, `archiveCommit.onError:167`, and `undo:205`. Interleave: archive n1 (snapshot S1=`[n1,n2]`, deferred 6s) → archive n2 (`[n1]`) → n1's commit 500s at t+6s → `restore(S1)` writes `[n1,n2]` back, resurrecting the already-archived n2 until `onSettled` refetch. **Fix:** replace the whole-cache snapshot/restore with a per-mutation delta restore (re-insert/re-flag only the specific row + revert exactly the count delta that mutation applied) so a rollback never touches rows another in-flight mutation owns.

- [x] [Review][Patch] **Filter + pagination semantics incomplete → build pager now (RULED 2b)** — one root: the view renders page-1 of a FILTERED query but treats it as the whole inbox. **Fix all three:** (a) build a real pager (`page` state + prev/next control; `useInbox` already advertises `keepPreviousData`); (b) make the header count coherent under an active filter — pair like-scoped unread/total (don't show global unread beside a filtered total) `InboxView.tsx:73-75,141`; (c) add a filtered-empty copy ("no matches for this filter", new i18n key both locales) distinct from the day-one role-toned empty `InboxView.tsx:176`.

### Patch

- [x] [Review][Patch] **AC6(ii) cross-tenant assertion missing from the mark-all-read handler test (HIGH — story-mandated, security-isolation)** [classlite-api/internal/test/inbox_mark_all_read_atdd_test.go:25,37] — the test covers caller-scoped + BH7 archived-stays-unread + a same-center other-user, but its own header admits "the raw-pool cross-tenant leg is a green-phase addition (checklist)" and it was never added. AC6 explicitly elevated a different-TENANT 0-row assertion as required for this net-new verb. Seed a second tenant, assert its rows are untouched.
- [x] [Review][Patch] **Teacher reply failure is silent** [classlite-web/src/features/inbox/components/InboxReplyComposer.tsx:51-56] — `reply.mutate(..., { onSuccess })` has no `onError` and `useReplyToQuestion` carries no global handler; a 500/network error leaves the composer open with the draft and zero feedback. Add an error toast / inline `role="alert"`.
- [x] [Review][Patch] **Reply composer not keyed by questionId → draft + visibility bleed** [classlite-web/src/features/inbox/components/InboxView.tsx:158-166] — switching from question A to B while the composer is open reuses the same instance; RHF content and the `visibility` state carry over (a privacy leak onto B's reply). Add `key={activeReply.questionId}`.
- [x] [Review][Patch] **Active-chip clear ("X") is dead** [classlite-web/src/features/inbox/components/InboxView.tsx:173] — `onToggleFilter={setActiveChip}` re-sets the same key, so clicking the active chip / its rendered `X` (InboxListShell.tsx:106) does nothing; the filter clears only via the separate "All" chip. Toggle back to the default chip when the active one is clicked.
- [x] [Review][Patch] **Intentional archive lost on unmount within the 6s window** [classlite-web/src/features/inbox/api/useInboxActions.ts:174-180] — the cleanup effect `clearTimeout`s every pending archive, so navigating away before `ARCHIVE_UNDO_WINDOW_MS` drops the archive (never POSTed); the row reappears next load. Flush (commit) pending archives on unmount instead of clearing.
- [x] [Review][Patch] **Undo toast expires before the commit window** [classlite-web/src/features/inbox/components/InboxView.tsx:120-123] — sonner's default duration (~4s) is shorter than the 6s `ARCHIVE_UNDO_WINDOW_MS`, so the Undo affordance vanishes ~2s before the archive actually commits. Set the toast `duration` to `ARCHIVE_UNDO_WINDOW_MS`.
- [x] [Review][Patch] **Storage percent not clamped above 100%** [classlite-web/src/features/inbox/lib/notificationMapping.ts:77] — `Math.round((used/limit)*100)` with `usedBytes > limitBytes` (over-quota) renders "Storage is 150% full". Clamp with `Math.min(100, …)`.
- [x] [Review][Patch] **Visibility toggle group mislabeled** [classlite-web/src/features/inbox/components/InboxReplyComposer.tsx:82-83] — `role="group"` uses `aria-label={t('inbox.reply.visibility.shared')}` ("Shared with class"), so a screen reader announces the group by one of its option names. Add a neutral `inbox.reply.visibility.label` key (both locales) and use it.
- [x] [Review][Patch] **read-on-view fires while hidden + never retries a rolled-back mark** [classlite-web/src/features/inbox/components/InboxView.tsx:81-98] — (a) the debounce has no `document.visibilityState` guard (unlike the poller's `refetchIntervalInBackground:false`), so rows get marked read in a backgrounded tab; (b) `markedRef.current.add(id)` happens before success, so a 404/500 rollback leaves the row unread and it is never re-marked while mounted. Guard on visibility + record the id on success.
- [x] [Review][Patch] **Mark-all-read handler test never asserts the `{data:{status}}` envelope body** [classlite-api/internal/test/inbox_mark_all_read_atdd_test.go:65-68] — AC6/TEST-BE-3 require asserting the envelope shape, not just status 200 + DB side-effects. Add the body assertion.

### Defer

- [x] [Review][Defer] **Relative-time label frozen at map time** [classlite-web/src/features/inbox/lib/notificationMapping.ts:104] — `occurredAtLabel` is computed once in `toInboxRow`; it doesn't advance while idle or on a runtime language switch until the list refetches (the `<time dateTime>` carries the absolute). Minor → FU (relative-time reactivity). The registered `{{val, relativeTime}}` i18n formatter is effectively unused by the precompute path.
- [x] [Review][Defer] **AC9 row-action touch targets < 44px** [classlite-web/src/components/domain/InboxRow.tsx:168,176] — primary `size="xs"` / archive `size="icon-xs"` are below the AC9 44px floor, but they're the shared 1d-4 chrome and "do not fork domain chrome" applies → tracked to 10-3/10-4 (documented deviation #5). AC9 therefore Partial.
- [x] [Review][Defer] **read-on-view invalidation amplification** [classlite-web/src/features/inbox/components/InboxView.tsx:86-98 + useInboxActions.ts:135] — a full page of 20 unread rows fires 20 `POST /read` each with its own list+count `onSettled` invalidation → a refetch burst on every inbox view. Bounded by `INBOX_PAGE_SIZE` + low v1 volume; proper fix = coalesce invalidations / batch → FU (efficiency).

### Dismissed (noise)

- Body-fallback escape hatch only reachable on an unknown type, not a thin-but-known type (auditor) — every known type resolves to a `.titleGeneric` no-var variant, so `INBOX_FALLBACK_KEY` is only hit via the `assertNever` arm. This is a *better* interpretation (stays bilingual for known types), is flagged/greppable, and is P0-tested. Not a defect.

---

## Dev Notes

- **Consume the frozen contract; do NOT reopen 10-1a.** The RLS, event fan-out, role-scope-at-write, and metadata shape are shipped. The only backend change is the mark-all-read route (DD6).
- **Teacher inbox is thin in v1 by design** — `question_asked` is the teacher's only row type until the **release-coupled** `10-1c-teacher-work-queue` adds the ungraded/late grading queue. The inbox feature does NOT ship until 10-1b AND 10-1c are both done (Ducdo). Don't try to surface submissions here — there's no event for them.
- **Student "Replies" and teacher "Mentions"/"System" chips are intentionally absent in v1** (no `question.answered` / mention / staff-health events) — DD8 derives chips from available types so nothing shows a permanently-empty category. Those return with `FU-10-1-QA-REPLY` / `FU-10-1-MENTIONS` / `FU-10-1-STAFF-HEALTH`.
- **No header bell** — the unread indicator is the sidebar `/inbox` badge + the mobile tab badge + the in-page "N unread · M total" header (UX §4.2). Don't add a topbar bell.
- **FW-4:** the count poller is the ONLY legit "interval" and it lives in Query (`refetchInterval`), not a `useEffect` and not `usePolling` (which would bypass the cache the badge reads from). No `useEffect` for any inbox fetch.
- **TS-6 / dates:** `createdAt` stays an ISO string until the i18n formatter; relative-time is a formatter, not `new Date()` in render.
- **TS-1 / GO-5:** `readAt`/`archivedAt` are explicit `null` (not `undefined`) on the wire; treat `readAt == null` as unread.
- **CQ-3:** `INBOX_POLL_INTERVAL_MS` and any page-size default are named constants, never inline literals.
- **TS-7:** import the reply mutation from `@/features/questions` (barrel), never a deep path.
- **Notification settings toggles STAY disabled** (10-1a D4 / Story 9.4 — they're email-channel gates on Profile `s38`, not in-app gates). Do NOT re-enable them here.

### Project Structure Notes

- New slice `classlite-web/src/features/inbox/` mirrors `features/dashboard/` exactly (dispatcher + per-role views + `api/` + `lib/` + `components/` + `__tests__/`). Reuses `components/domain/InboxListShell`+`InboxRow` (chrome) and `components/domain/SidebarNavItem`/`MobileTabBar` (badge slots) — do NOT fork the domain chrome; put the reply composer and any feature behavior in the feature layer.
- One thin BE touch: `inbox_handler.go` (+1 method), `cmd/api/main.go` (+1 route), `api.yaml` (+1 path). No migration, no `.sql`, no service edit.

### References

- Backend contract: [Source: _bmad-output/implementation-artifacts/10-1a-inbox-and-notifications-backend.md] (DD1/DD1b/DD3/DD5) + [Source: classlite-api/api.yaml#/api/inbox, #NotificationType, #NotificationMetadata, #Notification] + [Source: classlite-web/src/lib/api/client.ts].
- Epic / FRs: [Source: _bmad-output/planning-artifacts/epics/epic-10.md#Story 10.1] · [Source: prds/…/prd.md#FR-56..FR-59].
- UX: [Source: ux-design-specification.md#8.5 Inbox s50–s52 (line 504)] (scaffold, per-role lenses, "N unread · M total", chips, date dividers) · [#6.4 State Patterns (lines 378-387)] (trilogy) · [#8.5 empty role tone s56 (line 385)] · [#11.2 Mobile (lines 607-625)] (swipe→FU, scrolling chips, full-screen push, 44px) · [#4.2 sidebar Inbox badge (line 137)].
- Architecture: [Source: architecture.md:247] (polling 30-60s, configurable; aggregate batchy arrivals → `FU-10-1-AGGREGATION`) · [:253] (student/teacher route-chunk split) · [:257] (notifications through i18n).
- Reuse: `features/dashboard/DashboardRoute.tsx` (dispatcher) · `features/settings/api/useRooms.ts` (optimistic triple) · `features/grading/hooks/useAiGradeJob.ts:260` (refetchInterval) · `features/questions` barrel (`useReplyToQuestion`) · `features/dashboard/components/DashboardStates.tsx` (trilogy) · `src/lib/i18n.ts` (`vnDate` formatter registration) · `src/hooks/useRole.ts`.
- Rules: UX-1/UX-2/UX-3/UX-4, FW-2/FW-3/FW-4/FW-7, TS-1/TS-3/TS-6/TS-7, TEST-FE-1/2/4/5/6, TEST-UX-4, CQ-3, XL-1, WF-1/WF-3/WF-4. [Source: docs/project-context.md]

### Risk / WF-8

| Risk | Score | Covered by |
|---|---|---|
| **FE-owned cross-role MIS-render** (mapper mis-routes `payment_failed`, or a shared-component/chip-config regression surfaces a billing lane in the admin view) | **6** (FE-owned — NOT inherited; 10-1a has no opinion on which React component renders what; 4 near-identical role views invite copy-paste drift — Murat) | AC8 reframed (mapper lane golden + chip-derivation negative, RED-FIRST) + DD2 exhaustive-`never` switch |
| i18n parity regression (R38 class) | 6 (harness owned by 1-7c; this story MAPS to it via ~8 new key families + `relativeTime` ×2 locales — WF-8 keys on *maps-to*, not *owns*) | `STORY_10_1B_KEYS` ratchet wired RED-FIRST (AC10/Task 7.4) |
| R33 — polling thundering herd | 4–5 (monitor) + per-user cross-tab multiplier (TanStack Query does not dedupe across tabs → N tabs = N× `/count`; named, not fixed → `FU-10-1-BADGE-SYNC`) | single indexed `/count`; `INBOX_POLL_INTERVAL_MS` 30–60s; `refetchIntervalInBackground:false`; AC4 hidden-tab + single-instance tests |
| Mark-all-read cross-tenant/cross-user | inherits 10-1a RLS *mechanism* — but the *verb* is net-new (never in 10-1a's AC2 grid) | AC6/Task 1.4 own cross-tenant + BH7 archived-stays-unread |

**WF-8 — pragmatic read (Murat, per the ratified "pragmatic interpretation of spec absolutes").** The ≥6 *backend* risks (R1/R3/R15) are genuinely owned+gated in 10-1a and cannot be reopened here. But 10-1b **maps to** two ≥6 risks on the FE side (the mis-render 6 and the R38 parity 6), and the literal rule keys on *maps-to*. So the full WF-8 ceremony is **waived**, but its coverage is **NOT**: the **mapper-golden (AC8), the role-negative chip-derivation (AC8), and the `STORY_10_1B_KEYS` parity array (AC10) ship RED-FIRST** per the ATDD convention (import/compile-fail before the code/keys exist), then green. That's the cheap honest control (~half a day) — not a hand-authored red ceremony. Remaining P1 coverage (three-state, optimistic failure modes, poller, mark-all handler) ships inline. Confirm at `/bmad-tea AT 10-1b`.

---

## Resolved Decisions (party-mode 2026-10-07; Ducdo rulings)

_Surfaced by party-mode review (Sally/Winston/Murat/John); 🔴 trust + 🟠 cheap fixes already applied to the ACs/DDs/Tasks above. Product/technical forks ruled by Ducdo:_

- **OD1 — answered-question loop → RULED: one-directional inbox accepted for v1.** Student sees an "answered" state on their own "My questions" surface (s36/s29), NOT an inbox row — `FU-10-1-QA-ANSWERED`, outside 10-1b. (So the reply isn't a black hole without expanding 10-1b.) Baked into DD7/AC7.
- **OD2 — nameless `schedule_changed` → RULED: ship as specced.** The degraded generic row ships; mapper degrades per DD3. (Class-name enrichment remains `FU-10-1-METADATA-ENRICH`.)
- **OD3 — admin inbox (1 type / 0 actions) → RULED: ship as specced.** Admin inbox launches with `enrollment_changed` only; staff/health categories remain their FUs.
- **OD4 — release coupling → RULED: keep all 4 roles coupled to 10-1c.** One coherent launch; inbox ships only when 10-1b + 10-1c are both done. (No decouple.)
- **OD5 — second action slot → RULED: keep mark-all-read.** Approve/decline-enrollment stays `FU-10-1-ENROLL-ACTION`.
- **OD6 — AC8 mapper contract → RULED: FAITHFUL-renderer with a total mapper.** FE does not re-enforce authz (owned by 10-1a AC7). Baked into AC8(c).
- **OD7 — architecture → RULED: accept defaults.** (a) cross-tab badge = eventual-consistency within one poll + `FU-10-1-BADGE-SYNC` (not built here); (b) count-poll flicker = accepted-cosmetic (`onSettled` is the authority), no pause-poller coordination. Baked into DD5.

---

## Definition of Done

- All 10 ACs met.
- `/inbox` renders a role-scoped inbox for all four roles over the frozen 10-1a contract; badge wired on sidebar + mobile; mark-read/archive/mark-all-read optimistic; teacher reply reuses the existing Q&A endpoint.
- The ONLY backend change is `POST /api/inbox/read-all` (route + handler + api.yaml + codegen); no migration, no sqlc, no service edit; `go test -p 1 ./...` green.
- `tsc -b` green; full web vitest green (0 regressions) incl. three-state, role-negative DOM, mapping golden (7 types + null-metadata), i18n parity, and axe tests; ESLint clean.
- All new strings in `en.json` + `vi.json` + `STORY_10_1B_KEYS` ratchet; no hardcoded English; notification-settings toggles remain disabled.
- `codegen.sh` clean (api.yaml→client.ts only); api.yaml + client.ts + FE in ONE commit (WF-4); no generated-file hand-edit.
- File ≤600 lines; completion notes created per `docs/bmad-story-conventions.md` (sibling `-completion-notes.md`) at dev pickup.
- **Release note:** this story is release-coupled with `10-1c-teacher-work-queue` — the inbox feature is not launch-ready until both are `done`.

---

## Out of Scope (→ 10-1c or follow-ups)

- **Teacher grading work-queue** (ungraded/late submissions) → `10-1c-teacher-work-queue` (release-coupled, derived read).
- **Snooze** → `FU-10-1-SNOOZE` (needs the `snoozed_until` column 10-1a deliberately deferred + active-queue predicate change).
- **Add-to-calendar (.ics)** → `FU-10-1-CALENDAR` (schedule `newTime` not in metadata — blocked on `FU-10-1-METADATA-ENRICH`).
- **Approve/decline enrollment, ✦AI-suggest reply, notification rules** → `FU-10-1-ENROLL-ACTION` / `FU-10-1-AI-REPLY` / `FU-10-1-RULES`.
- **Swipe-to-act gestures** (s75/s84) → `FU-10-1-SWIPE` (no gesture lib; needs Rolldown-compat review).
- **Cross-tab badge sync** (BroadcastChannel so N tabs share one count + instant cross-tab optimistic updates) → `FU-10-1-BADGE-SYNC` (v1 accepts eventual consistency within one poll — OD7).
- **Grouped multi-type filter chips** ("Class" = assignment ∪ schedule) → deferred (single-type server-filtered chips in v1, DD8).
- **Student "Replies", teacher "Mentions"/"System", admin/owner "Staff/Health" categories** → `FU-10-1-QA-REPLY` / `FU-10-1-MENTIONS` / `FU-10-1-STAFF-HEALTH` (no source events yet).
- **Student "answered" state on the "My questions" surface (s36/s29)** → `FU-10-1-QA-ANSWERED` (RULED OD1 — closes the one-directional-loop gap outside the inbox; no inbox badge).
- **Aggregation** ("5 essays graded") → `FU-10-1-AGGREGATION`.
- **Metadata enrichment** (bandPreview, schedule old/new time + changeKind, question preview, class names) → `FU-10-1-METADATA-ENRICH` — the mapper degrades gracefully until it lands (DD3).
- **General EmptyState/ErrorState component extraction + polish** → `10-3-empty-states` / `10-4-error-states` (10-1b ships a functional inbox trilogy now, DD9).
- **Re-enabling notification-settings toggles** → a future email-notifications story (they stay disabled — 10-1a D4).

---

## Change Log

| Date | Change |
|---|---|
| 2026-10-07 | **CODE-REVIEW → done** (`/bmad-code-review 10-1b`, Amelia; 3 adversarial Opus-4.8 layers — Blind Hunter, Edge Case Hunter, Acceptance Auditor; all findings cross-verified against source). 14 findings: **2 decision-needed RULED by Ducdo** — (1a) surgical per-row/delta rollback replacing the whole-cache snapshot/restore that resurrected concurrently-mutated rows (`useInboxActions.ts`); (2b) built the pager + made the header count coherent under an active filter (global unread no longer paired with a filtered total) + a distinct filtered-empty copy (`InboxView.tsx`). **10 patch — all applied**: AC6(ii) cross-TENANT leak assertion added to the mark-all-read handler test (was a never-added checklist TODO) + `{data:{status}}` envelope-body assertion; silent teacher-reply failure now toasts (`InboxReplyComposer`); reply composer keyed by questionId (draft/visibility bleed fix); dead active-chip "X" now clears to All; intentional archive FLUSHED (not dropped) on unmount within the 6s window; undo-toast duration = window; storage% clamped ≤100; neutral visibility group aria-label; read-on-view visibility-guarded + records-on-success. **3 defer** → `deferred-work.md` (relative-time label frozen at map time; AC9 row-action 44px bounded by 1d-4 chrome → 10-3/10-4; read-on-view per-row invalidation amplification). **1 dismissed** (body-fallback nuance). 8 net-new i18n keys both locales + `STORY_10_1B_KEYS`. **GATES GREEN:** `tsc -b`=0 (the LSP billing/profile/notification "missing schema" flood was stale-cache — all schemas present on disk in the 15k-line `client.ts`) · inbox+parity+badge vitest **1076 pass**, inbox suite 57 pass (0 regressions) · ESLint clean · BE gofmt/vet clean + mark-all-read `go test` ok (caller-scoped + BH7 + cross-tenant + envelope). **AC9 stays PARTIAL** (44px, tracked to 10-3/10-4). RELEASE-COUPLED w/ 10-1c. CHANGES UNCOMMITTED. |
| 2026-10-07 | **DEV-STORY complete → review** (`/bmad-dev-story 10-1b`, Amelia). All 8 tasks / 21 subtasks done, all 10 ACs met. BE: `POST /api/inbox/read-all` (handler + route + api.yaml `EnvelopeStatusAck` + codegen, NO migration/sqlc); 5 ATDD reds green (mark-all-read de-tagged; mapper-golden; chips; parity ×2). FE: `src/features/inbox/` slice (dispatcher + 4 lazy role views over ONE shared `InboxView`, mapper, chips, relativeTime, 3 data hooks, trilogy, reply composer), badge wired on sidebar+mobile, `usePolling.ts` header fixed. Inline P1 tests added (optimistic triple rollback/floor/double-fire/deferred-undo, poller interval/disabled, three-state, faithful-render, dispatch, axe, reply, badge). **Gates GREEN:** `tsc -b`=0 · full web vitest **293 files / 3833 tests** pass (0 regressions) · ESLint clean · BE gofmt/vet/`go test -p 1 ./...` all ok · codegen additive (no sqlc drift). 5 documented deviations (relativeTime in core `src/lib/`; relative-time via i18n keys not raw Intl; `InboxListShell` gained an optional `emptyState` slot; added i18n keys beyond AC10's illustrative list; mobile 44px touch-target bounded by 1d-4 chrome → 10-3/10-4). Deferred-commit archive-undo (no un-archive endpoint exists). Completion record: [`10-1b-role-scoped-inbox-frontend-completion-notes.md`](./10-1b-role-scoped-inbox-frontend-completion-notes.md). **RELEASE-COUPLED: the inbox feature does not ship until 10-1b + 10-1c are both done.** Next: `/bmad-code-review 10-1b` (prefer a different LLM). |
| 2026-10-07 | **ATDD red-phase generated + verified** (`/bmad-tea AT 10-1b`, Murat). 5 red specimens for the WF-8 lightweight-red-first set: `notificationMapping.golden.test.ts` (AC3/AC8a — lane routing + i18n en/vi value-scan + null matrix + flagged body-fallback), `inboxChips.test.ts` (AC8b — per-role derivation, admin-has-no-billing/alerts), `inboxI18nKeys.ts` + `inboxI18nParity.test.ts` (AC10 — STORY_10_1B_KEYS parity), `inbox_mark_all_read_atdd_test.go` (AC6/Task1.4 — caller-scoped + BH7 archived-stays-unread + other-user untouched). **RED VERIFIED:** FE `tsc -b` exit 1 on EXACTLY the 2 intended seams (`../notificationMapping`, `../inboxChips`), zero incidental (a transient LSP billing/profile flood was stale-cache — CLI gate proved the tree clean); BE gofmt clean, untagged `go build`/`go vet` exit 0 (tagged red excluded), tagged compile exit 0 (runtime-gated 404). Seam contract + green guidance in `_bmad-output/test-artifacts/atdd-checklist-10-1b-role-scoped-inbox-frontend.md`. **WF-8 lightweight gate SATISFIED for backlog→in-progress.** Stays ready-for-dev. Next: `/bmad-dev-story 10-1b`. |
| 2026-10-07 | **Party-mode pre-dev review folded** (Sally/Winston/Murat/John independent subagents; Ducdo "apply 🔴+🟠, batch 🟡"). 🔴/🟠 APPLIED: AC7+DD7 reply composer now exposes the `visibility` toggle (privacy regression — Sally); **AC8 reframed** from a vacuous happy-path DOM check to an adversarial mapper-lane-golden + role-negative chip-derivation (Murat) and the cross-role **mis-render reclassified FE-OWNED risk-6** (struck "not reachable"); AC3/Task3.1 golden expanded to the per-field null matrix + flagged `body`-fallback (P0) in both locales; `toInboxRow` now **compile-time-exhaustive (`never` default)** (Winston); DD5 pinned two-key `ctx` snapshot + `max(0)` count floor + **archive undo toast** + accepted-cosmetic flicker/partial-pagination notes; DD7 **mark-read = read-on-view (debounced)** defined; DD9/AC2 empty-state italic-`<em>` headline + ghost nav-glyph + suppress-0 header (Sally); DD6 corrected to a NET-NEW `EnvelopeStatusAck` (not a reuse — Winston); Task1.4 + AC6 add cross-**tenant** leg + **BH7 archived-stays-unread** guard (Murat); AC4/Task2.3 poller hidden-tab + single-instance + null-role-disabled; Task6.2 fixes stale `usePolling.ts:11` header; WF-8 → **lightweight red-first** (maps to 2 FE-side ≥6: mis-render + R38 parity → mapper-golden/chip-derivation/parity-array ship RED-FIRST). New FU: `FU-10-1-BADGE-SYNC`. 🟡 product calls OD1–OD7 ALL RULED by Ducdo same session: OD1 one-directional loop accepted (student answered-state → `FU-10-1-QA-ANSWERED`, outside 10-1b) · OD2 ship nameless schedule row as-is · OD3 ship 1-type admin inbox as-is · OD4 KEEP all 4 roles coupled to 10-1c · OD5 keep mark-all-read (approve-enroll stays FU) · OD6 FAITHFUL-renderer mapper · OD7 accept cross-tab eventual-consistency (`FU-10-1-BADGE-SYNC`) + accept cosmetic flicker. All baked into ACs/DDs. Stays ready-for-dev. |
| 2026-10-07 | Created via `/bmad-create-story 10-1b` (Amelia). 2-agent parallel recon (UX inbox screens s50–s52/s56/s75/s84 + frontend pattern/reuse map) + frozen-contract read of 10-1a (`done`). **Key finding:** inbox is heavily pre-scaffolded (1d-4 chrome: `InboxListShell`/`InboxRow`/badge slots/`inboxRow.*`+`inboxList.*` i18n keys) → 10-1b is mostly wiring. **Ducdo rulings:** DR1 EXPAND actions, bounded to Mark-all-read (thin BE route) + Teacher reply (reuses existing `POST /api/questions/{id}/replies` — FE-only; Snooze/calendar/approve/AI/rules → FUs; nav actions free via `link`) · DR2 10-1b owns a functional role-toned trilogy (10-3/10-4 polish) · DR3 mobile responsive + tap buttons, swipe → `FU-10-1-SWIPE`. 10 ACs / 8 tasks. WF-8 hard gate NOT triggered (backend ≥6 risks owned/gated in 10-1a; 10-1b = caller-scoped route + FE). Release-coupled with 10-1c. backlog → ready-for-dev. Next: (optional `/bmad-tea AT 10-1b`) → `/bmad-dev-story 10-1b`. |
