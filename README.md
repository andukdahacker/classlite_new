# ClassLite v2

Multi-tenant education management platform for IELTS centers in Vietnam.

## Architecture

Monorepo with three independent services:

- **classlite-api/** — Go API (stdlib `net/http`, PostgreSQL + pgx v5, sqlc)
- **classlite-web/** — React 19 dashboard (Vite, TanStack Query, Tailwind CSS)
- **classlite-landing/** — Astro landing site (static HTML, Cloudflare Pages)

## Prerequisites

- Go 1.25+
- Node.js 22+
- Docker & Docker Compose
- [golang-migrate](https://github.com/golang-migrate/migrate) CLI
- [sqlc](https://docs.sqlc.dev/en/latest/overview/install.html) CLI

## Quick Start

One command brings up the whole stack — Postgres (+pgAdmin), migrations, the
Go API, the React dashboard, and the Astro landing site — and tears it down on
Ctrl-C:

```bash
cp .env.example .env   # first time only, then edit
./scripts/dev.sh       # DB + migrate + API + web + landing; Ctrl-C stops everything (data preserved)
```

Flags: `--clean` wipes the DB volume on exit · `--seed` runs `scripts/seed.sh`
after migrating · `--no-web` skips the dashboard · `--no-landing` skips the
landing site.

<details>
<summary>Manual steps (what <code>dev.sh</code> automates)</summary>

```bash
# 1. Copy environment variables
cp .env.example .env

# 2. Start PostgreSQL + pgAdmin
docker-compose up -d

# 3. Run database migrations
./scripts/migrate.sh up

# 4. Start Go API (in one terminal)
cd classlite-api && go run ./cmd/api

# 5. Start React dashboard (in another terminal)
cd classlite-web && npm install && npm run dev

# 6. Start Astro landing (in another terminal)
cd classlite-landing && npm install && npm run dev
```
</details>

## Services

| Service | Dev URL | Production |
|---------|---------|------------|
| Go API | http://localhost:8080 | Railway |
| React Dashboard | http://localhost:5173 | Cloudflare Pages |
| Astro Landing | http://localhost:4321 | Cloudflare Pages |
| pgAdmin | http://localhost:5050 | - |

## Scripts

| Script | Description |
|--------|-------------|
| `scripts/dev.sh` | One-command local stack: DB + migrate + API + web + landing, clean teardown on Ctrl-C |
| `scripts/codegen.sh` | Run sqlc + openapi-typescript + openapi-zod-client |
| `scripts/migrate.sh` | Database migrations (up/down/create) |
| `scripts/seed.sh` | Seed local database with test data |
| `scripts/sync-tokens.sh` | Copy `classlite-web/src/tokens.css` → `classlite-landing/src/styles/tokens.css` (Story 1.7a AC2) |

## Design Tokens

`classlite-web/src/tokens.css` is the single source of truth for the design system (color, type, radius, shadow, sidebar, layout). The Astro landing site at `classlite-landing/src/styles/tokens.css` is a synchronized copy — never edit it directly.

**After editing tokens:**

```bash
./scripts/sync-tokens.sh    # copies dashboard tokens → landing
git add classlite-web/src/tokens.css classlite-landing/src/styles/tokens.css
git commit
```

**CI parity guard.** `ci-web.yml` and `ci-landing.yml` both run `scripts/sync-tokens.sh` + `git diff --exit-code` on every PR that touches either tokens file. Drift fails the build with a unified diff in the job log — fix it by running the sync script locally and committing.

**Raw color literals are linted out of the codebase** via stylelint (`color-no-hex` + `declaration-property-value-disallowed-list`) and ESLint (`no-restricted-syntax` on TSX/TS hex string literals). The only sanctioned home for color literals is `tokens.css`. Lint suppressions must be registered in `docs/lint-exceptions.md` per the registry process; the registry starts empty by design.

## Code Generation

Generated artifacts are read-only. Fix the source, never the output:

- `api.yaml` → TypeScript types + Zod schemas
- `.sql` query files → Go structs via sqlc
- Migrations → Database schema (affects sqlc)
