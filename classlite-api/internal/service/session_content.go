// Package service — Story 3.5 SessionContentService.
//
// Session content is three sibling tables — notes, materials, exercises —
// hanging off a session. This service owns their CRUD. It deliberately does
// NOT reuse the 3.4 scheduling now-floor: content is teacher documentation and
// is addable on PAST and CANCELLED sessions alike (neither time nor status
// gates a content write).
//
// Authz (SEC-1, service-layer — never RLS):
//   - assertClassRole gates owner/admin/teacher on every operation (a student
//     is 403 INSUFFICIENT_ROLE — defense-in-depth behind the route gate).
//   - The parent session is loaded under the tenant tx: RLS scopes it to the
//     caller's center, so a sessionID belonging to another tenant reads as
//     ErrNoRows → 404 (this closes the cross-tenant FK case; the FK alone does
//     not). assertSessionTeacherScope then enforces cross-teacher isolation
//     (a teacher may only touch sessions of a class assigned to them → 404).
//   - Mutations on a specific content row are scoped by (id, session_id) so a
//     row cannot be edited through a sibling session the caller lacks scope on.
package service

import (
	"context"
	"errors"
	"fmt"

	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/store"
	"github.com/ducdo/classlite-api/internal/store/generated"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

const (
	sessionNoteCreatedAction     = "session_note.created"
	sessionNoteUpdatedAction     = "session_note.updated"
	sessionNoteDeletedAction     = "session_note.deleted"
	sessionMaterialCreatedAction = "session_material.created"
	sessionMaterialUpdatedAction = "session_material.updated"
	sessionMaterialDeletedAction = "session_material.deleted"
	sessionExerciseCreatedAction = "session_exercise.created"
	sessionExerciseUpdatedAction = "session_exercise.updated"
	sessionExerciseDeletedAction = "session_exercise.deleted"

	sessionNoteAuditEntity     = "session_note"
	sessionMaterialAuditEntity = "session_material"
	sessionExerciseAuditEntity = "session_exercise"

	sessionNoteNotFoundCode     = "SESSION_NOTE_NOT_FOUND"
	sessionMaterialNotFoundCode = "SESSION_MATERIAL_NOT_FOUND"
	sessionExerciseNotFoundCode = "SESSION_EXERCISE_NOT_FOUND"
)

// SessionContentService owns notes/materials/exercises CRUD for a session.
type SessionContentService struct {
	db    AuthDB
	audit AuditLogger
}

// NewSessionContentService constructs a SessionContentService bound to the DB
// pool and the audit logger. No clock seam — content writes are time-agnostic.
func NewSessionContentService(db AuthDB, audit AuditLogger) *SessionContentService {
	return &SessionContentService{db: db, audit: audit}
}

// --- inputs ---

// NoteInput is the decoded body of a note create/update.
type NoteInput struct {
	Body string
}

// MaterialInput is the decoded body of a material create/update (link-only v1).
type MaterialInput struct {
	Title string
	URL   string
}

// ExerciseInput is the decoded body of an exercise create/update.
type ExerciseInput struct {
	Title        string
	Instructions *string
	Link         *string
}

// --- not-found helpers ---

func sessionNoteNotFound(id uuid.UUID) error {
	return model.NotFoundError{Resource: "session note", ID: id.String(), Code: sessionNoteNotFoundCode}
}

func sessionMaterialNotFound(id uuid.UUID) error {
	return model.NotFoundError{Resource: "session material", ID: id.String(), Code: sessionMaterialNotFoundCode}
}

func sessionExerciseNotFound(id uuid.UUID) error {
	return model.NotFoundError{Resource: "session exercise", ID: id.String(), Code: sessionExerciseNotFoundCode}
}

// pgTextFromPtr renders an optional string as a nullable pgtype.Text.
func pgTextFromPtr(s *string) pgtype.Text {
	if s == nil {
		return pgtype.Text{}
	}
	return pgtype.Text{String: *s, Valid: true}
}

// --- tx ceremony (mirrors SessionService; content has no clock/now-floor) ---

func (s *SessionContentService) readInTenantTx(
	ctx context.Context, tc model.TenantContext, fn func(*generated.Queries) error,
) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("session content read tx: begin: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()

	if err := store.SetTenantContext(ctx, tx, tc); err != nil {
		return fmt.Errorf("session content read tx: %w", err)
	}
	if err := fn(generated.New(tx)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *SessionContentService) mutateInTenantTx(
	ctx context.Context, tc model.TenantContext, fn func(tx pgx.Tx, txQ *generated.Queries) error,
) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("session content mutate tx: begin: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()

	if err := store.SetTenantContext(ctx, tx, tc); err != nil {
		return fmt.Errorf("session content mutate tx: %w", err)
	}
	if err := fn(tx, generated.New(tx)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// authorizeSession runs the role + tenant + teacher-scope gate against the
// parent session inside an open tx. Returns the parent center id (from the
// tenant context) for use as the content row's denormalized center_id.
func (s *SessionContentService) authorizeSession(
	ctx context.Context, txQ *generated.Queries, tc model.TenantContext, sessionID uuid.UUID,
) (uuid.UUID, error) {
	if err := assertClassRole(tc); err != nil {
		return uuid.Nil, err
	}
	centerUUID, err := uuid.Parse(tc.CenterID)
	if err != nil {
		return uuid.Nil, &ForbiddenError{Reason: "invalid tenant context"}
	}
	row, err := txQ.GetSessionByID(ctx, pgUUID(sessionID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return uuid.Nil, sessionNotFound(sessionID)
		}
		return uuid.Nil, fmt.Errorf("authorize session: load: %w", err)
	}
	if err := assertSessionTeacherScope(tc, row.ClassTeacherID, sessionID); err != nil {
		return uuid.Nil, err
	}
	return centerUUID, nil
}

// --- notes ---

// ListSessionNotes returns the notes for a session (chronological).
func (s *SessionContentService) ListSessionNotes(
	ctx context.Context, tc model.TenantContext, sessionID uuid.UUID,
) ([]generated.SessionNote, error) {
	var out []generated.SessionNote
	err := s.readInTenantTx(ctx, tc, func(q *generated.Queries) error {
		if _, err := s.authorizeSession(ctx, q, tc, sessionID); err != nil {
			return err
		}
		rows, err := q.ListSessionNotesBySession(ctx, pgUUID(sessionID))
		if err != nil {
			return fmt.Errorf("list session notes: %w", err)
		}
		out = rows
		return nil
	})
	return out, err
}

// CreateSessionNote adds a note to a session. author_id is the acting user.
func (s *SessionContentService) CreateSessionNote(
	ctx context.Context, tc model.TenantContext, sessionID uuid.UUID, in NoteInput,
) (generated.SessionNote, error) {
	var out generated.SessionNote
	err := s.mutateInTenantTx(ctx, tc, func(tx pgx.Tx, txQ *generated.Queries) error {
		centerUUID, err := s.authorizeSession(ctx, txQ, tc, sessionID)
		if err != nil {
			return err
		}
		author := pgtype.UUID{}
		if userUUID, parseErr := uuid.Parse(tc.UserID); parseErr == nil {
			author = pgUUID(userUUID)
		}
		noteID := uuid.New()
		note, err := txQ.CreateSessionNote(ctx, generated.CreateSessionNoteParams{
			ID:        pgUUID(noteID),
			CenterID:  pgUUID(centerUUID),
			SessionID: pgUUID(sessionID),
			Body:      in.Body,
			AuthorID:  author,
		})
		if err != nil {
			return fmt.Errorf("create session note: %w", err)
		}
		changes := Changes{After: map[string]any{"session_id": sessionID.String(), "body": in.Body}}
		if err := s.audit.LogWithinTx(ctx, tx, tc, sessionNoteCreatedAction, sessionNoteAuditEntity, noteID, changes); err != nil {
			return fmt.Errorf("create session note: audit: %w", err)
		}
		out = note
		return nil
	})
	return out, err
}

// UpdateSessionNote edits a note's body.
func (s *SessionContentService) UpdateSessionNote(
	ctx context.Context, tc model.TenantContext, sessionID, noteID uuid.UUID, in NoteInput,
) (generated.SessionNote, error) {
	var out generated.SessionNote
	err := s.mutateInTenantTx(ctx, tc, func(tx pgx.Tx, txQ *generated.Queries) error {
		if _, err := s.authorizeSession(ctx, txQ, tc, sessionID); err != nil {
			return err
		}
		note, err := txQ.UpdateSessionNote(ctx, generated.UpdateSessionNoteParams{
			Body:      in.Body,
			ID:        pgUUID(noteID),
			SessionID: pgUUID(sessionID),
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return sessionNoteNotFound(noteID)
			}
			return fmt.Errorf("update session note: %w", err)
		}
		changes := Changes{After: map[string]any{"session_id": sessionID.String(), "body": in.Body}}
		if err := s.audit.LogWithinTx(ctx, tx, tc, sessionNoteUpdatedAction, sessionNoteAuditEntity, noteID, changes); err != nil {
			return fmt.Errorf("update session note: audit: %w", err)
		}
		out = note
		return nil
	})
	return out, err
}

// DeleteSessionNote removes a note.
func (s *SessionContentService) DeleteSessionNote(
	ctx context.Context, tc model.TenantContext, sessionID, noteID uuid.UUID,
) error {
	return s.mutateInTenantTx(ctx, tc, func(tx pgx.Tx, txQ *generated.Queries) error {
		if _, err := s.authorizeSession(ctx, txQ, tc, sessionID); err != nil {
			return err
		}
		if _, err := txQ.DeleteSessionNote(ctx, generated.DeleteSessionNoteParams{
			ID:        pgUUID(noteID),
			SessionID: pgUUID(sessionID),
		}); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return sessionNoteNotFound(noteID)
			}
			return fmt.Errorf("delete session note: %w", err)
		}
		changes := Changes{Before: map[string]any{"session_id": sessionID.String(), "note_id": noteID.String()}}
		if err := s.audit.LogWithinTx(ctx, tx, tc, sessionNoteDeletedAction, sessionNoteAuditEntity, noteID, changes); err != nil {
			return fmt.Errorf("delete session note: audit: %w", err)
		}
		return nil
	})
}

// --- materials (link-only v1) ---

// ListSessionMaterials returns the materials for a session.
func (s *SessionContentService) ListSessionMaterials(
	ctx context.Context, tc model.TenantContext, sessionID uuid.UUID,
) ([]generated.SessionMaterial, error) {
	var out []generated.SessionMaterial
	err := s.readInTenantTx(ctx, tc, func(q *generated.Queries) error {
		if _, err := s.authorizeSession(ctx, q, tc, sessionID); err != nil {
			return err
		}
		rows, err := q.ListSessionMaterialsBySession(ctx, pgUUID(sessionID))
		if err != nil {
			return fmt.Errorf("list session materials: %w", err)
		}
		out = rows
		return nil
	})
	return out, err
}

// CreateSessionMaterial adds a link material (title + external URL).
func (s *SessionContentService) CreateSessionMaterial(
	ctx context.Context, tc model.TenantContext, sessionID uuid.UUID, in MaterialInput,
) (generated.SessionMaterial, error) {
	var out generated.SessionMaterial
	err := s.mutateInTenantTx(ctx, tc, func(tx pgx.Tx, txQ *generated.Queries) error {
		centerUUID, err := s.authorizeSession(ctx, txQ, tc, sessionID)
		if err != nil {
			return err
		}
		materialID := uuid.New()
		material, err := txQ.CreateSessionMaterial(ctx, generated.CreateSessionMaterialParams{
			ID:        pgUUID(materialID),
			CenterID:  pgUUID(centerUUID),
			SessionID: pgUUID(sessionID),
			Title:     in.Title,
			Url:       in.URL,
		})
		if err != nil {
			return fmt.Errorf("create session material: %w", err)
		}
		changes := Changes{After: map[string]any{"session_id": sessionID.String(), "title": in.Title, "url": in.URL}}
		if err := s.audit.LogWithinTx(ctx, tx, tc, sessionMaterialCreatedAction, sessionMaterialAuditEntity, materialID, changes); err != nil {
			return fmt.Errorf("create session material: audit: %w", err)
		}
		out = material
		return nil
	})
	return out, err
}

// UpdateSessionMaterial edits a material's title/url.
func (s *SessionContentService) UpdateSessionMaterial(
	ctx context.Context, tc model.TenantContext, sessionID, materialID uuid.UUID, in MaterialInput,
) (generated.SessionMaterial, error) {
	var out generated.SessionMaterial
	err := s.mutateInTenantTx(ctx, tc, func(tx pgx.Tx, txQ *generated.Queries) error {
		if _, err := s.authorizeSession(ctx, txQ, tc, sessionID); err != nil {
			return err
		}
		material, err := txQ.UpdateSessionMaterial(ctx, generated.UpdateSessionMaterialParams{
			Title:     in.Title,
			Url:       in.URL,
			ID:        pgUUID(materialID),
			SessionID: pgUUID(sessionID),
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return sessionMaterialNotFound(materialID)
			}
			return fmt.Errorf("update session material: %w", err)
		}
		changes := Changes{After: map[string]any{"session_id": sessionID.String(), "title": in.Title, "url": in.URL}}
		if err := s.audit.LogWithinTx(ctx, tx, tc, sessionMaterialUpdatedAction, sessionMaterialAuditEntity, materialID, changes); err != nil {
			return fmt.Errorf("update session material: audit: %w", err)
		}
		out = material
		return nil
	})
	return out, err
}

// DeleteSessionMaterial removes a material.
func (s *SessionContentService) DeleteSessionMaterial(
	ctx context.Context, tc model.TenantContext, sessionID, materialID uuid.UUID,
) error {
	return s.mutateInTenantTx(ctx, tc, func(tx pgx.Tx, txQ *generated.Queries) error {
		if _, err := s.authorizeSession(ctx, txQ, tc, sessionID); err != nil {
			return err
		}
		if _, err := txQ.DeleteSessionMaterial(ctx, generated.DeleteSessionMaterialParams{
			ID:        pgUUID(materialID),
			SessionID: pgUUID(sessionID),
		}); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return sessionMaterialNotFound(materialID)
			}
			return fmt.Errorf("delete session material: %w", err)
		}
		changes := Changes{Before: map[string]any{"session_id": sessionID.String(), "material_id": materialID.String()}}
		if err := s.audit.LogWithinTx(ctx, tx, tc, sessionMaterialDeletedAction, sessionMaterialAuditEntity, materialID, changes); err != nil {
			return fmt.Errorf("delete session material: audit: %w", err)
		}
		return nil
	})
}

// --- exercises (session-scoped, ungraded — NOT the Epic 5/6 assignments entity) ---

// ListSessionExercises returns the exercises for a session.
func (s *SessionContentService) ListSessionExercises(
	ctx context.Context, tc model.TenantContext, sessionID uuid.UUID,
) ([]generated.SessionExercise, error) {
	var out []generated.SessionExercise
	err := s.readInTenantTx(ctx, tc, func(q *generated.Queries) error {
		if _, err := s.authorizeSession(ctx, q, tc, sessionID); err != nil {
			return err
		}
		rows, err := q.ListSessionExercisesBySession(ctx, pgUUID(sessionID))
		if err != nil {
			return fmt.Errorf("list session exercises: %w", err)
		}
		out = rows
		return nil
	})
	return out, err
}

// CreateSessionExercise adds an exercise (title + optional instructions/link).
func (s *SessionContentService) CreateSessionExercise(
	ctx context.Context, tc model.TenantContext, sessionID uuid.UUID, in ExerciseInput,
) (generated.SessionExercise, error) {
	var out generated.SessionExercise
	err := s.mutateInTenantTx(ctx, tc, func(tx pgx.Tx, txQ *generated.Queries) error {
		centerUUID, err := s.authorizeSession(ctx, txQ, tc, sessionID)
		if err != nil {
			return err
		}
		exerciseID := uuid.New()
		exercise, err := txQ.CreateSessionExercise(ctx, generated.CreateSessionExerciseParams{
			ID:           pgUUID(exerciseID),
			CenterID:     pgUUID(centerUUID),
			SessionID:    pgUUID(sessionID),
			Title:        in.Title,
			Instructions: pgTextFromPtr(in.Instructions),
			Link:         pgTextFromPtr(in.Link),
		})
		if err != nil {
			return fmt.Errorf("create session exercise: %w", err)
		}
		changes := Changes{After: map[string]any{"session_id": sessionID.String(), "title": in.Title}}
		if err := s.audit.LogWithinTx(ctx, tx, tc, sessionExerciseCreatedAction, sessionExerciseAuditEntity, exerciseID, changes); err != nil {
			return fmt.Errorf("create session exercise: audit: %w", err)
		}
		out = exercise
		return nil
	})
	return out, err
}

// UpdateSessionExercise edits an exercise.
func (s *SessionContentService) UpdateSessionExercise(
	ctx context.Context, tc model.TenantContext, sessionID, exerciseID uuid.UUID, in ExerciseInput,
) (generated.SessionExercise, error) {
	var out generated.SessionExercise
	err := s.mutateInTenantTx(ctx, tc, func(tx pgx.Tx, txQ *generated.Queries) error {
		if _, err := s.authorizeSession(ctx, txQ, tc, sessionID); err != nil {
			return err
		}
		exercise, err := txQ.UpdateSessionExercise(ctx, generated.UpdateSessionExerciseParams{
			Title:        in.Title,
			Instructions: pgTextFromPtr(in.Instructions),
			Link:         pgTextFromPtr(in.Link),
			ID:           pgUUID(exerciseID),
			SessionID:    pgUUID(sessionID),
		})
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return sessionExerciseNotFound(exerciseID)
			}
			return fmt.Errorf("update session exercise: %w", err)
		}
		changes := Changes{After: map[string]any{"session_id": sessionID.String(), "title": in.Title}}
		if err := s.audit.LogWithinTx(ctx, tx, tc, sessionExerciseUpdatedAction, sessionExerciseAuditEntity, exerciseID, changes); err != nil {
			return fmt.Errorf("update session exercise: audit: %w", err)
		}
		out = exercise
		return nil
	})
	return out, err
}

// DeleteSessionExercise removes an exercise.
func (s *SessionContentService) DeleteSessionExercise(
	ctx context.Context, tc model.TenantContext, sessionID, exerciseID uuid.UUID,
) error {
	return s.mutateInTenantTx(ctx, tc, func(tx pgx.Tx, txQ *generated.Queries) error {
		if _, err := s.authorizeSession(ctx, txQ, tc, sessionID); err != nil {
			return err
		}
		if _, err := txQ.DeleteSessionExercise(ctx, generated.DeleteSessionExerciseParams{
			ID:        pgUUID(exerciseID),
			SessionID: pgUUID(sessionID),
		}); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return sessionExerciseNotFound(exerciseID)
			}
			return fmt.Errorf("delete session exercise: %w", err)
		}
		changes := Changes{Before: map[string]any{"session_id": sessionID.String(), "exercise_id": exerciseID.String()}}
		if err := s.audit.LogWithinTx(ctx, tx, tc, sessionExerciseDeletedAction, sessionExerciseAuditEntity, exerciseID, changes); err != nil {
			return fmt.Errorf("delete session exercise: audit: %w", err)
		}
		return nil
	})
}
