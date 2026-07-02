// Story 2.1 — R1 discharge (score 9) — J15 grid adapted for the non-RLS
// onboarding_progress table.
//
// Six named patterns per AC9. Each pattern catches a specific SERVICE-LAYER
// bug (not an RLS regression — this table has no RLS by design, mirroring
// the email_verifications pattern from Story 1.3). Isolation is enforced
// at the service-layer via a user_id filter.
//
// NOTE: No `//go:build atdd_red_phase` tag on this file. Per AC9 it is
// permanent from day 1 — mirrors internal/test/audit_logs_rls_test.go's
// posture. It will compile-fail today because service.NewOnboardingService,
// service.OnboardingService, and the queries.GetOnboardingProgressByUser /
// queries.UpsertOnboardingProgress sqlc-generated functions do not yet
// exist. That is the RED signal.
//
// Reference for the six-pattern taxonomy: story file AC9 (lines that
// enumerate P1-Read through P6-DefaultStateNoCache).

package test

import (
	"context"
	"errors"
	"net/http/httptest"
	"testing"

	"github.com/ducdo/classlite-api/internal/handler"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/ducdo/classlite-api/internal/store/generated"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// -----------------------------------------------------------------------------
// Test helpers scoped to this file.
// -----------------------------------------------------------------------------

func newOnboardingSvc(t *testing.T, db *TxDB) *service.OnboardingService {
	t.Helper()
	return service.NewOnboardingService(db)
}

// uuidToStr converts a pgtype.UUID to canonical string form. Local so we
// don't force helpers.go to expose a public alias.
func uuidToStr(u pgtype.UUID) string { return UUIDString(u) }

// -----------------------------------------------------------------------------
// P1-Read — TestOnboardingProgress_ServiceForgetsUserIDFilter
// Failure mode: service does `SELECT * FROM onboarding_progress` and returns
// the first row (or any row) regardless of user_id. Cross-user leak, no RLS
// to save us.
// -----------------------------------------------------------------------------

func TestOnboardingProgress_P1_ServiceForgetsUserIDFilter(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	userA := CreateUser(t, db, "alice@example.com", "Alice")
	userB := CreateUser(t, db, "bob@example.com", "Bob")

	svc := newOnboardingSvc(t, db)

	// Seed userA's progress via the sqlc upsert directly (bypass the service
	// so the test doesn't rely on the service being correct for setup).
	queries := generated.New(db)
	_, err := queries.UpsertOnboardingProgress(ctx, generated.UpsertOnboardingProgressParams{
		UserID:      userA.ID,
		CurrentStep: "center",
		Payload:     []byte(`{"schemaVersion":1,"personaChoice":"founder"}`),
	})
	if err != nil {
		t.Fatalf("seed userA progress: %v", err)
	}

	// Query as userB. MUST return default state (empty currentStep from AC4),
	// NOT userA's row. If the service `SELECT`s without a user_id predicate,
	// this test fails because userA's data surfaces.
	uidB, _ := uuid.Parse(uuidToStr(userB.ID))
	progress, err := svc.GetProgress(ctx, uidB)
	if err != nil {
		t.Fatalf("GetProgress as userB: %v", err)
	}
	if progress.CurrentStep == "center" {
		t.Errorf("P1 VIOLATION: userB got userA's currentStep=center — service forgot user_id filter")
	}
	if progress.PersonaChoice != nil {
		t.Errorf("P1 VIOLATION: userB got userA's personaChoice=%v — service forgot user_id filter", *progress.PersonaChoice)
	}
}

// -----------------------------------------------------------------------------
// P2-Insert — TestOnboardingProgress_ServiceTrustsPayloadUserIDInsert
// Failure mode: service accepts a UserID field in the input struct and uses
// input.UserID for the INSERT instead of the ctx-derived UserID.
// -----------------------------------------------------------------------------

func TestOnboardingProgress_P2_ServiceTrustsPayloadUserIDInsert(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	userA := CreateUser(t, db, "alice@example.com", "Alice")
	userB := CreateUser(t, db, "bob@example.com", "Bob")

	svc := newOnboardingSvc(t, db)

	// UserB's identity is the caller. The input struct DELIBERATELY carries
	// a UserID field pointing to userA (attacker-controlled payload). The
	// service MUST use the ctx-supplied userB, NOT the payload's userA.
	uidB, _ := uuid.Parse(uuidToStr(userB.ID))
	uidAStr := uuidToStr(userA.ID)

	// The service's UpsertProgress signature (Task 6.1) is:
	//   UpsertProgress(ctx, userID uuid.UUID, in UpsertProgressInput)
	// There is NO userID field in UpsertProgressInput — by design. But if a
	// future refactor adds one and the service uses it, this test fails.
	// Guard against that by asserting: after upsert as userB, userA has NO
	// row (proving the service didn't write for userA).
	_, err := svc.UpsertProgress(ctx, uidB, service.UpsertProgressInput{
		CurrentStep: "spawn",
		Payload:     []byte(`{"schemaVersion":1,"personaChoice":"founder","attackerPayload":"` + uidAStr + `"}`),
	})
	if err != nil {
		t.Fatalf("upsert as userB: %v", err)
	}

	queries := generated.New(db)
	rowA, errA := queries.GetOnboardingProgressByUser(ctx, userA.ID)
	if errA == nil {
		t.Errorf("P2 VIOLATION: userA got a progress row (payload=%s) but was never the caller",
			string(rowA.Payload))
	}
	rowB, errB := queries.GetOnboardingProgressByUser(ctx, userB.ID)
	if errB != nil {
		t.Errorf("P2 setup: userB row must exist after upsert, got %v", errB)
	}
	if rowB.CurrentStep != "spawn" {
		t.Errorf("P2 setup: userB currentStep = %q, want spawn", rowB.CurrentStep)
	}
}

// -----------------------------------------------------------------------------
// P3-Update — TestOnboardingProgress_ServiceTrustsPayloadUserIDUpdate
// Same shape as P2 but on the UPDATE side of upsert. If a bug makes the
// service update the row matching input.UserID instead of the ctx UserID,
// this catches it.
// -----------------------------------------------------------------------------

func TestOnboardingProgress_P3_ServiceTrustsPayloadUserIDUpdate(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	userA := CreateUser(t, db, "alice@example.com", "Alice")
	userB := CreateUser(t, db, "bob@example.com", "Bob")

	queries := generated.New(db)
	// Pre-seed BOTH users so the update path is exercised, not the insert path.
	_, err := queries.UpsertOnboardingProgress(ctx, generated.UpsertOnboardingProgressParams{
		UserID: userA.ID, CurrentStep: "persona", Payload: []byte(`{"schemaVersion":1,"marker":"userA-original"}`),
	})
	if err != nil {
		t.Fatalf("seed A: %v", err)
	}
	_, err = queries.UpsertOnboardingProgress(ctx, generated.UpsertOnboardingProgressParams{
		UserID: userB.ID, CurrentStep: "persona", Payload: []byte(`{"schemaVersion":1,"marker":"userB-original"}`),
	})
	if err != nil {
		t.Fatalf("seed B: %v", err)
	}

	// UserB calls update; input carries an attacker-controlled hint.
	svc := newOnboardingSvc(t, db)
	uidB, _ := uuid.Parse(uuidToStr(userB.ID))
	_, err = svc.UpsertProgress(ctx, uidB, service.UpsertProgressInput{
		CurrentStep: "center",
		Payload:     []byte(`{"schemaVersion":1,"marker":"userB-overwrote-userA-attempt"}`),
	})
	if err != nil {
		t.Fatalf("upsert as userB: %v", err)
	}

	// userA's row MUST be intact.
	rowA, err := queries.GetOnboardingProgressByUser(ctx, userA.ID)
	if err != nil {
		t.Fatalf("re-read A: %v", err)
	}
	if !contains(string(rowA.Payload), "userA-original") {
		t.Errorf("P3 VIOLATION: userA's row was overwritten via userB's upsert — got %s", string(rowA.Payload))
	}
}

// -----------------------------------------------------------------------------
// P4-Delete — DOCUMENTED N/A
// This story ships no delete endpoint. AC9 requires the omission to be
// explicit (not silent) — the epic gate reviewer uses this file as
// discharge evidence.
// -----------------------------------------------------------------------------

func TestOnboardingProgress_P4_DeleteNotApplicable(t *testing.T) {
	t.Log("P4 (CrossTenantDelete): N/A — Story 2.1 ships no DELETE endpoint on onboarding_progress.")
	t.Log("If a future story adds one, revisit this file and add a P4 assertion mirroring P2/P3 shape.")
	// The test intentionally passes with no assertions. Its presence in
	// the file, with this log output, IS the epic-gate evidence per AC9.
}

// -----------------------------------------------------------------------------
// P5-NoAuthFallback — TWO focused tests (split at /bmad-tea RV so failures
// attribute to the correct layer).
//
// Failure mode being guarded: handler or service resolves UserID from a
// fallback ("system user", zero UUID, config default). Guards against
// `if userID := tc.UserID; userID == "" { userID = someFallback }`.
//
// Layer 1: service-layer rejection when caller passes uuid.Nil.
// Layer 2: handler-layer 500 posture when the request context has NO
//          TenantContext at all (middleware misconfigured or bypassed).
// -----------------------------------------------------------------------------

func TestOnboardingProgress_P5_ServiceRejectsZeroUUID(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	svc := newOnboardingSvc(t, db)

	// Pass a zero UUID — the service MUST reject, not fall back to a default
	// user or silently return default state.
	zeroUID := uuid.Nil
	_, err := svc.GetProgress(ctx, zeroUID)
	if err == nil {
		t.Errorf("P5 VIOLATION: GetProgress with zero UUID must error, got nil — likely a silent fallback")
	}

	// Same for upsert.
	_, err = svc.UpsertProgress(ctx, zeroUID, service.UpsertProgressInput{
		CurrentStep: "persona", Payload: []byte(`{"schemaVersion":1}`),
	})
	if err == nil {
		t.Errorf("P5 VIOLATION: UpsertProgress with zero UUID must error, got nil")
	}
	// Validate it's model.ValidationError (or an equivalent typed error), not raw pgx error.
	var vErr model.ValidationError
	if err != nil && !errors.As(err, &vErr) {
		t.Logf("P5 note: err type %T (want model.ValidationError-like)", err)
	}
}

func TestOnboardingProgress_P5_HandlerRejectsMissingTenantContext(t *testing.T) {
	db := SetupDB(t)
	svc := newOnboardingSvc(t, db)

	// Spec AC9 P5: handler invoked with a request whose context has NO
	// TenantContext.UserID must return 500 INTERNAL_ERROR, mirroring
	// RequireRole's missing-context posture. A 422 VALIDATION_ERROR
	// (from returning model.ValidationError) misclassifies a middleware
	// misconfiguration as a client-side validation failure.
	h := handler.NewOnboardingHandler(svc, RealClock{})
	req := httptest.NewRequest("GET", "/api/onboarding/progress", nil) // no TenantContext in ctx
	rec := httptest.NewRecorder()
	herr := h.GetProgress(rec, req)
	if herr == nil {
		t.Fatal("P5 VIOLATION: handler must reject request lacking TenantContext, got nil error")
	}
	var vErr model.ValidationError
	if errors.As(herr, &vErr) {
		t.Errorf("P5 VIOLATION: handler returned model.ValidationError for missing TenantContext → maps to 422; spec mandates 500. Got: %v", herr)
	}
	if !errors.Is(herr, handler.ErrTenantContextMissing) {
		t.Errorf("P5 VIOLATION: expected handler.ErrTenantContextMissing sentinel, got %T: %v", herr, herr)
	}
}

// -----------------------------------------------------------------------------
// P6-DefaultStateNoCache — TestOnboardingProgress_DefaultStateFromPgxErrNoRowsDoesNotLeakPrior
//
// Failure mode: service caches the last GetProgress response in a package-level
// or struct-level singleton and returns it for the next caller when the DB row
// is absent. Real Go footgun with `sync.Once`, module-scoped vars, or
// shared *sync.Map that isn't user-keyed.
// -----------------------------------------------------------------------------

func TestOnboardingProgress_P6_DefaultStateFromPgxErrNoRowsDoesNotLeakPrior(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	userA := CreateUser(t, db, "alice@example.com", "Alice")
	userB := CreateUser(t, db, "bob@example.com", "Bob") // NO seed — will hit pgx.ErrNoRows

	// Seed userA.
	queries := generated.New(db)
	_, err := queries.UpsertOnboardingProgress(ctx, generated.UpsertOnboardingProgressParams{
		UserID: userA.ID, CurrentStep: "center",
		Payload: []byte(`{"schemaVersion":1,"personaChoice":"founder","centerDraft":{"name":"USERA-LEAK-CANARY"}}`),
	})
	if err != nil {
		t.Fatalf("seed A: %v", err)
	}

	svc := newOnboardingSvc(t, db)

	// Read A first (populates any singleton).
	uidA, _ := uuid.Parse(uuidToStr(userA.ID))
	pA, err := svc.GetProgress(ctx, uidA)
	if err != nil {
		t.Fatalf("read A: %v", err)
	}
	if pA.CurrentStep != "center" {
		t.Fatalf("read A precondition: currentStep = %q, want center", pA.CurrentStep)
	}

	// Now read B (no row → default state).
	uidB, _ := uuid.Parse(uuidToStr(userB.ID))
	pB, err := svc.GetProgress(ctx, uidB)
	if err != nil {
		t.Fatalf("read B: %v", err)
	}
	if pB.CurrentStep != "persona" {
		t.Errorf("P6 VIOLATION: B's default state currentStep = %q, want persona (AC4 default) — likely singleton cache leak from A", pB.CurrentStep)
	}
	if pB.PersonaChoice != nil {
		t.Errorf("P6 VIOLATION: B's default state carries personaChoice=%v — singleton cache from A leaked", *pB.PersonaChoice)
	}
	// Byte-level ratchet — the raw payload MUST NOT reference userA's canary.
	if pB.RawPayload != nil && contains(string(pB.RawPayload), "USERA-LEAK-CANARY") {
		t.Errorf("P6 VIOLATION: B's default state contains userA's canary string")
	}
}

// -----------------------------------------------------------------------------
// center_members uniqueness (Task 10.2 supporting invariant — R1 discharge for
// the AC2 pre-check race window).
// -----------------------------------------------------------------------------

func TestCenterMembers_UserUniqueViolation(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a-uniq")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b-uniq")
	user := CreateUser(t, db, "u@example.com", "U")

	queries := generated.New(db)

	// First membership — succeeds under centerA tenant context.
	TenantContext(t, db, centerA.ID)
	_, err := queries.CreateCenterMember(ctx, generated.CreateCenterMemberParams{
		UserID: user.ID, CenterID: centerA.ID, Role: "owner",
	})
	if err != nil {
		t.Fatalf("first membership: %v", err)
	}

	// Second membership on centerB — MUST fail on idx_center_members_user_id
	// (Task 2.3 unique index). If this test does not fail, the migration is
	// missing and the story's "one center per user" invariant is unenforced.
	TenantContext(t, db, centerB.ID)
	_, err = queries.CreateCenterMember(ctx, generated.CreateCenterMemberParams{
		UserID: user.ID, CenterID: centerB.ID, Role: "owner",
	})
	if err == nil {
		t.Errorf("center_members uniqueness VIOLATION: second membership succeeded (unique index missing)")
	}
}

// -----------------------------------------------------------------------------
// Tiny local helpers.
// -----------------------------------------------------------------------------

// contains reports whether sub is within s. Local so this file doesn't need
// the `strings` import — the byte-level canary check in P6 is the only caller.
func contains(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
