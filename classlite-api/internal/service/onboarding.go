// Package service — Story 2.1 OnboardingService.
//
// Persona persistence + wizard progress upsert/read. The
// onboarding_progress table has no RLS (see migration 20260702120100).
// Isolation is enforced HERE: every method takes the userID as an explicit
// argument sourced from TenantContext by the handler, and every SQL touch
// runs with a WHERE user_id = $1 predicate. The J15 grid at
// internal/test/onboarding_progress_rls_test.go pins the six failure modes.
package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/store/generated"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

// Allowed persona values (mirror api.yaml enum + users CHECK constraint).
var validPersonas = map[string]struct{}{
	"operator":     {},
	"founder":      {},
	"solo_teacher": {},
}

// Allowed currentStep values (mirror api.yaml enum + onboarding_progress
// CHECK constraint).
var validCurrentSteps = map[string]struct{}{
	"persona":          {},
	"center":           {},
	"template":         {},
	"spawn":            {},
	"solo_first_class": {},
	"done":             {},
}

// OnboardingService owns the persona + progress writes.
type OnboardingService struct {
	db AuthDB
}

// NewOnboardingService builds an OnboardingService against a pgx pool (or
// TxDB in tests). No hidden state, no package-level caches.
func NewOnboardingService(db AuthDB) *OnboardingService {
	return &OnboardingService{db: db}
}

// OnboardingProgress is the service-layer representation of a stored
// progress row. Handler translates this into the API envelope shape.
//
// Two persona-shaped fields exist, and the distinction is load-bearing:
//   - Persona is the caller's users.persona value — the authoritative source
//     the handler emits as top-level `persona` in the AC4 response. Reflects
//     "the user has completed AC1 with this choice"; the wizard reads it to
//     skip AC1's screen on resume. Sourced from users.persona ONLY.
//   - PersonaChoice is the payload-side draft (payload.personaChoice) that
//     lives inside the JSONB blob. Visible to the client via RawPayload but
//     NEVER promoted to the top-level `persona` field.
type OnboardingProgress struct {
	CurrentStep   string
	Persona       *string
	PersonaChoice *string
	CenterDraft   *model.CenterDraft
	TemplateDraft *json.RawMessage
	UpdatedAt     *time.Time
	// RawPayload is the on-wire JSONB bytes, useful for the J15 P6 test
	// that asserts no cross-user leak by byte-level string search. Nil for
	// default state (no row for this user).
	RawPayload []byte
}

// UpsertProgressInput carries only fields the caller may set. UserID is
// deliberately absent — it must come from the caller's TenantContext, not
// the request body (J15 P2/P3).
type UpsertProgressInput struct {
	CurrentStep string
	Payload     []byte
}

// UpdatePersona validates + writes users.persona. Returns
// model.ValidationError on unknown persona or zero UUID, and
// model.NotFoundError when the JWT-supplied user row no longer exists
// (rowsAffected == 0). Without the affected-rows check, a user deleted
// between JWT issuance and this call would receive 200 for a write that
// never happened.
func (s *OnboardingService) UpdatePersona(ctx context.Context, userID uuid.UUID, persona string) error {
	if userID == uuid.Nil {
		return model.ValidationError{Fields: []model.FieldError{
			{Field: "userId", Message: "authenticated user required"},
		}}
	}
	if _, ok := validPersonas[persona]; !ok {
		return model.ValidationError{Fields: []model.FieldError{
			{Field: "persona", Message: "must be one of operator, founder, solo_teacher"},
		}}
	}

	q := generated.New(s.db)
	affected, err := q.UpdateUserPersona(ctx, generated.UpdateUserPersonaParams{
		ID:      pgUUID(userID),
		Persona: pgtype.Text{String: persona, Valid: true},
	})
	if err != nil {
		return fmt.Errorf("update user persona: %w", err)
	}
	if affected == 0 {
		return model.NotFoundError{Resource: "user", ID: userID.String(), Code: "USER_NOT_FOUND"}
	}
	return nil
}

// GetProgress returns the caller's saved progress row, or the default AC4
// state when no row exists. Persona (from users.persona) is the
// authoritative source for the AC4 top-level `persona` field — the payload's
// personaChoice is treated as a draft that lives inside RawPayload only and
// never leaks to the top-level output. pgx.ErrNoRows is NEVER propagated —
// the wizard treats "no row" as "start at persona pick."
//
// When a progress row exists, users.persona is fetched via a single JOIN
// query so both values are observed at the same MVCC snapshot; a two-query
// pattern let concurrent writes surface an inconsistent (fresh persona +
// stale progress) pair. When no progress row exists, we fetch users.persona
// alone — no cross-consistency to protect.
func (s *OnboardingService) GetProgress(ctx context.Context, userID uuid.UUID) (OnboardingProgress, error) {
	if userID == uuid.Nil {
		return OnboardingProgress{}, model.ValidationError{Fields: []model.FieldError{
			{Field: "userId", Message: "authenticated user required"},
		}}
	}

	q := generated.New(s.db)
	joined, err := q.GetOnboardingProgressWithPersona(ctx, pgUUID(userID))
	switch {
	case err == nil:
		payload, migErr := model.MigrateOnboardingPayload(joined.Payload)
		if migErr != nil {
			return OnboardingProgress{}, fmt.Errorf("decode onboarding payload: %w", migErr)
		}
		out := OnboardingProgress{
			CurrentStep:   joined.CurrentStep,
			PersonaChoice: payload.PersonaChoice,
			CenterDraft:   payload.CenterDraft,
			TemplateDraft: payload.TemplateDraft,
			RawPayload:    joined.Payload,
		}
		if joined.UpdatedAt.Valid {
			ts := joined.UpdatedAt.Time
			out.UpdatedAt = &ts
		}
		if joined.Persona.Valid {
			p := joined.Persona.String
			out.Persona = &p
		}
		return out, nil
	case errors.Is(err, pgx.ErrNoRows):
		// No progress row — fetch users.persona alone for the default-state
		// response. No cross-write to be consistent with; single query is fine.
		persona, personaErr := q.GetUserPersona(ctx, pgUUID(userID))
		out := OnboardingProgress{CurrentStep: "persona"}
		if personaErr != nil && !errors.Is(personaErr, pgx.ErrNoRows) {
			return OnboardingProgress{}, fmt.Errorf("get user persona: %w", personaErr)
		}
		if personaErr == nil && persona.Valid {
			p := persona.String
			out.Persona = &p
		}
		return out, nil
	default:
		return OnboardingProgress{}, fmt.Errorf("get onboarding progress: %w", err)
	}
}

// UpsertProgress writes (or overwrites) the caller's progress row. Payload
// is round-tripped through the typed OnboardingPayload struct so callers
// cannot smuggle unrecognized top-level fields into JSONB.
func (s *OnboardingService) UpsertProgress(ctx context.Context, userID uuid.UUID, in UpsertProgressInput) (OnboardingProgress, error) {
	if userID == uuid.Nil {
		return OnboardingProgress{}, model.ValidationError{Fields: []model.FieldError{
			{Field: "userId", Message: "authenticated user required"},
		}}
	}
	if _, ok := validCurrentSteps[in.CurrentStep]; !ok {
		return OnboardingProgress{}, model.ValidationError{Fields: []model.FieldError{
			{Field: "currentStep", Message: "unknown currentStep value"},
		}}
	}

	// Marshal-through validates the payload shape + drops fields that are
	// not part of OnboardingPayload. Unknown top-level fields silently drop
	// (they'd land in JSONB as-is otherwise — we keep the schema tight).
	payload, err := model.MigrateOnboardingPayload(in.Payload)
	if err != nil {
		return OnboardingProgress{}, model.ValidationError{Fields: []model.FieldError{
			{Field: "payload", Message: "invalid payload shape: " + err.Error()},
		}}
	}
	normalized, err := json.Marshal(payload)
	if err != nil {
		return OnboardingProgress{}, fmt.Errorf("re-marshal onboarding payload: %w", err)
	}

	q := generated.New(s.db)
	row, err := q.UpsertOnboardingProgress(ctx, generated.UpsertOnboardingProgressParams{
		UserID:      pgUUID(userID),
		CurrentStep: in.CurrentStep,
		Payload:     normalized,
	})
	if err != nil {
		return OnboardingProgress{}, fmt.Errorf("upsert onboarding progress: %w", err)
	}

	out := OnboardingProgress{
		CurrentStep:   row.CurrentStep,
		PersonaChoice: payload.PersonaChoice,
		CenterDraft:   payload.CenterDraft,
		TemplateDraft: payload.TemplateDraft,
		RawPayload:    row.Payload,
	}
	if row.UpdatedAt.Valid {
		ts := row.UpdatedAt.Time
		out.UpdatedAt = &ts
	}
	return out, nil
}

// pgUUID converts a google/uuid.UUID to pgtype.UUID for sqlc parameters.
func pgUUID(id uuid.UUID) pgtype.UUID {
	return pgtype.UUID{Bytes: id, Valid: true}
}
