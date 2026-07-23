// login_handler_test_atdd.go — Story 1.5 ATDD red-phase scaffolds.
//
// ACCEPTANCE CRITERIA COVERED
//   AC-1.5-01  Login envelope shape (access token + user fields)
//   AC-1.5-10  Set-Cookie in non-dev carries HttpOnly + Secure +
//              SameSite=Lax + Domain=.classlite.app (R7)

package handler_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ducdo/classlite-api/internal/handler"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/ducdo/classlite-api/internal/test"
)

// TestLoginHandler_AC10_NonDevCookieAttributes_AllFourPresent proves R7:
// the refresh-token cookie in non-dev env carries every attribute.
func TestLoginHandler_AC10_NonDevCookieAttributes_AllFourPresent(t *testing.T) {
	db := test.SetupDB(t)
	user := test.CreateUser(t, db, "alice@example.com", "Alice")
	_ = test.CreateCenterWithID(t, db, test.TenantAID, "Tenant A", "TENA")

	authSvc := newAuthHandlerService(t, db)
	_ = authSvc.SetPassword(context.Background(), user.ID, "ValidPass123!")

	// Construct handler in NON-DEV mode (the impl reads an env flag or
	// CookieConfig with Secure=true, Domain=".classlite.app").
	cfg := handler.CookieConfig{
		Domain:   ".classlite.app",
		Secure:   true,
		SameSite: http.SameSiteLaxMode,
	}
	h := handler.NewAuthHandler(authSvc, cfg)

	body, _ := json.Marshal(map[string]string{
		"email":    "alice@example.com",
		"password": "ValidPass123!",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "https://my.classlite.app")
	rec := httptest.NewRecorder()

	h.Login(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (body=%q)", rec.Code, rec.Body.String())
	}

	cookies := rec.Result().Cookies()
	var refreshCookie *http.Cookie
	for _, c := range cookies {
		if c.Name == "refresh_token" {
			refreshCookie = c
			break
		}
	}
	if refreshCookie == nil {
		t.Fatal("refresh_token cookie not set")
	}

	if !refreshCookie.HttpOnly {
		t.Error("refresh_token cookie: HttpOnly must be true")
	}
	if !refreshCookie.Secure {
		t.Error("refresh_token cookie: Secure must be true in non-dev env")
	}
	if refreshCookie.SameSite != http.SameSiteLaxMode {
		t.Errorf("refresh_token cookie: SameSite must be Lax, got %v", refreshCookie.SameSite)
	}
	if refreshCookie.Domain != ".classlite.app" {
		t.Errorf("refresh_token cookie: Domain must be .classlite.app, got %q", refreshCookie.Domain)
	}
	if refreshCookie.Path != "/" {
		t.Errorf("refresh_token cookie: Path should be /, got %q", refreshCookie.Path)
	}
}

// TestLoginHandler_AC01_SuccessEnvelopeShape proves the response body
// follows the project envelope convention.
func TestLoginHandler_AC01_SuccessEnvelopeShape(t *testing.T) {
	db := test.SetupDB(t)
	user := test.CreateUser(t, db, "alice@example.com", "Alice")
	_ = test.CreateCenterWithID(t, db, test.TenantAID, "Tenant A", "TENA")

	authSvc := newAuthHandlerService(t, db)
	_ = authSvc.SetPassword(context.Background(), user.ID, "ValidPass123!")

	h := handler.NewAuthHandler(authSvc, handler.CookieConfig{
		Domain: ".classlite.app", Secure: true, SameSite: http.SameSiteLaxMode,
	})

	body, _ := json.Marshal(map[string]string{
		"email":    "alice@example.com",
		"password": "ValidPass123!",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	h.Login(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}

	var resp struct {
		Data struct {
			AccessToken string `json:"accessToken"`
			User        struct {
				ID    string `json:"id"`
				Email string `json:"email"`
			} `json:"user"`
		} `json:"data"`
		Meta map[string]any `json:"meta"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("decode envelope: %v", err)
	}
	if resp.Data.AccessToken == "" {
		t.Error("data.accessToken: expected non-empty JWT")
	}
	if resp.Data.User.Email != "alice@example.com" {
		t.Errorf("data.user.email: expected alice@example.com, got %q", resp.Data.User.Email)
	}
	if strings.Contains(rec.Body.String(), "refresh") {
		t.Error("response body must NOT contain refresh token (it lives in httpOnly cookie only)")
	}
}

// TestLoginHandler_ReturnsCenterForSingleMembershipOwner proves the login
// response carries the caller's center summary (api.yaml LoginResult.center).
// This is the durability contract that lets the frontend rehydrate
// `Session.center` on every login/refresh — without it a reloaded
// center-owning user looked center-less and resume-onboarding misrouted them
// back to /setup/center (409 wedge).
func TestLoginHandler_ReturnsCenterForSingleMembershipOwner(t *testing.T) {
	db := test.SetupDB(t)
	user := test.CreateUser(t, db, "owner@example.com", "Owner")
	centerID := test.SeedCenterForUser(t, db, user.ID)

	authSvc := newAuthHandlerService(t, db)
	_ = authSvc.SetPassword(context.Background(), user.ID, "ValidPass123!")
	h := handler.NewAuthHandler(authSvc, handler.CookieConfig{
		Domain: ".classlite.app", Secure: true, SameSite: http.SameSiteLaxMode,
	})

	body, _ := json.Marshal(map[string]string{
		"email":    "owner@example.com",
		"password": "ValidPass123!",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.Login(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (body=%q)", rec.Code, rec.Body.String())
	}
	var resp struct {
		Data struct {
			Center *struct {
				ID        string `json:"id"`
				Name      string `json:"name"`
				ShortCode string `json:"shortCode"`
				Timezone  string `json:"timezone"`
			} `json:"center"`
		} `json:"data"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("decode envelope: %v", err)
	}
	if resp.Data.Center == nil {
		t.Fatalf("data.center: expected the owner's center summary, got null")
	}
	if got := resp.Data.Center.ID; got != test.UUIDString(centerID) {
		t.Errorf("data.center.id: expected %q, got %q", test.UUIDString(centerID), got)
	}
	if resp.Data.Center.Name != "Test Center" {
		t.Errorf("data.center.name: expected %q, got %q", "Test Center", resp.Data.Center.Name)
	}
	if resp.Data.Center.ShortCode == "" {
		t.Error("data.center.shortCode: expected non-empty")
	}
	if resp.Data.Center.Timezone == "" {
		t.Error("data.center.timezone: expected non-empty")
	}
}

// TestLoginHandler_CenterNullForUserWithoutMembership proves the symmetric
// case: a user with zero memberships gets `center: null` (never undefined /
// omitted — GO-5), matching the null `role`.
func TestLoginHandler_CenterNullForUserWithoutMembership(t *testing.T) {
	db := test.SetupDB(t)
	user := test.CreateUser(t, db, "nobody@example.com", "Nobody")

	authSvc := newAuthHandlerService(t, db)
	_ = authSvc.SetPassword(context.Background(), user.ID, "ValidPass123!")
	h := handler.NewAuthHandler(authSvc, handler.CookieConfig{
		Domain: ".classlite.app", Secure: true, SameSite: http.SameSiteLaxMode,
	})

	body, _ := json.Marshal(map[string]string{
		"email":    "nobody@example.com",
		"password": "ValidPass123!",
	})
	req := httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.Login(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (body=%q)", rec.Code, rec.Body.String())
	}
	// The key must be present and explicitly null (GO-5: never omitempty).
	if !strings.Contains(rec.Body.String(), `"center":null`) {
		t.Errorf("expected data.center to be explicit null, got body=%q", rec.Body.String())
	}
}

func newAuthHandlerService(t *testing.T, db *test.TxDB) *service.AuthService {
	t.Helper()
	hasher := service.BcryptHasher{Cost: 4}
	sender := &service.MockEmailSender{}
	queue := service.NewEmailRetryQueue(sender, 8)
	auditLogger := service.NewPgAuthAuditLogger(db)
	return service.NewAuthService(db, hasher, sender, auditLogger, queue, "https://my.classlite.app/verify-email")
}
