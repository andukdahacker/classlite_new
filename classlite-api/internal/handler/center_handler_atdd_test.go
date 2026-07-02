// ATDD specimens for Story 2.1 — Center Handler.
//
// Expected to FAIL against current codebase:
//   - handler.NewCenterHandler does not exist
//   - service.NewCenterService does not exist
//   - service.AuditLogger interface not defined
//   - service.MintAccessToken not extracted from AuthService
//   - migrations for `idx_center_members_user_id` unique index not applied
//
// Coverage:
//   AC2 — Center creation (happy owner+shortCode+accessToken)
//   AC2 — 409 USER_ALREADY_HAS_CENTER — sequential double-post
//   AC2 — 409 USER_ALREADY_HAS_CENTER — concurrent double-post (both 409, not one 500)
//   AC2 — 403 EMAIL_VERIFICATION_REQUIRED
//   AC2 — 422 VALIDATION_ERROR
//   AC2 — response includes fresh accessToken with center+role claims
//   AC6 — audit failure rolls back the whole tx (brokenAuditLogger fixture)
//   AC6 — audit_logs.changes exactly `{before: null, after: {...}}`

package handler_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/ducdo/classlite-api/internal/handler"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/ducdo/classlite-api/internal/test"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// -----------------------------------------------------------------------------
// AC2 — Happy path
// -----------------------------------------------------------------------------

func TestCreateCenter_AC02_HappyPath_ReturnsOwnerRoleAndToken(t *testing.T) {
	db := test.SetupDB(t)
	user := test.CreateUser(t, db, "founder@example.com", "Founder")
	test.MarkUserEmailVerified(t, db, user.ID)
	srv := test.NewTestServerForUser(t, db, user.ID)

	body := `{"name":"Trung tâm Anh ngữ Sài Gòn","brandColor":"#00AA55","logoUrl":null}`
	req := httptest.NewRequest(http.MethodPost, "/api/centers", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("want 201, got %d — body: %s", rec.Code, rec.Body.String())
	}

	var envelope struct {
		Data struct {
			ID          string `json:"id"`
			Name        string `json:"name"`
			ShortCode   string `json:"shortCode"`
			Role        string `json:"role"`
			AccessToken string `json:"accessToken"`
			ExpiresAt   string `json:"expiresAt"`
		} `json:"data"`
		Meta struct{ ServerTime string `json:"serverTime"` } `json:"meta"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&envelope); err != nil {
		t.Fatalf("decode: %v", err)
	}

	if envelope.Data.Role != "owner" {
		t.Errorf("AC2: role MUST be 'owner' regardless of persona, got %q", envelope.Data.Role)
	}
	if envelope.Data.ShortCode != "trung-tam-anh-ngu-sai-gon" {
		t.Errorf("AC2 (+AC5b): shortCode MUST slugify VN correctly, got %q", envelope.Data.ShortCode)
	}
	if envelope.Data.AccessToken == "" {
		t.Errorf("AC2: response MUST include fresh accessToken (no forced relogin)")
	}
	if envelope.Meta.ServerTime == "" {
		t.Errorf("AC2: meta.serverTime MUST be populated (Sally-B2)")
	}
}

func TestCreateCenter_AC02_ResponseIncludesFreshAccessTokenWithClaims(t *testing.T) {
	db := test.SetupDB(t)
	user := test.CreateUser(t, db, "founder@example.com", "F")
	test.MarkUserEmailVerified(t, db, user.ID)
	srv := test.NewTestServerForUser(t, db, user.ID)

	body := `{"name":"Test Center","brandColor":null,"logoUrl":null}`
	req := httptest.NewRequest(http.MethodPost, "/api/centers", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	var envelope struct {
		Data struct {
			ID          string `json:"id"`
			AccessToken string `json:"accessToken"`
		} `json:"data"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&envelope); err != nil {
		t.Fatalf("decode: %v", err)
	}

	// Verify the token carries CenterID + Role claims (post-MintAccessToken).
	// Green-phase: use the same JWT signer as the test server.
	claims := test.VerifyAccessToken(t, envelope.Data.AccessToken) // green-phase helper
	if claims.CenterID != envelope.Data.ID {
		t.Errorf("AC2 token: CenterID claim=%q, want %q", claims.CenterID, envelope.Data.ID)
	}
	if claims.Role != "owner" {
		t.Errorf("AC2 token: Role claim=%q, want owner", claims.Role)
	}
}

// -----------------------------------------------------------------------------
// AC2 — 409 sequential double-post (pre-check branch)
// -----------------------------------------------------------------------------

func TestCreateCenter_AC02_SequentialDoublePost_Returns409UserAlreadyHasCenter(t *testing.T) {
	db := test.SetupDB(t)
	user := test.CreateUser(t, db, "u@example.com", "U")
	test.MarkUserEmailVerified(t, db, user.ID)
	srv := test.NewTestServerForUser(t, db, user.ID)

	// First POST — succeeds
	req1 := httptest.NewRequest(http.MethodPost, "/api/centers",
		strings.NewReader(`{"name":"First Center","brandColor":null,"logoUrl":null}`))
	req1.Header.Set("Content-Type", "application/json")
	rec1 := httptest.NewRecorder()
	srv.ServeHTTP(rec1, req1)
	if rec1.Code != http.StatusCreated {
		t.Fatalf("first POST: want 201, got %d", rec1.Code)
	}

	// Second POST — 409 via pre-check
	req2 := httptest.NewRequest(http.MethodPost, "/api/centers",
		strings.NewReader(`{"name":"Second Center","brandColor":null,"logoUrl":null}`))
	req2.Header.Set("Content-Type", "application/json")
	rec2 := httptest.NewRecorder()
	srv.ServeHTTP(rec2, req2)

	if rec2.Code != http.StatusConflict {
		t.Fatalf("second POST: want 409, got %d", rec2.Code)
	}
	assertErrorCodeCenter(t, rec2.Body, "USER_ALREADY_HAS_CENTER")
}

// -----------------------------------------------------------------------------
// AC2 — 409 CONCURRENT double-post (Murat-S2: both 409, not one 500)
// -----------------------------------------------------------------------------

func TestCreateCenter_AC02_ConcurrentDoublePost_BothReturn409NotOne500(t *testing.T) {
	pool := test.SetupRawPool(t) // Murat-B3: cannot race under SetupDB's single-tx
	user := test.CreateUserOnPool(t, pool, "u@example.com", "U") // green-phase raw-pool fixture
	test.MarkUserEmailVerifiedOnPool(t, pool, user.ID)
	t.Cleanup(func() {
		test.PurgeUserAndOwnedCenters(t, pool, user.ID) // clean residue since SetupRawPool leaves it
	})

	// Both goroutines target the same authenticated user; one wins the
	// pre-check + INSERT race; the other MUST hit idx_center_members_user_id
	// unique violation and get REMAPPED from 23505 to USER_ALREADY_HAS_CENTER.
	// The failure mode we're guarding: one goroutine returns 500 INTERNAL_ERROR
	// because the service didn't remap the raw pgerror.
	var wg sync.WaitGroup
	results := make([]int, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			srv := test.NewTestServerForUserOnPool(t, pool, user.ID) // per-goroutine server (raw pool, real tx)
			body := `{"name":"Race Center","brandColor":null,"logoUrl":null}`
			req := httptest.NewRequest(http.MethodPost, "/api/centers", strings.NewReader(body))
			req.Header.Set("Content-Type", "application/json")
			rec := httptest.NewRecorder()
			srv.ServeHTTP(rec, req)
			results[idx] = rec.Code
		}(i)
	}
	wg.Wait()

	// Exactly one 201 (winner) + one 409 (loser). NEVER a 500.
	winnerCount, loserCount, otherCount := 0, 0, 0
	for _, code := range results {
		switch code {
		case http.StatusCreated:
			winnerCount++
		case http.StatusConflict:
			loserCount++
		default:
			otherCount++
		}
	}
	if winnerCount != 1 || loserCount != 1 || otherCount != 0 {
		t.Errorf("AC2 race (Murat-S2): want 1×201 + 1×409, got %v (500-vs-409 race bug lives here)", results)
	}
}

// -----------------------------------------------------------------------------
// AC2 — 403 EMAIL_VERIFICATION_REQUIRED
// -----------------------------------------------------------------------------

func TestCreateCenter_AC02_UnverifiedEmail_Returns403(t *testing.T) {
	db := test.SetupDB(t)
	user := test.CreateUser(t, db, "u@example.com", "U") // NOT verified
	srv := test.NewTestServerForUser(t, db, user.ID)

	req := httptest.NewRequest(http.MethodPost, "/api/centers",
		strings.NewReader(`{"name":"Test","brandColor":null,"logoUrl":null}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("want 403, got %d", rec.Code)
	}
	assertErrorCodeCenter(t, rec.Body, "EMAIL_VERIFICATION_REQUIRED")
}

// -----------------------------------------------------------------------------
// AC2 — 422 validation
// -----------------------------------------------------------------------------

func TestCreateCenter_AC02_EmptyName_Returns422(t *testing.T) {
	db := test.SetupDB(t)
	user := test.CreateUser(t, db, "u@example.com", "U")
	test.MarkUserEmailVerified(t, db, user.ID)
	srv := test.NewTestServerForUser(t, db, user.ID)

	req := httptest.NewRequest(http.MethodPost, "/api/centers",
		strings.NewReader(`{"name":"","brandColor":null,"logoUrl":null}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("want 422, got %d", rec.Code)
	}
}

// -----------------------------------------------------------------------------
// AC6 — Audit failure rolls back the WHOLE tx
// -----------------------------------------------------------------------------

// brokenAuditLogger implements the AuditLogger interface (Story 2.1 Task 7.1)
// but forces LogWithinTx to return an error. Injected via the CenterService
// constructor seam so we can prove tx atomicity: a failed audit MUST roll
// back the centers + center_members INSERTs.
type brokenAuditLogger struct{ err error }

func (b *brokenAuditLogger) LogWithinTx(
	_ context.Context, _ pgx.Tx, _ model.TenantContext,
	_, _ string, _ uuid.UUID, _ any,
) error {
	return b.err
}

// Compile-time assertion that brokenAuditLogger satisfies the interface —
// this line becomes the load-bearing spec that Amelia's `AuditLogger` interface
// must match. If Amelia's interface has a different shape, this line breaks.
var _ service.AuditLogger = (*brokenAuditLogger)(nil)

func TestCreateCenter_AC06_AuditFailure_RollsBackWholeTx(t *testing.T) {
	pool := test.SetupRawPool(t) // real pool so the service's tx commits/rolls back for real
	user := test.CreateUserOnPool(t, pool, "u@example.com", "U")
	test.MarkUserEmailVerifiedOnPool(t, pool, user.ID)
	t.Cleanup(func() { test.PurgeUserAndOwnedCenters(t, pool, user.ID) })

	broken := &brokenAuditLogger{err: errors.New("simulated audit failure")}
	// Green-phase: NewCenterService accepts AuditLogger + accessTokenIssuer at the constructor.
	centerSvc := service.NewCenterService(pool, broken, test.MockAccessTokenIssuer{}, test.RealClock{})

	uid, _ := uuid.Parse(test.UUIDString(user.ID))
	_, err := centerSvc.CreateCenter(context.Background(), uid, service.CreateCenterInput{
		Name: "Should Rollback", BrandColor: nil, LogoUrl: nil,
	})

	if err == nil {
		t.Fatalf("AC6: CreateCenter with broken audit MUST error, got nil")
	}

	// Assert zero rows across ALL three tables — tx atomicity.
	// `centers` has no RLS, so the app pool sees it globally.
	// `center_members` and `audit_logs` are RLS-protected, so query via
	// the superuser pool — otherwise RLS returns 0 rows against the
	// classlite_app connection regardless of whether the tx rolled back
	// (vacuously satisfying the assertion). Hardening applied by
	// /bmad-tea TA 2-1 after INT-2-4 surfaced the RLS-scope issue.
	sp := test.SuperuserPool(t)
	countCenters := test.CountRows(t, pool, "SELECT count(*) FROM centers")
	countMembers := test.CountRows(t, sp, "SELECT count(*) FROM center_members WHERE user_id = $1", user.ID)
	countAudit := test.CountRows(t, sp, "SELECT count(*) FROM audit_logs WHERE user_id = $1", user.ID)

	if countCenters != 0 {
		t.Errorf("AC6 tx atomicity broken: %d centers rows survived a failed audit", countCenters)
	}
	if countMembers != 0 {
		t.Errorf("AC6 tx atomicity broken: %d center_members rows survived a failed audit", countMembers)
	}
	if countAudit != 0 {
		t.Errorf("AC6 tx atomicity broken: %d audit_logs rows survived a failed audit", countAudit)
	}
}

func TestCreateCenter_AC06_ExactJsonbShape_BeforeNullAfterPopulated(t *testing.T) {
	// Amend the audit shape at exactly `{before: null, after: {...}}`.
	// If a future dev copy-pastes CreateCenter for UpdateCenter and forgets
	// to populate `before`, THAT bug shows up as a change in this test —
	// not as an audit-shape drift.
	db := test.SetupDB(t)
	user := test.CreateUser(t, db, "u@example.com", "U")
	test.MarkUserEmailVerified(t, db, user.ID)
	srv := test.NewTestServerForUser(t, db, user.ID)

	req := httptest.NewRequest(http.MethodPost, "/api/centers",
		strings.NewReader(`{"name":"Audit Shape Test","brandColor":"#123456","logoUrl":null}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	// Parse the response to get the returned centerID — the audit row's
	// entity_id must equal it (AC6 pins the full row shape).
	var createResp struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &createResp); err != nil {
		t.Fatalf("decode create-center response: %v", err)
	}
	if createResp.Data.ID == "" {
		t.Fatalf("create-center response missing data.id (status=%d, body=%s)", rec.Code, rec.Body.String())
	}

	// Fetch the audit_logs row via test helper.
	auditRow := test.LatestAuditLogForUser(t, db, user.ID) // green-phase fixture
	var changes struct {
		Before *json.RawMessage `json:"before"`
		After  struct {
			Name       string  `json:"name"`
			ShortCode  string  `json:"short_code"`
			BrandColor *string `json:"brand_color"`
			LogoUrl    *string `json:"logo_url"`
		} `json:"after"`
	}
	if err := json.Unmarshal(auditRow.Changes, &changes); err != nil {
		t.Fatalf("decode changes: %v", err)
	}

	if changes.Before != nil {
		t.Errorf("AC6: changes.before MUST be null, got %s", *changes.Before)
	}
	if changes.After.Name != "Audit Shape Test" {
		t.Errorf("AC6: changes.after.name mismatch, got %q", changes.After.Name)
	}
	if auditRow.Action != "center.created" {
		t.Errorf("AC6: audit_logs.action = %q, want center.created", auditRow.Action)
	}
	if auditRow.EntityType != "center" {
		t.Errorf("AC6: audit_logs.entity_type = %q, want %q", auditRow.EntityType, "center")
	}
	if got := test.UUIDString(auditRow.EntityID); got != createResp.Data.ID {
		t.Errorf("AC6: audit_logs.entity_id = %q, want %q (from create-center response)", got, createResp.Data.ID)
	}
}

// -----------------------------------------------------------------------------
// Test-local helpers
// -----------------------------------------------------------------------------

func assertErrorCodeCenter(t *testing.T, body *bytes.Buffer, wantCode string) {
	t.Helper()
	var env struct {
		Error struct{ Code string `json:"code"` } `json:"error"`
	}
	if err := json.NewDecoder(body).Decode(&env); err != nil {
		t.Fatalf("decode error envelope: %v", err)
	}
	if env.Error.Code != wantCode {
		t.Errorf("want error.code=%q, got %q", wantCode, env.Error.Code)
	}
}

// Keep symbols referenced so compile-fail signals the missing green-phase code.
var (
	_ = handler.NewCenterHandler
	_ = service.NewCenterService
	_ = (*service.AuthService).MintAccessToken
	_ = time.Second
	_ sync.Mutex // sync stays live via brokenTokenIssuer even if usage collapses
)

// -----------------------------------------------------------------------------
// TA pass (2026-07-02) — center-side P2 expansion.
// -----------------------------------------------------------------------------

// brokenTokenIssuer satisfies the accessTokenIssuer interface (via the same
// method shape MockAccessTokenIssuer uses) but returns an error every time.
// Used to prove the post-Commit ordering invariant: if MintAccessToken fails
// AFTER tx.Commit succeeds, the center + membership + audit rows MUST persist
// (client can recover by re-logging in), NOT roll back.
type brokenTokenIssuer struct{ err error }

func (b brokenTokenIssuer) MintAccessToken(
	_ context.Context, _ uuid.UUID, _ *uuid.UUID, _ string,
) (string, time.Time, error) {
	return "", time.Time{}, b.err
}

// 2.1-INT-2-3 (P2, AC2): name composed entirely of Unicode whitespace
// (nbsp + ideographic space + regular spaces) must trim to empty and be
// rejected as VALIDATION_ERROR. Locks in the code-review P7 `strings.TrimSpace`
// fix — the byte-based trimName it replaced would have kept these characters
// as content, letting them through the min-length check.
func TestCreateCenter_INT23_UnicodeWhitespaceName_Returns422(t *testing.T) {
	db := test.SetupDB(t)
	user := test.CreateUser(t, db, "ws-only@example.com", "W")
	test.MarkUserEmailVerified(t, db, user.ID)
	srv := test.NewTestServerForUser(t, db, user.ID)

	// U+00A0 = non-breaking space, U+3000 = ideographic space (Vietnamese
	// keyboards produce these under some IME configurations).
	body := "{\"name\":\"    　  \",\"brandColor\":null,\"logoUrl\":null}"
	req := httptest.NewRequest(http.MethodPost, "/api/centers", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnprocessableEntity {
		t.Errorf("Unicode-whitespace-only name: want 422 VALIDATION_ERROR, got %d — body: %s", rec.Code, rec.Body.String())
	}
	assertErrorCodeCenter(t, rec.Body, "VALIDATION_ERROR")
}

// 2.1-INT-2-4 (P2, AC2): broken accessTokenIssuer AFTER successful Commit —
// the center + membership + audit rows MUST persist (accepted-loss recovery
// via re-login). Symmetric to AC6 audit-failure test but flips the ordering
// invariant: audit runs inside the tx (must roll back), token mint runs
// OUTSIDE the tx (must NOT roll back).
func TestCreateCenter_INT24_BrokenTokenIssuer_CenterPersistsAfterCommit(t *testing.T) {
	pool := test.SetupRawPool(t) // real pool so the tx actually commits
	user := test.CreateUserOnPool(t, pool, "token-fail@example.com", "T")
	test.MarkUserEmailVerifiedOnPool(t, pool, user.ID)
	// CreateUserOnPool registers a t.Cleanup that purges via superuser pool.

	auditSvc := service.NewAuditService(pool)
	broken := brokenTokenIssuer{err: errors.New("simulated token mint failure")}
	centerSvc := service.NewCenterService(pool, auditSvc, broken, test.RealClock{})

	uid := test.MustParseUUID(t, test.UUIDString(user.ID))
	result, err := centerSvc.CreateCenter(context.Background(), uid, service.CreateCenterInput{
		Name: "Token Fail Test", BrandColor: nil, LogoUrl: nil,
	})

	if err == nil {
		t.Fatalf("broken token issuer: CreateCenter MUST return the mint error, got nil (result=%+v)", result)
	}

	// The whole point of this test: rows persist even though the caller sees
	// an error. center_members has RLS, so query via the superuser pool to
	// see across the tenant boundary (this is the same escape hatch
	// PurgeUserAndOwnedCenters uses at cleanup).
	sp := test.SuperuserPool(t)
	countMembers := test.CountRows(t, sp, "SELECT count(*) FROM center_members WHERE user_id = $1", user.ID)
	if countMembers != 1 {
		t.Errorf("post-Commit token failure: expected 1 center_members row (accepted loss + login recovers), got %d", countMembers)
	}
	countAudit := test.CountRows(t, sp, "SELECT count(*) FROM audit_logs WHERE user_id = $1 AND action = 'center.created'", user.ID)
	if countAudit != 1 {
		t.Errorf("post-Commit token failure: expected 1 audit_logs 'center.created' row, got %d", countAudit)
	}
}

// 2.1-INT-2-5 (P2, AC2): name-length ceiling is rune-based, not byte-based.
// Vietnamese input is ~90% of the target market; a byte-based check would
// reject a 40-character Vietnamese name (which is 100-120 bytes). Locks in
// the code-review P3 `utf8.RuneCountInString` fix against regression.
func TestCreateCenter_INT25_RuneBoundary_VietnameseName(t *testing.T) {
	db := test.SetupDB(t)

	// "Đà" = 4 bytes (Đ=2, à=2). 60 repetitions = 120 runes, 240 bytes —
	// well past the byte-based check but exactly at the rune-based ceiling.
	nameAt120Runes := strings.Repeat("Đà", 60)
	nameAt121Runes := nameAt120Runes + "x"

	t.Run("at_120_runes_succeeds", func(t *testing.T) {
		db2 := test.SetupDB(t) // fresh tx so the two subtests are isolated
		user := test.CreateUser(t, db2, "rune-120@example.com", "U")
		test.MarkUserEmailVerified(t, db2, user.ID)
		srv := test.NewTestServerForUser(t, db2, user.ID)

		body := `{"name":"` + nameAt120Runes + `","brandColor":null,"logoUrl":null}`
		req := httptest.NewRequest(http.MethodPost, "/api/centers", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		srv.ServeHTTP(rec, req)

		if rec.Code != http.StatusCreated {
			t.Errorf("120-rune Vietnamese name: want 201 (rune-check accepts), got %d — body: %s", rec.Code, rec.Body.String())
		}
	})

	t.Run("at_121_runes_rejected", func(t *testing.T) {
		db2 := test.SetupDB(t)
		user := test.CreateUser(t, db2, "rune-121@example.com", "U")
		test.MarkUserEmailVerified(t, db2, user.ID)
		srv := test.NewTestServerForUser(t, db2, user.ID)

		body := `{"name":"` + nameAt121Runes + `","brandColor":null,"logoUrl":null}`
		req := httptest.NewRequest(http.MethodPost, "/api/centers", strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		srv.ServeHTTP(rec, req)

		if rec.Code != http.StatusUnprocessableEntity {
			t.Errorf("121-rune Vietnamese name: want 422 (over ceiling), got %d — body: %s", rec.Code, rec.Body.String())
		}
		assertErrorCodeCenter(t, rec.Body, "VALIDATION_ERROR")
	})

	_ = db // silence unused var if compiler misreads the closure
}
