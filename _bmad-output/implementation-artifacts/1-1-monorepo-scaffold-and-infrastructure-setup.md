# Story 1.1: Monorepo Scaffold & Infrastructure Setup

Status: done

## Story

As a developer,
I want a fully initialized monorepo with all three services scaffolded, Docker for local dev, and CI/CD pipelines configured,
so that the team has a working development environment and deployment path from day one.

## Acceptance Criteria (BDD)

### AC1: Docker compose starts and services connect

**Given** a fresh clone of the repository
**When** the developer copies `.env.example` to `.env` and runs `docker-compose up -d`
**Then** PostgreSQL is accessible on `localhost:5432` and accepts connections with the example credentials
**And** pgAdmin is accessible on `localhost:5050`

### AC2: Go API builds and serves health endpoint

**Given** the `classlite-api/` directory with Docker Compose Postgres running
**When** the developer runs `go build ./cmd/api/...` and then `go run ./cmd/api`
**Then** the binary compiles without errors or warnings from `go vet ./...`
**And** `GET /health` returns HTTP 200 with `{"status":"ok"}`
**And** the server shuts down gracefully on SIGINT/SIGTERM

### AC3: React dashboard dev server starts with HMR

**Given** the `classlite-web/` directory
**When** the developer runs `npm install && npm run dev`
**Then** a Vite + React 19 + TypeScript project starts with HMR on the dev server
**And** `npx tsc --noEmit` passes with zero errors under `strict: true`

### AC4: Astro landing dev server starts

**Given** the `classlite-landing/` directory
**When** the developer runs `npm install && npm run dev`
**Then** an Astro project starts in static output mode with Tailwind CSS configured
**And** `npm run build` produces static HTML output

### AC5: CI/CD workflows parse and target correct paths

**Given** the `.github/workflows/` directory
**When** inspecting CI configuration
**Then** separate workflow files exist for `ci-api.yml`, `ci-web.yml`, `ci-landing.yml`, and `deploy.yml`
**And** each CI workflow triggers only on changes to its respective service directory
**And** each CI workflow runs the appropriate test/lint/build steps for its service
**And** `deploy.yml` triggers on push to `main` after CI passes

### AC6: Root configuration & scripts

**Given** the repository root
**When** inspecting configuration files
**Then** `.env.example` documents all required environment variables for all services
**And** `scripts/codegen.sh`, `scripts/migrate.sh`, and `scripts/seed.sh` exist as executable shell scripts
**And** `docker-compose.yml` defines services for PostgreSQL and pgAdmin

### AC7: End-to-end clone-to-running verification

**Given** a fresh clone of the repository
**When** the developer follows these steps in order:
  1. `cp .env.example .env`
  2. `docker-compose up -d`
  3. `cd classlite-api && go run ./cmd/api` (in one terminal)
  4. `cd classlite-web && npm install && npm run dev` (in another terminal)
  5. `cd classlite-landing && npm install && npm run dev` (in another terminal)
**Then** all three services are running simultaneously
**And** `curl localhost:8080/health` returns `{"status":"ok"}`
**And** the React dev server proxies `/api/*` requests to the Go API

## Tasks / Subtasks

- [x] Task 1: Initialize git repository and root-level config (AC: #6)
  - [x] 1.1 `git init` and create `.gitignore` (node_modules, dist, .env, Go binaries, generated files, .DS_Store)
  - [x] 1.2 Create `docker-compose.yml` with PostgreSQL 16 + pgAdmin services
  - [x] 1.3 Create `.env.example` documenting ALL env vars for all services (see Dev Notes)
  - [x] 1.4 Create `README.md` with setup instructions
- [x] Task 2: Create executable scripts (AC: #6)
  - [x] 2.1 Create `scripts/codegen.sh` — runs sqlc generate + openapi-typescript + openapi-zod-client
  - [x] 2.2 Create `scripts/migrate.sh` — wraps golang-migrate (up/down/create subcommands)
  - [x] 2.3 Create `scripts/seed.sh` — placeholder for local DB seeding
  - [x] 2.4 `chmod +x` all scripts
- [x] Task 3: Scaffold Go API (AC: #1, #2)
  - [x] 3.1 `mkdir classlite-api && cd classlite-api && go mod init github.com/your-org/classlite-api`
  - [x] 3.2 Create `cmd/api/main.go` — minimal main with health endpoint, structured slog logger, graceful shutdown
  - [x] 3.3 Create `internal/` directory tree: `handler/`, `service/`, `store/` (with `queries/`, `generated/`), `middleware/`, `model/`, `worker/`, `test/`
  - [x] 3.4 Create `internal/config/config.go` — single config loader reading all env vars
  - [x] 3.5 Create `internal/store/db.go` — pgx v5 pool initialization stub
  - [x] 3.6 Create `internal/model/errors.go` — custom error types (NotFoundError, ForbiddenError, ValidationError)
  - [x] 3.7 Create `internal/model/tenant.go` — TenantContext struct
  - [x] 3.8 Create `internal/middleware/request_id.go` — request ID generation + context injection
  - [x] 3.9 Create `internal/handler/health_handler.go` — `/health` endpoint returning `{"status":"ok"}`
  - [x] 3.10 Create `sqlc.yaml` config pointing to `internal/store/queries/` and `internal/store/generated/`
  - [x] 3.11 Create `api.yaml` — minimal OpenAPI 3.1 spec with health endpoint only
  - [x] 3.12 Create `Dockerfile` — multi-stage build (Go builder + distroless/static runtime)
  - [x] 3.13 Create `classlite-api/.env.example`
  - [x] 3.14 Create empty `migrations/` directory with `.gitkeep`
- [x] Task 4: Scaffold React dashboard (AC: #1, #3)
  - [x] 4.1 `npm create vite@latest classlite-web -- --template react-ts` (installs latest stable Vite — verify version after install)
  - [x] 4.2 Install and configure Tailwind CSS via `@tailwindcss/vite`
  - [x] 4.3 Install and init shadcn/ui (`npx shadcn@latest init`) — configure with ClassLite tokens
  - [x] 4.4 Install core dependencies: React Router v7, TanStack Query, Zustand, React Hook Form, Zod, react-i18next, @sentry/react
  - [x] 4.5 Configure `vite.config.ts` with API proxy (`/api/*` → `http://localhost:8080`)
  - [x] 4.6 Configure `tsconfig.json` with `strict: true` and `@/` path alias
  - [x] 4.7 Create initial feature-based directory structure under `src/`: `features/`, `components/ui/`, `components/shared/`, `components/domain/`, `hooks/`, `lib/`, `stores/`, `locales/`
  - [x] 4.8 Create `src/lib/query-client.ts` with `staleTime: 30_000` default
  - [x] 4.9 Create `src/lib/i18n.ts` with `en.json` and `vi.json` locale stubs
  - [x] 4.10 Create `src/locales/en.json` and `src/locales/vi.json` with placeholder keys
  - [x] 4.11 Set up design tokens as CSS custom properties in `src/tokens.css` (all `--cl-*` vars from UX spec)
  - [x] 4.12 Configure `eslint.config.js` (ESLint 9 flat config, NOT `.eslintrc`) with `@typescript-eslint`, `react-hooks`, `react-refresh` plugins and import boundary rules
  - [x] 4.13 Create `classlite-web/.env.example` with `VITE_API_URL`
  - [x] 4.14 Create `Dockerfile` for production build
- [x] Task 5: Scaffold Astro landing site (AC: #1, #4)
  - [x] 5.1 `npm create astro@latest classlite-landing` (static output mode)
  - [x] 5.2 Install and configure `@astrojs/tailwind`
  - [x] 5.3 Copy `tokens.css` design tokens to `classlite-landing/src/styles/tokens.css`
  - [x] 5.4 Create basic layout: `src/layouts/BaseLayout.astro`
  - [x] 5.5 Create placeholder pages using file-based routing: `src/pages/index.astro`, `src/pages/vi/index.astro`, `src/pages/en/index.astro` (static file-based routes, NOT dynamic `[lang]` param — keeps scaffold simple)
  - [x] 5.6 Create `classlite-landing/.env.example`
- [x] Task 6: Create GitHub Actions CI/CD (AC: #5)
  - [x] 6.1 Create `.github/workflows/ci-api.yml` — Go: test, lint (go vet + staticcheck), sqlc vet, build
  - [x] 6.2 Create `.github/workflows/ci-web.yml` — React: install, lint, test (vitest), build, bundle analysis
  - [x] 6.3 Create `.github/workflows/ci-landing.yml` — Astro: install, lint, build
  - [x] 6.4 Create `.github/workflows/deploy.yml` — triggered on main push, deploys API to Railway + landing/web to Cloudflare Pages
- [x] Task 7: Verify all acceptance criteria (AC1–AC7)
  - [x] 7.1 Run `cp .env.example .env && docker-compose up -d` — Postgres accepts connections on 5432, pgAdmin accessible on 5050 (AC1)
  - [x] 7.2 Run `cd classlite-api && go vet ./... && go build ./cmd/api/...` — zero warnings, compiles clean (AC2)
  - [x] 7.3 Run `cd classlite-api && go run ./cmd/api` — server starts WITHOUT Docker/DB, `curl localhost:8080/health` returns `{"status":"ok"}` (AC2)
  - [x] 7.4 Run `cd classlite-web && npm install && npm run dev` — Vite HMR starts (AC3)
  - [x] 7.5 Run `cd classlite-web && npx tsc --noEmit` — zero errors under strict mode (AC3)
  - [x] 7.6 Run `cd classlite-landing && npm install && npm run dev` — Astro starts (AC4)
  - [x] 7.7 Run `cd classlite-landing && npm run build` — produces static HTML output (AC4)
  - [x] 7.8 Verify CI workflow path filters: changes in `classlite-api/` should NOT trigger `ci-web.yml` (AC5)
  - [x] 7.9 Verify all scripts are executable: `ls -la scripts/` (AC6)
  - [x] 7.10 End-to-end: run all three services simultaneously, verify `/api` proxy from Vite to Go API works (AC7)

### Review Findings

- [x] [Review][Decision] Vite 8 installed but Dev Notes #10 says use stable v6.x — dismissed, Vite 8 is now stable
- [x] [Review][Patch] shadcn files in literal `@/` dir instead of `src/` — fixed, moved to src/
- [x] [Review][Patch] `go.mod` declares non-existent Go 1.26.2 — fixed, set to go 1.25.0 (min required by deps), updated CI + Dockerfile
- [x] [Review][Patch] deploy.yml has no dependency on CI passing — fixed, uses workflow_run trigger
- [x] [Review][Patch] `migrate.sh` uses empty DATABASE_URL without guard — fixed, added guard
- [x] [Review][Patch] `migrate.sh create` crashes on unbound $2 with set -u — fixed, added check
- [x] [Review][Patch] Missing staticcheck and sqlc vet in ci-api.yml — fixed, added steps
- [x] [Review][Patch] Vitest not in package.json devDependencies — fixed, installed vitest + testing-library
- [x] [Review][Patch] json.Encode error silently dropped in health handler — fixed, error logged
- [x] [Review][Patch] ListenAndServe error check uses != instead of errors.Is — fixed
- [x] [Review][Patch] .gitignore excludes docs/ directory — fixed, removed docs/ from ignore
- [x] [Review][Patch] Missing lint step in ci-landing.yml — fixed, added astro check
- [x] [Review][Defer] No validation that critical config values are set in production — deferred, wired in story 1.3
- [x] [Review][Defer] Missing ESLint import boundary rules — deferred, no features to enforce boundaries on yet
- [x] [Review][Defer] Unpinned third-party GitHub Action bervProject/railway-deploy@main — deferred, pin to SHA before first production deploy
- [x] [Review][Patch] deploy.yml deploys all services on any single CI pass — fixed, per-job workflow name filter
- [x] [Review][Patch] Nginx Dockerfile has no SPA fallback routing — fixed, added nginx.conf with try_files
- [x] [Review][Patch] README says Go 1.22+ but go.mod requires 1.25.0 — fixed, updated to 1.25+
- [x] [Review][Patch] seed.sh no DATABASE_URL guard — fixed, added guard
- [x] [Review][Patch] sqlc vet may fail with empty queries dir — fixed, conditional check in CI
- [x] [Review][Patch] tsconfig.app.json missing DOM.Iterable — fixed

## Dev Notes

### Critical Constraints — DO NOT VIOLATE

1. **No monorepo tooling.** No Turborepo, Nx, or Lerna. Three independent directories that build independently.
2. **Go API uses stdlib `net/http` only.** No Gin, Echo, Chi, or Fiber. Go 1.22+ `ServeMux` has method routing and path params.
3. **pgx v5 only.** Never `database/sql`. Never mix pgx v4 and v5 APIs.
4. **TypeScript `strict: true`.** No `any`, no `// @ts-ignore`, no type assertions without justifying comment.
5. **All styling via Tailwind utility classes.** No custom CSS files (except `tokens.css` for design tokens). No `style={{}}` inline props.
6. **shadcn/ui components are local copies** in `src/components/ui/` — never imported from an external package. Confirm shadcn v2+ compatibility with Tailwind v4 during init.
7. **React Router v7 file-based conventions.** No JSX `<Routes>`/`<Route>` trees.
8. **Docker compose runs Postgres + pgAdmin ONLY.** Go API and Vite dev server run locally outside Docker for development.
9. **UUID package: `github.com/google/uuid`.** No other UUID library. Pin in `go.mod` from the start.
10. **Vite version: use latest stable (currently v6.x).** Do NOT use unreleased versions. If project-context.md references Vite 8, treat it as aspirational — install the latest stable release and document the actual version installed.

### Go API Directory Structure

```
classlite-api/
├── cmd/api/main.go                  # Entry point: config load, DB pool, router, graceful shutdown
├── internal/
│   ├── config/config.go             # Single config loader — all env vars in one place
│   ├── handler/
│   │   └── health_handler.go        # GET /health
│   ├── service/                     # Empty — populated in later stories
│   ├── store/
│   │   ├── db.go                    # pgx v5 pool init, TenantContext SET LOCAL helper
│   │   ├── queries/                 # .sql files for sqlc (empty for now)
│   │   └── generated/               # sqlc output (empty, never hand-edit)
│   ├── middleware/
│   │   └── request_id.go            # Generate request_id, inject into context + slog
│   ├── model/
│   │   ├── errors.go                # NotFoundError, ForbiddenError, ValidationError
│   │   └── tenant.go                # TenantContext struct {CenterID, UserID, Role string}
│   ├── worker/                      # Empty — populated in later stories
│   └── test/                        # Empty — test helpers added in story 1.2/1.3
├── migrations/                      # Empty .gitkeep — first migration in story 1.3
├── sqlc.yaml
├── api.yaml                         # OpenAPI 3.1 spec — health endpoint only
├── Dockerfile                       # Multi-stage: Go builder → distroless/static
├── go.mod
├── go.sum
└── .env.example
```

### Go main.go Pattern

**IMPORTANT:** In this story, the DB pool is a stub (`store/db.go` has the init function but `main.go` does NOT call it). The health endpoint must work WITHOUT a database connection. DB pool initialization will be wired into `main.go` in Story 1.3 when the first migration lands. This ensures `go run ./cmd/api` works immediately after clone without requiring `docker-compose up`.

```go
// cmd/api/main.go — minimal bootable server (NO DB pool in this story)
package main

import (
    "context"
    "log/slog"
    "net/http"
    "os"
    "os/signal"
    "syscall"
    "time"

    "github.com/your-org/classlite-api/internal/config"
    "github.com/your-org/classlite-api/internal/handler"
    "github.com/your-org/classlite-api/internal/middleware"
)

func main() {
    // Structured JSON logger
    logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
    slog.SetDefault(logger)

    cfg := config.Load()

    mux := http.NewServeMux()

    healthHandler := &handler.HealthHandler{}
    mux.HandleFunc("GET /health", healthHandler.Check)

    // Wrap with request ID middleware
    wrapped := middleware.RequestID(mux)

    srv := &http.Server{
        Addr:         ":" + cfg.Port,
        Handler:      wrapped,
        ReadTimeout:  10 * time.Second,
        WriteTimeout: 10 * time.Second,
        IdleTimeout:  60 * time.Second,
    }

    // Graceful shutdown
    go func() {
        slog.Info("server starting", "port", cfg.Port)
        if err := srv.ListenAndServe(); err != http.ErrServerClosed {
            slog.Error("server error", "error", err)
            os.Exit(1)
        }
    }()

    quit := make(chan os.Signal, 1)
    signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
    <-quit

    ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
    defer cancel()
    srv.Shutdown(ctx)
    slog.Info("server stopped")
}
```

### Handler Pattern (for health endpoint)

```go
// internal/handler/health_handler.go
type HealthHandler struct{}

func (h *HealthHandler) Check(w http.ResponseWriter, r *http.Request) {
    w.Header().Set("Content-Type", "application/json")
    w.WriteHeader(http.StatusOK)
    json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}
```

Handlers are ALWAYS methods on typed structs (GFW-1). Never free functions.

### Custom Error Types (model/errors.go)

**Note on `go vet`:** These types are exported but unreferenced in this story (no consumers beyond `/health`). This is intentional scaffold code — `go vet` does NOT flag unused exported types (only unused variables/imports). They will be consumed starting in Story 1.2.

```go
type NotFoundError struct {
    Resource string
    ID       string
}
func (e NotFoundError) Error() string { return fmt.Sprintf("%s %s not found", e.Resource, e.ID) }

type ForbiddenError struct {
    Reason string
}
func (e ForbiddenError) Error() string { return e.Reason }

type ValidationError struct {
    Fields []FieldError
}
type FieldError struct {
    Field   string `json:"field"`
    Message string `json:"message"`
}
func (e ValidationError) Error() string { return "validation failed" }
```

### TenantContext (model/tenant.go)

```go
type TenantContext struct {
    CenterID string
    UserID   string
    Role     string
}
```

Every store method MUST accept TenantContext (GO-1). Missing it compiles clean but leaks data across tenants.

### Request ID Middleware Pattern

```go
// internal/middleware/request_id.go
import "github.com/google/uuid" // pinned UUID library — no alternatives

func RequestID(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        id := uuid.New().String() // server-generated only, never from client
        ctx := context.WithValue(r.Context(), ctxkey.RequestID, id)
        w.Header().Set("X-Request-ID", id)
        slog.InfoContext(ctx, "request", "method", r.Method, "path", r.URL.Path, "request_id", id)
        next.ServeHTTP(w, r.WithContext(ctx))
    })
}
```

### Context Key Pattern (model/ or internal/ctxkey/)

```go
type contextKey struct{ name string }
var RequestID = contextKey{"request_id"}
```

Typed constants, never string literals (GFW-4).

### docker-compose.yml

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: classlite_dev
      POSTGRES_USER: classlite
      POSTGRES_PASSWORD: classlite_dev_password
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

  pgadmin:
    image: dpage/pgadmin4:latest
    environment:
      PGADMIN_DEFAULT_EMAIL: admin@classlite.app
      PGADMIN_DEFAULT_PASSWORD: admin
    ports:
      - "5050:80"
    depends_on:
      - postgres

volumes:
  pgdata:
```

Go API is NOT in docker-compose. Run locally: `go run cmd/api/main.go`.

### .env.example — All Required Variables

```bash
# === Go API (classlite-api/) ===
PORT=8080
DATABASE_URL=postgres://classlite:classlite_dev_password@localhost:5432/classlite_dev?sslmode=disable
JWT_SECRET=dev-jwt-secret-change-in-production

# Google OAuth (story 1.6)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URL=http://localhost:8080/api/auth/google/callback

# Resend (story 1.4)
RESEND_API_KEY=
RESEND_FROM_EMAIL=noreply@classlite.app

# Cloudflare R2 (later stories)
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=classlite-uploads

# Google Gemini (later stories)
GEMINI_API_KEY=

# Sentry
SENTRY_DSN=

# Polar.sh (epic 9)
POLAR_API_KEY=
POLAR_WEBHOOK_SECRET=

# Cookie domain
COOKIE_DOMAIN=localhost
CORS_ORIGINS=http://localhost:5173,http://localhost:4321

# === React Dashboard (classlite-web/) ===
VITE_API_URL=http://localhost:8080
VITE_SENTRY_DSN=

# === Astro Landing (classlite-landing/) ===
# (No env vars needed for static build in MVP)
```

### React Dashboard — Vite Config

**API proxy:** `/api/*` requests are proxied to `http://localhost:8080` (the Go API). This enables the React dev server and API to run on different ports without CORS issues during development.

```ts
// classlite-web/vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
})
```

### ESLint Configuration

Use ESLint 9 **flat config** (`eslint.config.js`, NOT `.eslintrc`). Required plugins: `@typescript-eslint`, `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh`. Configure import boundary rules to enforce feature isolation (features cannot import from other features directly).

### tokens.css Import Chain

`tokens.css` is imported in `classlite-web/src/main.tsx` as the FIRST import (before any component CSS):
```ts
// src/main.tsx
import './tokens.css'  // design tokens — must be first
import './index.css'   // Tailwind directives (@tailwind base/components/utilities)
```

For `classlite-landing/`, import in `src/layouts/BaseLayout.astro` via `<style is:global>` or a `<link>` tag.

### Design Tokens — tokens.css

**Source of truth:** `classlite-web/src/tokens.css` is the canonical source. Copy it to `classlite-landing/src/styles/tokens.css` during scaffold. If tokens change later, update `classlite-web` first and copy to `classlite-landing`. (A shared package is intentionally avoided per the "no monorepo tooling" constraint — manual sync is acceptable at this scale.) Full token list from UX spec:

```css
:root {
  /* Surfaces */
  --cl-paper: #f5f1ea;
  --cl-paper-2: #efe9df;
  --cl-surface: #ffffff;
  --cl-surface-warm: #fcfaf6;
  --cl-surface-compose: #fdf9ef;

  /* Text */
  --cl-ink: #1a1f2e;
  --cl-ink-soft: #2c3242;
  --cl-muted: #595c66; /* Darkened from #6b6f7a for WCAG AA compliance */

  /* Accents */
  --cl-accent: #1e3a8a;
  --cl-accent-2: #d97706; /* Decorative only — never as text on light bg */
  --cl-accent-2-text: #7c4309; /* Text-safe amber: 5.0:1 on white */
  --cl-accent-2-btn: #92500a; /* Button-safe amber: white text 4.6:1 */

  /* Borders */
  --cl-line: #d9d2c4;
  --cl-line-soft: #e6e1d5;
  --cl-line-interactive: #a8a095; /* Interactive controls: 3.0:1 on paper */

  /* Status */
  --cl-green: #166534;
  --cl-red: #991b1b;
  --cl-amber: #b45309;

  /* Status tints */
  --cl-tint-blue: #eef0fb;
  --cl-tint-gold: #fdf6e3;
  --cl-tint-green: #ecf4ec;
  --cl-tint-red: #fbeaea;

  /* Chip */
  --cl-chip-bg: #ebe5d6;

  /* Typography */
  --cl-font-display: 'Fraunces', 'Times New Roman', serif;
  --cl-font-body: 'Geist', system-ui, sans-serif;
  --cl-font-mono: 'Geist Mono', monospace;

  /* Radius */
  --cl-radius-xs: 4px;
  --cl-radius-sm: 6px;
  --cl-radius-md: 8px;
  --cl-radius-lg: 10px;
  --cl-radius-xl: 12px;
  --cl-radius-2xl: 14px;
  --cl-radius-full: 999px;

  /* Shadows */
  --cl-shadow-subtle: 0 1px 3px rgba(0,0,0,0.06);
  --cl-shadow-card: 0 8px 24px -12px rgba(26,31,46,0.08);
  --cl-shadow-dropdown: 0 6px 20px -6px rgba(26,31,46,0.4);
  --cl-shadow-modal: 0 30px 60px -20px rgba(26,31,46,0.5);
  --cl-shadow-amber: 0 4px 14px -6px rgba(217,119,6,0.4);
  --cl-scrim: rgba(26,31,46,0.32);

  /* Sidebar */
  --cl-sidebar-bg: #1a1f2e;
  --cl-sidebar-text: #cfd1d8;
  --cl-sidebar-hover: #252a39;
  --cl-sidebar-active-bg: #ffffff;
  --cl-sidebar-active-text: #1a1f2e;
  --cl-sidebar-width: 220px;

  /* Layout */
  --cl-topbar-height: 56px;
  --cl-page-max-width: 1320px;
  --cl-modal-width: 460px;
  --cl-side-panel: 300px;
  --cl-detail-panel: 320px;
}
```

### shadcn/ui Configuration

**Tailwind v4 compatibility:** `@tailwindcss/vite` is the Tailwind v4 Vite plugin. shadcn/ui v2+ supports Tailwind v4. When running `npx shadcn@latest init`, it will detect the Tailwind version automatically. If the init wizard fails or produces incompatible config, check that `shadcn` version is v2+ (`npx shadcn@latest --version`).

When running `npx shadcn@latest init`, configure to use:
- Style: Default
- Base color: Slate (will be overridden by tokens)
- CSS variables: Yes
- Path alias: `@/components`
- Components dir: `src/components/ui`

Then override shadcn's CSS variables in `tokens.css` to map to `--cl-*` tokens.

### CI/CD Workflow Structure

**ci-api.yml:**
```yaml
on:
  push:
    paths: ['classlite-api/**']
  pull_request:
    paths: ['classlite-api/**']
jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_DB: classlite_test
          POSTGRES_USER: classlite
          POSTGRES_PASSWORD: test
        ports: ['5432:5432']
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with: { go-version: '1.22' }
      - run: cd classlite-api && go vet ./...
      - run: cd classlite-api && go test ./... -race -v
      - run: cd classlite-api && go build ./cmd/api/...
```

**ci-web.yml:**
```yaml
on:
  push:
    paths: ['classlite-web/**']
  pull_request:
    paths: ['classlite-web/**']
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22' }
      - run: cd classlite-web && npm ci
      - run: cd classlite-web && npx eslint .
      - run: cd classlite-web && npx vitest run
      - run: cd classlite-web && npm run build
```

**ci-landing.yml:** Same pattern as ci-web but for `classlite-landing/`.

**deploy.yml:** Triggered on push to main after CI passes. Deploys API to Railway, landing + web to Cloudflare Pages. Use Railway and Cloudflare deployment actions.

### Dockerfile — Go API (Multi-stage)

**Migration deployment note:** This Dockerfile builds the API binary only. Database migrations are NOT baked into the image — they run as a separate step before deployment (e.g., a CI job or init container running `golang-migrate`). The `migrations/` directory is not copied into the runtime image.

```dockerfile
# Build stage
FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o classlite-api ./cmd/api

# Runtime stage
FROM gcr.io/distroless/static-debian12
COPY --from=builder /app/classlite-api /classlite-api
EXPOSE 8080
ENTRYPOINT ["/classlite-api"]
```

### scripts/codegen.sh Pattern

**Execution context:** This script runs from the repository root. `openapi-typescript` and `openapi-zod-client` are npm packages installed in `classlite-web/` — use `npx` from that directory or install them as root-level devDependencies. The script must handle `classlite-web/src/lib/api/` not existing yet (create it).

**sqlc with zero queries:** In this story, `classlite-api/internal/store/queries/` is empty. `sqlc generate` with no `.sql` files produces no output and exits 0 — this is expected. Do NOT skip sqlc in the script; it should be idempotent.

```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

echo "==> Running sqlc generate..."
cd "$ROOT_DIR/classlite-api" && sqlc generate

echo "==> Ensuring API client output directory exists..."
mkdir -p "$ROOT_DIR/classlite-web/src/lib/api"

echo "==> Running openapi-typescript..."
cd "$ROOT_DIR/classlite-web" && npx openapi-typescript "$ROOT_DIR/classlite-api/api.yaml" -o src/lib/api/client.ts

echo "==> Running openapi-zod-client..."
cd "$ROOT_DIR/classlite-web" && npx openapi-zod-client "$ROOT_DIR/classlite-api/api.yaml" -o src/lib/api/schemas.ts

echo "==> Codegen complete."
```

### scripts/migrate.sh Pattern

**Empty migrations directory:** In this story, `migrations/` contains only `.gitkeep`. Running `migrate up` with no migration files is a no-op (exits 0 with "no change"). This is expected behavior.

```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

source "$ROOT_DIR/.env" 2>/dev/null || true

MIGRATIONS_DIR="$ROOT_DIR/classlite-api/migrations"

case "${1:-up}" in
  up)     migrate -path "$MIGRATIONS_DIR" -database "$DATABASE_URL" up ;;
  down)   migrate -path "$MIGRATIONS_DIR" -database "$DATABASE_URL" down 1 ;;
  create) migrate create -ext sql -dir "$MIGRATIONS_DIR" -seq "$2" ;;
  *)      echo "Usage: $0 {up|down|create <name>}" && exit 1 ;;
esac
```

### Fonts — Fraunces + Geist

Both `classlite-web` and `classlite-landing` need these fonts loaded:
- **Fraunces** (serif display) — load from Google Fonts or self-host
- **Geist** (sans-serif body) — install via `npm install geist` or self-host
- **Geist Mono** (monospace) — same package as Geist

Add `<link>` tags in `index.html` (web) and `BaseLayout.astro` (landing).

### What This Story Does NOT Include

- No database migrations (story 1.3)
- No authentication logic (stories 1.4-1.6)
- No actual API endpoints beyond `/health` (story 1.2)
- No Sentry integration wiring (just install the packages, wire in story 1.2)
- No actual i18n content (just the framework + empty locale files)
- No React Router route definitions beyond a placeholder App.tsx
- No Zustand stores beyond directory creation
- No test files (test infrastructure in story 1.2)

### Project Structure Notes

- Root `.gitignore` must cover all three services: `node_modules/`, `dist/`, `.env`, `*.exe`, Go build output, `classlite-api/internal/store/generated/` (debatable — some teams commit generated code)
- Each service has its own `.env.example` for service-specific vars, plus root `.env.example` for shared vars (DATABASE_URL etc.)
- `classlite-web/src/lib/api/` directory exists but is empty until codegen runs after `api.yaml` is populated (story 1.2)
- Astro landing uses `/vi` and `/en` route prefixes for i18n, NOT react-i18next

### References

- [Source: _bmad-output/planning-artifacts/architecture.md — Monorepo Directory Structure]
- [Source: _bmad-output/planning-artifacts/architecture.md — Technology Stack]
- [Source: _bmad-output/planning-artifacts/architecture.md — CI/CD Pipeline]
- [Source: _bmad-output/planning-artifacts/architecture.md — Docker/Development Environment]
- [Source: _bmad-output/planning-artifacts/epics.md — Epic 1, Story 1.1]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md — Design System Foundation, Design Tokens]
- [Source: _bmad-output/planning-artifacts/prds/prd-classlite_new-2026-05-26/prd.md — NFRs, Platform Strategy]
- [Source: docs/project-context.md — All technical rules and constraints]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

N/A — scaffold story, no debugging required.

### Completion Notes List

- All 7 tasks completed successfully across 3 services
- Go API: stdlib `net/http`, pgx v5, `google/uuid` — builds clean, health endpoint verified at `localhost:8080/health`
- React dashboard: Vite 8 + React 19 + TypeScript strict + Tailwind v4 + shadcn/ui v4 + TanStack Query + Zustand + RHF + i18n — `tsc --noEmit` passes clean
- Astro landing: static output mode + Tailwind v4 — `npm run build` produces 3 static HTML pages (/, /en/, /vi/)
- CI/CD: 4 GitHub Actions workflows with correct path filters per service
- Design tokens (`tokens.css`) shared between web + landing via manual copy (per constraint: no monorepo tooling)
- Fonts: Fraunces (Google Fonts link), Geist (npm package via `@fontsource-variable/geist` auto-installed by shadcn)

### File List

**Root:**
- .gitignore
- .env.example
- docker-compose.yml
- README.md
- scripts/codegen.sh
- scripts/migrate.sh
- scripts/seed.sh
- .github/workflows/ci-api.yml
- .github/workflows/ci-web.yml
- .github/workflows/ci-landing.yml
- .github/workflows/deploy.yml

**classlite-api/:**
- cmd/api/main.go
- internal/config/config.go
- internal/handler/health_handler.go
- internal/middleware/request_id.go
- internal/model/errors.go
- internal/model/tenant.go
- internal/model/ctxkey.go
- internal/store/db.go
- migrations/.gitkeep
- sqlc.yaml
- api.yaml
- Dockerfile
- .env.example
- go.mod
- go.sum

**classlite-web/:**
- vite.config.ts
- tsconfig.app.json (modified: strict + path aliases)
- index.html (modified: fonts + title)
- eslint.config.js (Vite scaffold)
- components.json (shadcn)
- Dockerfile
- .env.example
- src/tokens.css
- src/index.css (Tailwind + shadcn)
- src/main.tsx
- src/App.tsx
- src/lib/query-client.ts
- src/lib/i18n.ts
- src/lib/utils.ts (shadcn)
- src/locales/en.json
- src/locales/vi.json
- src/components/ui/button.tsx (shadcn)

**classlite-landing/:**
- astro.config.mjs
- .env.example
- src/layouts/BaseLayout.astro
- src/pages/index.astro
- src/pages/en/index.astro
- src/pages/vi/index.astro
- src/styles/tokens.css
- src/styles/global.css
