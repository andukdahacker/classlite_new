# Epic 1A: Project Foundation

## Description

Infrastructure sub-epic split from the original Epic 1. Establishes the monorepo structure, Go API skeleton with middleware, database connectivity, auth schema with row-level security, and cross-cutting infrastructure services (email, storage, events, audit logging) that all subsequent epics depend on.

## Functional Requirements

No FRs are directly owned by this epic. Epic 1A is pure infrastructure that enables every FR across Epics 2-10.

## Non-Functional Requirements Addressed

- **NFR-2 (Multi-Tenancy Foundation):** RLS policies, `SET LOCAL app.current_tenant_id` per-request, tenant-scoped queries returning zero rows on null tenant.
- **NFR-3 (Performance Baseline):** pgx connection pooling, middleware ordering (rate limiter early), health endpoint with DB connectivity check.
- **NFR-4 (Security Core):** CORS middleware, rate limiting, custom error types that never leak internals, RLS adversarial test suite, audit logging.

## Stories

---

### Story 1.1: Monorepo Scaffold

**Size:** L | **Audience:** Full-stack | **Dependencies:** None

As a developer,
I want a monorepo with three service directories, Docker Compose for local development, CI/CD pipelines, and shared scripts,
So that the team has a consistent, reproducible development environment from day one.

**Acceptance Criteria:**

**Given** the repository is cloned and Docker is running,
**When** I run `docker-compose up`,
**Then** the Go API, Next.js web app, and database containers all start and are reachable on their configured ports.

**Given** the CI/CD pipeline is triggered,
**When** code is pushed to the main branch,
**Then** linting, tests, and build steps pass for all three services.

**Given** the monorepo scripts directory exists,
**When** I run the setup script,
**Then** all dependencies are installed and the local `.env` files are created from templates.

---

### Story 1.2a: Go API Skeleton & Middleware Chain

**Size:** M | **Audience:** Backend | **Dependencies:** Story 1.1

As a backend developer,
I want a Go API entry point with request_id, logger, CORS, and rate_limit middleware wired in the correct order,
So that every request is traceable, logged, access-controlled, and rate-limited before reaching any handler.

**Acceptance Criteria:**

**Given** any incoming HTTP request,
**When** it passes through the middleware chain,
**Then** a unique `X-Request-ID` header is set (or preserved if already present), the request is logged via slog with the request ID, CORS headers are applied per configuration, and rate limiting is enforced.

**Given** the middleware chain is configured,
**When** I inspect the wiring order,
**Then** the order is: request_id -> logger -> cors -> rate_limit -> router.

**Given** the rate limiter threshold is exceeded,
**When** another request arrives from the same source,
**Then** a `429 Too Many Requests` response is returned before the request reaches the router.

---

### Story 1.2b: Database Connection, Health Endpoint & Tenant Context

**Size:** S | **Audience:** Backend | **Dependencies:** Story 1.1

As a backend developer,
I want a pgx connection pool, a health endpoint that reports DB connectivity, and a per-request tenant context function,
So that the API can connect to PostgreSQL reliably, operators can monitor health, and every query runs in the correct tenant scope.

**Acceptance Criteria:**

**Given** the API starts with a valid `DATABASE_URL`,
**When** the pgx pool initializes,
**Then** the pool connects successfully and is reusable across requests.

**Given** the health endpoint is called,
**When** the database is reachable,
**Then** `GET /api/health` returns `200` with `{ "status": "ok", "db": "connected" }`.

**Given** the health endpoint is called,
**When** the database is unreachable,
**Then** `GET /api/health` returns `503` with `{ "status": "degraded", "db": "disconnected" }`.

**Given** a request includes a valid tenant context,
**When** a database query is executed,
**Then** `SET LOCAL app.current_tenant_id = '<center_id>'` is issued on the connection before any query runs.

---

### Story 1.2c: Error Handling & Config System

**Size:** S | **Audience:** Backend | **Dependencies:** Story 1.2a

As a backend developer,
I want custom error types (NotFoundError, ForbiddenError, ValidationError, ConflictError) mapped to standard HTTP responses, and a config loader for all environment variables,
So that error responses are consistent, never leak internals, and configuration is centralized.

**Acceptance Criteria:**

**Given** a handler returns a `NotFoundError`,
**When** the error mapping middleware processes it,
**Then** the response is `404` with body `{ "error": { "code": "NOT_FOUND", "message": "...", "requestId": "...", "details": null } }`.

**Given** a handler returns a `ForbiddenError`,
**When** the error mapping middleware processes it,
**Then** the response is `403` with the standard error envelope.

**Given** a handler returns a `ValidationError` with field-level details,
**When** the error mapping middleware processes it,
**Then** the response is `422` with `details` containing the field errors.

**Given** a handler returns a `ConflictError`,
**When** the error mapping middleware processes it,
**Then** the response is `409` with the standard error envelope.

**Given** an unhandled panic or unknown error occurs,
**When** the error mapping middleware catches it,
**Then** the response is `500` with a generic message and no internal details are leaked.

**Given** environment variables are set,
**When** the config loader initializes,
**Then** all required env vars are loaded, validated, and accessible via a typed config struct.

---

### Story 1.2d: Email Service Abstraction

**Size:** S | **Audience:** Backend | **Dependencies:** Story 1.1

As a developer,
I want an email service interface (`EmailSender.Send(ctx, to, template, data)`) with a Resend implementation,
So that email sending is decoupled from the provider and testable.

**Acceptance Criteria:**

**Given** the `EmailSender` interface is defined in `internal/service/email.go`,
**When** a caller invokes `Send(ctx, to, template, data)`,
**Then** the call is dispatched to the configured implementation (Resend or mock).

**Given** the Resend implementation in `internal/service/email_resend.go` is configured with a valid API key,
**When** `Send` is called,
**Then** the email is delivered via the Resend API with the correct template and data.

**Given** the mock implementation is used in tests,
**When** `Send` is called,
**Then** the call is recorded and no external API call is made.

---

### Story 1.2e: Presigned Upload Infrastructure

**Size:** S | **Audience:** Backend | **Dependencies:** Story 1.1

As a developer,
I want a reusable presigned URL upload pattern for Cloudflare R2,
So that Knowledge Hub (Epic 4) and Speaking recordings (Epic 5) don't duplicate upload logic.

**Acceptance Criteria:**

**Given** a valid authenticated request,
**When** `POST /api/uploads/presign` is called with `{ "filename": "notes.pdf", "contentType": "application/pdf", "feature": "knowledge" }`,
**Then** the response contains a presigned PUT URL with key format `{center_id}/{feature}/{uuid}.{ext}` and an expiry of 15 minutes.

**Given** a file has been uploaded to R2 using the presigned URL,
**When** `POST /api/uploads/confirm` is called with the object key,
**Then** the endpoint verifies the object exists in R2 and returns `{ "key": "...", "size": 12345, "contentType": "application/pdf" }`.

**Given** the storage interface is defined in `internal/service/storage.go`,
**When** tests need to verify upload logic,
**Then** a mock implementation can be substituted without hitting R2.

---

### Story 1.2f: Event Tracking Foundation

**Size:** S | **Audience:** Backend | **Dependencies:** Story 1.1

As a developer,
I want a lightweight in-process event bus for domain events (grade released, assignment created, enrollment changed, etc.),
So that analytics (Epic 8) and notifications (Epic 10) can consume structured events without coupling to the producing code.

**Acceptance Criteria:**

**Given** the event bus is defined in `internal/event/bus.go`,
**When** `Publish(ctx, event)` is called with a domain event,
**Then** all registered handlers for that event type are invoked synchronously.

**Given** a handler is registered via `Subscribe(eventType, handler)`,
**When** an event of that type is published,
**Then** the handler receives the event with fields `Type`, `CenterID`, `UserID`, `Payload`, and `Timestamp`.

**Given** any event is published,
**When** the event bus processes it,
**Then** the event is logged via slog with all fields for future replay capability.

**Given** no external message queue is configured (MVP),
**When** events are published,
**Then** they are processed in-process without requiring any external infrastructure.

---

### Story 1.3: Auth Database Schema & Row-Level Security

**Size:** L | **Audience:** Backend | **Dependencies:** Story 1.2b

As a backend developer,
I want the auth database schema (users, centers, center_members, email_verifications, refresh_tokens, password_resets, invites) with RLS policies and sqlc setup,
So that all auth data is tenant-isolated at the database level and queries are type-safe.

**Acceptance Criteria:**

**Given** the migration is applied,
**When** I inspect the database,
**Then** all 7 tables exist with correct columns, indexes, and foreign keys.

**Given** RLS is enabled on all tenant-scoped tables,
**When** `app.current_tenant_id` is null or not set,
**Then** all SELECT, UPDATE, and DELETE queries return zero rows (not an error).

**Given** RLS is enabled,
**When** `app.current_tenant_id` is set to a valid center ID,
**Then** only rows belonging to that center are visible.

**Given** the adversarial test suite runs,
**When** a query attempts cross-tenant access, null tenant access, or SQL injection via the tenant ID,
**Then** all attempts are blocked and zero rows are returned.

**Given** sqlc is configured,
**When** I run `sqlc generate`,
**Then** type-safe Go query functions are generated for all auth-related queries.

---

### Story 1.3b: Audit Logging Infrastructure

**Size:** M | **Audience:** Backend | **Dependencies:** Story 1.2b

As a developer,
I want an audit log table and service that records who changed what and when,
So that multi-tenant billing and enrollment changes are traceable.

**Acceptance Criteria:**

**Given** the migration is applied,
**When** I inspect the database,
**Then** the `audit_logs` table exists with columns: `id`, `center_id`, `user_id`, `action` (string), `entity_type`, `entity_id`, `changes` (JSONB with before/after), `ip_address`, `created_at`.

**Given** RLS is enabled on `audit_logs`,
**When** `app.current_tenant_id` is null or set to a different center,
**Then** audit records from other tenants are not visible.

**Given** the audit service in `internal/service/audit.go` is initialized,
**When** `Log(ctx, action, entity, changes)` is called,
**Then** a row is inserted into `audit_logs` with the current user ID, center ID, IP address, and timestamp derived from the request context.

**Given** the `audit_logs` table has data,
**When** querying by center, entity type, and date range,
**Then** the query uses the index on `(center_id, entity_type, created_at)` efficiently.
