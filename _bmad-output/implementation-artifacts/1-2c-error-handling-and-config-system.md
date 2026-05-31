# Story 1.2c: Error Handling & Config System

Status: done

## Story

As a backend developer,
I want custom error types (NotFoundError, ForbiddenError, ValidationError, ConflictError) mapped to standard HTTP responses, and a config loader that validates required environment variables,
so that error responses are consistent, never leak internals, and configuration is centralized with fail-fast on missing values.

## Acceptance Criteria (BDD)

### AC1: NotFoundError → 404
Given a handler returns a NotFoundError,
When the error mapping middleware processes it,
Then the response is 404 with body {"error":{"code":"NOT_FOUND","message":"...","requestId":"...","details":null}}.

### AC2: ForbiddenError → 403
Given a handler returns a ForbiddenError,
When the error mapping middleware processes it,
Then the response is 403 with the standard error envelope.

### AC3: ValidationError → 422
Given a handler returns a ValidationError with field-level details,
When the error mapping middleware processes it,
Then the response is 422 with details containing the field errors array.

### AC4: ConflictError → 409
Given a handler returns a ConflictError,
When the error mapping middleware processes it,
Then the response is 409 with the standard error envelope.

### AC5: Unknown errors → 500
Given an unhandled panic or unknown error occurs,
When the error mapping middleware catches it,
Then the response is 500 with a generic message and no internal details are leaked,
And the full error is logged via slog with request_id for debugging.

### AC6: Config validation
Given environment variables are set,
When the config loader initializes,
Then all required env vars are loaded, validated, and accessible via a typed config struct,
And if DATABASE_URL or JWT_SECRET is empty in non-development mode, the app refuses to start.

## Tasks / Subtasks

- [x] Task 1: Add ConflictError to model/errors.go (AC: #4)
  - [x] ConflictError{Resource, ID string} with Error() method
- [x] Task 2: Create internal/middleware/error_mapper.go (AC: #1-5)
  - [x] Wrap handler to catch panics (recover)
  - [x] Type-switch on error: NotFoundError→404, ForbiddenError→403, ValidationError→422, ConflictError→409
  - [x] Unknown errors→500 with generic message, log full error
  - [x] All responses use standard envelope with requestId from context
  - [x] ErrorMapper wraps HandlerWithError (per-route, not middleware chain)
- [x] Task 3: Create internal/handler/response.go (AC: #1-5)
  - [x] Envelope struct: type Envelope struct { Data any `json:"data"` }
  - [x] ErrorResponse struct matching the API contract
  - [x] WriteJSON and WriteError shared helpers
- [x] Task 4: Update config.go with validation (AC: #6)
  - [x] Add APP_ENV (development/staging/production, default: development)
  - [x] Validate() checks critical vars in non-development mode
  - [x] LogSummary() logs config without secrets at startup
- [x] Task 5: Wire config validation into main.go
  - [x] cfg.Validate() called after Load(), exits on failure
  - [x] cfg.LogSummary() called at startup

### Review Findings

- [x] [Review][Patch] `ValidationError` with nil `Fields` produces `"details": null` on 422 — fixed: nil-coalesce to empty slice [error_mapper.go]
- [x] [Review][Patch] `cfg.LogSummary()` executes before `cfg.Validate()` — fixed: validate first, log after [main.go]
- [x] [Review][Defer] Double WriteHeader if handler writes response then panics or returns error — needs tracked ResponseWriter wrapper, add when handler complexity warrants it
- [x] [Review][Defer] Config Validate allows arbitrary APP_ENV values (typos not caught) — add allowlist when more environments exist
- [x] [Review][Defer] Empty CORS_ORIGINS string edge case — already handled by CORS middleware parseOrigins

## Dev Notes

### What exists (UPDATE files)
- `internal/model/errors.go` — Add ConflictError type alongside existing three.
- `internal/config/config.go` — Add APP_ENV field and validation logic.
- `cmd/api/main.go` — Wire error mapper middleware.

### What to create (NEW files)
- `internal/middleware/error_mapper.go`
- `internal/handler/response.go` — shared JSON response helpers

### Critical constraints
- Error codes UPPER_SNAKE_CASE: NOT_FOUND, FORBIDDEN, VALIDATION_ERROR, CONFLICT, INTERNAL_ERROR (CQ-5)
- Never bare json.Encode — always use envelope (GFW-5)
- requestId extracted from context via ctxkey.RequestID
- Panic recovery must log stack trace but never expose it in response
- No omitempty on response struct JSON tags (GO-5)

### References
- [Source: docs/project-context.md — GO-2, GO-5, GFW-5, CQ-5]
- [Source: _bmad-output/planning-artifacts/epics.md — Story 1.2c]

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6 (1M context)

### Debug Log References
N/A — clean implementation.

### Completion Notes List
- ConflictError added to model/errors.go alongside existing 3 error types.
- ErrorMapper: per-handler wrapper (HandlerWithError → http.HandlerFunc). Type-switches on 4 domain errors + panic recovery. 7 tests covering all error types + panic + no-error path.
- Response helpers: Envelope, ErrorResponse, ErrorBody structs with no omitempty (GO-5). WriteJSON and WriteError shared helpers with error logging.
- Config: APP_ENV field, Validate() method (fail-fast in non-dev), LogSummary() (no secrets). 5 tests.
- main.go: cfg.Validate() + cfg.LogSummary() wired after Load().
- Note: ErrorMapper is a per-handler wrapper, not a middleware chain layer. Used as `mux.HandleFunc("GET /api/foo", middleware.ErrorMapper(handler.Foo))`.
- All 26 tests pass with -race. go vet clean.

### File List
- classlite-api/internal/model/errors.go (MODIFIED — added ConflictError)
- classlite-api/internal/middleware/error_mapper.go (NEW)
- classlite-api/internal/middleware/error_mapper_test.go (NEW — 7 tests)
- classlite-api/internal/handler/response.go (NEW — Envelope, ErrorResponse, WriteJSON, WriteError)
- classlite-api/internal/config/config.go (MODIFIED — APP_ENV, Validate, LogSummary)
- classlite-api/internal/config/config_test.go (NEW — 5 tests)
- classlite-api/cmd/api/main.go (MODIFIED — config validation + summary wired)
