//go:build atdd_red_phase

// logout_handler_test_atdd.go — Story 1.5 ATDD red-phase scaffolds.
//
// ACCEPTANCE CRITERIA COVERED
//   AC-1.5-05  Logout: refresh token invalidated in DB + cookie cleared

package handler_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/ducdo/classlite-api/internal/handler"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/ducdo/classlite-api/internal/test"
)

func TestLogoutHandler_AC05_InvalidatesRefreshAndClearsCookie(t *testing.T) {
	db := test.SetupDB(t)
	user := test.CreateUser(t, db, "alice@example.com", "Alice")
	_ = test.CreateCenterWithID(t, db, test.TenantAID, "Tenant A", "TENA")
	authSvc := newAuthHandlerService(t, db)
	_ = authSvc.SetPassword(context.Background(), user.ID, "ValidPass123!")

	loginResult, err := authSvc.Login(context.Background(), service.LoginInput{
		Email: "alice@example.com", Password: "ValidPass123!",
	})
	if err != nil {
		t.Fatalf("seed login: %v", err)
	}

	h := handler.NewAuthHandler(authSvc, handler.CookieConfig{
		Domain: ".classlite.app", Secure: true, SameSite: http.SameSiteLaxMode,
	})

	req := httptest.NewRequest(http.MethodPost, "/api/auth/logout", nil)
	req.AddCookie(&http.Cookie{Name: "refresh_token", Value: loginResult.RefreshToken})
	rec := httptest.NewRecorder()

	h.Logout(rec, req)

	if rec.Code != http.StatusOK && rec.Code != http.StatusNoContent {
		t.Fatalf("expected 200 or 204, got %d", rec.Code)
	}

	// Refresh token row is deleted.
	var count int
	if err := db.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM refresh_tokens WHERE token_hash = $1`,
		service.HashRefreshToken(loginResult.RefreshToken),
	).Scan(&count); err != nil {
		t.Fatalf("count refresh tokens: %v", err)
	}
	if count != 0 {
		t.Fatalf("expected refresh_tokens row deleted on logout, found %d", count)
	}

	// Set-Cookie clears the refresh cookie (MaxAge < 0 or expires in past).
	cookies := rec.Result().Cookies()
	var cleared *http.Cookie
	for _, c := range cookies {
		if c.Name == "refresh_token" {
			cleared = c
			break
		}
	}
	if cleared == nil {
		t.Fatal("logout did not emit a clearing Set-Cookie for refresh_token")
	}
	if cleared.MaxAge >= 0 && cleared.Expires.IsZero() {
		t.Fatalf("logout cookie should clear refresh_token (MaxAge<0 or Expires in past), got MaxAge=%d Expires=%v",
			cleared.MaxAge, cleared.Expires)
	}
}
