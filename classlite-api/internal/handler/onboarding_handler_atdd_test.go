// ATDD specimens for Story 2.1 — Onboarding Handler.
//
// Every test in this file is expected to FAIL against the current codebase:
//   - handler.NewOnboardingHandler does not exist yet (compile-fail)
//   - service.NewOnboardingService does not exist yet (compile-fail)
//   - The four onboarding endpoints are not wired in cmd/api/main.go
//   - onboarding_progress table does not exist yet
//
// Amelia removes this build tag file-by-file during green-phase and turns
// each Test* function into a passing assertion. Mirrors Story 1-5/1-6
// ATDD pattern (see internal/service/google_oauth_atdd_test.go for shape).
//
// Coverage:
//   AC1  — POST /api/onboarding/persona (persist / idempotent / 401 / 403 / 422)
//   AC3  — PUT  /api/onboarding/progress (upsert / 422 / returns updatedAt)
//   AC4  — GET  /api/onboarding/progress (existing row / default state / joins persona)
//   AC8  — full middleware chain (ExtractTenant → RequireVerifiedEmail → handler)
//   AC10 — cross-user attack vectors: url_param_override / body_field_override / header_spoof
//          + DOM-wide privacy ratchet (Story 1.9c pattern extended)

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

// -----------------------------------------------------------------------------
// AC1 — POST /api/onboarding/persona
// -----------------------------------------------------------------------------

func TestSetPersona_AC01_ValidValue_Persists(t *testing.T) {
	db := test.SetupDB(t)
	user := test.CreateUser(t, db, "founder@example.com", "Founder One")
	test.MarkUserEmailVerified(t, db, user.ID) // green-phase: fixtures.go helper

	srv := test.NewTestServerForUser(t, db, user.ID) // green-phase harness

	req := httptest.NewRequest(http.MethodPost, "/api/onboarding/persona",
		strings.NewReader(`{"persona":"founder"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("want 200 OK, got %d — body: %s", rec.Code, rec.Body.String())
	}
	var envelope struct {
		Data struct{ Persona string } `json:"data"`
		Meta struct{ ServerTime string } `json:"meta"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&envelope); err != nil {
		t.Fatalf("decode envelope: %v", err)
	}
	if envelope.Data.Persona != "founder" {
		t.Errorf("want persona=founder, got %q", envelope.Data.Persona)
	}
	if envelope.Meta.ServerTime == "" {
		t.Errorf("AC1: envelope.meta.serverTime MUST be populated (Sally-B2 amendment)")
	}
}

func TestSetPersona_AC01_UnknownPersona_Returns422(t *testing.T) {
	db := test.SetupDB(t)
	user := test.CreateUser(t, db, "u@example.com", "U")
	test.MarkUserEmailVerified(t, db, user.ID)
	srv := test.NewTestServerForUser(t, db, user.ID)

	req := httptest.NewRequest(http.MethodPost, "/api/onboarding/persona",
		strings.NewReader(`{"persona":"admin"}`)) // not in {operator, founder, solo_teacher}
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("want 422, got %d", rec.Code)
	}
	assertErrorCode(t, rec.Body, "VALIDATION_ERROR")
}

func TestSetPersona_AC01_Idempotent_BrowserBack(t *testing.T) {
	db := test.SetupDB(t)
	user := test.CreateUser(t, db, "u@example.com", "U")
	test.MarkUserEmailVerified(t, db, user.ID)
	srv := test.NewTestServerForUser(t, db, user.ID)

	for i := 0; i < 2; i++ {
		req := httptest.NewRequest(http.MethodPost, "/api/onboarding/persona",
			strings.NewReader(`{"persona":"operator"}`))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		srv.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("iteration %d: want 200 (idempotent), got %d", i, rec.Code)
		}
	}
}

func TestSetPersona_AC01_NoAuth_Returns401(t *testing.T) {
	db := test.SetupDB(t)
	srv := test.NewTestServerUnauthenticated(t, db)

	req := httptest.NewRequest(http.MethodPost, "/api/onboarding/persona",
		strings.NewReader(`{"persona":"founder"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d", rec.Code)
	}
	assertErrorCode(t, rec.Body, "AUTH_REQUIRED")
}

func TestSetPersona_AC01_UnverifiedEmail_Returns403(t *testing.T) {
	db := test.SetupDB(t)
	user := test.CreateUser(t, db, "unverified@example.com", "U") // NOT verified
	srv := test.NewTestServerForUser(t, db, user.ID)

	req := httptest.NewRequest(http.MethodPost, "/api/onboarding/persona",
		strings.NewReader(`{"persona":"founder"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("want 403, got %d", rec.Code)
	}
	assertErrorCode(t, rec.Body, "EMAIL_VERIFICATION_REQUIRED")
}

// -----------------------------------------------------------------------------
// AC3 — PUT /api/onboarding/progress
// -----------------------------------------------------------------------------

func TestPutProgress_AC03_UpsertsRow(t *testing.T) {
	db := test.SetupDB(t)
	user := test.CreateUser(t, db, "u@example.com", "U")
	test.MarkUserEmailVerified(t, db, user.ID)
	srv := test.NewTestServerForUser(t, db, user.ID)

	body := `{"currentStep":"center","payload":{"schemaVersion":1,"personaChoice":"founder","centerDraft":{"name":"Trung tâm A","brandColor":"#ff0000","logoUrl":null}}}`
	req := httptest.NewRequest(http.MethodPut, "/api/onboarding/progress", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d — body: %s", rec.Code, rec.Body.String())
	}
	// Second upsert with different step MUST succeed (idempotent-by-user).
	body2 := `{"currentStep":"template","payload":{"schemaVersion":1,"personaChoice":"founder","centerDraft":null,"templateDraft":null}}`
	req2 := httptest.NewRequest(http.MethodPut, "/api/onboarding/progress", strings.NewReader(body2))
	req2.Header.Set("Content-Type", "application/json")
	rec2 := httptest.NewRecorder()
	srv.ServeHTTP(rec2, req2)
	if rec2.Code != http.StatusOK {
		t.Fatalf("upsert 2: want 200, got %d", rec2.Code)
	}
}

func TestPutProgress_AC03_UnknownStep_Returns422(t *testing.T) {
	db := test.SetupDB(t)
	user := test.CreateUser(t, db, "u@example.com", "U")
	test.MarkUserEmailVerified(t, db, user.ID)
	srv := test.NewTestServerForUser(t, db, user.ID)

	body := `{"currentStep":"not-a-valid-step","payload":{"schemaVersion":1}}`
	req := httptest.NewRequest(http.MethodPut, "/api/onboarding/progress", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("want 422, got %d", rec.Code)
	}
}

func TestPutProgress_AC03_ReturnsUpdatedAt(t *testing.T) {
	db := test.SetupDB(t)
	user := test.CreateUser(t, db, "u@example.com", "U")
	test.MarkUserEmailVerified(t, db, user.ID)
	srv := test.NewTestServerForUser(t, db, user.ID)

	body := `{"currentStep":"persona","payload":{"schemaVersion":1}}`
	req := httptest.NewRequest(http.MethodPut, "/api/onboarding/progress", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	var envelope struct {
		Data struct {
			CurrentStep string `json:"currentStep"`
			UpdatedAt   string `json:"updatedAt"`
		} `json:"data"`
		Meta struct{ ServerTime string `json:"serverTime"` } `json:"meta"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&envelope); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if envelope.Data.UpdatedAt == "" {
		t.Errorf("AC3: updatedAt MUST be populated (wizard's 'auto-saved Ns ago' affordance)")
	}
	if envelope.Meta.ServerTime == "" {
		t.Errorf("AC3: meta.serverTime MUST be populated (skew-immune 'Ns ago' seed)")
	}
}

// -----------------------------------------------------------------------------
// AC4 — GET /api/onboarding/progress
// -----------------------------------------------------------------------------

func TestGetProgress_AC04_ExistingRow_ReturnsPayload(t *testing.T) {
	db := test.SetupDB(t)
	user := test.CreateUser(t, db, "u@example.com", "U")
	test.MarkUserEmailVerified(t, db, user.ID)
	test.SeedOnboardingProgress(t, db, user.ID, "center", `{"schemaVersion":1,"personaChoice":"founder"}`) // green-phase fixture
	srv := test.NewTestServerForUser(t, db, user.ID)

	req := httptest.NewRequest(http.MethodGet, "/api/onboarding/progress", nil)
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d", rec.Code)
	}
	var envelope struct {
		Data struct {
			CurrentStep string `json:"currentStep"`
			Payload     json.RawMessage `json:"payload"`
			UpdatedAt   *string `json:"updatedAt"`
			Persona     *string `json:"persona"`
		} `json:"data"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&envelope); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if envelope.Data.CurrentStep != "center" {
		t.Errorf("want currentStep=center, got %q", envelope.Data.CurrentStep)
	}
}

func TestGetProgress_AC04_NoRow_ReturnsDefaultStateNot404(t *testing.T) {
	db := test.SetupDB(t)
	user := test.CreateUser(t, db, "u@example.com", "U")
	test.MarkUserEmailVerified(t, db, user.ID)
	// NO SeedOnboardingProgress call — row absent
	srv := test.NewTestServerForUser(t, db, user.ID)

	req := httptest.NewRequest(http.MethodGet, "/api/onboarding/progress", nil)
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	// AC4 hard rule: NEVER 404, ALWAYS 200 with default state.
	if rec.Code != http.StatusOK {
		t.Fatalf("AC4: no row → want 200 with default state, got %d", rec.Code)
	}
	var envelope struct {
		Data struct {
			CurrentStep string  `json:"currentStep"`
			Payload     any     `json:"payload"`
			UpdatedAt   *string `json:"updatedAt"`
			Persona     *string `json:"persona"`
		} `json:"data"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&envelope); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if envelope.Data.CurrentStep != "persona" {
		t.Errorf("AC4 default state: want currentStep=persona, got %q", envelope.Data.CurrentStep)
	}
	if envelope.Data.Payload != nil {
		t.Errorf("AC4 default state: payload MUST be null, got %v", envelope.Data.Payload)
	}
	if envelope.Data.UpdatedAt != nil {
		t.Errorf("AC4 default state: updatedAt MUST be null, got %v", *envelope.Data.UpdatedAt)
	}
}

func TestGetProgress_AC04_JoinsPersonaFromUsers(t *testing.T) {
	// Sally-S1 amendment: GET returns users.persona so resume doesn't need
	// a second round-trip to /me.
	db := test.SetupDB(t)
	user := test.CreateUser(t, db, "u@example.com", "U")
	test.MarkUserEmailVerified(t, db, user.ID)
	test.SetUserPersona(t, db, user.ID, "solo_teacher") // green-phase fixture
	// Deliberately do NOT seed onboarding_progress — the persona MUST still surface.
	srv := test.NewTestServerForUser(t, db, user.ID)

	req := httptest.NewRequest(http.MethodGet, "/api/onboarding/progress", nil)
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	var envelope struct {
		Data struct{ Persona *string `json:"persona"` } `json:"data"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&envelope); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if envelope.Data.Persona == nil || *envelope.Data.Persona != "solo_teacher" {
		t.Errorf("AC4 (Sally-S1): want persona=solo_teacher joined from users, got %v", envelope.Data.Persona)
	}
}

// -----------------------------------------------------------------------------
// AC8 — Middleware chain — end-to-end integration
// -----------------------------------------------------------------------------

func TestOnboardingChain_AC08_UnverifiedUser_Rejected(t *testing.T) {
	// AC8 asserts the chain order: ExtractTenant → RequireVerifiedEmail → handler.
	// A caller with valid JWT but unverified email must be rejected by
	// RequireVerifiedEmail before the handler runs. If the chain is
	// misordered (e.g. RequireVerifiedEmail before ExtractTenant), this
	// returns 500 instead of 403 — that's the wiring bug we're guarding.
	db := test.SetupDB(t)
	user := test.CreateUser(t, db, "unverified@example.com", "U") // NOT verified
	srv := test.NewTestServerForUser(t, db, user.ID)

	req := httptest.NewRequest(http.MethodGet, "/api/onboarding/progress", nil)
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("AC8 chain order: unverified user must 403, got %d (chain likely misordered)", rec.Code)
	}
	assertErrorCode(t, rec.Body, "EMAIL_VERIFICATION_REQUIRED")
}

// -----------------------------------------------------------------------------
// AC10 — Cross-user attack vectors (three named subtests per Murat-B2)
// -----------------------------------------------------------------------------

func TestGetProgress_AC10_AttackVectors(t *testing.T) {
	db := test.SetupDB(t)
	victim := test.CreateUser(t, db, "victim@example.com", "Victim")
	attacker := test.CreateUser(t, db, "attacker@example.com", "Attacker")
	test.MarkUserEmailVerified(t, db, victim.ID)
	test.MarkUserEmailVerified(t, db, attacker.ID)
	test.SeedOnboardingProgress(t, db, victim.ID, "template",
		`{"schemaVersion":1,"personaChoice":"founder","centerDraft":{"name":"Victim Center","brandColor":"#ff0000","logoUrl":null}}`)

	srv := test.NewTestServerForUser(t, db, attacker.ID)
	victimIDStr := test.UUIDString(victim.ID)

	t.Run("attack_vector_url_param_override", func(t *testing.T) {
		// Attacker tries: GET /api/onboarding/progress?user_id=<victim>
		// Server MUST resolve UserID from TenantContext only, IGNORE query param.
		req := httptest.NewRequest(http.MethodGet,
			"/api/onboarding/progress?user_id="+victimIDStr, nil)
		rec := httptest.NewRecorder()
		srv.ServeHTTP(rec, req)

		assertDoesNotLeak(t, rec.Body, "Victim Center", "founder", victimIDStr)
	})

	t.Run("attack_vector_body_field_override", func(t *testing.T) {
		// PUT /api/onboarding/progress with body carrying userId=<victim>.
		// Server MUST write for the AUTHENTICATED user, not the body claim.
		body := `{"userId":"` + victimIDStr + `","currentStep":"done","payload":{"schemaVersion":1}}`
		req := httptest.NewRequest(http.MethodPut, "/api/onboarding/progress",
			strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		srv.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Fatalf("attack_vector_body_field_override: PUT should still succeed for attacker, got %d", rec.Code)
		}
		// Verify victim's row was NOT overwritten — re-read as victim's server harness.
		srv2 := test.NewTestServerForUser(t, db, victim.ID)
		req2 := httptest.NewRequest(http.MethodGet, "/api/onboarding/progress", nil)
		rec2 := httptest.NewRecorder()
		srv2.ServeHTTP(rec2, req2)
		if strings.Contains(rec2.Body.String(), `"currentStep":"done"`) {
			t.Errorf("attack_vector_body_field_override: victim's row was overwritten! body-userId trusted")
		}
	})

	t.Run("attack_vector_header_spoof", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodGet, "/api/onboarding/progress", nil)
		req.Header.Set("X-User-ID", victimIDStr)
		req.Header.Set("X-Onboarding-User", victimIDStr)
		rec := httptest.NewRecorder()
		srv.ServeHTTP(rec, req)

		assertDoesNotLeak(t, rec.Body, "Victim Center", "founder", victimIDStr)
	})
}

func TestGetProgress_AC10_DomWidePrivacyRatchet(t *testing.T) {
	// Mirrors Story 1.9c REST-path ratchet — attacker's response body MUST NOT
	// contain any of victim's field values as raw bytes.
	db := test.SetupDB(t)
	victim := test.CreateUser(t, db, "victim@example.com", "Victim")
	attacker := test.CreateUser(t, db, "attacker@example.com", "Attacker")
	test.MarkUserEmailVerified(t, db, victim.ID)
	test.MarkUserEmailVerified(t, db, attacker.ID)
	test.SeedOnboardingProgress(t, db, victim.ID, "spawn",
		`{"schemaVersion":1,"centerDraft":{"name":"SECRET-VICTIM-STRING","brandColor":"#deadbe","logoUrl":null}}`)

	srv := test.NewTestServerForUser(t, db, attacker.ID)
	req := httptest.NewRequest(http.MethodGet, "/api/onboarding/progress", nil)
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	if bytes.Contains(rec.Body.Bytes(), []byte("SECRET-VICTIM-STRING")) {
		t.Errorf("AC10 DOM-wide privacy: attacker response contained victim's centerDraft.name")
	}
	if bytes.Contains(rec.Body.Bytes(), []byte("#deadbe")) {
		t.Errorf("AC10 DOM-wide privacy: attacker response contained victim's brandColor")
	}
}

// -----------------------------------------------------------------------------
// Test-local helpers — reference future fixtures; RED until green-phase.
// -----------------------------------------------------------------------------

// These references are what makes this file compile-fail today (Amelia's
// green-phase task list — expose these constructors + fixtures):
//   - handler.NewOnboardingHandler(...)
//   - service.NewOnboardingService(...)
//   - test.NewTestServerForUser(t, pool, userID)
//   - test.NewTestServerUnauthenticated(t, pool)
//   - test.MarkUserEmailVerified(t, db, userID)
//   - test.SeedOnboardingProgress(t, db, userID, step, payload)
//   - test.SetUserPersona(t, db, userID, persona)
//
// The direct handler/service imports here are the compile-fail signal.

func assertErrorCode(t *testing.T, body *bytes.Buffer, wantCode string) {
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

func assertDoesNotLeak(t *testing.T, body *bytes.Buffer, forbidden ...string) {
	t.Helper()
	raw := body.String()
	for _, s := range forbidden {
		if s == "" {
			continue
		}
		if strings.Contains(raw, s) {
			t.Errorf("cross-user leak: response body contained %q", s)
		}
	}
}

// Unused imports get flagged; keep handler + service in play so a broken
// green-phase implementation surfaces as compile-fail here first.
var _ = handler.NewOnboardingHandler
var _ = service.NewOnboardingService
var _ = context.TODO
