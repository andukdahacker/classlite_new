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
	"time"

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

// -----------------------------------------------------------------------------
// TA pass (2026-07-02) — P2/P3 expansion beyond ATDD's P0/P1 surface.
// Each test carries an ID (2.1-INT-2-N) matching automation-summary-2-1.md.
// -----------------------------------------------------------------------------

// 2.1-INT-2-1 (P2, AC1): POST /persona twice with DIFFERENT values must be
// treated as last-write-wins — the spec's "idempotent" language covers the
// same-value case; a subsequent different value is a legitimate wizard
// back+forward+re-pick and must persist the new choice.
func TestSetPersona_INT21_LastWriteWins_DifferentValues(t *testing.T) {
	db := test.SetupDB(t)
	user := test.CreateUser(t, db, "last-write@example.com", "L")
	test.MarkUserEmailVerified(t, db, user.ID)
	srv := test.NewTestServerForUser(t, db, user.ID)

	for _, persona := range []string{"founder", "operator"} {
		req := httptest.NewRequest(http.MethodPost, "/api/onboarding/persona",
			strings.NewReader(`{"persona":"`+persona+`"}`))
		req.Header.Set("Content-Type", "application/json")
		rec := httptest.NewRecorder()
		srv.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("persona=%q: want 200, got %d — body: %s", persona, rec.Code, rec.Body.String())
		}
	}

	// GET progress — Persona field (users.persona-derived) must reflect the
	// SECOND write, not the first.
	req := httptest.NewRequest(http.MethodGet, "/api/onboarding/progress", nil)
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET after two POSTs: want 200, got %d", rec.Code)
	}
	var envelope struct {
		Data struct {
			Persona *string `json:"persona"`
		} `json:"data"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&envelope); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if envelope.Data.Persona == nil {
		t.Fatal("Persona MUST be non-nil after two writes — got null; last-write-wins broken")
	}
	if *envelope.Data.Persona != "operator" {
		t.Errorf("last-write-wins: want persona=operator, got %q", *envelope.Data.Persona)
	}
}

// 2.1-INT-2-2 (P2, AC1/3): request body just over the 16 KiB cap must fail
// as a client error (422), not a 500 — MaxBytesReader trips inside
// json.Decode and the handler must surface a clean VALIDATION_ERROR envelope.
func TestOnboarding_INT22_BodyCapBoundary_Returns422NotFiveHundred(t *testing.T) {
	db := test.SetupDB(t)
	user := test.CreateUser(t, db, "body-cap@example.com", "B")
	test.MarkUserEmailVerified(t, db, user.ID)
	srv := test.NewTestServerForUser(t, db, user.ID)

	// Build a JSON body over 16 KiB via a fat payload field.
	// 16*1024 = 16384; the pad string alone (17000 chars) puts us safely over.
	pad := strings.Repeat("x", 17_000)
	body := `{"currentStep":"persona","payload":{"schemaVersion":1,"personaChoice":"` + pad + `"}}`
	if len(body) <= 16*1024 {
		t.Fatalf("test precondition: crafted body is %d bytes, expected > 16 KiB", len(body))
	}

	req := httptest.NewRequest(http.MethodPut, "/api/onboarding/progress",
		strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	if rec.Code >= 500 {
		t.Errorf("body-cap overflow leaked as %d — MUST be a 4xx client error, not 5xx", rec.Code)
	}
	if rec.Code != http.StatusUnprocessableEntity {
		t.Errorf("want 422 VALIDATION_ERROR, got %d — body: %s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body, "VALIDATION_ERROR")
}

// 2.1-INT-2-6 (P2, AC3): PUT /progress with an unsupported payload
// schemaVersion must surface as 422 VALIDATION_ERROR, not 500. Locks in
// MigrateOnboardingPayload's error path through the handler's error mapper.
func TestPutProgress_INT26_UnsupportedSchemaVersion_Returns422(t *testing.T) {
	db := test.SetupDB(t)
	user := test.CreateUser(t, db, "schema-99@example.com", "S")
	test.MarkUserEmailVerified(t, db, user.ID)
	srv := test.NewTestServerForUser(t, db, user.ID)

	req := httptest.NewRequest(http.MethodPut, "/api/onboarding/progress",
		strings.NewReader(`{"currentStep":"persona","payload":{"schemaVersion":99,"personaChoice":"founder"}}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnprocessableEntity {
		t.Errorf("unsupported schemaVersion: want 422, got %d — body: %s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body, "VALIDATION_ERROR")
}

// 2.1-INT-2-7 (P3, AC3+AC4): full wizard round-trip proves the code-review
// Persona (users.persona-derived, top-level response) vs PersonaChoice
// (payload draft, only inside RawPayload) split holds end-to-end across
// three endpoints — POST /persona → PUT /progress → GET /progress.
func TestOnboarding_INT27_WizardRoundtrip_PersonaVsPersonaChoiceSemantics(t *testing.T) {
	db := test.SetupDB(t)
	user := test.CreateUser(t, db, "wizard@example.com", "W")
	test.MarkUserEmailVerified(t, db, user.ID)
	srv := test.NewTestServerForUser(t, db, user.ID)

	// Step 1: POST /persona sets users.persona = "solo_teacher".
	req := httptest.NewRequest(http.MethodPost, "/api/onboarding/persona",
		strings.NewReader(`{"persona":"solo_teacher"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("step 1 POST /persona: want 200, got %d — body: %s", rec.Code, rec.Body.String())
	}

	// Step 2: PUT /progress with payload.personaChoice = "founder" (draft
	// deliberately different from users.persona, simulating wizard state).
	req = httptest.NewRequest(http.MethodPut, "/api/onboarding/progress",
		strings.NewReader(`{"currentStep":"center","payload":{"schemaVersion":1,"personaChoice":"founder","centerDraft":{"name":"Wizard Test","brandColor":"#112233","logoUrl":null}}}`))
	req.Header.Set("Content-Type", "application/json")
	rec = httptest.NewRecorder()
	srv.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("step 2 PUT /progress: want 200, got %d — body: %s", rec.Code, rec.Body.String())
	}

	// Step 3: GET /progress — top-level Persona MUST be "solo_teacher"
	// (users.persona), payload.personaChoice MUST be "founder" (the draft).
	req = httptest.NewRequest(http.MethodGet, "/api/onboarding/progress", nil)
	rec = httptest.NewRecorder()
	srv.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("step 3 GET /progress: want 200, got %d", rec.Code)
	}
	var envelope struct {
		Data struct {
			CurrentStep string  `json:"currentStep"`
			Persona     *string `json:"persona"`
			Payload     struct {
				PersonaChoice string `json:"personaChoice"`
				CenterDraft   struct {
					Name string `json:"name"`
				} `json:"centerDraft"`
			} `json:"payload"`
		} `json:"data"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&envelope); err != nil {
		t.Fatalf("decode: %v", err)
	}

	if envelope.Data.Persona == nil || *envelope.Data.Persona != "solo_teacher" {
		t.Errorf("top-level Persona MUST reflect users.persona = solo_teacher, got %v", envelope.Data.Persona)
	}
	if envelope.Data.Payload.PersonaChoice != "founder" {
		t.Errorf("payload.personaChoice MUST reflect the draft = founder, got %q", envelope.Data.Payload.PersonaChoice)
	}
	if envelope.Data.CurrentStep != "center" {
		t.Errorf("currentStep MUST be center, got %q", envelope.Data.CurrentStep)
	}
	if envelope.Data.Payload.CenterDraft.Name != "Wizard Test" {
		t.Errorf("payload.centerDraft.name MUST roundtrip, got %q", envelope.Data.Payload.CenterDraft.Name)
	}
}

// 2.1-INT-2-8 (P2, AC8): per-route rate limit (20 tokens per minute per
// IP-keyed user) — the 21st request within the window MUST return
// 429 RATE_LIMIT_EXCEEDED. Each newStorySrv call in the test harness gets
// its own limiter (unique key per test), so the burst count is deterministic.
func TestOnboarding_INT28_RateLimit_21stRequestReturns429(t *testing.T) {
	db := test.SetupDB(t)
	user := test.CreateUser(t, db, "rate-limit@example.com", "R")
	test.MarkUserEmailVerified(t, db, user.ID)
	srv := test.NewTestServerForUser(t, db, user.ID)

	// 20 GETs — all succeed (burst budget).
	for i := 0; i < 20; i++ {
		req := httptest.NewRequest(http.MethodGet, "/api/onboarding/progress", nil)
		rec := httptest.NewRecorder()
		srv.ServeHTTP(rec, req)
		if rec.Code == http.StatusTooManyRequests {
			t.Fatalf("request %d/20 unexpectedly rate-limited — burst budget exhausted early", i+1)
		}
	}

	// 21st request — must trip.
	req := httptest.NewRequest(http.MethodGet, "/api/onboarding/progress", nil)
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)
	if rec.Code != http.StatusTooManyRequests {
		t.Errorf("21st request: want 429 RATE_LIMIT_EXCEEDED, got %d — body: %s", rec.Code, rec.Body.String())
	}
	assertErrorCode(t, rec.Body, "RATE_LIMIT_EXCEEDED")
}

// 2.1-INT-2-9 (P3, envelope contract): every 2xx from every story-2.1
// endpoint must include meta.serverTime as a parseable RFC3339 UTC
// timestamp. Cross-cuts every AC; single test protects the whole surface.
func TestOnboarding_INT29_EnvelopeContract_ServerTimeIsRFC3339UTC(t *testing.T) {
	db := test.SetupDB(t)
	user := test.CreateUser(t, db, "envelope@example.com", "E")
	test.MarkUserEmailVerified(t, db, user.ID)
	srv := test.NewTestServerForUser(t, db, user.ID)

	// Exercise the 4 endpoints in an order that keeps each 2xx.
	// 1. POST /persona (200)
	// 2. PUT /progress (200)
	// 3. GET /progress (200)
	// 4. POST /centers (201) — must be last to satisfy one-center-per-user.
	type call struct {
		method string
		path   string
		body   string
		want   int
	}
	calls := []call{
		{http.MethodPost, "/api/onboarding/persona", `{"persona":"founder"}`, http.StatusOK},
		{http.MethodPut, "/api/onboarding/progress", `{"currentStep":"persona","payload":{"schemaVersion":1}}`, http.StatusOK},
		{http.MethodGet, "/api/onboarding/progress", "", http.StatusOK},
		{http.MethodPost, "/api/centers", `{"name":"Envelope Test","brandColor":null,"logoUrl":null}`, http.StatusCreated},
	}

	for _, c := range calls {
		var req *http.Request
		if c.body == "" {
			req = httptest.NewRequest(c.method, c.path, nil)
		} else {
			req = httptest.NewRequest(c.method, c.path, strings.NewReader(c.body))
			req.Header.Set("Content-Type", "application/json")
		}
		rec := httptest.NewRecorder()
		srv.ServeHTTP(rec, req)

		if rec.Code != c.want {
			t.Errorf("%s %s: want %d, got %d — body: %s", c.method, c.path, c.want, rec.Code, rec.Body.String())
			continue
		}

		var envelope struct {
			Meta struct {
				ServerTime string `json:"serverTime"`
			} `json:"meta"`
		}
		if err := json.NewDecoder(rec.Body).Decode(&envelope); err != nil {
			t.Errorf("%s %s: decode envelope: %v", c.method, c.path, err)
			continue
		}
		if envelope.Meta.ServerTime == "" {
			t.Errorf("%s %s: envelope.meta.serverTime is empty — every 2xx MUST populate it", c.method, c.path)
			continue
		}
		// Must parse as RFC3339 with (or without) fractional seconds.
		// AC preamble specifies ISO-8601 UTC, RFC3339 is the strict subset.
		parsed, err := time.Parse(time.RFC3339Nano, envelope.Meta.ServerTime)
		if err != nil {
			// Fall back to RFC3339 (no fractional) — either is acceptable per spec.
			parsed, err = time.Parse(time.RFC3339, envelope.Meta.ServerTime)
			if err != nil {
				t.Errorf("%s %s: serverTime %q is not valid RFC3339: %v", c.method, c.path, envelope.Meta.ServerTime, err)
				continue
			}
		}
		if parsed.Location() != time.UTC && parsed.Location().String() != "UTC" {
			// RFC3339 encoded as "Z" preserves UTC; "+00:00" also acceptable.
			// Convert to UTC and compare offset to catch non-UTC-encoded timestamps.
			_, offset := parsed.Zone()
			if offset != 0 {
				t.Errorf("%s %s: serverTime %q is not UTC (offset=%d)", c.method, c.path, envelope.Meta.ServerTime, offset)
			}
		}
	}
}
