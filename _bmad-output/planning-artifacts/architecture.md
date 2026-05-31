---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8]
lastStep: 8
status: 'complete'
completedAt: '2026-05-27'
inputDocuments:
  - '_bmad-output/planning-artifacts/prds/prd-classlite_new-2026-05-26/prd.md'
  - 'docs/classlite-entry/classlite-ia.md'
workflowType: 'architecture'
project_name: 'classlite_new'
user_name: 'Ducdo'
date: '2026-05-26'
---

# Architecture Decision Document

_This document builds collaboratively through step-by-step discovery. Sections are appended as we work through each architectural decision together._

## Project Context Analysis

### Requirements Overview

**Functional Requirements:**
81 FRs across 21 feature domains. The heaviest architectural weight falls on:
- Grading system (3 distinct modes + AI assistance pipelines)
- Exercise authoring (structured editor with multiple question types, drag-reorder, AI generation)
- Assignment lifecycle (attempt interfaces for 4 skill types, autosave, late handling)
- Analytics (aggregated from grading, attendance, submissions; role-scoped views)
- Billing (3 tiers, plan limit enforcement, grace period logic, proration)

**Non-Functional Requirements:**
- NFR-1: i18n — Vietnamese + English, runtime switch, locale-aware formatting
- NFR-2: Multi-tenancy — center-scoped data, query-level isolation
- NFR-3: Performance — FCP <2s on 4G, grading view <3s, search <500ms, autosave no lag
- NFR-4: Security — proven auth provider, server-side RBAC, no raw payment data, malware scanning, rate limiting
- NFR-5: Accessibility — WCAG 2.1 AA, keyboard navigation for grading, screen reader support
- NFR-6: Data integrity — immutable graded submissions, audit trails, soft deletes

**Scale & Complexity:**

- Primary domain: Full-stack web application (responsive, not native mobile)
- Complexity level: High
- Estimated architectural components: ~12–15 major bounded contexts

### Technical Constraints & Dependencies

- **Payment processing:** Polar.sh — no raw payment data touches ClassLite systems
- **AI provider:** Google Gemini — metered credits, async processing for grading/generation
- **Google Meet integration:** OAuth-based, auto-generated meeting links for sessions
- **Auth:** Roll-your-own (bcrypt + JWT + Google OAuth) — FR-75 through FR-81
- **Hosting:** TBD (v1 used Railway — decision needed)
- **Browser support:** Chrome, Firefox, Safari, Edge — latest 2 versions
- **No offline mode** — internet required for all features
- **No native mobile app** — responsive web only

### Cross-Cutting Concerns Identified

1. **Multi-tenancy & data isolation** — every query must enforce center scope
2. **Role-based access control** — 4 roles, server-side enforcement, 2 editable permissions
3. **Internationalization** — bilingual UI, runtime switch, locale formatting
4. **Real-time updates** — inbox badges, autosave, notification delivery
5. **File/media handling** — PDFs, images, audio uploads; storage quotas per plan tier
6. **AI credit metering** — track consumption, enforce limits, support add-on packs
7. **Audit & immutability** — enrollment logs, graded submission immutability, soft deletes
8. **Plan limit enforcement** — soft warnings + hard blocks across multiple resource types

## Starter Template Evaluation

### Primary Technology Domain

Full-stack web application with three independently deployed services: landing site, dashboard SPA, and API.

### Architecture: Landing + Dashboard + API

ClassLite v2 uses a three-service architecture:
- **Landing site** (`classlite.app`) — Astro static site for marketing, pricing, and SEO
- **Dashboard** (`my.classlite.app`) — React SPA for the authenticated product experience
- **API** (`api.classlite.app`) — Go REST API serving both frontends

All three deploy independently. The landing site links to `my.classlite.app/register` for signup CTAs. Auth cookies are scoped to `.classlite.app` so the landing page can detect logged-in users for redirect (FR-73).

### Frontend: Vite 8 + React + TypeScript + Tailwind + shadcn/ui

**Initialization:**
```bash
npm create vite@latest classlite-web -- --template react-ts
# + @tailwindcss/vite + npx shadcn@latest init
```

**Architectural Decisions Provided:**
- Language & Runtime: TypeScript (strict), React 19, Vite 8 (Rolldown bundler)
- Styling: Tailwind CSS + shadcn/ui (accessible, composable components)
- Build: Vite 8 — Rust-based Rolldown bundler, 10-30x faster builds
- Dev Experience: HMR, fast cold starts, TypeScript path aliases (@/)

**Decisions Still Needed (later steps):**
- State management, routing, form handling
- i18n library (must be wired before first component)
- Testing framework
- Code splitting strategy (critical for 4G users in Vietnam)

### Landing Site: Astro (FR-71–FR-74)

**Initialization:**
```bash
npm create astro@latest classlite-landing
# + @astrojs/tailwind
```

**Rationale:** The landing page at `classlite.app` is a marketing site — it needs SEO, fast load times, and zero JS by default. Astro outputs static HTML with optional client-side islands. This is a better fit than hacking SSG into a Vite SPA. Separate repo directory, separate deploy, separate domain.

**Architectural Decisions:**
- Framework: Astro (latest stable), static output mode
- Styling: Tailwind CSS (shared design tokens with the dashboard via CSS variables or shared config)
- i18n: Astro's built-in i18n routing (`/vi/`, `/en/`) — generates static pages for both languages. Default language detected via `Accept-Language` header with redirect, or explicit `/vi`/`/en` prefix
- Hosting: Cloudflare Pages at `classlite.app` — global CDN, instant deploys, zero server cost
- Content: Pricing tiers hardcoded (matches FR-61). Feature highlights, social proof, and legal pages (Terms, Privacy) are static content — no CMS needed for MVP

**Pages:**
- `/` — Hero, feature highlights, social proof, footer (FR-71)
- `/pricing` or inline section — Tier comparison, annual/monthly toggle, VND (FR-72)
- `/terms`, `/privacy` — Legal pages
- All pages render in both `/vi` and `/en` prefixes

**Logged-in redirect (FR-73):** A small client-side script checks for the auth cookie (scoped to `.classlite.app`). If present, redirects to `my.classlite.app`. This is the only JS on the landing page — Astro's island architecture keeps it minimal.

**Signup CTAs:** All "Get started" / "Start free" buttons link to `my.classlite.app/register`. Tier-specific CTAs can pass a `?plan=pro` query param so the dashboard can pre-select the plan during onboarding.

---

### Backend: Go Standard Library (net/http)

**Initialization:**
```bash
go mod init github.com/your-org/classlite-api
```

**Rationale:** Go 1.22+ http.ServeMux natively supports method-based routing and path parameters. No third-party router — zero framework lock-in. Middleware is composed via standard handler wrapping.

**Architectural Decisions Provided:**
- Language & Runtime: Go (latest stable), standard library net/http
- Pattern: Pure net/http handlers, standard middleware wrapping
- Project layout: Standard Go (cmd/, internal/, pkg/)

**Decisions Still Needed (later steps):**
- Database driver/query approach (pgx + sqlc vs ORM)
- RLS + connection pooling strategy (critical — naive pooling breaks RLS)
- Async job queue for AI grading pipeline
- Migration tooling, auth middleware, testing patterns

### Database: PostgreSQL

**Rationale:** Relational core data model. RLS for multi-tenant isolation. JSONB for semi-structured data (exercises, AI responses). Built-in full-text search. ACID for billing and grading integrity.

### File Storage: Cloudflare R2

**Rationale:** S3-compatible object storage. Direct browser uploads, CDN delivery via Cloudflare. Go API never proxies blobs. Covers Knowledge Hub files, audio recordings (Speaking exercises), and document uploads.

### Infrastructure: Docker + Railway + Cloudflare

- **Landing site** (`classlite.app`): Cloudflare Pages — static Astro build, global CDN
- **Dashboard** (`my.classlite.app`): Cloudflare Pages or Railway static — Vite build output
- **API** (`api.classlite.app`): Railway — Docker container, Go binary
- **Database**: Railway managed PostgreSQL
- **File storage**: Cloudflare R2 (S3-compatible object storage)
- **DNS & CDN**: Cloudflare for all domains
- **Auth cookie domain**: `.classlite.app` — shared across landing and dashboard subdomains

### Notifications: Polling (No Real-Time)

MVP uses polling for inbox badge updates. No WebSocket/SSE infrastructure needed. Simplifies deployment and eliminates Railway long-lived connection concerns.

**Note:** Project initialization using these commands should be the first implementation story.

## Core Architectural Decisions

### Decision Priority Analysis

**Critical Decisions (Block Implementation):**
- Database query layer: pgx + sqlc
- Auth: Roll-your-own (bcrypt + JWT + Google OAuth via golang.org/x/oauth2)
- API pattern: REST with OpenAPI spec
- AI grading pipeline: Async via PostgreSQL-backed job queue
- Multi-tenancy: PostgreSQL RLS with per-request SET LOCAL

**Important Decisions (Shape Architecture):**
- Frontend state: TanStack Query + Zustand
- Routing: React Router v7
- Forms: React Hook Form + Zod (for standard forms only — writing editor is decoupled, see Frontend Architecture)
- i18n: react-i18next
- Repo structure: Monorepo
- CI/CD: GitHub Actions → Railway auto-deploy
- Error tracking: Sentry

**Deferred Decisions (Post-MVP):**
- Redis caching layer (add when bottleneck proves itself)
- Additional OAuth providers beyond Google (Facebook, Apple — FR-81 assumption)
- Email notifications for non-auth events (grading complete, assignment due, schedule changes)
- Push notifications

### Data Architecture

- **Query layer:** pgx + sqlc — write SQL, auto-generate type-safe Go structs. Full visibility into queries hitting Postgres, critical for RLS correctness.
- **Migrations:** golang-migrate — SQL-based, version-controlled migration files. Migrations must run before tests in CI pipeline.
- **Multi-tenancy:** PostgreSQL Row-Level Security. Middleware calls `SET LOCAL app.current_tenant_id` on each request. All tables with tenant-scoped data include a `center_id` column and RLS policy. **Critical guard:** RLS policies must return zero rows (not all rows) when `app.current_tenant_id` is null or unset. This prevents data leaks if the middleware chain fails silently.
- **JSONB usage:** Exercise content structure, AI grading responses, and flexible metadata stored as JSONB columns. Queried via PostgreSQL JSON operators in sqlc. **Validation convention:** JSONB is always unmarshalled into typed Go structs — compile-time schema at the application layer even though the DB column is untyped. Include a `schema_version` integer column alongside JSONB columns to support future shape migrations that golang-migrate cannot handle inside JSON.
- **Caching:** No dedicated cache in MVP. PostgreSQL query performance is sufficient. Redis added later if needed.
- **Job queue:** PostgreSQL-backed using `SELECT ... FOR UPDATE SKIP LOCKED` pattern. Jobs table with explicit state machine: `pending → processing → complete | failed`. Index on `(status, created_at)` from day one. Failed jobs include error details and retry count. Job TTL and max retry policy defined per job type. Jobs survive process restarts. Worker goroutines poll the table.

### Authentication & Security

- **Auth provider:** Roll-your-own, no external auth service.
- **Password auth (FR-75):** bcrypt hashing, email/password registration. Fields: email (unique), password (min 8 chars), full name. Password strength check in frontend (weak/medium/strong indicator). Backend enforces minimum length.
- **Email verification (FR-76):** On registration, system generates a time-limited token (24h expiry) and sends a verification email. Token stored in DB (`email_verifications` table with `token`, `user_id`, `expires_at`, `verified_at`). Unverified users cannot access the product — middleware rejects with 403 and a `VERIFICATION_REQUIRED` error code. Resend endpoint rate-limited to 1 per 60 seconds per email.
- **Login/logout (FR-77):** Email/password login. Account lockout after 5 failed attempts in 10 minutes (15-minute lockout window). Lockout tracked in a `login_attempts` table or in-memory counter keyed by email. Logout clears the refresh token from DB and the auth cookies.
- **Password reset (FR-78):** Forgot-password flow generates a 1-hour token, sent via email. Token stored in `password_resets` table. On successful reset, all existing refresh tokens for that user are invalidated (force re-login on all devices). The reset endpoint always returns 200 regardless of whether the email exists (prevents enumeration).
- **Google OAuth (FR-81, mandatory):** golang.org/x/oauth2 + Google provider. Account linking by email — if Google login email matches existing account, link to same user row. Google OAuth users skip email verification (Google has already verified). On first Google OAuth login with no existing account, a new user is created with `email_verified = true`.
- **Invite acceptance (FR-79):** Staff invite links contain a signed token with the invite ID. Acceptance screen shows center name, inviter, role. If the invited email already has an account, the existing user is linked to the center via `center_members` (skip registration, show a confirmation screen). If new, a registration form is shown with email locked to the invite address. Invite tokens expire after 7 days. Expired invites render a clear message with "Request new invite" prompt.
- **Session tokens:** JWT signed with app secret. Access token: short-lived (15 min), stored in `httpOnly` secure cookie. Refresh token: long-lived (7 days default, 30 days with "Remember me" per FR-77), stored in DB (`refresh_tokens` table with `user_id`, `token_hash`, `expires_at`, `created_at`). JWT includes `user_id` and `center_id` claims.
- **Force logout (FR-80):** Owner can force-logout a staff member from the staff detail view by deleting all their refresh tokens. Next access token expiry forces re-login.
- **Authorization:** Middleware chain: `requireAuth → requireVerified → extractTenant → requireRole(roles...)`. Role stored in `center_members` table (user_id + center_id + role). 4-role model: Owner > Admin > Teacher | Student.
- **Tenant isolation hardening:** `extractTenant` derives tenant from JWT claims. An explicit assertion verifies that the JWT's `center_id` claim matches the resource being accessed — prevents a valid user from crafting requests to another tenant's endpoints. Middleware failure modes are defined explicitly: auth failure → 401, unverified → 403, tenant mismatch → 403, insufficient role → 403. Adversarial tests for the auth/RLS chain are required before production launch.
- **Rate limiting:** In-process token bucket on `/api/auth/login`, `/api/auth/register`, `/api/auth/forgot-password`, and `/api/auth/resend-verification` endpoints. Keyed by IP. Acceptable to lose state on restart for MVP (attacker gets a fresh bucket, but the window is small). Move to Redis-backed if multi-instance deployment is needed.
- **API security:** CORS configured for both origins (`classlite.app` and `my.classlite.app`). Auth cookies use `Domain=.classlite.app` with `SameSite=Lax`, `Secure`, `HttpOnly`. No raw payment data — delegated to Polar.sh.

**Auth API Endpoints:**
```
POST   /api/auth/register              # Email/password registration (FR-75)
POST   /api/auth/verify-email          # Email verification via token (FR-76)
POST   /api/auth/resend-verification   # Resend verification email (FR-76)
POST   /api/auth/login                 # Email/password login (FR-77)
POST   /api/auth/logout                # Clear session (FR-77)
POST   /api/auth/refresh               # Refresh access token
POST   /api/auth/forgot-password       # Request password reset (FR-78)
POST   /api/auth/reset-password        # Set new password via token (FR-78)
GET    /api/auth/google                # Initiate Google OAuth flow (FR-81)
GET    /api/auth/google/callback       # Google OAuth callback (FR-81)
POST   /api/auth/accept-invite         # Accept staff invite (FR-79)
```

### API & Communication Patterns

- **API style:** REST. Resource-oriented endpoints mapping to domain entities.
- **API documentation:** OpenAPI/Swagger spec — **spec-first approach**. The OpenAPI spec is the source of truth. TypeScript client types and Zod validation schemas are both auto-generated from the spec (using tools like openapi-typescript + openapi-zod-client). This prevents drift between API contract, frontend types, and form validation. Go handlers are validated against the spec in CI.
- **Error handling:** Consistent JSON envelope: `{ "error": { "code": "...", "message": "...", "details": [...] } }`. Custom Go error types map to HTTP status codes (400, 401, 403, 404, 422, 500).
- **AI grading flow:** `POST /api/submissions/{id}/ai-grade` → returns `{ "jobId": "..." }`. Frontend polls `GET /api/jobs/{jobId}` with progressive intervals (2s → 4s → 8s backoff) while on grading screen, longer intervals when navigated away. Worker picks up job, calls Gemini, writes results, marks complete or failed.
- **Notifications:** Polling-based. Frontend uses TanStack Query with a refetch interval (30-60s) for inbox badge count. Polling interval is configurable (not hardcoded). Aggregate batchy arrivals in the UI ("5 essays graded") rather than individual notifications.
- **Observability:** Every request carries a `request_id` propagated through Go context, emitted in log/slog structured output, and attached to Sentry breadcrumbs. Enables correlated debugging across logs and error tracking.

### Frontend Architecture

- **State management:** TanStack Query for server state (caching, refetching, polling, optimistic updates). Zustand for client-side UI state (sidebar, editor state, language preference).
- **Routing:** React Router v7. Route-based code splitting with explicit bundle separation: student-facing routes and teacher/admin routes are separate chunks. Students never download exercise editor or grading interface code. Critical for 4G mobile performance in Vietnam.
- **Forms:** React Hook Form + Zod validation schemas for standard forms (class creation, settings, enrollment, etc.). Zod schemas auto-generated from OpenAPI spec.
- **Writing editor:** Decoupled from React Hook Form. The rich text editor manages its own draft state with debounced autosave via TanStack Query mutations. Visible "Saved/Saving..." indicator. Isolated from form re-render cycles to avoid keystroke performance issues. This is a document-editing pattern, not a form-submission pattern.
- **Inline anchored comments (grading):** Desktop: Docs-style inline comment bubbles. Mobile: slide-up drawer showing comments associated with selected passage — inline bubbles degrade poorly on 360px screens.
- **i18n:** react-i18next. JSON translation files for Vietnamese and English. Runtime language switch. Locale-aware date/time/number formatting. Notification strings must go through i18n — no hardcoded text in polling response handling.
- **Component library:** shadcn/ui. Accessible, composable, customizable. Tree-shake unused Radix primitives to minimize bundle size.
- **File uploads (mobile):** R2 presigned URL uploads include progress indicators that survive network interruption, with retry affordances. No silent failures on upload.

### Infrastructure & Deployment

- **Repo structure:** Monorepo — `classlite-landing/`, `classlite-web/`, and `classlite-api/` in one repository. Independent deploys: Cloudflare Pages for landing + dashboard, Railway for API.
- **CI/CD:** GitHub Actions for CI (run migrations → test → lint → build per service). Cloudflare Pages auto-deploy for landing + dashboard on push to main. Railway auto-deploy for API on push to main.
- **Environment config:** Railway env management for secrets. `.env.example` in repo. Go: `os.Getenv`. Frontend: Vite `import.meta.env` with `VITE_` prefix.
- **Logging:** Go `log/slog` (stdlib, structured JSON output) with `request_id` correlation. Frontend: Sentry SDK.
- **Error tracking:** Sentry wired in from day one, both frontend and backend. Sentry breadcrumbs include `request_id` for cross-service correlation.
- **Health checks:** `/health` endpoint on Go API. Railway built-in health monitoring.
- **File uploads:** Direct browser → Cloudflare R2 (presigned URLs generated by Go API). Files never proxy through the API.
- **RLS testing:** Dedicated test helper that wraps each DB test in a transaction with `SET LOCAL app.current_tenant_id`. Written on day one, used by every DB test.

### Decision Impact Analysis

**Implementation Sequence:**
1. Monorepo scaffold + Docker setup + Railway config + Cloudflare DNS (`classlite.app`, `my.classlite.app`, `api.classlite.app`)
2. Go API skeleton with middleware chain (auth, verified, tenant, logging, request_id)
3. PostgreSQL schema + RLS policies (with null-tenant guard) + golang-migrate setup (including auth tables: `email_verifications`, `refresh_tokens`, `password_resets`)
4. RLS adversarial test suite + tenant isolation test helper
5. sqlc configuration + initial query generation
6. Resend email service setup (`email_service.go` + DNS verification for `classlite.app`)
7. Auth system (registration, email verification, login/logout, password reset, Google OAuth, invite acceptance, JWT with `.classlite.app` cookie domain)
8. Vite + React scaffold with shadcn/ui + react-i18next + React Router (with student/teacher bundle split) → `my.classlite.app`
9. Astro landing site scaffold + bilingual pages + pricing section → `classlite.app`
10. TanStack Query + Zustand wiring
11. OpenAPI spec + TypeScript client + Zod schema generation
12. Sentry integration (all three services) with request_id correlation
13. Postgres job queue (with state machine + index) + AI grading worker

**Cross-Component Dependencies:**
- sqlc depends on schema being finalized (migrations first)
- Frontend TypeScript client + Zod schemas depend on OpenAPI spec (single source of truth)
- AI grading worker depends on job queue table + Gemini API integration
- RLS depends on auth middleware setting tenant context
- File uploads depend on R2 bucket + presigned URL endpoint
- Writing editor is independent of RHF — uses TanStack Query mutations directly

## Implementation Patterns & Consistency Rules

### Naming Patterns

**Database Naming:**
- Tables: snake_case, plural — `users`, `classes`, `submissions`, `center_members`
- Columns: snake_case — `center_id`, `created_at`, `target_band`
- Foreign keys: `{referenced_table_singular}_id` — `user_id`, `class_id`
- Indexes: `idx_{table}_{columns}` — `idx_users_email`, `idx_submissions_status_created_at`
- Enums: snake_case — `submission_status`, values: `pending`, `submitted`, `graded`
- Job states: DB enum type `job_status` with values: `pending`, `processing`, `complete`, `failed`. All job types use the same state enum — no per-type variations.

**API Naming:**
- Endpoints: plural nouns, kebab-case for multi-word — `/api/classes`, `/api/ai-credits`, `/api/knowledge-hub`
- Route params: `{id}` style (Go stdlib) — `GET /api/classes/{id}/students/{studentId}`
- Query params: snake_case — `?class_id=123&sort_by=created_at`
- JSON request/response fields: camelCase — `{ "centerId": "...", "targetBand": 6.5 }`
- sqlc struct tags handle snake_case DB ↔ camelCase JSON mapping

**Go Code Naming:**
- Packages: single lowercase word — `handler`, `service`, `store`
- Exported types: PascalCase — `ClassService`, `SubmissionStore`
- Interfaces: verb-noun or noun — `ClassStore`, `GradingService`
- Unexported helpers: camelCase — `validateBandScore`, `buildQuery`

**React Code Naming:**
- Components: PascalCase files — `ClassDetail.tsx`, `GradingView.tsx`
- Hooks: camelCase with `use` prefix — `useClasses.ts`, `useAuth.ts`
- Utils/helpers: camelCase — `formatBand.ts`, `dateUtils.ts`
- Feature directories: kebab-case — `exercise-editor/`, `ai-grading/`
- Constants: UPPER_SNAKE_CASE — `MAX_FILE_SIZE`, `POLLING_INTERVAL`
- i18n keys: dot-separated, feature-scoped — `grading.aiSuggestion.accept`, `classes.form.name`

### Structure Patterns

**Frontend (React) — organized by feature:**
```
classlite-web/
  src/
    features/
      auth/               # Login, Register, GoogleCallback, VerifyEmail, ForgotPassword, ResetPassword, InviteAccept
      onboarding/         # Persona selection, center setup, class spawn
      dashboard/          # Role-specific dashboards
      classes/            # ClassList, ClassDetail, ClassForm
      sessions/           # Schedule, SessionDetail
      exercises/          # ExerciseEditor, ExerciseLibrary
      grading/            # WritingGrading, SpeakingGrading, AutoGrade
      assignments/        # AssignmentList, StudentAttempt, WritingEditor
      students/           # StudentDetail, StudentRoster
      analytics/          # ClassPerformance, StudentPerformance
      people/             # StaffList, Enrollment
      knowledge-hub/      # FileManager, FileDetail
      inbox/              # InboxList (role-scoped)
      billing/            # PlanPicker, InvoiceHistory
      settings/           # CenterSettings, Profile
      archive/            # ArchiveList
    components/
      ui/                 # shadcn/ui components (auto-generated)
      shared/             # Layout, Sidebar, Breadcrumbs, TopBar, SearchPalette
      composed/           # Cross-feature compositions (e.g., StudentBandChart used in both analytics/ and students/)
    hooks/                # App-wide: useAuth, useCurrentCenter, usePolling
    lib/                  # Generated API client, i18n config, query client, zod schemas
    stores/               # Zustand stores (uiStore, editorStore, languageStore)
    locales/              # en.json, vi.json
  e2e/                    # End-to-end tests
```

**Each feature directory follows:**
```
features/grading/
  GradingView.tsx           # Main route component
  WritingGrading.tsx        # Sub-component
  SpeakingGrading.tsx       # Sub-component
  AutoGradeReview.tsx       # Sub-component
  useGrading.ts             # Feature-specific hooks
  grading.types.ts          # Feature-specific types (if not from API client)
  GradingView.test.tsx      # Co-located unit test
```

**Import boundaries:**
- Features import from `components/`, `hooks/`, `lib/`, `stores/` — never from other features directly.
- Cross-feature shared components live in `components/composed/`.
- ESLint rules enforce these boundaries in CI.

**Backend (Go) — standard layout with domain layers:**
```
classlite-api/
  cmd/
    api/                    # main.go entry point
  internal/
    handler/                # HTTP handlers, grouped by domain
    service/                # Business logic
    store/                  # Data access (sqlc generated + custom)
      queries/              # .sql files for sqlc
    middleware/              # Auth, tenant, logging, request_id, rate_limit
    model/                  # Shared domain types and error types
    worker/                 # Job queue: AI grading, content generation
    test/                   # Integration test helpers (tenant context wrapper)
  migrations/               # golang-migrate SQL files (YYYYMMDDHHMMSS_description.sql)
  sqlc.yaml                 # sqlc configuration
  Dockerfile
```

**Go layer convention:** handler → service → store. Handlers never call store directly. Services contain business logic and orchestration. Stores contain data access only. Dependencies injected via constructor functions, not globals.

**Test definitions:**
- **Unit tests** (co-located, `_test.go` / `.test.tsx`): test a single function, component, or handler in isolation. Mock external dependencies.
- **Integration tests** (Go: `internal/test/`, React: `e2e/`): test across layers with a real database or browser. Go integration tests use the tenant context test helper.

### Format Patterns

**API Response Formats (defined in OpenAPI spec):**

The `data` wrapper and error envelope are part of the OpenAPI schema. Auto-generated TypeScript types include the wrapper — no manual unwrapping needed. The API client layer handles extraction.

```json
// Success (single resource)
{ "data": { "id": "...", "name": "..." } }

// Success (list with pagination)
{ "data": [...], "meta": { "total": 100, "page": 1, "pageSize": 20 } }

// Error (all error responses follow this shape)
{ "error": { "code": "VALIDATION_ERROR", "message": "Human-readable message", "requestId": "abc-123", "details": [{ "field": "name", "message": "Required" }] } }

// 204 No Content — no body (deletes, some updates)
```

`requestId` is included in every error response — enables users to reference specific errors in support requests and developers to trace across slog + Sentry.

**Pagination:** Offset-based (`page` + `pageSize`). Default page size: 20. Max page size: 100.

**Date/Time:** ISO 8601 strings in JSON (`"2026-05-26T14:30:00Z"`). Stored as `timestamptz` in PostgreSQL. Frontend formats via react-i18next locale-aware formatting.

**Null Handling:** Go struct fields use pointer types for nullable fields (`*string`, `*time.Time`) with `json:"fieldName"` tag (no `omitempty`). This ensures explicit nulls in JSON output. Never omit fields — frontend relies on consistent response shapes.

**IDs:** UUIDs (v7 for time-ordered, or v4). String representation in JSON. `uuid` type in PostgreSQL.

### Communication Patterns

**Auth Token Lifecycle:**
- JWT stored in `httpOnly` secure cookie (not localStorage — prevents XSS access).
- Access token: short-lived (15 min). Refresh token: long-lived (7 days), stored in DB.
- On 401 response: TanStack Query's global `onError` triggers a silent refresh attempt via `/api/auth/refresh`. If refresh succeeds, original request is retried automatically. If refresh fails, redirect to `/login`.
- Google OAuth callback stores tokens via the same cookie mechanism.

**TanStack Query key conventions:**
```typescript
// Entity lists
['classes', { centerId, filters }]
// Single entity
['classes', classId]
// Nested resources
['classes', classId, 'students']
// Job polling
['jobs', jobId]
```

**Optimistic Update Pattern:**
All mutations that modify visible data use TanStack Query's optimistic update pattern:
1. `onMutate`: snapshot current cache, apply optimistic update
2. `onError`: rollback to snapshot, show error toast
3. `onSettled`: invalidate query to refetch authoritative state

This applies to: grading actions (accept/dismiss AI suggestion), attendance marking, enrollment changes, assignment creation. The writing editor autosave does NOT use optimistic updates — it uses debounced mutations with a "Saved/Saving..." indicator.

**State Ownership (strict boundary):**
- **TanStack Query** owns ALL server-derived state. No exceptions. If it came from an API call, it lives in TanStack Query cache.
- **Zustand** owns ONLY client-side ephemeral UI state: sidebar collapse, modal open/close, editor toolbar state, language preference, theme. Never duplicates server data.

**File Upload Flow:**
1. Frontend requests presigned URL: `POST /api/uploads/presign` with `{ fileName, contentType, feature }` → returns `{ uploadUrl, objectKey }`
2. Frontend uploads directly to R2 via presigned URL, tracking progress.
3. Frontend confirms upload: `POST /api/uploads/confirm` with `{ objectKey }` → backend verifies object exists in R2, creates DB record.
4. **R2 key convention:** `{center_id}/{feature}/{uuid}.{ext}` — e.g., `abc-123/speaking/550e8400-e29b.webm`. Tenant isolation enforced by key prefix.

**Zustand store conventions:**
- One store per concern: `useUIStore`, `useEditorStore`, `useLanguageStore`
- Never store server data in Zustand — that's TanStack Query's job
- Actions and state co-located in the store

**Go worker job types:**
```
ai_grade_writing
ai_grade_speaking
ai_generate_section
ai_generate_questions
ai_generate_distractors
```
Job type is a string column, worker dispatches to typed handler. New job types added by adding a handler — no framework, just a switch. All jobs use the shared `job_status` enum.

### Process Patterns

**Frontend Error Display (by HTTP status):**
- `401` → silent refresh attempt; if fails, redirect to `/login`
- `403` with `VERIFICATION_REQUIRED` code → redirect to `/verify-email` pending screen
- `403` → render permission denied page (role required shown, per FR-70)
- `404` → render "not found" page
- `422` → inline field errors on the form that triggered the request
- `429` → toast: "Too many attempts, please wait"
- `500` → toast with `requestId`: "Something went wrong. Reference: {requestId}"

**Loading States:** TanStack Query's `isLoading` / `isError` / `data` pattern. Every data-fetching component renders three states: loading skeleton → data → error with retry button. No custom loading state management.

**Error Boundaries:** One top-level React error boundary for unexpected crashes (renders "Something went wrong" with Sentry event ID). Per-feature error handling via TanStack Query `onError`. User-facing error messages use i18n keys, never raw API messages.

**Go Error Handling:**
```go
// Domain errors — custom types that map to HTTP status
type NotFoundError struct{ Resource string; ID string }    // → 404
type ForbiddenError struct{ Reason string }                // → 403
type ValidationError struct{ Fields []FieldError }         // → 422
type ConflictError struct{ Resource string; Field string } // → 409
```
Top-level middleware maps error types to HTTP responses + error envelope with `requestId`. No `panic` for control flow. Errors always propagated up, never swallowed silently.

**Logging Levels:**
- `slog.Error` — something broke, needs attention (failed DB query, Gemini API error)
- `slog.Warn` — recoverable but unexpected (rate limit hit, retry triggered)
- `slog.Info` — significant business events (user created, grade submitted, job completed)
- `slog.Debug` — development only (request/response bodies, query timing)

All log entries include `request_id`, `center_id`, and `user_id` from context.

**Request ID propagation:** Generated by the first middleware in the Go chain (`middleware/request_id.go`). Stored in `context.Context`. Emitted in slog, Sentry breadcrumbs, and error response envelope. Not client-sent — server-generated only.

### Enforcement Guidelines

**All AI agents MUST:**
1. Follow naming conventions exactly — no camelCase in DB, no snake_case in JSON responses
2. Respect the layer convention: handler → service → store (no shortcuts)
3. Use TanStack Query for all server data — never fetch in useEffect or store in Zustand
4. Write co-located unit tests for every new component and handler
5. Add i18n keys for all user-facing strings — no hardcoded text in components
6. Include `center_id` in all tenant-scoped database tables and queries
7. Use the error type system — no raw HTTP status codes in handlers
8. Generate TypeScript types and Zod schemas from OpenAPI spec — never hand-write API types
9. Use pointer types with no `omitempty` for nullable Go struct fields — ensure explicit nulls
10. Use the R2 key convention `{center_id}/{feature}/{uuid}.{ext}` for all file uploads

**Writing editor exemption:** The writing editor and its sub-components are exempt from React Hook Form conventions. The editor uses the document-editing pattern (debounced TanStack Query mutations), not the form-submission pattern.

**Pattern Verification:**
- CI runs `sqlc vet` to validate SQL queries against schema
- CI runs OpenAPI spec validation against Go handlers
- ESLint rules enforce import boundaries (features don't import from other features directly)
- Go vet + staticcheck in CI

## Project Structure & Boundaries

### Complete Project Directory Structure

```
classlite/
├── .github/
│   └── workflows/
│       ├── ci-api.yml                  # Go: test, lint, sqlc vet, OpenAPI validate
│       ├── ci-web.yml                  # React: test, lint, build, bundle analysis
│       ├── ci-landing.yml              # Astro: build, lint
│       └── deploy.yml                  # Railway (API) + Cloudflare Pages (landing + web) triggers
├── .env.example                        # Shared env var documentation
├── docker-compose.yml                  # Local dev: API + Postgres + pgAdmin
├── README.md
├── scripts/
│   ├── codegen.sh                      # Run sqlc + openapi-typescript + openapi-zod-client
│   ├── migrate.sh                      # Run golang-migrate (up/down/create)
│   └── seed.sh                         # Seed local DB with test data
│
├── classlite-landing/                  # Astro static site → classlite.app
│   ├── package.json
│   ├── astro.config.mjs
│   ├── tsconfig.json
│   ├── tailwind.config.mjs
│   ├── public/
│   │   ├── favicon.ico
│   │   └── og-image.png               # Open Graph default image
│   └── src/
│       ├── layouts/
│       │   └── BaseLayout.astro        # Head (meta, OG tags), header, footer
│       ├── pages/
│       │   ├── index.astro             # Landing page (default locale redirect)
│       │   ├── vi/
│       │   │   ├── index.astro         # Vietnamese landing
│       │   │   ├── terms.astro
│       │   │   └── privacy.astro
│       │   └── en/
│       │       ├── index.astro         # English landing
│       │       ├── terms.astro
│       │       └── privacy.astro
│       ├── components/
│       │   ├── Hero.astro
│       │   ├── Features.astro
│       │   ├── PricingSection.astro    # Tier cards, annual/monthly toggle
│       │   ├── SocialProof.astro
│       │   ├── Header.astro            # Nav + language toggle + login/signup links
│       │   └── Footer.astro
│       ├── scripts/
│       │   └── auth-redirect.ts        # Check auth cookie, redirect to my.classlite.app (FR-73)
│       ├── i18n/
│       │   ├── vi.json
│       │   └── en.json
│       └── styles/
│           └── global.css
│
├── classlite-api/
│   ├── Dockerfile
│   ├── go.mod
│   ├── go.sum
│   ├── sqlc.yaml
│   ├── api.yaml                        # OpenAPI spec (source of truth)
│   ├── .env.example
│   ├── cmd/
│   │   └── api/
│   │       └── main.go                 # Entry point: wire dependencies, start server
│   ├── internal/
│   │   ├── config/
│   │   │   └── config.go              # Single config loader — all env vars in one place
│   │   ├── handler/
│   │   │   ├── auth_handler.go
│   │   │   ├── center_handler.go
│   │   │   ├── class_handler.go
│   │   │   ├── template_handler.go
│   │   │   ├── session_handler.go
│   │   │   ├── exercise_handler.go
│   │   │   ├── assignment_handler.go
│   │   │   ├── submission_handler.go
│   │   │   ├── grading_handler.go
│   │   │   ├── question_handler.go
│   │   │   ├── student_handler.go
│   │   │   ├── staff_handler.go
│   │   │   ├── enrollment_handler.go
│   │   │   ├── analytics_handler.go
│   │   │   ├── knowledge_hub_handler.go
│   │   │   ├── upload_handler.go
│   │   │   ├── inbox_handler.go
│   │   │   ├── billing_handler.go
│   │   │   ├── search_handler.go
│   │   │   ├── job_handler.go
│   │   │   └── health_handler.go
│   │   ├── service/
│   │   │   ├── auth_service.go
│   │   │   ├── email_service.go       # Transactional emails (verification, reset, invites)
│   │   │   ├── center_service.go
│   │   │   ├── class_service.go
│   │   │   ├── template_service.go
│   │   │   ├── session_service.go
│   │   │   ├── exercise_service.go
│   │   │   ├── assignment_service.go
│   │   │   ├── submission_service.go
│   │   │   ├── grading_service.go      # Split into service/grading/ subdir when >300 lines
│   │   │   ├── question_service.go
│   │   │   ├── student_service.go
│   │   │   ├── staff_service.go
│   │   │   ├── enrollment_service.go
│   │   │   ├── analytics_service.go
│   │   │   ├── knowledge_hub_service.go
│   │   │   ├── upload_service.go
│   │   │   ├── inbox_service.go
│   │   │   ├── billing_service.go
│   │   │   ├── search_service.go
│   │   │   └── job_service.go
│   │   ├── store/
│   │   │   ├── db.go                   # Connection pool, TenantContext type, SET LOCAL
│   │   │   ├── queries/                # .sql files for sqlc
│   │   │   │   ├── users.sql
│   │   │   │   ├── email_verifications.sql
│   │   │   │   ├── refresh_tokens.sql
│   │   │   │   ├── password_resets.sql
│   │   │   │   ├── invites.sql
│   │   │   │   ├── centers.sql
│   │   │   │   ├── classes.sql
│   │   │   │   ├── templates.sql
│   │   │   │   ├── sessions.sql
│   │   │   │   ├── exercises.sql
│   │   │   │   ├── assignments.sql
│   │   │   │   ├── submissions.sql
│   │   │   │   ├── grades.sql
│   │   │   │   ├── questions.sql
│   │   │   │   ├── students.sql
│   │   │   │   ├── staff.sql
│   │   │   │   ├── enrollments.sql
│   │   │   │   ├── analytics.sql
│   │   │   │   ├── files.sql
│   │   │   │   ├── notifications.sql
│   │   │   │   ├── billing.sql
│   │   │   │   ├── jobs.sql
│   │   │   │   └── search.sql
│   │   │   ├── generated/              # sqlc auto-generated Go code (never hand-edit)
│   │   │   └── testdata/               # Fixture SQL for integration tests
│   │   ├── middleware/
│   │   │   ├── request_id.go
│   │   │   ├── logger.go
│   │   │   ├── auth.go
│   │   │   ├── verified.go           # Rejects unverified users with VERIFICATION_REQUIRED
│   │   │   ├── tenant.go
│   │   │   ├── role.go
│   │   │   ├── rate_limit.go
│   │   │   └── cors.go
│   │   ├── model/
│   │   │   ├── errors.go              # NotFoundError, ForbiddenError, ValidationError, ConflictError
│   │   │   ├── roles.go              # Role constants, permission checks
│   │   │   ├── tenant.go             # TenantContext type definition
│   │   │   ├── exercise_content.go   # Typed Go structs for exercise JSONB
│   │   │   ├── ai_response.go        # Typed Go structs for AI grading JSONB
│   │   │   └── job_types.go          # Job type constants, state enum
│   │   ├── worker/                    # Peer of handler/ — second entry point into service layer
│   │   │   ├── dispatcher.go         # Job polling loop, dispatch by type, retry logic
│   │   │   ├── ai_grade_writing.go
│   │   │   ├── ai_grade_speaking.go
│   │   │   ├── ai_generate.go
│   │   │   └── testdata/             # Mock Gemini responses for worker tests
│   │   └── test/
│   │       ├── helpers.go            # TenantContext wrapper, test DB setup/teardown
│   │       ├── fixtures.go           # Seed data factories
│   │       └── adversarial_test.go   # RLS/auth adversarial tests
│   └── migrations/                    # Naming: {YYYYMMDDHHMMSS}_{description}.up.sql
│       ├── 20260526120000_create_users.up.sql
│       ├── 20260526120000_create_users.down.sql
│       ├── 20260526120001_create_centers.up.sql
│       ├── 20260526120001_create_centers.down.sql
│       ├── 20260526120002_create_email_verifications.up.sql
│       ├── 20260526120002_create_email_verifications.down.sql
│       ├── 20260526120003_create_refresh_tokens.up.sql
│       ├── 20260526120003_create_refresh_tokens.down.sql
│       ├── 20260526120004_create_password_resets.up.sql
│       ├── 20260526120004_create_password_resets.down.sql
│       └── ...
│
├── classlite-web/
│   ├── Dockerfile
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── eslint.config.js               # Import boundary rules enforced here
│   ├── components.json                 # shadcn/ui config
│   ├── .env.example
│   ├── index.html
│   ├── public/
│   │   └── favicon.ico
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx                    # Router, providers, error boundary
│   │   ├── routes.tsx                 # Route defs with lazy loading + student/teacher bundle split
│   │   ├── features/
│   │   │   ├── auth/
│   │   │   │   ├── index.ts               # Barrel file (public exports)
│   │   │   │   ├── LoginPage.tsx
│   │   │   │   ├── RegisterPage.tsx
│   │   │   │   ├── GoogleCallback.tsx
│   │   │   │   ├── VerifyEmailPage.tsx    # Verification pending + resend
│   │   │   │   ├── ForgotPasswordPage.tsx
│   │   │   │   ├── ResetPasswordPage.tsx
│   │   │   │   ├── InviteAcceptPage.tsx   # Invite acceptance + registration
│   │   │   │   ├── useAuth.ts
│   │   │   │   └── LoginPage.test.tsx
│   │   │   ├── onboarding/
│   │   │   │   ├── index.ts
│   │   │   │   ├── PersonaSelect.tsx
│   │   │   │   ├── CenterSetup.tsx
│   │   │   │   ├── TemplateBuilder.tsx
│   │   │   │   ├── ClassSpawn.tsx
│   │   │   │   ├── OnboardingDone.tsx
│   │   │   │   ├── SoloFirstClass.tsx
│   │   │   │   └── useOnboarding.ts
│   │   │   ├── dashboard/
│   │   │   │   ├── index.ts
│   │   │   │   ├── TeacherDashboard.tsx
│   │   │   │   ├── StudentDashboard.tsx
│   │   │   │   ├── OwnerDashboard.tsx
│   │   │   │   └── useDashboard.ts
│   │   │   ├── classes/
│   │   │   │   ├── index.ts
│   │   │   │   ├── ClassList.tsx
│   │   │   │   ├── ClassDetail.tsx
│   │   │   │   ├── ClassForm.tsx
│   │   │   │   ├── useClasses.ts
│   │   │   │   └── ClassList.test.tsx
│   │   │   ├── sessions/
│   │   │   │   ├── index.ts
│   │   │   │   ├── SessionList.tsx
│   │   │   │   ├── SessionDetail.tsx
│   │   │   │   ├── ScheduleWorkspace.tsx
│   │   │   │   ├── SessionModal.tsx
│   │   │   │   └── useSessions.ts
│   │   │   ├── exercises/
│   │   │   │   ├── index.ts
│   │   │   │   ├── ExerciseLibrary.tsx
│   │   │   │   ├── ExerciseEditor.tsx
│   │   │   │   ├── AIGenerateDialog.tsx
│   │   │   │   ├── useExercises.ts
│   │   │   │   └── ExerciseEditor.test.tsx
│   │   │   ├── grading/
│   │   │   │   ├── index.ts
│   │   │   │   ├── GradingView.tsx
│   │   │   │   ├── WritingGrading.tsx
│   │   │   │   ├── SpeakingGrading.tsx
│   │   │   │   ├── AutoGradeReview.tsx
│   │   │   │   ├── AIGradingSuggestions.tsx
│   │   │   │   ├── useGrading.ts
│   │   │   │   └── GradingView.test.tsx
│   │   │   ├── assignments/
│   │   │   │   ├── index.ts
│   │   │   │   ├── AssignmentList.tsx
│   │   │   │   ├── StudentAttempt.tsx
│   │   │   │   ├── WritingEditor.tsx      # Decoupled from RHF — document pattern
│   │   │   │   ├── SpeakingRecorder.tsx
│   │   │   │   ├── SubmissionResult.tsx
│   │   │   │   ├── useAssignments.ts
│   │   │   │   └── WritingEditor.test.tsx
│   │   │   ├── students/
│   │   │   │   ├── index.ts
│   │   │   │   ├── StudentRoster.tsx
│   │   │   │   ├── StudentDetail.tsx
│   │   │   │   └── useStudents.ts
│   │   │   ├── analytics/
│   │   │   │   ├── index.ts
│   │   │   │   ├── AnalyticsHome.tsx
│   │   │   │   ├── ClassPerformance.tsx
│   │   │   │   ├── StudentPerformance.tsx
│   │   │   │   ├── MyPerformance.tsx
│   │   │   │   └── useAnalytics.ts
│   │   │   ├── people/
│   │   │   │   ├── index.ts
│   │   │   │   ├── StaffList.tsx
│   │   │   │   ├── StaffDetail.tsx
│   │   │   │   ├── InviteStaffModal.tsx
│   │   │   │   ├── EnrollmentManager.tsx
│   │   │   │   ├── PermissionsMatrix.tsx
│   │   │   │   └── usePeople.ts
│   │   │   ├── knowledge-hub/
│   │   │   │   ├── index.ts
│   │   │   │   ├── KnowledgeHub.tsx
│   │   │   │   ├── FileDetail.tsx
│   │   │   │   └── useKnowledgeHub.ts
│   │   │   ├── inbox/
│   │   │   │   ├── index.ts
│   │   │   │   ├── InboxList.tsx
│   │   │   │   └── useInbox.ts
│   │   │   ├── billing/
│   │   │   │   ├── index.ts
│   │   │   │   ├── PlanPicker.tsx
│   │   │   │   ├── BillingDashboard.tsx
│   │   │   │   ├── InvoiceHistory.tsx
│   │   │   │   ├── UpgradeModal.tsx
│   │   │   │   ├── PlanLimitBanner.tsx
│   │   │   │   ├── PaymentDeclinedStrip.tsx
│   │   │   │   └── useBilling.ts
│   │   │   ├── settings/
│   │   │   │   ├── index.ts
│   │   │   │   ├── CenterSettings.tsx
│   │   │   │   ├── ProfileSettings.tsx
│   │   │   │   └── useSettings.ts
│   │   │   ├── archive/
│   │   │   │   ├── index.ts
│   │   │   │   ├── ArchiveList.tsx
│   │   │   │   └── useArchive.ts
│   │   │   ├── questions/
│   │   │   │   ├── index.ts
│   │   │   │   ├── QASidebar.tsx
│   │   │   │   └── useQuestions.ts
│   │   │   └── search/
│   │   │       ├── index.ts
│   │   │       ├── SearchPalette.tsx
│   │   │       └── useSearch.ts
│   │   ├── components/
│   │   │   ├── ui/                        # shadcn/ui (auto-generated, never hand-edit)
│   │   │   ├── shared/                    # App shell and layout
│   │   │   │   ├── AppLayout.tsx
│   │   │   │   ├── Sidebar.tsx
│   │   │   │   ├── TopBar.tsx
│   │   │   │   ├── UserPill.tsx
│   │   │   │   ├── ErrorBoundary.tsx
│   │   │   │   ├── PermissionDenied.tsx
│   │   │   │   ├── NotFound.tsx
│   │   │   │   └── EmptyState.tsx
│   │   │   └── domain/                    # Business-aware, feature-agnostic
│   │   │       ├── BandScoreChart.tsx
│   │   │       ├── BandScoreDisplay.tsx
│   │   │       ├── StudentCard.tsx
│   │   │       ├── StatusBadge.tsx
│   │   │       ├── AttendanceTable.tsx
│   │   │       ├── FileUploader.tsx       # R2 upload with progress + retry
│   │   │       └── RichTextViewer.tsx     # Read-only essay/submission viewer
│   │   ├── hooks/                         # App-wide ONLY (global concerns)
│   │   │   ├── useAuth.ts
│   │   │   ├── useCurrentCenter.ts
│   │   │   ├── useRole.ts
│   │   │   └── usePolling.ts
│   │   ├── lib/
│   │   │   ├── api/                       # Generated from OpenAPI spec (never hand-edit)
│   │   │   │   ├── client.ts             # openapi-typescript generated client
│   │   │   │   └── schemas.ts            # openapi-zod-client generated Zod schemas
│   │   │   ├── query-client.ts           # TanStack Query config (401 refresh handler)
│   │   │   ├── i18n.ts                   # react-i18next setup
│   │   │   └── utils.ts                  # formatBand, dateUtils, etc.
│   │   ├── stores/
│   │   │   ├── uiStore.ts               # Sidebar, modals, toasts
│   │   │   ├── editorStore.ts           # Writing editor ephemeral state
│   │   │   └── languageStore.ts         # Language preference (persisted)
│   │   └── locales/
│   │       ├── en.json
│   │       └── vi.json
│   └── e2e/
│       ├── onboarding.spec.ts
│       ├── grading.spec.ts
│       └── student-attempt.spec.ts
```

### Structural Conventions

**Service growth rule:** Any service file exceeding ~300 lines should be split into a subdomain package:
```
internal/service/grading/
  scorer.go         # Band score calculation
  feedback.go       # AI feedback processing
  rubric.go         # IELTS rubric evaluation
  grading.go        # Orchestrator (public interface)
```
The orchestrator file remains the public API for the subdomain. Other layers still import `service/grading` — the split is internal.

**Worker as peer entry point:** `internal/worker/` is a peer of `internal/handler/` — both are entry points into the service layer. Workers import services. Services are ignorant of whether they're called from HTTP or a background job. This prevents services from accumulating caller-specific conditional logic.

**TenantContext as compile-time safety:**
```go
// model/tenant.go
type TenantContext struct {
    CenterID string
    UserID   string
    Role     string
}

// Store interface methods require TenantContext — compile error if omitted
func (s *ClassStore) ListClasses(ctx context.Context, tc model.TenantContext, filters ClassFilters) ([]Class, error)
```
This makes tenant scoping a compile-time concern, not a code-review concern. The middleware populates `TenantContext` and the handler passes it explicitly to services and stores.

**Feature barrel files:** Every feature exports via `index.ts`. External imports use `@/features/auth` not `@/features/auth/LoginPage`. ESLint `no-restricted-imports` enforces this boundary.

**Migration naming:** `{YYYYMMDDHHMMSS}_{description}.up.sql` / `.down.sql`. Timestamp-based prevents collision when multiple developers create migrations on the same day.

### Architectural Boundaries

**API Boundaries:**
- All frontend → backend communication through REST API defined in `api.yaml`
- No direct database access from frontend
- Polar.sh billing calls proxied through `billing_handler` / `billing_service` — frontend never calls Polar directly
- R2 uploads bypass API (presigned URLs) but confirmation goes through the API
- Google OAuth callback hits the API which handles token exchange

**Layer Boundaries (Go):**
- `handler` → `service` → `store` — strict one-way dependency
- `handler`: HTTP concern only (parse request, call service, write response)
- `service`: business logic, orchestration, can call multiple stores
- `store`: data access only, no business logic, no HTTP awareness. All methods require `TenantContext`
- `middleware`: independent — operates on `http.Handler`, no service/store imports
- `worker`: imports `service` layer (not handlers) — peer entry point for background jobs
- `model`: imported by all layers — shared types and errors
- `config`: imported by `cmd/api/main.go` for wiring — not imported by other internal packages directly

**Frontend Boundaries:**
- Features never import from other features — only via barrel file `index.ts` if needed (rare)
- `components/ui/` — pure presentational, no business logic
- `components/domain/` — business-aware but feature-agnostic (reusable across features)
- `components/shared/` — app shell and layout only
- `hooks/` (app-wide) — strictly global concerns. Feature-specific hooks live in their feature directory
- `lib/api/` — auto-generated, never hand-edited
- Zustand stores contain NO server-derived data — TanStack Query owns all server state

**Data Boundaries:**
- All tenant-scoped tables include `center_id` + RLS policy
- JSONB columns always have companion `schema_version` column
- `store/db.go` manages connection pool and per-request `SET LOCAL`
- Migrations are the only way to change schema — no manual DDL
- `store/generated/` is auto-generated by sqlc — never hand-edited

### Requirements to Structure Mapping

| PRD Feature Domain | Frontend Feature Dir | Backend Handler | Backend Service | Key Screens |
|---|---|---|---|---|
| 4.0a Landing Page | `classlite-landing/` (Astro) | N/A (static site at `classlite.app`) | N/A | Landing, Pricing, Terms, Privacy |
| 4.0b Authentication | `auth/` | `auth_handler` | `auth_service` | Login, Register, Verify, Reset, Invite |
| 4.1 Onboarding | `onboarding/` | `auth_handler`, `center_handler` | `auth_service`, `center_service`, `class_service` | s00–s09 |
| 4.2 Center Management | `settings/` | `center_handler` | `center_service` | s49 |
| 4.3 Roles & Permissions | `people/` | `staff_handler` | `staff_service` | s44 |
| 4.4 Class Management | `classes/` | `class_handler`, `template_handler` | `class_service`, `template_service` | s07–s10, s19–s22 |
| 4.5 Scheduling | `sessions/` | `session_handler` | `session_service` | s11–s14 |
| 4.6 Exercise Authoring | `exercises/` | `exercise_handler` | `exercise_service` | s15–s17 |
| 4.7 AI Content Gen | `exercises/` (AIGenerateDialog) | `exercise_handler` | `exercise_service`, `job_service` | s17 |
| 4.8 Assignments | `assignments/` | `assignment_handler`, `submission_handler` | `assignment_service`, `submission_service` | s33–s35 |
| 4.9 Grading | `grading/` | `grading_handler`, `submission_handler` | `grading_service` | s23–s25 |
| 4.10 Anchored Q&A | `questions/` | `question_handler` | `question_service` | s18, s36 |
| 4.11 People Management | `people/`, `students/` | `staff_handler`, `student_handler`, `enrollment_handler` | `staff_service`, `student_service`, `enrollment_service` | s39–s44, s10a |
| 4.12 Analytics | `analytics/` | `analytics_handler` | `analytics_service` | s45–s49 |
| 4.13 Knowledge Hub | `knowledge-hub/` | `knowledge_hub_handler`, `upload_handler` | `knowledge_hub_service`, `upload_service` | s26–s27 |
| 4.14 Inbox | `inbox/` | `inbox_handler` | `inbox_service` | s50–s52 |
| 4.15 Archive | `archive/` | (reuses class/exercise handlers with archive filter) | (reuses existing services) | s28 |
| 4.16 Billing | `billing/` | `billing_handler` | `billing_service` | s68–s73 |
| 4.17 Search | `search/` | `search_handler` | `search_service` | (⌘K palette) |
| 4.18 User Profile | `settings/` | `auth_handler` | `auth_service` | s38 |

### Cross-Cutting Concerns Mapping

| Concern | Frontend Location | Backend Location |
|---|---|---|
| Authentication | `hooks/useAuth.ts`, `lib/query-client.ts`, `features/auth/*` | `middleware/auth.go`, `middleware/verified.go`, `service/auth_service.go`, `service/email_service.go` |
| Multi-tenancy | `hooks/useCurrentCenter.ts` | `middleware/tenant.go`, `model/tenant.go`, `store/db.go` |
| Role-based access | `hooks/useRole.ts`, `components/shared/Sidebar.tsx` | `middleware/role.go`, `model/roles.go` |
| i18n | `lib/i18n.ts`, `locales/*.json` | N/A (API returns keys, not translated strings) |
| Error handling | `components/shared/ErrorBoundary.tsx`, `lib/query-client.ts` | `model/errors.go`, error mapping middleware |
| File uploads | `components/domain/FileUploader.tsx` | `handler/upload_handler.go`, `service/upload_service.go` |
| AI jobs | `features/grading/useGrading.ts` (polling) | `worker/*.go`, `service/job_service.go` |
| Plan limits | `features/billing/PlanLimitBanner.tsx` | `service/billing_service.go` (enforced in relevant services) |
| Observability | Sentry SDK | `middleware/request_id.go`, `middleware/logger.go`, Sentry SDK |

### External Integration Points

| Integration | Protocol | Owner (Go package) | Notes |
|---|---|---|---|
| Google Gemini | HTTPS REST | `worker/ai_grade_*.go`, `worker/ai_generate.go` | Async via job queue. Credits metered in `billing_service` |
| Polar.sh | HTTPS REST + webhooks | `service/billing_service.go` | No raw payment data. Webhook endpoint for payment events |
| Google OAuth | OAuth 2.0 | `service/auth_service.go` | Token exchange server-side. Mandatory for MVP (FR-81) |
| Google Meet | OAuth + Calendar API | `service/session_service.go` | Auto-generate meeting links |
| Resend | HTTPS REST | `service/email_service.go` | Verification, password reset, staff invites. Go SDK: `github.com/resend/resend-go/v2` |
| Cloudflare R2 | S3-compatible API | `service/upload_service.go` | Presigned URLs only — Go never proxies blobs |
| Sentry | HTTPS | Both services | Error tracking + performance monitoring |

### Development Workflow

**Local development:**
- `docker-compose up` starts Postgres + pgAdmin
- `cd classlite-api && go run cmd/api/main.go` starts the API
- `cd classlite-web && npm run dev` starts Vite dev server with HMR
- Vite dev server proxies `/api/*` to Go API (configured in `vite.config.ts`). In production, `my.classlite.app` calls `api.classlite.app` directly (CORS configured)
- `scripts/codegen.sh` regenerates sqlc output + TS client + Zod schemas

**Build process:**
- Landing: `cd classlite-landing && astro build` → static HTML in `dist/` → Cloudflare Pages (`classlite.app`)
- Dashboard: `cd classlite-web && vite build` → static assets in `dist/` → Cloudflare Pages (`my.classlite.app`)
- Backend: `go build -o classlite-api cmd/api/main.go` → single binary in Docker container → Railway (`api.classlite.app`)

**Deployment:**
- Push to `main` → GitHub Actions CI runs → on pass, auto-deploys trigger
- `classlite-landing/` → Cloudflare Pages (`classlite.app`)
- `classlite-web/` → Cloudflare Pages (`my.classlite.app`)
- `classlite-api/` → Railway (`api.classlite.app`)
- Migrations run as part of API startup (or as a separate Railway deploy command)
- Cloudflare Pages build commands: `cd classlite-landing && npm run build` / `cd classlite-web && npm run build`

## Architecture Validation Results

### Coherence Validation ✅

**Decision Compatibility:** All technology choices are compatible and work together without conflicts. Vite 8 + React 19 + TypeScript + shadcn/ui is a proven frontend stack. Go stdlib + pgx + sqlc is a well-trodden backend path. PostgreSQL RLS works directly with pgx without ORM interference.

**Pattern Consistency:** Naming conventions are consistent across all layers. Layer conventions are structurally enforced. TenantContext provides compile-time safety that aligns with RLS decisions. Error types map cleanly from Go domain errors → HTTP status → frontend error display.

**Structure Alignment:** Project tree implements all patterns defined in step 5. Feature directories map to PRD domains. Import boundaries are enforceable via ESLint + barrel files. Worker is correctly positioned as a peer entry point.

### Requirements Coverage Validation ✅

**Functional Requirements:** All 81 FRs across 21 PRD feature domains have clear architectural support. Every FR maps to a specific frontend feature directory, backend handler, and service.

**Non-Functional Requirements:** All 6 NFRs are architecturally addressed:
- i18n: react-i18next with runtime switch
- Multi-tenancy: RLS + TenantContext compile-time safety + null-guard
- Performance: Code splitting, Vite 8 Rolldown bundler, Cloudflare CDN
- Security: Roll-your-own JWT, rate limiting, tenant assertion, CORS
- Accessibility: shadcn/ui (Radix-based WCAG AA), keyboard navigation
- Data integrity: Immutable submissions, audit logs, soft deletes, schema versioning

### Implementation Readiness Validation ✅

**Decision Completeness:** All critical and important decisions documented with rationale. Technology versions verified via web search. Clear implementation sequence defined.

**Structure Completeness:** Complete project tree with all directories and key files specified. Requirements-to-structure mapping table provides clear guidance.

**Pattern Completeness:** Naming, structure, format, communication, and process patterns all defined with examples. Enforcement rules + CI verification specified.

### Gap Analysis Results

**Critical Gaps:** None.

**Important Gaps (resolve in first implementation sprint):**
1. Rich text editor library (Tiptap / Slate / Lexical) — affects WritingEditor and grading comment rendering
2. Testing framework for React (Vitest recommended) and E2E (Playwright recommended)
3. OpenAPI generation tooling exact versions and CLI commands
4. ~~**Transactional email provider**~~ **RESOLVED** — Resend (`github.com/resend/resend-go/v2`). Sending domain: `classlite.app` (requires DNS records in Cloudflare)
5. ~~**Landing page framework**~~ **RESOLVED** — Astro static site, separate from the React SPA. Hosted at `classlite.app` via Cloudflare Pages

**Nice-to-Have (post-MVP):**
- Storybook for component documentation
- Database seeding strategy for demo/staging
- Performance monitoring dashboards

### Architecture Completeness Checklist

**Requirements Analysis**
- [x] Project context thoroughly analyzed
- [x] Scale and complexity assessed
- [x] Technical constraints identified
- [x] Cross-cutting concerns mapped

**Architectural Decisions**
- [x] Critical decisions documented with versions
- [x] Technology stack fully specified
- [x] Integration patterns defined
- [x] Performance considerations addressed

**Implementation Patterns**
- [x] Naming conventions established
- [x] Structure patterns defined
- [x] Communication patterns specified
- [x] Process patterns documented

**Project Structure**
- [x] Complete directory structure defined
- [x] Component boundaries established
- [x] Integration points mapped
- [x] Requirements to structure mapping complete

### Architecture Readiness Assessment

**Overall Status:** READY FOR IMPLEMENTATION

**Confidence Level:** High — all 16 checklist items pass, no critical gaps, all 81 FRs covered.

**Key Strengths:**
- Compile-time tenant safety via TenantContext (prevents class of data leaks)
- Spec-first OpenAPI prevents frontend/backend drift
- Clear separation of concerns (feature isolation, layer convention, worker as peer)
- AI grading pipeline fully designed (async job queue, progressive polling, state machine)
- Practical scalability conventions (service split rule, sub-service pattern)

**Areas for Future Enhancement:**
- Redis caching when performance bottlenecks appear
- Real-time notifications via SSE if polling proves insufficient
- Email notifications for critical events
- Additional OAuth providers

### Implementation Handoff

**AI Agent Guidelines:**
- Follow all architectural decisions exactly as documented
- Use implementation patterns consistently across all components
- Respect project structure and boundaries (handler → service → store, feature isolation)
- Refer to this document for all architectural questions
- When in doubt about where code goes, check the Requirements to Structure Mapping table

**First Implementation Priority:**
1. Initialize monorepo structure + Docker + Railway config + Cloudflare DNS setup
2. Go API skeleton: `cmd/api/main.go` + middleware chain (including `verified.go`) + config loader
3. PostgreSQL schema + RLS policies + golang-migrate (including auth tables)
4. Adversarial test suite for auth/RLS
5. Resend email service + auth system (full FR-75 through FR-81)
6. Dashboard scaffold: Vite + React + shadcn/ui + react-i18next + React Router → `my.classlite.app`
7. Auth feature pages (login, register, verify, reset, invite accept)
8. Astro landing site → `classlite.app`
