# Story 1.2e: Presigned Upload Infrastructure

Status: done

## Story

As a developer,
I want a reusable presigned URL upload pattern for Cloudflare R2,
so that Knowledge Hub (Epic 4) and Speaking recordings (Epic 5) don't duplicate upload logic.

## Acceptance Criteria (BDD)

### AC1: Presign endpoint
Given a valid authenticated request,
When POST /api/uploads/presign is called with {"filename":"notes.pdf","contentType":"application/pdf","feature":"knowledge"},
Then the response contains a presigned PUT URL with key format {center_id}/{feature}/{uuid}.{ext} and an expiry of 5 minutes.

### AC2: Confirm endpoint
Given a file has been uploaded to R2 using the presigned URL,
When POST /api/uploads/confirm is called with the object key,
Then the endpoint verifies the object exists in R2 and returns {"key":"...","size":12345,"contentType":"application/pdf"}.

### AC3: Storage interface for testing
Given the storage interface defined in internal/service/storage.go,
When tests need to verify upload logic,
Then a mock implementation can be substituted without hitting R2.

### AC4: Security validations
Given a presign request,
When the file extension is checked,
Then only allowlisted extensions are accepted (pdf, png, jpg, jpeg, svg, mp3, wav, webm),
And Content-Type is locked to the validated MIME type in the presigned request,
And the center_id in the key path matches the authenticated user's center_id.

## Tasks / Subtasks

- [x] Task 1: Create internal/service/storage.go (AC: #3)
  - [x] Define StorageService interface: Presign + HeadObject
  - [x] Define ObjectMeta struct {Key, ContentType, Size}
- [x] Task 2: Create internal/service/storage_r2.go (AC: #1, #4)
  - [x] R2StorageService using AWS SDK v2 (S3-compatible)
  - [x] Presign: PUT URL with content-type lock and configurable expiry
  - [x] HeadObject: verify object exists, return metadata
- [x] Task 3: Create internal/service/storage_mock.go (AC: #3)
  - [x] MockStorageService with Objects map, PresignError, HeadObjectError
  - [x] Compile-time interface check
- [x] Task 4: Create internal/handler/upload_handler.go (AC: #1, #2, #4)
  - [x] POST /api/uploads/presign — extension allowlist, key gen {center_id}/{feature}/{uuid}.{ext}, 5-min expiry
  - [x] POST /api/uploads/confirm — HeadObject, return metadata
  - [x] center_id from TenantContext (falls back to "unknown" pre-auth)
- [x] Task 5: Add R2 config to config.go
  - [x] R2AccountID, R2AccessKeyID, R2SecretAccessKey, R2BucketName
- [x] Task 6: Add AWS SDK v2 dependency to go.mod
  - [x] aws-sdk-go-v2 v1.41.9 + s3 v1.102.2 + credentials + config
- [x] Task 7: Wire upload routes in main.go
  - [x] Mock storage as default, R2 when R2_ACCOUNT_ID is set
  - [x] Routes wrapped with ErrorMapper

## Dev Notes

### What to create (NEW files)
- `internal/service/storage.go` — interface
- `internal/service/storage_r2.go` — R2 implementation
- `internal/service/storage_mock.go` — mock
- `internal/handler/upload_handler.go` — presign + confirm endpoints

### What exists (UPDATE files)
- `internal/config/config.go` — add R2 config fields
- `cmd/api/main.go` — add upload routes
- `classlite-api/api.yaml` — add upload endpoints to OpenAPI spec

### Critical constraints
- Max presigned URL expiry: 5 minutes, NOT default 15 (SEC-8)
- Content-Type MUST be locked in presigned request (SEC-8)
- center_id in key MUST match authenticated user's center_id from JWT (SEC-8)
- File extension allowlist validated server-side BEFORE generating URL (SEC-8)
- Post-upload confirm must verify actual stored object's Content-Type from R2 metadata (SEC-8)
- No file data flows through Go server — browser uploads directly to R2 (XL-3)
- These endpoints require authentication (auth middleware from story 1.4+) — for now, create handlers but note they need auth wrapping later

### Review Findings

- [x] [Review][Patch] center_id falls back to "unknown" — fixed: returns ForbiddenError when TenantID missing + test added
- [x] [Review][Patch] Confirm doesn't verify key prefix — fixed: checks HasPrefix(key, centerID+"/") + cross-tenant test added
- [x] [Review][Patch] ContentType not validated against extension — fixed: extension→MIME mapping with cross-check + test added
- [x] [Review][Patch] Mock Presign doesn't record key in Objects — fixed: records ObjectMeta on Presign
- [x] [Review][Patch] No feature allowlist — fixed: allowedFeatures map (knowledge/speaking/avatars) + test added
- [x] [Review][Defer] HeadObject error mapped to 404 for all errors including network failures — add R2 error type checking when needed
- [x] [Review][Defer] No max-size constraint on presigned PUT — R2/S3 limitation, validate post-upload

### References
- [Source: docs/project-context.md — SEC-8, XL-3]
- [Source: _bmad-output/planning-artifacts/epics.md — Story 1.2e]

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6 (1M context)

### Debug Log References
- go vet caught type mismatch: `*MockStorageService` not assignable to `*R2StorageService` — fixed by declaring `var uploadStorage service.StorageService`.

### Completion Notes List
- StorageService interface: Presign + HeadObject with ObjectMeta struct.
- R2StorageService: AWS SDK v2 S3-compatible client, presigned PUT with content-type lock, HeadObject for confirm.
- MockStorageService: Objects map, PresignError/HeadObjectError for test control, compile-time interface check.
- UploadHandler: Presign validates extension allowlist (8 types), generates key {center_id}/{feature}/{uuid}.{ext}, 5-min expiry. Confirm checks HeadObject.
- 8 handler tests: valid PDF, disallowed ext, missing fields, invalid JSON, confirm exists/not-found/empty-key, all allowed extensions.
- Config: R2AccountID, R2AccessKeyID, R2SecretAccessKey, R2BucketName added.
- main.go: mock storage by default, R2 when R2_ACCOUNT_ID set. Routes wrapped with ErrorMapper.
- All 43 tests pass with -race. go vet clean.

### File List
- classlite-api/internal/service/storage.go (NEW — StorageService interface + ObjectMeta)
- classlite-api/internal/service/storage_r2.go (NEW — R2 implementation)
- classlite-api/internal/service/storage_mock.go (NEW — mock for tests)
- classlite-api/internal/handler/upload_handler.go (NEW — Presign + Confirm endpoints)
- classlite-api/internal/handler/upload_handler_test.go (NEW — 8 tests)
- classlite-api/internal/config/config.go (MODIFIED — R2 config fields)
- classlite-api/cmd/api/main.go (MODIFIED — upload routes + service import)
- classlite-api/go.mod (MODIFIED — AWS SDK v2 deps)
- classlite-api/go.sum (MODIFIED)
