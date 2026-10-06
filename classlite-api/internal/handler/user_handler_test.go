// Story 9.4 — self-profile handler integration tests (real middleware chain +
// real service + real DB in a rolled-back tx, per TEST-BE-3). Covers the
// envelope/422 wire shapes, AC7 email-field-ignored, and SEC-10 change-password
// rate limiting.
package handler_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/ducdo/classlite-api/internal/test"
	"github.com/jackc/pgx/v5/pgtype"
)

func seedVerifiedUser(t *testing.T, db *test.TxDB, email, name string) pgtype.UUID {
	t.Helper()
	var id pgtype.UUID
	if err := db.QueryRow(context.Background(),
		`INSERT INTO users (email, full_name, email_verified, language_pref) VALUES ($1, $2, true, 'vi') RETURNING id`,
		email, name,
	).Scan(&id); err != nil {
		t.Fatalf("seed verified user: %v", err)
	}
	return id
}

func TestGetMe_ReturnsEnvelopeWithAllKeys(t *testing.T) {
	db := test.SetupDB(t)
	userID := seedVerifiedUser(t, db, test.UniqueEmail("getme"), "Ada Lovelace")
	srv := test.NewTestServerForProfile(t, db, userID)

	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, httptest.NewRequest("GET", "/api/users/me", nil))

	if rec.Code != http.StatusOK {
		t.Fatalf("GET /api/users/me: status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var resp struct {
		Data map[string]any `json:"data"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	// GO-5 — every key present (avatarUrl explicitly null, not omitted).
	for _, key := range []string{"id", "email", "fullName", "avatarUrl", "languagePref", "notificationSettings", "emailVerified", "isOauthOnly"} {
		if _, ok := resp.Data[key]; !ok {
			t.Fatalf("response missing key %q (GO-5): %v", key, resp.Data)
		}
	}
	if resp.Data["fullName"] != "Ada Lovelace" {
		t.Fatalf("fullName = %v", resp.Data["fullName"])
	}
	if resp.Data["avatarUrl"] != nil {
		t.Fatalf("avatarUrl should serialize as null, got %v", resp.Data["avatarUrl"])
	}
	notif, ok := resp.Data["notificationSettings"].(map[string]any)
	if !ok || notif["schemaVersion"] == nil {
		t.Fatalf("notificationSettings should be a typed object with schemaVersion, got %v", resp.Data["notificationSettings"])
	}
}

func TestUpdateMe_EmptyFullName_422Shape(t *testing.T) {
	db := test.SetupDB(t)
	userID := seedVerifiedUser(t, db, test.UniqueEmail("put422"), "Name Here")
	srv := test.NewTestServerForProfile(t, db, userID)

	body := `{"fullName":"  ","avatarUrl":null,"languagePref":"vi","notificationSettings":{"schemaVersion":1,"emailOnSubmission":true,"emailOnQuestion":true,"emailOnAnnouncement":true}}`
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, httptest.NewRequest("PUT", "/api/users/me", bytes.NewBufferString(body)))

	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422, got %d: %s", rec.Code, rec.Body.String())
	}
	var resp struct {
		Error struct {
			Code    string `json:"code"`
			Details []struct {
				Field string `json:"field"`
			} `json:"details"`
		} `json:"error"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.Error.Code != "VALIDATION_ERROR" {
		t.Fatalf("error code = %q, want VALIDATION_ERROR", resp.Error.Code)
	}
	if len(resp.Error.Details) == 0 || resp.Error.Details[0].Field != "fullName" {
		t.Fatalf("expected a fullName field error, got %+v", resp.Error.Details)
	}
}

func TestUpdateMe_MissingAvatarUrl_422(t *testing.T) {
	db := test.SetupDB(t)
	userID := seedVerifiedUser(t, db, test.UniqueEmail("putnoavatar"), "Snapshot User")
	srv := test.NewTestServerForProfile(t, db, userID)

	// D2 review patch — a PUT that OMITS avatarUrl (vs an explicit null) must 422,
	// not silently blank the stored avatar. notificationSettings is present.
	body := `{"fullName":"Snapshot User","languagePref":"vi","notificationSettings":{"schemaVersion":1,"emailOnSubmission":true,"emailOnQuestion":true,"emailOnAnnouncement":true}}`
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, httptest.NewRequest("PUT", "/api/users/me", bytes.NewBufferString(body)))

	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("D2: a PUT omitting avatarUrl should 422, got %d: %s", rec.Code, rec.Body.String())
	}
	var resp struct {
		Error struct {
			Code    string `json:"code"`
			Details []struct {
				Field string `json:"field"`
			} `json:"details"`
		} `json:"error"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.Error.Code != "VALIDATION_ERROR" {
		t.Fatalf("error code = %q, want VALIDATION_ERROR", resp.Error.Code)
	}
	if len(resp.Error.Details) == 0 || resp.Error.Details[0].Field != "avatarUrl" {
		t.Fatalf("expected an avatarUrl field error, got %+v", resp.Error.Details)
	}
}

func TestUpdateMe_IgnoresEmailField(t *testing.T) {
	db := test.SetupDB(t)
	origEmail := test.UniqueEmail("ac7")
	userID := seedVerifiedUser(t, db, origEmail, "Immutable Email")
	srv := test.NewTestServerForProfile(t, db, userID)

	// AC7 — a PUT carrying an `email` field must NOT mutate the login identity.
	body := `{"fullName":"Immutable Email","avatarUrl":null,"languagePref":"en","email":"attacker@evil.example","notificationSettings":{"schemaVersion":1,"emailOnSubmission":true,"emailOnQuestion":true,"emailOnAnnouncement":true}}`
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, httptest.NewRequest("PUT", "/api/users/me", bytes.NewBufferString(body)))
	if rec.Code != http.StatusOK {
		t.Fatalf("PUT: status = %d, body = %s", rec.Code, rec.Body.String())
	}

	var stored string
	if err := db.QueryRow(context.Background(), `SELECT email FROM users WHERE id = $1`, userID).Scan(&stored); err != nil {
		t.Fatalf("re-read email: %v", err)
	}
	if stored != origEmail {
		t.Fatalf("AC7 VIOLATION: email mutated via PUT: got %q, want %q", stored, origEmail)
	}
}

func TestChangePassword_RateLimited_SEC10(t *testing.T) {
	db := test.SetupDB(t)
	userID := seedVerifiedUser(t, db, test.UniqueEmail("sec10"), "Rate Limited")
	// Tight change-password bucket (burst 2) so the 3rd rapid request 429s.
	srv := test.NewTestServerForProfileTightCP(t, db, userID, 2)

	body := `{"currentPassword":"whatever","newPassword":"a-brand-new-pass-456"}`
	var lastCode int
	for i := 0; i < 3; i++ {
		rec := httptest.NewRecorder()
		srv.ServeHTTP(rec, httptest.NewRequest("POST", "/api/users/me/change-password", bytes.NewBufferString(body)))
		lastCode = rec.Code
	}
	if lastCode != http.StatusTooManyRequests {
		t.Fatalf("SEC-10: expected the 3rd change-password request to be 429, got %d", lastCode)
	}
}
