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
| `scripts/codegen.sh` | Run sqlc + openapi-typescript + openapi-zod-client |
| `scripts/migrate.sh` | Database migrations (up/down/create) |
| `scripts/seed.sh` | Seed local database with test data |

## Code Generation

Generated artifacts are read-only. Fix the source, never the output:

- `api.yaml` → TypeScript types + Zod schemas
- `.sql` query files → Go structs via sqlc
- Migrations → Database schema (affects sqlc)
