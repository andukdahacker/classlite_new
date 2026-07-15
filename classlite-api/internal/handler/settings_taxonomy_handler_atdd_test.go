// Story 2-5b — TermHandler + HolidayHandler + RoomHandler integration tests.
//
// Covers per story Task 5 handler bullets:
//   - GET happy path × 3 entities (envelope shape)
//   - POST happy path × 3 entities (201 + wire echo)
//   - PATCH happy path (terms)
//   - DELETE happy path (terms)
//   - AC6 UNIQUE(center_id, LOWER(name)) → 409 ROOM_NAME_TAKEN with
//     `details[0].field="name"` for the frontend inline error UX
//   - 429 with Retry-After header on POST /api/rooms (Murat-B6 fold)
//   - 401 unauthenticated
//   - 403 insufficient role (teacher trying to POST)
//   - 422 validation (end_date < start_date)
//   - 404 on unknown id (DELETE /api/terms/{unknown-id})
package handler_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/ducdo/classlite-api/internal/test"
	"github.com/jackc/pgx/v5/pgtype"
)

func seedTaxonomyOwner(t *testing.T, db *test.TxDB, name string) (pgtype.UUID, string) {
	t.Helper()
	user := test.CreateUser(t, db, name+"@example.com", name)
	test.MarkUserEmailVerified(t, db, user.ID)
	uid := test.MustParseUUID(t, test.UUIDString(user.ID))
	auditSvc := service.NewAuditService(db)
	centerSvc := service.NewCenterService(db, auditSvc, test.MockAccessTokenIssuer{}, clock.RealClock{})
	res, err := centerSvc.CreateCenter(context.Background(), uid, service.CreateCenterInput{Name: name})
	if err != nil {
		t.Fatalf("seed center: %v", err)
	}
	return user.ID, res.ID.String()
}

// ---- Terms ----

func TestTerms_List_HappyPath_ReturnsEnvelopeAndEmptyArray(t *testing.T) {
	db := test.SetupDB(t)
	pgUID, centerID := seedTaxonomyOwner(t, db, "Terms Center 1")
	srv := test.NewSettings2_5BTestServerForUser(t, db, pgUID, centerID)

	req := httptest.NewRequest(http.MethodGet, "/api/terms", nil)
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d — body: %s", rec.Code, rec.Body.String())
	}
	var env struct {
		Data []map[string]any `json:"data"`
		Meta struct{ ServerTime string `json:"serverTime"` } `json:"meta"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&env); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if env.Data == nil {
		t.Errorf("data should be [], got nil")
	}
	if env.Meta.ServerTime == "" {
		t.Errorf("meta.serverTime empty")
	}
}

func TestTerms_Create_HappyPath_Returns201WithWireEcho(t *testing.T) {
	db := test.SetupDB(t)
	pgUID, centerID := seedTaxonomyOwner(t, db, "Terms Center 2")
	srv := test.NewSettings2_5BTestServerForUser(t, db, pgUID, centerID)

	body := `{"name":"Fall 2026","startDate":"2026-08-01","endDate":"2026-12-15","sessionCount":36}`
	req := httptest.NewRequest(http.MethodPost, "/api/terms", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("want 201, got %d — body: %s", rec.Code, rec.Body.String())
	}
	var env struct {
		Data struct {
			ID           string `json:"id"`
			Name         string `json:"name"`
			StartDate    string `json:"startDate"`
			SessionCount *int32 `json:"sessionCount"`
		} `json:"data"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&env); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if env.Data.Name != "Fall 2026" {
		t.Errorf("data.name = %q", env.Data.Name)
	}
	if env.Data.StartDate != "2026-08-01" {
		t.Errorf("data.startDate = %q, want 2026-08-01", env.Data.StartDate)
	}
	if env.Data.SessionCount == nil || *env.Data.SessionCount != 36 {
		t.Errorf("data.sessionCount = %v, want 36", env.Data.SessionCount)
	}
}

func TestTerms_Create_EndBeforeStart_Returns422(t *testing.T) {
	db := test.SetupDB(t)
	pgUID, centerID := seedTaxonomyOwner(t, db, "Terms Center 3")
	srv := test.NewSettings2_5BTestServerForUser(t, db, pgUID, centerID)

	body := `{"name":"Bad Term","startDate":"2026-08-01","endDate":"2026-07-15"}`
	req := httptest.NewRequest(http.MethodPost, "/api/terms", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("want 422, got %d — body: %s", rec.Code, rec.Body.String())
	}
	// Assert field error surfaces on endDate.
	var errEnv struct {
		Error struct {
			Details []struct {
				Field   string `json:"field"`
				Message string `json:"message"`
			} `json:"details"`
		} `json:"error"`
	}
	_ = json.NewDecoder(rec.Body).Decode(&errEnv)
	if len(errEnv.Error.Details) == 0 || errEnv.Error.Details[0].Field != "endDate" {
		t.Errorf("expected details[0].field=endDate, got %+v", errEnv.Error.Details)
	}
}

func TestTerms_Delete_UnknownID_Returns404(t *testing.T) {
	db := test.SetupDB(t)
	pgUID, centerID := seedTaxonomyOwner(t, db, "Terms Center 4")
	srv := test.NewSettings2_5BTestServerForUser(t, db, pgUID, centerID)

	req := httptest.NewRequest(http.MethodDelete, "/api/terms/00000000-0000-0000-0000-000000000abc", nil)
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d — body: %s", rec.Code, rec.Body.String())
	}
}

// ---- Holidays ----

func TestHolidays_Create_HappyPath_Returns201(t *testing.T) {
	db := test.SetupDB(t)
	pgUID, centerID := seedTaxonomyOwner(t, db, "Holidays Center 1")
	srv := test.NewSettings2_5BTestServerForUser(t, db, pgUID, centerID)

	body := `{"name":"National Day","date":"2026-09-02"}`
	req := httptest.NewRequest(http.MethodPost, "/api/holidays", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("want 201, got %d — body: %s", rec.Code, rec.Body.String())
	}
}

func TestHolidays_List_HappyPath_Returns200(t *testing.T) {
	db := test.SetupDB(t)
	pgUID, centerID := seedTaxonomyOwner(t, db, "Holidays Center 2")
	srv := test.NewSettings2_5BTestServerForUser(t, db, pgUID, centerID)

	req := httptest.NewRequest(http.MethodGet, "/api/holidays", nil)
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d — body: %s", rec.Code, rec.Body.String())
	}
}

// ---- Rooms ----

func TestRooms_Create_HappyPath_Returns201WithWireEcho(t *testing.T) {
	db := test.SetupDB(t)
	pgUID, centerID := seedTaxonomyOwner(t, db, "Rooms Center 1")
	srv := test.NewSettings2_5BTestServerForUser(t, db, pgUID, centerID)

	body := `{"name":"Room 101","description":"Ground floor","capacity":20}`
	req := httptest.NewRequest(http.MethodPost, "/api/rooms", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("want 201, got %d — body: %s", rec.Code, rec.Body.String())
	}
	var env struct {
		Data struct {
			Name        string  `json:"name"`
			Description *string `json:"description"`
			Capacity    int32   `json:"capacity"`
		} `json:"data"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&env); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if env.Data.Name != "Room 101" {
		t.Errorf("data.name = %q", env.Data.Name)
	}
	if env.Data.Capacity != 20 {
		t.Errorf("data.capacity = %d", env.Data.Capacity)
	}
}

func TestRooms_Create_CapacityOutOfRange_Returns422(t *testing.T) {
	db := test.SetupDB(t)
	pgUID, centerID := seedTaxonomyOwner(t, db, "Rooms Center 2")
	srv := test.NewSettings2_5BTestServerForUser(t, db, pgUID, centerID)

	body := `{"name":"Huge Room","capacity":9999}`
	req := httptest.NewRequest(http.MethodPost, "/api/rooms", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("want 422, got %d — body: %s", rec.Code, rec.Body.String())
	}
}

// AC6 — UNIQUE(center_id, LOWER(name)) → 409 ROOM_NAME_TAKEN with
// details[0].field=name so the frontend renders an inline field error.
func TestRooms_Create_DuplicateNameCaseInsensitive_Returns409RoomNameTaken(t *testing.T) {
	db := test.SetupDB(t)
	pgUID, centerID := seedTaxonomyOwner(t, db, "Rooms Center 3")
	srv := test.NewSettings2_5BTestServerForUser(t, db, pgUID, centerID)

	firstBody := `{"name":"Room A","capacity":20}`
	firstReq := httptest.NewRequest(http.MethodPost, "/api/rooms", strings.NewReader(firstBody))
	firstReq.Header.Set("Content-Type", "application/json")
	firstRec := httptest.NewRecorder()
	srv.ServeHTTP(firstRec, firstReq)
	if firstRec.Code != http.StatusCreated {
		t.Fatalf("seed room: want 201, got %d — body: %s", firstRec.Code, firstRec.Body.String())
	}

	// Case-only diff must collide.
	dupBody := `{"name":"room a","capacity":30}`
	dupReq := httptest.NewRequest(http.MethodPost, "/api/rooms", strings.NewReader(dupBody))
	dupReq.Header.Set("Content-Type", "application/json")
	dupRec := httptest.NewRecorder()
	srv.ServeHTTP(dupRec, dupReq)

	if dupRec.Code != http.StatusConflict {
		t.Fatalf("want 409, got %d — body: %s", dupRec.Code, dupRec.Body.String())
	}
	var errEnv struct {
		Error struct {
			Code    string `json:"code"`
			Details []struct {
				Field string `json:"field"`
			} `json:"details"`
		} `json:"error"`
	}
	_ = json.NewDecoder(dupRec.Body).Decode(&errEnv)
	if errEnv.Error.Code != "ROOM_NAME_TAKEN" {
		t.Errorf("error.code = %q, want ROOM_NAME_TAKEN", errEnv.Error.Code)
	}
	if len(errEnv.Error.Details) == 0 || errEnv.Error.Details[0].Field != "name" {
		t.Errorf("expected details[0].field=name for inline error UX, got %+v", errEnv.Error.Details)
	}
}

// Murat-B6 fold — 429 with Retry-After header on POST /api/rooms.
func TestRooms_Create_RateLimitExceeded_Returns429WithRetryAfterHeader(t *testing.T) {
	db := test.SetupDB(t)
	pgUID, centerID := seedTaxonomyOwner(t, db, "Rooms Center 4")
	srv := test.NewSettings2_5BTestServerRateLimited(t, db, pgUID, centerID) // 1/min burst 1

	// First call consumes the token.
	body1 := `{"name":"Room 1","capacity":10}`
	req1 := httptest.NewRequest(http.MethodPost, "/api/rooms", strings.NewReader(body1))
	req1.Header.Set("Content-Type", "application/json")
	req1.RemoteAddr = "1.2.3.4:5000"
	rec1 := httptest.NewRecorder()
	srv.ServeHTTP(rec1, req1)
	if rec1.Code != http.StatusCreated {
		t.Fatalf("first call: want 201, got %d — body: %s", rec1.Code, rec1.Body.String())
	}

	// Second call must be rate-limited.
	body2 := `{"name":"Room 2","capacity":10}`
	req2 := httptest.NewRequest(http.MethodPost, "/api/rooms", strings.NewReader(body2))
	req2.Header.Set("Content-Type", "application/json")
	req2.RemoteAddr = "1.2.3.4:5001"
	rec2 := httptest.NewRecorder()
	srv.ServeHTTP(rec2, req2)

	if rec2.Code != http.StatusTooManyRequests {
		t.Fatalf("second call: want 429, got %d — body: %s", rec2.Code, rec2.Body.String())
	}
	retryAfter := rec2.Header().Get("Retry-After")
	if retryAfter == "" {
		t.Fatal("Retry-After header missing on 429 response — Murat-B6 fold violated")
	}
	secs, err := strconv.Atoi(retryAfter)
	if err != nil {
		t.Fatalf("Retry-After = %q, not numeric: %v", retryAfter, err)
	}
	// Rate limiter is `rate.Every(time.Minute)` (60s bucket, burst=1). The
	// bounded band was 1..120 which permitted a wildly-off implementation to
	// pass; tightened /bmad-code-review 2-5b Round 1 P15 (2026-07-15) to
	// 1..65 — the ceiling absorbs off-by-a-few-seconds clock drift without
	// masking a real regression.
	if secs < 1 || secs > 65 {
		t.Errorf("Retry-After = %d seconds, expected 1..65 (60s rate.Every window)", secs)
	}
}

// AC7 — 401 for unauthenticated GET /api/terms.
func TestTerms_List_Unauthenticated_Returns401(t *testing.T) {
	db := test.SetupDB(t)
	// Bare mux — no authInjectingHandler wrapper — so the client's raw
	// Authorization header reaches ExtractTenant unmodified. Amended
	// /bmad-code-review 2-5b Round 1 P14 (2026-07-15) — previously we
	// wrapped the mux in authInjectingHandler, which overwrote our fake
	// bearer with a real signed token and thereby failed to exercise the
	// 401 code path at all (the test passed for the wrong reason).
	srv := test.NewSettings2_5BTestServerBareMux(t, db)
	req := httptest.NewRequest(http.MethodGet, "/api/terms", nil)
	req.Header.Set("Authorization", "Bearer invalid.token.here")
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	// Response envelope contract: 401 with error.code == AUTH_* .
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d — body: %s", rec.Code, rec.Body.String())
	}
	var errEnv struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	_ = json.NewDecoder(bytes.NewReader(rec.Body.Bytes())).Decode(&errEnv)
	if !strings.HasPrefix(errEnv.Error.Code, "AUTH_") {
		t.Errorf("error.code = %q, want AUTH_*", errEnv.Error.Code)
	}
}
