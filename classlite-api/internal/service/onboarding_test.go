// Story 2.1 Task 12.1 — OnboardingService unit tests.
//
// Note: OnboardingService takes an AuthDB (real pgxpool or *TxDB) rather
// than a per-query store interface, so these tests use test.SetupDB(t)
// like the store-integration tests. TEST-BE-4's "mock the store interface"
// posture would require introducing an OnboardingStore abstraction — not
// pulled in for this story because there is only one call site and the
// abstraction adds noise without a second consumer (see Dev Notes
// "Architectural debt acknowledged" §2 — AuthDB reuse is a load-bearing
// YAGNI decision).
//
// Coverage: persona validation matrix + default-when-missing shape +
// upsert payload roundtrip normalization.
package service_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/ducdo/classlite-api/internal/test"
	"github.com/google/uuid"
)

func TestOnboardingService_UpdatePersona_ValidationMatrix(t *testing.T) {
	db := test.SetupDB(t)
	user := test.CreateUser(t, db, "persona-matrix@example.com", "P")
	uid, _ := uuid.Parse(test.UUIDString(user.ID))

	svc := service.NewOnboardingService(db)
	ctx := context.Background()

	cases := []struct {
		name    string
		persona string
		wantErr bool
	}{
		{"operator_valid", "operator", false},
		{"founder_valid", "founder", false},
		{"solo_teacher_valid", "solo_teacher", false},
		{"admin_invalid", "admin", true},
		{"empty_invalid", "", true},
		{"capitalized_invalid", "Founder", true},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := svc.UpdatePersona(ctx, uid, tc.persona)
			if tc.wantErr {
				if err == nil {
					t.Fatalf("want ValidationError for %q, got nil", tc.persona)
				}
				var vErr model.ValidationError
				if !errors.As(err, &vErr) {
					t.Errorf("want model.ValidationError, got %T (%v)", err, err)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error for %q: %v", tc.persona, err)
			}
		})
	}
}

func TestOnboardingService_UpdatePersona_ZeroUUID_ReturnsValidationError(t *testing.T) {
	db := test.SetupDB(t)
	svc := service.NewOnboardingService(db)

	err := svc.UpdatePersona(context.Background(), uuid.Nil, "founder")
	var vErr model.ValidationError
	if !errors.As(err, &vErr) {
		t.Errorf("zero UUID → want ValidationError, got %T (%v)", err, err)
	}
}

func TestOnboardingService_GetProgress_DefaultWhenMissing(t *testing.T) {
	db := test.SetupDB(t)
	user := test.CreateUser(t, db, "default-state@example.com", "D")
	uid, _ := uuid.Parse(test.UUIDString(user.ID))

	svc := service.NewOnboardingService(db)
	got, err := svc.GetProgress(context.Background(), uid)
	if err != nil {
		t.Fatalf("GetProgress: %v", err)
	}
	if got.CurrentStep != "persona" {
		t.Errorf("default currentStep = %q, want persona", got.CurrentStep)
	}
	if got.Persona != nil {
		t.Errorf("default Persona (users.persona-derived) = %v, want nil — users.persona was never set for this user", *got.Persona)
	}
	if got.PersonaChoice != nil {
		t.Errorf("default personaChoice = %v, want nil", *got.PersonaChoice)
	}
	if got.UpdatedAt != nil {
		t.Errorf("default updatedAt = %v, want nil", *got.UpdatedAt)
	}
	if got.RawPayload != nil {
		t.Errorf("default rawPayload = %v, want nil", got.RawPayload)
	}
}

func TestOnboardingService_UpsertProgress_TypedPayloadRoundtrip(t *testing.T) {
	db := test.SetupDB(t)
	user := test.CreateUser(t, db, "payload-roundtrip@example.com", "R")
	uid, _ := uuid.Parse(test.UUIDString(user.ID))

	svc := service.NewOnboardingService(db)
	ctx := context.Background()

	// Payload with an EXTRA top-level field the typed struct doesn't know.
	// The service should strip it during the marshal-through — a payload
	// smuggling attack surface hardening.
	rawIn := `{"schemaVersion":1,"personaChoice":"founder","centerDraft":{"name":"Test","brandColor":"#ff0000","logoUrl":null},"unknownField":"should_be_stripped"}`
	got, err := svc.UpsertProgress(ctx, uid, service.UpsertProgressInput{
		CurrentStep: "center",
		Payload:     []byte(rawIn),
	})
	if err != nil {
		t.Fatalf("UpsertProgress: %v", err)
	}
	if got.CurrentStep != "center" {
		t.Errorf("currentStep = %q, want center", got.CurrentStep)
	}
	if got.PersonaChoice == nil || *got.PersonaChoice != "founder" {
		t.Errorf("personaChoice (payload draft) = %v, want founder", got.PersonaChoice)
	}
	// Persona (users.persona-derived) is orthogonal to PersonaChoice (payload
	// draft). UpsertProgress writes onboarding_progress only; it never touches
	// users.persona. Since this test never called UpdatePersona, Persona must
	// stay nil — proves the code-review P1 split (Persona vs PersonaChoice)
	// stays intact through the upsert path.
	if got.Persona != nil {
		t.Errorf("Persona (users.persona-derived) = %v, want nil — UpsertProgress must not touch users.persona", *got.Persona)
	}
	// Round-trip: unknown top-level field must not leak into stored payload.
	if got.RawPayload != nil {
		if strings.Contains(string(got.RawPayload), "unknownField") {
			t.Errorf("payload leaked unknown top-level field: %s", string(got.RawPayload))
		}
	}
}

func TestOnboardingService_UpsertProgress_UnknownStep_ReturnsValidationError(t *testing.T) {
	db := test.SetupDB(t)
	user := test.CreateUser(t, db, "bad-step@example.com", "B")
	uid, _ := uuid.Parse(test.UUIDString(user.ID))

	svc := service.NewOnboardingService(db)
	_, err := svc.UpsertProgress(context.Background(), uid, service.UpsertProgressInput{
		CurrentStep: "not-a-real-step",
		Payload:     []byte(`{"schemaVersion":1}`),
	})
	var vErr model.ValidationError
	if !errors.As(err, &vErr) {
		t.Errorf("unknown step → want ValidationError, got %T (%v)", err, err)
	}
}
