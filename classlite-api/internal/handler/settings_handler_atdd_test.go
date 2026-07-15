// Story 2-5a — SettingsHandler integration tests via NewSettingsTestServerForUser.
//
// Coverage per story Task 3.5 handler tests bullet:
//   - GET happy path: full envelope shape
//   - PATCH happy path: name + contactEmail persist and echo back
//   - Tenant mismatch (path id ≠ tc.CenterID) → 403 TENANT_MISMATCH
//   - Timezone-not-in-whitelist → 422 UNSUPPORTED_TIMEZONE
//   - Rate-limit → 429 with Retry-After header (Murat-B6 fold)
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
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// seedOwnerCenterHandler returns (userID pgtype.UUID, centerID string)
// after wiring a verified Owner and creating a center via CenterService —
// the test then hits SettingsHandler through the full middleware chain.
func seedOwnerCenterHandler(t *testing.T, db *test.TxDB, name string) (pgtype.UUID, string) {
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

func TestSettingsHandler_Get_HappyPath_ReturnsEnvelopeAndProfile(t *testing.T) {
	db := test.SetupDB(t)
	pgUID, centerID := seedOwnerCenterHandler(t, db, "Get Handler Center")
	srv := test.NewSettingsTestServerForUser(t, db, pgUID, centerID)

	req := httptest.NewRequest(http.MethodGet, "/api/centers/"+centerID, nil)
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d — body: %s", rec.Code, rec.Body.String())
	}

	var env struct {
		Data struct {
			ID                  string  `json:"id"`
			Name                string  `json:"name"`
			ShortCode           string  `json:"shortCode"`
			ContactEmail        *string `json:"contactEmail"`
			BrandColor          *string `json:"brandColor"`
			LogoUrl             *string `json:"logoUrl"`
			Timezone            string  `json:"timezone"`
			GoogleMeetConnected bool    `json:"googleMeetConnected"`
			CreatedAt           string  `json:"createdAt"`
		} `json:"data"`
		Meta struct{ ServerTime string `json:"serverTime"` } `json:"meta"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&env); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if env.Data.ID != centerID {
		t.Errorf("data.id = %q, want %q", env.Data.ID, centerID)
	}
	if env.Data.Name != "Get Handler Center" {
		t.Errorf("data.name = %q", env.Data.Name)
	}
	if env.Data.Timezone != "Asia/Ho_Chi_Minh" {
		t.Errorf("data.timezone = %q, want default", env.Data.Timezone)
	}
	if env.Data.ContactEmail != nil {
		t.Errorf("data.contactEmail should be null on fresh center, got %v", env.Data.ContactEmail)
	}
	if env.Meta.ServerTime == "" {
		t.Errorf("meta.serverTime empty")
	}
}

func TestSettingsHandler_Patch_HappyPath_UpdatesAndEchoesBack(t *testing.T) {
	db := test.SetupDB(t)
	pgUID, centerID := seedOwnerCenterHandler(t, db, "Patch Handler Center")
	srv := test.NewSettingsTestServerForUser(t, db, pgUID, centerID)

	body := `{"name":"Renamed Center","contactEmail":"hello@example.com","timezone":"Asia/Bangkok"}`
	req := httptest.NewRequest(http.MethodPatch, "/api/centers/"+centerID, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d — body: %s", rec.Code, rec.Body.String())
	}

	var env struct {
		Data struct {
			Name         string  `json:"name"`
			ContactEmail *string `json:"contactEmail"`
			Timezone     string  `json:"timezone"`
		} `json:"data"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&env); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if env.Data.Name != "Renamed Center" {
		t.Errorf("data.name = %q", env.Data.Name)
	}
	if env.Data.ContactEmail == nil || *env.Data.ContactEmail != "hello@example.com" {
		t.Errorf("data.contactEmail = %v", env.Data.ContactEmail)
	}
	if env.Data.Timezone != "Asia/Bangkok" {
		t.Errorf("data.timezone = %q", env.Data.Timezone)
	}
}

func TestSettingsHandler_Patch_ShortCodeInBody_IsSilentlyIgnored(t *testing.T) {
	// AC3 read-only shortCode contract: a rogue client sending shortCode
	// must not mutate the column. Handler accepts the body, PATCH runs
	// with an empty UpdateCenterInput.ShortCode (field absent), and the
	// short_code column stays untouched.
	db := test.SetupDB(t)
	pgUID, centerID := seedOwnerCenterHandler(t, db, "ReadOnly Short Code Center")
	srv := test.NewSettingsTestServerForUser(t, db, pgUID, centerID)

	// Fetch the original shortCode.
	var original struct {
		Data struct {
			ShortCode string `json:"shortCode"`
		} `json:"data"`
	}
	getReq := httptest.NewRequest(http.MethodGet, "/api/centers/"+centerID, nil)
	getRec := httptest.NewRecorder()
	srv.ServeHTTP(getRec, getReq)
	if err := json.NewDecoder(getRec.Body).Decode(&original); err != nil {
		t.Fatalf("decode original: %v", err)
	}

	// PATCH with a shortCode override that should be ignored.
	body := `{"shortCode":"attacker-slug"}`
	req := httptest.NewRequest(http.MethodPatch, "/api/centers/"+centerID, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("want 200 (silently accepted), got %d — body: %s", rec.Code, rec.Body.String())
	}

	var after struct {
		Data struct {
			ShortCode string `json:"shortCode"`
		} `json:"data"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&after); err != nil {
		t.Fatalf("decode after: %v", err)
	}
	if after.Data.ShortCode != original.Data.ShortCode {
		t.Errorf("shortCode changed from %q to %q — AC3 read-only violated",
			original.Data.ShortCode, after.Data.ShortCode)
	}
}

func TestSettingsHandler_Get_TenantMismatch_Returns403TenantMismatch(t *testing.T) {
	db := test.SetupDB(t)
	pgUID, centerID := seedOwnerCenterHandler(t, db, "TM Get Center")
	srv := test.NewSettingsTestServerForUser(t, db, pgUID, centerID)

	// Craft a request with a random unrelated UUID in the path.
	other := uuid.New().String()
	req := httptest.NewRequest(http.MethodGet, "/api/centers/"+other, nil)
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("want 403, got %d — body: %s", rec.Code, rec.Body.String())
	}
	assertErrorCodeCenter(t, rec.Body, "TENANT_MISMATCH")
}

func TestSettingsHandler_Patch_TenantMismatch_Returns403(t *testing.T) {
	db := test.SetupDB(t)
	pgUID, centerID := seedOwnerCenterHandler(t, db, "TM Patch Center")
	srv := test.NewSettingsTestServerForUser(t, db, pgUID, centerID)

	other := uuid.New().String()
	body := `{"name":"Attacker Rename"}`
	req := httptest.NewRequest(http.MethodPatch, "/api/centers/"+other, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("want 403, got %d — body: %s", rec.Code, rec.Body.String())
	}
	assertErrorCodeCenter(t, rec.Body, "TENANT_MISMATCH")
}

func TestSettingsHandler_Patch_UnsupportedTimezone_Returns422(t *testing.T) {
	db := test.SetupDB(t)
	pgUID, centerID := seedOwnerCenterHandler(t, db, "Bad TZ Handler Center")
	srv := test.NewSettingsTestServerForUser(t, db, pgUID, centerID)

	body := `{"timezone":"Antarctica/Vostok"}`
	req := httptest.NewRequest(http.MethodPatch, "/api/centers/"+centerID, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("want 422, got %d — body: %s", rec.Code, rec.Body.String())
	}
	assertErrorCodeCenter(t, rec.Body, "UNSUPPORTED_TIMEZONE")
}

func TestSettingsHandler_Patch_InvalidContactEmail_Returns422Validation(t *testing.T) {
	db := test.SetupDB(t)
	pgUID, centerID := seedOwnerCenterHandler(t, db, "Bad Email Handler Center")
	srv := test.NewSettingsTestServerForUser(t, db, pgUID, centerID)

	body := `{"contactEmail":"not-an-email"}`
	req := httptest.NewRequest(http.MethodPatch, "/api/centers/"+centerID, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("want 422, got %d — body: %s", rec.Code, rec.Body.String())
	}
	assertErrorCodeCenter(t, rec.Body, "VALIDATION_ERROR")
}

func TestSettingsHandler_Get_MalformedUUID_Returns403TenantMismatch(t *testing.T) {
	// A path like `/api/centers/not-a-uuid` reaches the handler's tenant
	// mismatch check FIRST (path ≠ tc.CenterID), which is the correct
	// posture — never leak "the value you sent doesn't parse as a UUID"
	// vs "the UUID you sent isn't your center."
	db := test.SetupDB(t)
	pgUID, centerID := seedOwnerCenterHandler(t, db, "Bad UUID Center")
	srv := test.NewSettingsTestServerForUser(t, db, pgUID, centerID)

	req := httptest.NewRequest(http.MethodGet, "/api/centers/not-a-uuid", nil)
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("want 403 TENANT_MISMATCH, got %d — body: %s", rec.Code, rec.Body.String())
	}
	assertErrorCodeCenter(t, rec.Body, "TENANT_MISMATCH")
}

func TestSettingsHandler_Get_RateLimitExceeded_Returns429WithRetryAfterHeader(t *testing.T) {
	// Murat-B6 fold: 429 responses MUST include a Retry-After header per
	// RFC 6585 §4. Force this by using the rate-limited test server variant.
	db := test.SetupDB(t)
	pgUID, centerID := seedOwnerCenterHandler(t, db, "Rate Limited Center")
	srv := test.NewSettingsTestServerRateLimited(t, db, pgUID, centerID)

	// First call consumes the single token.
	first := httptest.NewRequest(http.MethodGet, "/api/centers/"+centerID, nil)
	firstRec := httptest.NewRecorder()
	srv.ServeHTTP(firstRec, first)
	if firstRec.Code != http.StatusOK {
		t.Fatalf("first request want 200, got %d — body: %s", firstRec.Code, firstRec.Body.String())
	}

	// Second call must be rate-limited.
	second := httptest.NewRequest(http.MethodGet, "/api/centers/"+centerID, nil)
	secondRec := httptest.NewRecorder()
	srv.ServeHTTP(secondRec, second)

	if secondRec.Code != http.StatusTooManyRequests {
		t.Fatalf("second request want 429, got %d — body: %s", secondRec.Code, secondRec.Body.String())
	}
	retry := secondRec.Header().Get("Retry-After")
	if retry == "" {
		t.Fatalf("429 response missing Retry-After header (Murat-B6)")
	}
	if seconds, err := strconv.Atoi(retry); err != nil || seconds < 1 {
		t.Errorf("Retry-After should be a positive integer seconds value, got %q", retry)
	}
	assertErrorCodeCenter(t, secondRec.Body, "RATE_LIMIT_EXCEEDED")
}

// D4 (2026-07-15 code review) — explicit JSON `null` on a nullable field
// clears the column to SQL NULL. Round-trip via GET to confirm persistence.
func TestSettingsHandler_Patch_ContactEmailNull_ClearsColumnToNull(t *testing.T) {
	db := test.SetupDB(t)
	pgUID, centerID := seedOwnerCenterHandler(t, db, "Null Clear Center")
	srv := test.NewSettingsTestServerForUser(t, db, pgUID, centerID)

	// Seed a value first.
	setBody := `{"contactEmail":"hello@example.com"}`
	setReq := httptest.NewRequest(http.MethodPatch, "/api/centers/"+centerID, strings.NewReader(setBody))
	setReq.Header.Set("Content-Type", "application/json")
	setRec := httptest.NewRecorder()
	srv.ServeHTTP(setRec, setReq)
	if setRec.Code != http.StatusOK {
		t.Fatalf("seed set: want 200, got %d — body: %s", setRec.Code, setRec.Body.String())
	}

	// Clear via explicit null.
	clrBody := `{"contactEmail":null}`
	clrReq := httptest.NewRequest(http.MethodPatch, "/api/centers/"+centerID, strings.NewReader(clrBody))
	clrReq.Header.Set("Content-Type", "application/json")
	clrRec := httptest.NewRecorder()
	srv.ServeHTTP(clrRec, clrReq)
	if clrRec.Code != http.StatusOK {
		t.Fatalf("clear: want 200, got %d — body: %s", clrRec.Code, clrRec.Body.String())
	}

	var env struct {
		Data struct {
			ContactEmail *string `json:"contactEmail"`
		} `json:"data"`
	}
	if err := json.NewDecoder(clrRec.Body).Decode(&env); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if env.Data.ContactEmail != nil {
		t.Errorf("contactEmail should be null after clear, got %v", env.Data.ContactEmail)
	}
}

// P8 (2026-07-15 code review) — explicit empty string is rejected as 422.
// Empty is neither absent (no change) nor null (clear); the wire contract
// forces the client to pick one of the two explicit signals.
func TestSettingsHandler_Patch_ContactEmailEmptyString_Returns422(t *testing.T) {
	db := test.SetupDB(t)
	pgUID, centerID := seedOwnerCenterHandler(t, db, "Empty String Center")
	srv := test.NewSettingsTestServerForUser(t, db, pgUID, centerID)

	body := `{"contactEmail":""}`
	req := httptest.NewRequest(http.MethodPatch, "/api/centers/"+centerID, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("want 422, got %d — body: %s", rec.Code, rec.Body.String())
	}
	assertErrorCodeCenter(t, rec.Body, "VALIDATION_ERROR")
}

// D4 non-nullable variant — JSON `null` on `name` (required field) is
// rejected with 422 before the SQL layer sees it.
func TestSettingsHandler_Patch_NameNull_Returns422(t *testing.T) {
	db := test.SetupDB(t)
	pgUID, centerID := seedOwnerCenterHandler(t, db, "Name Null Center")
	srv := test.NewSettingsTestServerForUser(t, db, pgUID, centerID)

	body := `{"name":null}`
	req := httptest.NewRequest(http.MethodPatch, "/api/centers/"+centerID, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("want 422, got %d — body: %s", rec.Code, rec.Body.String())
	}
	assertErrorCodeCenter(t, rec.Body, "VALIDATION_ERROR")
}

// P14 (2026-07-15 code review) — body over the 16 KiB cap returns 413
// PAYLOAD_TOO_LARGE, not 422 "invalid JSON".
func TestSettingsHandler_Patch_OversizedBody_Returns413(t *testing.T) {
	db := test.SetupDB(t)
	pgUID, centerID := seedOwnerCenterHandler(t, db, "Oversized Center")
	srv := test.NewSettingsTestServerForUser(t, db, pgUID, centerID)

	// Build a 17 KiB body — enough to exceed the 16 KiB MaxBytesReader cap.
	giantName := strings.Repeat("A", 17*1024)
	body := `{"name":"` + giantName + `"}`
	req := httptest.NewRequest(http.MethodPatch, "/api/centers/"+centerID, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("want 413, got %d — body: %s", rec.Code, rec.Body.String())
	}
	assertErrorCodeCenter(t, rec.Body, "PAYLOAD_TOO_LARGE")
}

// assertErrorCodeCenter is defined in center_handler_atdd_test.go. Re-declare
// nothing here — Go allows sharing the helper across files in the same package.

// keep the settings service constructor symbol referenced so an accidental
// rename shows here at compile time.
var _ = service.NewSettingsService

// keep bytes referenced for future test additions.
var _ = bytes.NewReader
