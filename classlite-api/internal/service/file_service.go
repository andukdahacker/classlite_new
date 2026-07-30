// Package service — Story 4.4a FileService.
//
// The Knowledge Hub domain: R2-backed files + nestable folders, the storage
// ceiling, and the hardened confirm path. One service owns files AND folders so
// the confirm→create + storage accounting + folder tree all share the same
// tenant-tx discipline.
//
// Authz (SEC-1, service-layer): every operation runs assertClassRole
// (owner/admin/teacher; student → 403). Knowledge Hub is a center-shared staff
// library — NOT teacher-scoped like exercises, so all staff see all center
// files (no per-author 404).
//
// The party-mode correctness contracts live here:
//   - AC12 storage ceiling: enforced at ConfirmUpload INSIDE a per-center
//     serialized tx (pg_advisory_xact_lock) so N concurrent confirms cannot each
//     read headroom and jointly overflow the cap.
//   - AC4 idempotency: (center_id, object_key) — a retried confirm returns the
//     same row, writes once, counts once.
//   - AC9 delete-on-mismatch: HeadObject re-validation, best-effort delete on a
//     size/type mismatch, fail-closed (no row, no phantom delete) on a HeadObject
//     transport error, and an orphaned_object telemetry counter when the delete
//     itself fails.
//   - AC2 folder cycle/depth guard on move (recursive-CTE ancestor walk).
package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"mime"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/store"
	"github.com/ducdo/classlite-api/internal/store/generated"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

const (
	// maxFolderDepth bounds folder nesting (root = depth 1). The cycle guard
	// alone guarantees the 4.4b tree render terminates; this is the secondary UX
	// ceiling (AC2). NOT pinned by the story ACs — chosen here and surfaced in
	// the completion notes for review.
	maxFolderDepth   = 10
	folderNameMaxLen = 200
	fileNameMaxLen   = 200

	fileCreatedAction   = "file.created"
	fileUpdatedAction   = "file.updated"
	fileDeletedAction   = "file.deleted"
	folderCreatedAction = "folder.created"
	folderUpdatedAction = "folder.updated"
	folderDeletedAction = "folder.deleted"
	fileAuditEntity     = "file"
	folderAuditEntity   = "folder"

	fileNotFoundCode   = "FILE_NOT_FOUND"
	folderNotFoundCode = "FOLDER_NOT_FOUND"
)

// FileService owns Knowledge Hub files + folders and the storage ceiling.
type FileService struct {
	db      AuthDB
	storage StorageService
	audit   AuditLogger
	clk     clock.Clock
}

// NewFileService constructs a FileService bound to the DB pool, the R2 storage
// service (HeadObject re-validation + delete-on-mismatch), the audit logger,
// and a clock.
func NewFileService(db AuthDB, storage StorageService, audit AuditLogger, clk clock.Clock) *FileService {
	return &FileService{db: db, storage: storage, audit: audit, clk: clk}
}

// --- inputs / outputs ---

// TriUUID carries a PATCH field's JSON tri-state for a nullable folder pointer:
// Set=false → key absent (unchanged); Set=true && Value==nil → explicit null
// (move to root); Set=true && Value!=nil → reparent.
type TriUUID struct {
	Set   bool
	Value *uuid.UUID
}

// ConfirmUploadInput is the decoded /uploads/confirm payload for a knowledge
// file. ContentType is the type the client locked at presign; it is NOT trusted
// — confirm re-derives the expected type from the key extension and cross-checks
// HeadObject. FolderID nil = root.
type ConfirmUploadInput struct {
	ObjectKey   string
	Name        string
	ContentType string
	SizeBytes   int64
	FolderID    *uuid.UUID
}

// UpdateFileInput is the decoded rename/move payload. Name nil = unchanged;
// Folder tri-state resolves unchanged/root/reparent.
type UpdateFileInput struct {
	Name   *string
	Folder TriUUID
}

// CreateFolderInput / UpdateFolderInput mirror the file inputs for folders.
type CreateFolderInput struct {
	Name           string
	ParentFolderID *uuid.UUID
}

type UpdateFolderInput struct {
	Name   *string
	Parent TriUUID
}

// LinkedLocation is one host (session/exercise) referencing a file (AC13).
type LinkedLocation struct {
	Type  string
	ID    string
	Label string
}

// FileDetail is the file-detail result: the row + its linked locations. No
// view-rate (deferred).
type FileDetail struct {
	Row             generated.File
	LinkedLocations []LinkedLocation
}

// --- tx helpers (mirror ExerciseService) ---

func (s *FileService) readInTenantTx(ctx context.Context, tc model.TenantContext, fn func(*generated.Queries) error) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("file read tx: begin: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()
	if err := store.SetTenantContext(ctx, tx, tc); err != nil {
		return fmt.Errorf("file read tx: %w", err)
	}
	if err := fn(generated.New(tx)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (s *FileService) mutateInTenantTx(ctx context.Context, tc model.TenantContext, fn func(tx pgx.Tx, q *generated.Queries) error) error {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("file mutate tx: begin: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()
	if err := store.SetTenantContext(ctx, tx, tc); err != nil {
		return fmt.Errorf("file mutate tx: %w", err)
	}
	if err := fn(tx, generated.New(tx)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// auditIfActor writes an audit row only when the TenantContext carries a user
// (the AuditService requires a valid actor). The production knowledge chain
// always supplies one; the direct-service tests exercise the storage/quota
// contracts without a user, so audit is skipped there rather than failing the
// operation.
func (s *FileService) auditIfActor(ctx context.Context, tx pgx.Tx, tc model.TenantContext, action, entity string, id uuid.UUID, changes any) error {
	if tc.UserID == "" {
		return nil
	}
	return s.audit.LogWithinTx(ctx, tx, tc, action, entity, id, changes)
}

// bestEffortDelete removes an object after a failed validation / storage-full
// rejection. A delete FAILURE is not fatal — it emits the orphaned_object
// telemetry counter (AC9) so a later reaper can reclaim the bytes. The R2 host
// is never logged (A10 — key only, no signed URL).
func (s *FileService) bestEffortDelete(ctx context.Context, key string) {
	if err := s.storage.Delete(ctx, key); err != nil {
		slog.WarnContext(ctx, "orphaned_object",
			"reason", "delete_after_rejected_upload_failed",
			"object_key", key,
			"request_id", requestIDFromCtx(ctx),
		)
	}
}

func requestIDFromCtx(ctx context.Context) string {
	id, _ := ctx.Value(model.RequestID).(string)
	return id
}

// --- ConfirmUpload (AC4 / AC9 / AC12) ---

// ConfirmUpload re-validates a completed knowledge upload against R2 and, on
// success, creates the files row inside a per-center serialized transaction that
// enforces the storage ceiling. Idempotent by (center_id, object_key).
func (s *FileService) ConfirmUpload(ctx context.Context, tc model.TenantContext, in ConfirmUploadInput) (*generated.File, error) {
	if err := assertClassRole(tc); err != nil {
		return nil, err
	}
	_, feature, ext, ok := ParseObjectKey(in.ObjectKey)
	if !ok {
		return nil, model.ValidationError{Fields: []model.FieldError{{Field: "key", Message: "malformed object key"}}}
	}

	// Name (review P5): an explicitly-provided name must satisfy the shared
	// 1–200 rule — confirm was the only create path skipping validateName, so a
	// multi-megabyte / control-char name could land in the unbounded text column.
	// An empty name falls back to the (bounded) object-key basename.
	name := strings.TrimSpace(in.Name)
	if name != "" {
		if verr := validateName(name, "name", fileNameMaxLen); verr != nil {
			return nil, verr
		}
	} else {
		name = defaultFileName(in.ObjectKey)
	}

	centerUUID, err := uuid.Parse(tc.CenterID)
	if err != nil {
		return nil, fmt.Errorf("confirm upload: parse center id: %w", err)
	}
	var uploadedBy pgtype.UUID
	if tc.UserID != "" {
		if uid, perr := uuid.Parse(tc.UserID); perr == nil {
			uploadedBy = pgUUID(uid)
		}
	}
	var folderID pgtype.UUID
	if in.FolderID != nil {
		folderID = pgUUID(*in.FolderID)
	}

	var out generated.File
	err = s.mutateInTenantTx(ctx, tc, func(tx pgx.Tx, q *generated.Queries) error {
		// Serialize per center so the read-then-insert quota check is atomic
		// against concurrent confirms (AC12 — the party-mode TOCTOU fix). The
		// lock releases at tx end (commit/rollback).
		if _, lerr := tx.Exec(ctx, "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", tc.CenterID); lerr != nil {
			return fmt.Errorf("confirm upload: advisory lock: %w", lerr)
		}

		// Idempotency: a prior confirm for this key returns the SAME row without
		// re-counting storage (AC4).
		existing, gerr := q.GetFileByObjectKey(ctx, generated.GetFileByObjectKeyParams{
			CenterID: pgUUID(centerUUID), ObjectKey: in.ObjectKey,
		})
		if gerr == nil {
			// AC11 replay counter — confirm ran against an already-confirmed key.
			// Structured Info only (v1 policy; promote to a dedup table if
			// >3/month post-launch). object_key is safe to log (no signature).
			slog.InfoContext(ctx, "upload confirm replay",
				"object_key", in.ObjectKey,
				"file_id", uuidStringFromPg(existing.ID),
				"request_id", requestIDFromCtx(ctx),
			)
			out = existing
			return nil
		}
		if !errors.Is(gerr, pgx.ErrNoRows) {
			return fmt.Errorf("confirm upload: idempotency lookup: %w", gerr)
		}

		// Folder existence (review P4): the move/create paths validate the target
		// folder; confirm must too — a non-existent folderId would hit the FK as a
		// 500, and a cross-tenant folderId (FK checks bypass RLS; files_insert
		// WITH CHECK only validates center_id) would plant a file pointing at
		// another center's folder. RLS-scoped lookup → 404 if absent.
		if in.FolderID != nil {
			if verr := assertFolderExists(ctx, q, *in.FolderID); verr != nil {
				return verr
			}
		}

		// Layer 4 — HeadObject re-validation, run AFTER the idempotency
		// short-circuit above (review P6) so a retried confirm whose object was
		// later reaped/transient-errored still returns the persisted row rather
		// than 502. A transport error OR a nil meta fails CLOSED: no row, no
		// phantom delete (AC9, review P8).
		meta, herr := s.storage.HeadObject(ctx, in.ObjectKey)
		if herr != nil || meta == nil {
			return UploadVerificationFailedError{Key: in.ObjectKey}
		}
		// Defense-in-depth (review P10): reject an extension outside the allowlist
		// (presign already gates it, but confirm claims to be authoritative). Also
		// closes the uncapped-size → int64-overflow path for an unknown ext.
		expectedMIME, mimeKnown := AllowedExtensions[ext]
		if !mimeKnown {
			s.bestEffortDelete(ctx, in.ObjectKey)
			return ContentTypeMismatchError{Expected: "an allowed file type", Got: ext}
		}
		// Stored size over the A9 cap → delete + 413.
		if cap, hasCap := MaxUploadBytes(feature, ext); hasCap && meta.Size > cap {
			s.bestEffortDelete(ctx, in.ObjectKey)
			return FileTooLargeError{Feature: feature, Ext: ext, LimitBytes: cap, GotBytes: meta.Size}
		}
		// Stored Content-Type ≠ the locked type → delete + 422. Compared on the
		// parsed, case-folded media type (review P7) so a valid object carrying
		// parameters ("application/pdf; charset=…") or different casing is not
		// destructively deleted.
		if meta.ContentType != "" && !mediaTypeMatches(meta.ContentType, expectedMIME) {
			s.bestEffortDelete(ctx, in.ObjectKey)
			return ContentTypeMismatchError{Expected: expectedMIME, Got: meta.ContentType}
		}
		storedType := meta.ContentType
		if storedType == "" {
			storedType = expectedMIME
		}

		// Storage ceiling — read live usage under the lock, compare to the
		// per-center ceiling (AC12).
		used, uerr := q.SumFileSizeByCenter(ctx, pgUUID(centerUUID))
		if uerr != nil {
			return fmt.Errorf("confirm upload: sum usage: %w", uerr)
		}
		limit, lerr := q.GetCenterStorageLimit(ctx, pgUUID(centerUUID))
		if lerr != nil {
			return fmt.Errorf("confirm upload: storage limit: %w", lerr)
		}
		if used+meta.Size > limit {
			// Reject + reclaim the just-uploaded object (best-effort + orphan
			// telemetry). The delete is a storage op, safe inside the tx (R2 has
			// no tx); the rollback then discards nothing (no row written).
			s.bestEffortDelete(ctx, in.ObjectKey)
			return StorageFullError{UsedBytes: used, LimitBytes: limit, RequestedBytes: meta.Size}
		}

		row, ierr := q.InsertFileIdempotent(ctx, generated.InsertFileIdempotentParams{
			CenterID:    pgUUID(centerUUID),
			FolderID:    folderID,
			Name:        name,
			Slug:        uniqueSlug(name, ext),
			ObjectKey:   in.ObjectKey,
			ContentType: storedType,
			SizeBytes:   meta.Size,
			UploadedBy:  uploadedBy,
		})
		if errors.Is(ierr, pgx.ErrNoRows) {
			// A concurrent confirm for the same key won the ON CONFLICT race —
			// re-read and return the winner (one row, counted once).
			won, rerr := q.GetFileByObjectKey(ctx, generated.GetFileByObjectKeyParams{
				CenterID: pgUUID(centerUUID), ObjectKey: in.ObjectKey,
			})
			if rerr != nil {
				return fmt.Errorf("confirm upload: re-read after conflict: %w", rerr)
			}
			out = won
			return nil
		}
		if ierr != nil {
			return fmt.Errorf("confirm upload: insert: %w", ierr)
		}
		if aerr := s.auditIfActor(ctx, tx, tc, fileCreatedAction, fileAuditEntity, uuidFromPg(row.ID),
			Changes{After: map[string]any{"name": row.Name, "objectKey": row.ObjectKey, "sizeBytes": row.SizeBytes}}); aerr != nil {
			return fmt.Errorf("confirm upload: audit: %w", aerr)
		}
		out = row
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &out, nil
}

// --- File CRUD ---

// ListFiles returns the (non-deleted) files in a folder (nil folderID = root).
func (s *FileService) ListFiles(ctx context.Context, tc model.TenantContext, folderID *uuid.UUID) ([]generated.File, error) {
	if err := assertClassRole(tc); err != nil {
		return nil, err
	}
	centerUUID, err := uuid.Parse(tc.CenterID)
	if err != nil {
		return nil, fmt.Errorf("list files: parse center id: %w", err)
	}
	var folderParam pgtype.UUID
	if folderID != nil {
		folderParam = pgUUID(*folderID)
	}
	var out []generated.File
	err = s.readInTenantTx(ctx, tc, func(q *generated.Queries) error {
		rows, lerr := q.ListFilesByFolder(ctx, generated.ListFilesByFolderParams{
			CenterID: pgUUID(centerUUID), FolderID: folderParam,
		})
		if lerr != nil {
			return fmt.Errorf("list files: %w", lerr)
		}
		out = rows
		return nil
	})
	return out, err
}

// GetFileDetail resolves a file by slug plus its linked locations (AC13).
func (s *FileService) GetFileDetail(ctx context.Context, tc model.TenantContext, slug string) (*FileDetail, error) {
	if err := assertClassRole(tc); err != nil {
		return nil, err
	}
	centerUUID, err := uuid.Parse(tc.CenterID)
	if err != nil {
		return nil, fmt.Errorf("file detail: parse center id: %w", err)
	}
	var detail FileDetail
	err = s.readInTenantTx(ctx, tc, func(q *generated.Queries) error {
		row, gerr := q.GetFileBySlug(ctx, generated.GetFileBySlugParams{CenterID: pgUUID(centerUUID), Slug: slug})
		if gerr != nil {
			if errors.Is(gerr, pgx.ErrNoRows) {
				return model.NotFoundError{Resource: "file", ID: slug, Code: fileNotFoundCode}
			}
			return fmt.Errorf("file detail: get: %w", gerr)
		}
		detail.Row = row

		sessions, serr := q.ListSessionsLinkingFile(ctx, row.ID)
		if serr != nil {
			return fmt.Errorf("file detail: session links: %w", serr)
		}
		for _, se := range sessions {
			detail.LinkedLocations = append(detail.LinkedLocations, LinkedLocation{
				Type: "session", ID: uuidStringFromPg(se.ID), Label: se.Topic.String,
			})
		}

		filter, merr := json.Marshal(map[string]any{
			"sections": []any{map[string]any{"knowledgeFileId": uuidStringFromPg(row.ID)}},
		})
		if merr != nil {
			return fmt.Errorf("file detail: build link filter: %w", merr)
		}
		exercises, eerr := q.ListExercisesLinkingFile(ctx, filter)
		if eerr != nil {
			return fmt.Errorf("file detail: exercise links: %w", eerr)
		}
		for _, ex := range exercises {
			detail.LinkedLocations = append(detail.LinkedLocations, LinkedLocation{
				Type: "exercise", ID: uuidStringFromPg(ex.ID), Label: ex.Title,
			})
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &detail, nil
}

// RenameMoveFile renames and/or reparents a file. A move to a non-existent /
// cross-tenant folder → 404 FOLDER_NOT_FOUND.
func (s *FileService) RenameMoveFile(ctx context.Context, tc model.TenantContext, id uuid.UUID, in UpdateFileInput) (*generated.File, error) {
	if err := assertClassRole(tc); err != nil {
		return nil, err
	}
	if in.Name != nil {
		if err := validateName(*in.Name, "name", fileNameMaxLen); err != nil {
			return nil, err
		}
	}
	var out generated.File
	err := s.mutateInTenantTx(ctx, tc, func(tx pgx.Tx, q *generated.Queries) error {
		current, gerr := q.GetFileByID(ctx, pgUUID(id))
		if gerr != nil {
			if errors.Is(gerr, pgx.ErrNoRows) {
				return model.NotFoundError{Resource: "file", ID: id.String(), Code: fileNotFoundCode}
			}
			return fmt.Errorf("rename/move file: get: %w", gerr)
		}
		name := current.Name
		if in.Name != nil {
			name = strings.TrimSpace(*in.Name)
		}
		folderID := current.FolderID
		if in.Folder.Set {
			if in.Folder.Value == nil {
				folderID = pgtype.UUID{} // move to root
			} else {
				if verr := assertFolderExists(ctx, q, *in.Folder.Value); verr != nil {
					return verr
				}
				folderID = pgUUID(*in.Folder.Value)
			}
		}
		updated, uerr := q.UpdateFile(ctx, generated.UpdateFileParams{Name: name, FolderID: folderID, ID: pgUUID(id)})
		if uerr != nil {
			if errors.Is(uerr, pgx.ErrNoRows) {
				return model.NotFoundError{Resource: "file", ID: id.String(), Code: fileNotFoundCode}
			}
			return fmt.Errorf("rename/move file: update: %w", uerr)
		}
		if aerr := s.auditIfActor(ctx, tx, tc, fileUpdatedAction, fileAuditEntity, id,
			Changes{Before: map[string]any{"name": current.Name}, After: map[string]any{"name": updated.Name}}); aerr != nil {
			return fmt.Errorf("rename/move file: audit: %w", aerr)
		}
		out = updated
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &out, nil
}

// SoftDeleteFile stamps deleted_at (AC3); frees storage accounting. The R2
// object + row are retained.
func (s *FileService) SoftDeleteFile(ctx context.Context, tc model.TenantContext, id uuid.UUID) error {
	if err := assertClassRole(tc); err != nil {
		return err
	}
	centerUUID, err := uuid.Parse(tc.CenterID)
	if err != nil {
		return fmt.Errorf("soft-delete file: parse center id: %w", err)
	}
	return s.mutateInTenantTx(ctx, tc, func(tx pgx.Tx, q *generated.Queries) error {
		row, derr := q.SoftDeleteFile(ctx, generated.SoftDeleteFileParams{ID: pgUUID(id), CenterID: pgUUID(centerUUID)})
		if derr != nil {
			if errors.Is(derr, pgx.ErrNoRows) {
				return model.NotFoundError{Resource: "file", ID: id.String(), Code: fileNotFoundCode}
			}
			return fmt.Errorf("soft-delete file: %w", derr)
		}
		if aerr := s.auditIfActor(ctx, tx, tc, fileDeletedAction, fileAuditEntity, id,
			Changes{Before: map[string]any{"name": row.Name, "objectKey": row.ObjectKey}}); aerr != nil {
			return fmt.Errorf("soft-delete file: audit: %w", aerr)
		}
		return nil
	})
}

// StorageUsage returns live used bytes + the center ceiling (AC12).
func (s *FileService) StorageUsage(ctx context.Context, tc model.TenantContext) (used, limit int64, err error) {
	if aerr := assertClassRole(tc); aerr != nil {
		return 0, 0, aerr
	}
	centerUUID, perr := uuid.Parse(tc.CenterID)
	if perr != nil {
		return 0, 0, fmt.Errorf("storage usage: parse center id: %w", perr)
	}
	err = s.readInTenantTx(ctx, tc, func(q *generated.Queries) error {
		u, e := q.SumFileSizeByCenter(ctx, pgUUID(centerUUID))
		if e != nil {
			return fmt.Errorf("storage usage: sum: %w", e)
		}
		l, e := q.GetCenterStorageLimit(ctx, pgUUID(centerUUID))
		if e != nil {
			return fmt.Errorf("storage usage: limit: %w", e)
		}
		used, limit = u, l
		return nil
	})
	return used, limit, err
}

// --- Folder CRUD ---

// ListFolders returns the center's (non-deleted) folders — the 4.4b tree source.
func (s *FileService) ListFolders(ctx context.Context, tc model.TenantContext) ([]generated.Folder, error) {
	if err := assertClassRole(tc); err != nil {
		return nil, err
	}
	centerUUID, err := uuid.Parse(tc.CenterID)
	if err != nil {
		return nil, fmt.Errorf("list folders: parse center id: %w", err)
	}
	var out []generated.Folder
	err = s.readInTenantTx(ctx, tc, func(q *generated.Queries) error {
		rows, lerr := q.ListFolders(ctx, pgUUID(centerUUID))
		if lerr != nil {
			return fmt.Errorf("list folders: %w", lerr)
		}
		out = rows
		return nil
	})
	return out, err
}

// CreateFolder inserts a folder, optionally under a parent (depth-guarded).
func (s *FileService) CreateFolder(ctx context.Context, tc model.TenantContext, in CreateFolderInput) (*generated.Folder, error) {
	if err := assertClassRole(tc); err != nil {
		return nil, err
	}
	if err := validateName(in.Name, "name", folderNameMaxLen); err != nil {
		return nil, err
	}
	centerUUID, err := uuid.Parse(tc.CenterID)
	if err != nil {
		return nil, fmt.Errorf("create folder: parse center id: %w", err)
	}
	var parentID pgtype.UUID
	if in.ParentFolderID != nil {
		parentID = pgUUID(*in.ParentFolderID)
	}
	var out generated.Folder
	err = s.mutateInTenantTx(ctx, tc, func(tx pgx.Tx, q *generated.Queries) error {
		if in.ParentFolderID != nil {
			if verr := assertFolderExists(ctx, q, *in.ParentFolderID); verr != nil {
				return verr
			}
			depth, derr := folderDepth(ctx, q, *in.ParentFolderID)
			if derr != nil {
				return derr
			}
			if depth+1 > maxFolderDepth {
				return FolderMaxDepthError{Max: maxFolderDepth}
			}
		}
		row, ierr := q.InsertFolder(ctx, generated.InsertFolderParams{
			CenterID: pgUUID(centerUUID), ParentFolderID: parentID, Name: strings.TrimSpace(in.Name),
		})
		if ierr != nil {
			return fmt.Errorf("create folder: insert: %w", ierr)
		}
		if aerr := s.auditIfActor(ctx, tx, tc, folderCreatedAction, folderAuditEntity, uuidFromPg(row.ID),
			Changes{After: map[string]any{"name": row.Name}}); aerr != nil {
			return fmt.Errorf("create folder: audit: %w", aerr)
		}
		out = row
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &out, nil
}

// RenameMoveFolder renames and/or reparents a folder, guarding against a cycle
// (move into own descendant → FolderCycle) and depth overflow (AC2).
func (s *FileService) RenameMoveFolder(ctx context.Context, tc model.TenantContext, id uuid.UUID, in UpdateFolderInput) (*generated.Folder, error) {
	if err := assertClassRole(tc); err != nil {
		return nil, err
	}
	if in.Name != nil {
		if err := validateName(*in.Name, "name", folderNameMaxLen); err != nil {
			return nil, err
		}
	}
	var out generated.Folder
	err := s.mutateInTenantTx(ctx, tc, func(tx pgx.Tx, q *generated.Queries) error {
		current, gerr := q.GetFolder(ctx, pgUUID(id))
		if gerr != nil {
			if errors.Is(gerr, pgx.ErrNoRows) {
				return model.NotFoundError{Resource: "folder", ID: id.String(), Code: folderNotFoundCode}
			}
			return fmt.Errorf("rename/move folder: get: %w", gerr)
		}
		name := current.Name
		if in.Name != nil {
			name = strings.TrimSpace(*in.Name)
		}
		parentID := current.ParentFolderID
		if in.Parent.Set {
			if in.Parent.Value == nil {
				parentID = pgtype.UUID{} // move to root
			} else {
				target := *in.Parent.Value
				if target == id {
					return FolderCycleError{}
				}
				if verr := assertFolderExists(ctx, q, target); verr != nil {
					return verr
				}
				// Cycle guard (AC2): moving F under target T is a cycle iff F is
				// an ancestor of T. FolderAncestorIDs(T) includes T itself.
				ancestors, aerr := q.FolderAncestorIDs(ctx, pgUUID(target))
				if aerr != nil {
					return fmt.Errorf("rename/move folder: ancestor walk: %w", aerr)
				}
				for _, anc := range ancestors {
					if uuidFromPg(anc) == id {
						return FolderCycleError{}
					}
				}
				if len(ancestors)+1 > maxFolderDepth {
					return FolderMaxDepthError{Max: maxFolderDepth}
				}
				parentID = pgUUID(target)
			}
		}
		updated, uerr := q.UpdateFolder(ctx, generated.UpdateFolderParams{Name: name, ParentFolderID: parentID, ID: pgUUID(id)})
		if uerr != nil {
			if errors.Is(uerr, pgx.ErrNoRows) {
				return model.NotFoundError{Resource: "folder", ID: id.String(), Code: folderNotFoundCode}
			}
			return fmt.Errorf("rename/move folder: update: %w", uerr)
		}
		if aerr := s.auditIfActor(ctx, tx, tc, folderUpdatedAction, folderAuditEntity, id,
			Changes{Before: map[string]any{"name": current.Name}, After: map[string]any{"name": updated.Name}}); aerr != nil {
			return fmt.Errorf("rename/move folder: audit: %w", aerr)
		}
		out = updated
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &out, nil
}

// SoftDeleteFolder stamps deleted_at on the folder AND cascades to its whole
// subtree (review D2). Deleting a folder soft-deletes every descendant folder
// and every file under them in one tenant tx, which (a) frees the subtree's
// storage quota and (b) guarantees no live folder is ever left with a
// soft-deleted ancestor — the state that would truncate the cycle-guard
// ancestor walk and admit a physical parent_folder_id cycle (AC2/AC3).
func (s *FileService) SoftDeleteFolder(ctx context.Context, tc model.TenantContext, id uuid.UUID) error {
	if err := assertClassRole(tc); err != nil {
		return err
	}
	centerUUID, err := uuid.Parse(tc.CenterID)
	if err != nil {
		return fmt.Errorf("soft-delete folder: parse center id: %w", err)
	}
	return s.mutateInTenantTx(ctx, tc, func(tx pgx.Tx, q *generated.Queries) error {
		// Confirm the folder exists (RLS-scoped) — absent/already-deleted/
		// cross-tenant → 404.
		target, gerr := q.GetFolder(ctx, pgUUID(id))
		if gerr != nil {
			if errors.Is(gerr, pgx.ErrNoRows) {
				return model.NotFoundError{Resource: "folder", ID: id.String(), Code: folderNotFoundCode}
			}
			return fmt.Errorf("soft-delete folder: get: %w", gerr)
		}
		// Collect the live subtree (includes the target itself), then cascade:
		// files first (frees quota), then the folders.
		subtree, serr := q.FolderSubtreeIDs(ctx, pgUUID(id))
		if serr != nil {
			return fmt.Errorf("soft-delete folder: subtree: %w", serr)
		}
		if _, ferr := q.SoftDeleteFilesByFolderIDs(ctx, generated.SoftDeleteFilesByFolderIDsParams{
			CenterID: pgUUID(centerUUID), FolderIds: subtree,
		}); ferr != nil {
			return fmt.Errorf("soft-delete folder: cascade files: %w", ferr)
		}
		if _, folerr := q.SoftDeleteFoldersByIDs(ctx, generated.SoftDeleteFoldersByIDsParams{
			CenterID: pgUUID(centerUUID), Ids: subtree,
		}); folerr != nil {
			return fmt.Errorf("soft-delete folder: cascade folders: %w", folerr)
		}
		if aerr := s.auditIfActor(ctx, tx, tc, folderDeletedAction, folderAuditEntity, id,
			Changes{Before: map[string]any{"name": target.Name}}); aerr != nil {
			return fmt.Errorf("soft-delete folder: audit: %w", aerr)
		}
		return nil
	})
}

// --- helpers ---

// assertFolderExists returns 404 FOLDER_NOT_FOUND when a target folder is
// absent/soft-deleted/cross-tenant (RLS-scoped GetFolder).
func assertFolderExists(ctx context.Context, q *generated.Queries, id uuid.UUID) error {
	if _, err := q.GetFolder(ctx, pgUUID(id)); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return model.NotFoundError{Resource: "folder", ID: id.String(), Code: folderNotFoundCode}
		}
		return fmt.Errorf("resolve folder %s: %w", id, err)
	}
	return nil
}

// folderDepth returns the depth of a folder (root = 1) via the recursive
// ancestor walk.
func folderDepth(ctx context.Context, q *generated.Queries, id uuid.UUID) (int, error) {
	ancestors, err := q.FolderAncestorIDs(ctx, pgUUID(id))
	if err != nil {
		return 0, fmt.Errorf("folder depth: %w", err)
	}
	return len(ancestors), nil
}

// mediaTypeMatches reports whether a stored Content-Type is the expected
// canonical MIME, comparing the parsed, case-folded media type so parameters
// ("; charset=…") and casing ("Application/PDF") don't cause a false mismatch
// that would destructively delete a valid upload (review P7).
func mediaTypeMatches(got, expected string) bool {
	mt, _, err := mime.ParseMediaType(got)
	if err != nil {
		mt = strings.TrimSpace(strings.ToLower(got))
	}
	return strings.EqualFold(mt, expected)
}

func validateName(name, field string, maxLen int) error {
	trimmed := strings.TrimSpace(name)
	if rc := utf8.RuneCountInString(trimmed); rc < 1 || rc > maxLen {
		return model.ValidationError{Fields: []model.FieldError{{
			Field: field, Code: "INVALID_NAME", Message: fmt.Sprintf("%s must be 1–%d characters", field, maxLen),
		}}}
	}
	return nil
}

var slugNonAlnum = regexp.MustCompile(`[^a-z0-9]+`)

// uniqueSlug builds a URL-safe, unique-per-center slug from a display name plus
// a short random token (the (center_id, slug) unique index needs uniqueness;
// the random token makes a collision negligible). Falls back to the extension
// stem when the name has no slug-able characters.
func uniqueSlug(name, ext string) string {
	base := slugNonAlnum.ReplaceAllString(strings.ToLower(strings.TrimSpace(name)), "-")
	base = strings.Trim(base, "-")
	if base == "" {
		base = "file"
	}
	if len(base) > 80 {
		base = strings.Trim(base[:80], "-")
	}
	return base + "-" + uuid.NewString()[:8]
}

// defaultFileName derives a display name from the object key's basename when the
// client sends none.
func defaultFileName(key string) string {
	parts := strings.Split(key, "/")
	last := parts[len(parts)-1]
	if last == "" {
		return "file"
	}
	return last
}
