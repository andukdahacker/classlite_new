// Package service — Story 2.7 StudentImportService.
//
// Bulk student import is a DATA-FIRST foundation write path (framed like the
// 3.4.5 enrollment keystone): it parses an owner-uploaded CSV/XLSX off R2,
// classifies each row, and — on confirm — creates users + student memberships +
// active enrollments + best-effort invite emails inside ONE tenant transaction.
//
// Two endpoints, both stateless:
//   - PreviewImport  — advisory. Parse + classify, no writes.
//   - ConfirmImport  — authoritative. Re-parse + re-classify from scratch, then
//     a per-row savepoint fan-out on the import's OWN tx.
//
// Critical invariants:
//   - GetObject bypasses RLS (SEC-8) — the tenant-key prefix guard is enforced
//     FIRST, before any download, on both methods (story Blocker #4).
//   - Enrollments are created via the enrollment sqlc queries on the import tx
//     (generated.New(tx)), NEVER the tx-owning EnrollmentService.CreateEnrollment
//     — nesting db.Begin would grab a separate pooled connection and the
//     just-created student member would be uncommitted + RLS-invisible to it
//     (story Blocker #1).
//   - Confirm re-validates the caller's role from center_members (SEC-1/R15) — a
//     stale/elevated JWT does not decide authorization.
//   - Idempotency: CreateEnrollmentIfNotActive (ON CONFLICT DO NOTHING) makes a
//     sequential re-run a no-op; a losing concurrent row rolls back to its
//     savepoint and is reported skipped (uq_enrollments_active is the belt).
package service

import (
	"bytes"
	"context"
	"encoding/csv"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/mail"
	"path/filepath"
	"strings"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/store"
	"github.com/ducdo/classlite-api/internal/store/generated"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/xuri/excelize/v2"
)

const (
	// maxImportRows caps the per-import fan-out. It is BOTH a UX guard (AC6) and
	// a tx-budget cap — 200 rows × ~4 statements is what importTxDeadline is
	// sized for. Exactly 200 passes, 201 rejects (header excluded).
	maxImportRows = 200

	// importTxDeadline bounds the whole confirm fan-out. Spawn's 30s was sized
	// for ~20 classes; 2.7 fans out up to 200 rows so it gets a larger budget.
	// It also bounds PreviewImport (parse + classify) so a pathological file
	// cannot run unbounded on the advisory path.
	importTxDeadline = 60 * time.Second

	// maxImportFileBytes caps the server-side parse (code review P1). The R2
	// download is bounded by io.LimitReader to this size, so a large or
	// decompression-bomb upload cannot be fully read into memory / OOM the API
	// before the 200-row cap ever applies. 5 MiB comfortably fits 200 rows of
	// CSV/XLSX with headroom.
	maxImportFileBytes = 5 * 1024 * 1024

	studentImportAction = "student.import"
	studentImportEntity = "center"

	// Only enrollable classes participate in class_name resolution (code review
	// D2). Matching an ended/paused class would enroll a student into a dead
	// class, and an ended+active same-name pair would falsely trip ambiguity.
	classStatusUpcoming = "upcoming"
	classStatusActive   = "active"
)

// Per-row classification statuses (AC3). unassigned = importable but classless
// (the preview warns the student is not yet in any class).
const (
	importStatusNewUser         = "new_user"
	importStatusExistingUser    = "existing_user"
	importStatusValidationError = "validation_error"
	importStatusUnassigned      = "unassigned"
)

// Row-level validation error codes surfaced in the preview + error-report CSV.
const (
	importErrInvalidEmail        = "INVALID_EMAIL"
	importErrMissingName         = "MISSING_NAME"
	importErrDuplicateEmail      = "DUPLICATE_EMAIL"
	importErrClassNotFound       = "CLASS_NAME_NOT_FOUND"
	importErrClassAmbiguous      = "CLASS_NAME_AMBIGUOUS"
	importErrUserInAnotherCenter = "USER_IN_ANOTHER_CENTER"
	importErrUserAlreadyStaff    = "USER_ALREADY_STAFF"
	importErrRowPersistFailed    = "ROW_PERSIST_FAILED"
)

// ImportPreviewRow is one classified row in the advisory preview (api.yaml
// ImportPreviewRow). No omitempty (GO-5) — Error is "" when the row is valid.
type ImportPreviewRow struct {
	RowNumber int    `json:"rowNumber"`
	Email     string `json:"email"`
	FullName  string `json:"fullName"`
	ClassName string `json:"className"`
	Status    string `json:"status"`
	Error     string `json:"error"`
}

// ImportSummary is the preview banner tally.
type ImportSummary struct {
	Total      int `json:"total"`
	WillImport int `json:"willImport"`
	WillSkip   int `json:"willSkip"`
	Unassigned int `json:"unassigned"`
}

// ImportPreview is the advisory PreviewImport payload.
type ImportPreview struct {
	Rows    []ImportPreviewRow `json:"rows"`
	Summary ImportSummary      `json:"summary"`
}

// ImportResultRow is one row's committed outcome (api.yaml ImportResultRow).
type ImportResultRow struct {
	RowNumber int    `json:"rowNumber"`
	Email     string `json:"email"`
	Status    string `json:"status"`
	Persisted bool   `json:"persisted"`
	Error     string `json:"error"`
}

// ImportResult is the authoritative ConfirmImport payload. InvitesSent=false is
// a first-class signal (best-effort email is a silent-drop risk) — always
// surfaced + slog.Warn'd.
type ImportResult struct {
	Rows        []ImportResultRow `json:"rows"`
	Created     int               `json:"created"`
	InvitesSent bool              `json:"invitesSent"`
	Failed      int               `json:"failed"`
}

// StudentImportService owns preview + confirm.
type StudentImportService struct {
	db      AuthDB
	storage StorageService
	audit   AuditLogger
	clk     clock.Clock

	// Best-effort invite delivery. Wired in production via SetInviteDelivery;
	// nil in tests (invite ROWS are still created inside the tx — only the email
	// enqueue is skipped, so InvitesSent reports false).
	inviter       EmailRetryQueue
	acceptURLBase string
}

// NewStudentImportService constructs the service bound to the DB, storage,
// audit, and clock seams. Invite email delivery is wired separately via
// SetInviteDelivery so the constructor stays test-friendly (4 args).
func NewStudentImportService(db AuthDB, storage StorageService, audit AuditLogger, clk clock.Clock) *StudentImportService {
	return &StudentImportService{
		db:            db,
		storage:       storage,
		audit:         audit,
		clk:           clk,
		acceptURLBase: "http://localhost:5173/invite",
	}
}

// SetInviteDelivery wires the best-effort invite email queue + accept URL base.
// Production main.go calls this after construction; tests leave it unset.
func (s *StudentImportService) SetInviteDelivery(queue EmailRetryQueue, acceptURLBase string) {
	s.inviter = queue
	if acceptURLBase != "" {
		s.acceptURLBase = strings.TrimRight(acceptURLBase, "/")
	}
}

// importFileNotFound is the 404 raised when GetObject cannot find the key.
func importFileNotFound(key string) error {
	return model.NotFoundError{Resource: "import", ID: key, Code: "IMPORT_FILE_NOT_FOUND"}
}

// guardTenantKey enforces the SEC-8 tenant-key prefix BEFORE any GetObject.
// GetObject bypasses RLS, so this is the sole guard against a caller reading
// another center's uploaded file (story Blocker #4).
func guardTenantKey(tc model.TenantContext, key string) error {
	if !strings.HasPrefix(key, tc.CenterID+"/") {
		return model.ForbiddenError{Reason: "key does not belong to your center"}
	}
	return nil
}

// PreviewImport parses + classifies the uploaded file without writing anything
// (advisory). File-level errors (malformed header, row-limit) short-circuit.
func (s *StudentImportService) PreviewImport(ctx context.Context, tc model.TenantContext, key string) (ImportPreview, error) {
	if err := guardTenantKey(tc, key); err != nil {
		return ImportPreview{}, err
	}

	// Bound the advisory path the same way confirm is bounded (P1) — a
	// pathological parse must not run unbounded.
	ctx, cancel := context.WithTimeout(ctx, importTxDeadline)
	defer cancel()

	callerUUID, err := uuid.Parse(tc.UserID)
	if err != nil {
		return ImportPreview{}, &ForbiddenError{Reason: "invalid tenant context"}
	}
	centerUUID, err := uuid.Parse(tc.CenterID)
	if err != nil {
		return ImportPreview{}, &ForbiddenError{Reason: "invalid tenant context"}
	}

	content, err := s.storage.GetObject(ctx, key)
	if err != nil {
		return ImportPreview{}, importFileNotFound(key)
	}
	if len(content) > maxImportFileBytes {
		return ImportPreview{}, &ImportFileTooLargeError{LimitBytes: maxImportFileBytes, GotBytes: int64(len(content))}
	}
	parsed, err := parseImportFile(content, key)
	if err != nil {
		return ImportPreview{}, err
	}

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return ImportPreview{}, fmt.Errorf("preview import: begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()
	if err := store.SetTenantContext(ctx, tx, tc); err != nil {
		return ImportPreview{}, fmt.Errorf("preview import: %w", err)
	}
	txQ := generated.New(tx)

	// SEC-1 / R15 — re-validate the caller's role from center_members (not the
	// JWT claim) before returning the classified roster, mirroring ConfirmImport
	// (P2). Preview leaks class names + per-email account existence, so a
	// stale/elevated JWT must not reach the classification.
	previewMember, err := txQ.GetCenterMemberByUserAndCenter(ctx, generated.GetCenterMemberByUserAndCenterParams{
		UserID:   pgUUID(callerUUID),
		CenterID: pgUUID(centerUUID),
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ImportPreview{}, &ForbiddenError{Reason: "insufficient role"}
		}
		return ImportPreview{}, fmt.Errorf("preview import: get member: %w", err)
	}
	if previewMember.Role != model.RoleOwner && previewMember.Role != model.RoleAdmin {
		return ImportPreview{}, &ForbiddenError{Reason: "insufficient role"}
	}

	classified, err := classifyImportRows(ctx, txQ, tc, parsed)
	if err != nil {
		return ImportPreview{}, err
	}
	// Read-only path — roll back rather than commit.

	preview := ImportPreview{Rows: make([]ImportPreviewRow, 0, len(classified))}
	for i := range classified {
		row := &classified[i]
		preview.Rows = append(preview.Rows, ImportPreviewRow{
			RowNumber: row.rowNumber,
			Email:     row.rawEmail,
			FullName:  row.fullName,
			ClassName: row.className,
			Status:    row.status,
			Error:     row.errorCode,
		})
		preview.Summary.Total++
		switch row.status {
		case importStatusValidationError:
			preview.Summary.WillSkip++
		case importStatusUnassigned:
			preview.Summary.WillImport++
			preview.Summary.Unassigned++
		default:
			preview.Summary.WillImport++
		}
	}
	return preview, nil
}

// ConfirmImport re-parses + re-classifies from scratch (preview is advisory,
// confirm is authoritative), re-validates the caller role (SEC-1), then commits
// the valid rows via a per-row savepoint fan-out. Partial success is the
// contract: valid rows persist within a COMMITTED tx; a commit/audit failure is
// a full rollback (naturally idempotent on retry).
func (s *StudentImportService) ConfirmImport(ctx context.Context, tc model.TenantContext, key, importID string) (ImportResult, error) {
	if err := guardTenantKey(tc, key); err != nil {
		return ImportResult{}, err
	}
	content, err := s.storage.GetObject(ctx, key)
	if err != nil {
		return ImportResult{}, importFileNotFound(key)
	}
	if len(content) > maxImportFileBytes {
		return ImportResult{}, &ImportFileTooLargeError{LimitBytes: maxImportFileBytes, GotBytes: int64(len(content))}
	}
	parsed, err := parseImportFile(content, key)
	if err != nil {
		return ImportResult{}, err
	}

	centerUUID, err := uuid.Parse(tc.CenterID)
	if err != nil {
		return ImportResult{}, &ForbiddenError{Reason: "invalid tenant context"}
	}
	callerUUID, err := uuid.Parse(tc.UserID)
	if err != nil {
		return ImportResult{}, &ForbiddenError{Reason: "invalid tenant context"}
	}

	ctx, cancel := context.WithTimeout(ctx, importTxDeadline)
	defer cancel()

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return ImportResult{}, fmt.Errorf("confirm import: begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()
	if err := store.SetTenantContext(ctx, tx, tc); err != nil {
		return ImportResult{}, fmt.Errorf("confirm import: %w", err)
	}
	txQ := generated.New(tx)

	// SEC-1 / R15 — re-validate role from center_members, not the JWT claim.
	member, err := txQ.GetCenterMemberByUserAndCenter(ctx, generated.GetCenterMemberByUserAndCenterParams{
		UserID:   pgUUID(callerUUID),
		CenterID: pgUUID(centerUUID),
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ImportResult{}, &ForbiddenError{Reason: "insufficient role"}
		}
		return ImportResult{}, fmt.Errorf("confirm import: get member: %w", err)
	}
	if member.Role != model.RoleOwner && member.Role != model.RoleAdmin {
		return ImportResult{}, &ForbiddenError{Reason: "insufficient role"}
	}

	classified, err := classifyImportRows(ctx, txQ, tc, parsed)
	if err != nil {
		return ImportResult{}, err
	}

	// centerName + inviterName captured pre-commit (RLS scoped) for post-commit
	// invite email rendering.
	centerName, inviterName := s.readInviteIdentity(ctx, txQ, centerUUID, callerUUID)

	result := ImportResult{Rows: make([]ImportResultRow, 0, len(classified))}
	var pending []pendingInvite
	for i := range classified {
		row := &classified[i]
		rr := ImportResultRow{RowNumber: row.rowNumber, Email: row.rawEmail, Status: row.status, Persisted: false, Error: row.errorCode}
		if row.status == importStatusValidationError {
			result.Failed++
			result.Rows = append(result.Rows, rr)
			continue
		}
		invite, err := s.persistImportRow(ctx, tx, txQ, centerUUID, callerUUID, row)
		if err != nil {
			// A savepoint-management failure means the tx is unusable — bail the
			// whole import (full rollback → naturally idempotent retry).
			return ImportResult{}, err
		}
		if row.persisted {
			rr.Persisted = true
			result.Created++
			if invite != nil {
				pending = append(pending, *invite)
			}
		} else {
			// The row failed inside its savepoint (e.g. a losing concurrent
			// insert). Report it skipped; the DB stays correct.
			rr.Status = importStatusValidationError
			rr.Error = importErrRowPersistFailed
			result.Failed++
		}
		result.Rows = append(result.Rows, rr)
	}

	changes := Changes{After: map[string]any{
		"importId": importID,
		"created":  result.Created,
		"failed":   result.Failed,
	}}
	if err := s.audit.LogWithinTx(ctx, tx, tc, studentImportAction, studentImportEntity, centerUUID, changes); err != nil {
		return ImportResult{}, fmt.Errorf("confirm import: audit: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return ImportResult{}, fmt.Errorf("confirm import: commit: %w", err)
	}
	cancel() // release the tx deadline before the post-commit best-effort loop.

	// Detach cancellation for the post-commit invite loop (P5): the cancel()
	// above (and the elapsed tx deadline) must not abort email enqueue — a
	// COMMITTED import's invites should still be attempted. WithoutCancel keeps
	// the request_id value for log correlation while dropping the deadline.
	result.InvitesSent = s.deliverInvites(context.WithoutCancel(ctx), tc, centerName, inviterName, pending)
	return result, nil
}

// pendingInvite carries the raw token for a post-commit invite email.
type pendingInvite struct {
	email    string
	rawToken string
}

// deliverInvites enqueues the best-effort invite emails after commit. Returns
// true only if there were invites AND all enqueued successfully (a dropped
// enqueue is surfaced as InvitesSent=false + slog.Warn — never blocks).
func (s *StudentImportService) deliverInvites(ctx context.Context, tc model.TenantContext, centerName, inviterName string, pending []pendingInvite) bool {
	if len(pending) == 0 {
		// Nothing to send is vacuously "all sent" (P7). An all-existing or
		// all-unassigned import must not report invitesSent=false, which the FE
		// result screen reads as "some invites failed."
		return true
	}
	if s.inviter == nil {
		slog.Warn("student_import_invites_no_queue", "center_id", tc.CenterID, "pending", len(pending))
		return false
	}
	requestID, _ := ctx.Value(model.RequestID).(string)
	allSent := true
	for _, inv := range pending {
		acceptURL := fmt.Sprintf("%s/%s", s.acceptURLBase, inv.rawToken)
		subject, body := RenderInviteEmail(stripCRLFAndControls(centerName), stripCRLFAndControls(inviterName), model.RoleStudent, acceptURL)
		if !s.inviter.Enqueue(EmailJob{To: inv.email, Subject: subject, HTML: body}) {
			allSent = false
			slog.Warn("student_import_invite_enqueue_rejected",
				"request_id", requestID,
				"center_id", tc.CenterID,
				"to_hash", hashEmailForLog(inv.email),
			)
		}
	}
	if !allSent {
		slog.Warn("student_import_invites_not_all_sent", "center_id", tc.CenterID, "attempted", len(pending))
	}
	return allSent
}

// readInviteIdentity reads the center name + caller display name inside the tx
// for the post-commit invite email copy. Best-effort — a read miss degrades to
// empty strings (the invite ROW is the durable contract; email is best-effort).
func (s *StudentImportService) readInviteIdentity(ctx context.Context, txQ *generated.Queries, centerUUID, callerUUID uuid.UUID) (centerName, inviterName string) {
	if center, err := txQ.GetCenterByID(ctx, pgUUID(centerUUID)); err == nil {
		centerName = center.Name
	}
	if caller, err := txQ.GetUserByID(ctx, pgUUID(callerUUID)); err == nil {
		inviterName = strings.TrimSpace(caller.FullName)
		if inviterName == "" {
			inviterName = strings.TrimSpace(strings.Split(caller.Email, "@")[0])
		}
	}
	return centerName, inviterName
}

// persistImportRow runs the per-row savepoint fan-out on the import's OWN tx.
// A row-level failure rolls back to the savepoint (row.persisted stays false)
// and returns nil error so the loop continues; a savepoint-management failure
// returns a non-nil error to abort the whole import.
func (s *StudentImportService) persistImportRow(
	ctx context.Context, tx pgx.Tx, txQ *generated.Queries,
	centerUUID, callerUUID uuid.UUID, row *classifiedImportRow,
) (*pendingInvite, error) {
	savepoint := fmt.Sprintf("import_row_%d", row.rowNumber)
	if _, err := tx.Exec(ctx, "SAVEPOINT "+savepoint); err != nil {
		return nil, fmt.Errorf("confirm import: savepoint: %w", err)
	}
	rollback := func() (*pendingInvite, error) {
		if _, err := tx.Exec(ctx, "ROLLBACK TO SAVEPOINT "+savepoint); err != nil {
			return nil, fmt.Errorf("confirm import: rollback to savepoint: %w", err)
		}
		return nil, nil
	}

	// Resolve the student user id — reuse the existing account or mint a new one
	// (NULL password_hash + NULL google_id = the invite-claim signal, Task 6a).
	var studentPg pgtype.UUID
	if row.userIDValid {
		studentPg = row.userID
	} else {
		created, err := txQ.CreateUser(ctx, generated.CreateUserParams{
			Email:        row.normEmail,
			PasswordHash: pgtype.Text{},
			FullName:     row.fullName,
			GoogleID:     pgtype.Text{},
		})
		if err != nil {
			// A concurrent import of the same email loses the users.email unique
			// race — skip this row (DB stays correct).
			return rollback()
		}
		studentPg = created.ID
	}

	if _, err := txQ.UpsertCenterMemberWithRole(ctx, generated.UpsertCenterMemberWithRoleParams{
		UserID:   studentPg,
		CenterID: pgUUID(centerUUID),
		Role:     model.RoleStudent,
	}); err != nil {
		return rollback()
	}

	// TODO(2-7): Epic 9 — enforce plan student-cap here (R22). No plan/seat infra
	// exists yet; the 200-row-per-import cap (maxImportRows) is 2.7's only
	// write-time limit. See deferred-work.md → R22.
	if row.classIDValid {
		if _, err := txQ.CreateEnrollmentIfNotActive(ctx, generated.CreateEnrollmentIfNotActiveParams{
			ID:        pgUUID(uuid.New()),
			CenterID:  pgUUID(centerUUID),
			StudentID: studentPg,
			ClassID:   row.classID,
		}); err != nil && !errors.Is(err, pgx.ErrNoRows) {
			// ErrNoRows = ON CONFLICT DO NOTHING matched an already-active
			// enrollment → counted done, savepoint intact. Any OTHER error rolls
			// the row back.
			return rollback()
		}
	}

	// Enqueue an invite for a brand-new account OR for an existing account that
	// has never accepted its invite (D4) — the latter lets a re-import recover a
	// dropped first invite email. createImportInvite's nested savepoint absorbs a
	// pre-existing active invite (idx_invites_center_email_active), so a
	// re-invite is a no-op when a live invite already exists.
	var invite *pendingInvite
	if !row.userIDValid || row.userNeverAccepted {
		inv, err := s.createImportInvite(ctx, tx, txQ, savepoint, centerUUID, callerUUID, row.normEmail)
		if err != nil {
			return nil, err
		}
		invite = inv
	}

	if _, err := tx.Exec(ctx, "RELEASE SAVEPOINT "+savepoint); err != nil {
		return nil, fmt.Errorf("confirm import: release savepoint: %w", err)
	}
	row.persisted = true
	return invite, nil
}

// createImportInvite inserts the student invite row inside a NESTED savepoint so
// a pre-existing active invite (idx_invites_center_email_active) does not abort
// the row — the user/member/enrollment still persist; the email is just skipped.
func (s *StudentImportService) createImportInvite(
	ctx context.Context, tx pgx.Tx, txQ *generated.Queries, rowSavepoint string,
	centerUUID, callerUUID uuid.UUID, normEmail string,
) (*pendingInvite, error) {
	raw, err := newPasswordResetToken()
	if err != nil {
		return nil, fmt.Errorf("confirm import: generate invite token: %w", err)
	}
	inviteSavepoint := rowSavepoint + "_invite"
	if _, err := tx.Exec(ctx, "SAVEPOINT "+inviteSavepoint); err != nil {
		return nil, fmt.Errorf("confirm import: invite savepoint: %w", err)
	}
	_, err = txQ.CreateInviteFull(ctx, generated.CreateInviteFullParams{
		ID:        pgUUID(model.NewID()),
		CenterID:  pgUUID(centerUUID),
		InviterID: pgUUID(callerUUID),
		Email:     normEmail,
		Name:      pgtype.Text{},
		Role:      model.RoleStudent,
		TokenHash: hashInviteTokenHex(raw),
		ExpiresAt: pgtype.Timestamptz{Time: s.clk.Now().Add(inviteTTL), Valid: true},
	})
	if err != nil {
		// Active invite already exists (or any insert error): roll back only the
		// invite savepoint, skip the email, keep the row.
		if _, rbErr := tx.Exec(ctx, "ROLLBACK TO SAVEPOINT "+inviteSavepoint); rbErr != nil {
			return nil, fmt.Errorf("confirm import: rollback invite savepoint: %w", rbErr)
		}
		return nil, nil
	}
	if _, err := tx.Exec(ctx, "RELEASE SAVEPOINT "+inviteSavepoint); err != nil {
		return nil, fmt.Errorf("confirm import: release invite savepoint: %w", err)
	}
	return &pendingInvite{email: normEmail, rawToken: raw}, nil
}

// -----------------------------------------------------------------------------
// Parsing
// -----------------------------------------------------------------------------

// parsedImportRow is a raw file row before classification.
type parsedImportRow struct {
	rowNumber int // 1-based data-row index (header excluded)
	email     string
	fullName  string
	className string
}

// parseImportFile sniffs the format from the key extension and dispatches. The
// header must carry `email` + `full_name` (`class_name` optional). > 200 data
// rows rejects (AC6). Deterministic row order (both csv + excelize preserve it)
// so error-report row numbers match what the user saw.
func parseImportFile(content []byte, key string) ([]parsedImportRow, error) {
	switch strings.ToLower(filepath.Ext(key)) {
	case ".csv":
		records, err := readCSVRecords(content)
		if err != nil {
			return nil, err
		}
		return parseImportRecords(records)
	case ".xlsx":
		records, err := readXLSXRecords(content)
		if err != nil {
			return nil, err
		}
		return parseImportRecords(records)
	default:
		return nil, model.ValidationError{Fields: []model.FieldError{
			{Field: "file", Message: "unsupported file type (expected .csv or .xlsx)"},
		}}
	}
}

// readCSVRecords parses CSV bytes into records, stripping a UTF-8 BOM from the
// header first (else the BOM binds to the first column name and "email" no
// longer matches). Ragged rows are tolerated (FieldsPerRecord = -1).
func readCSVRecords(content []byte) ([][]string, error) {
	content = bytes.TrimPrefix(content, []byte{0xEF, 0xBB, 0xBF})
	reader := csv.NewReader(bytes.NewReader(content))
	reader.FieldsPerRecord = -1
	reader.TrimLeadingSpace = false
	var records [][]string
	for {
		record, err := reader.Read()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return nil, model.ValidationError{Fields: []model.FieldError{
				{Field: "file", Message: "the file is not valid CSV"},
			}}
		}
		records = append(records, record)
	}
	return records, nil
}

// readXLSXRecords reads the FIRST sheet of an XLSX into records. excelize's
// GetRows returns formatted cell strings, so a numeric/date-typed email cell is
// coerced to text (story parse-edge matrix).
func readXLSXRecords(content []byte) ([][]string, error) {
	malformed := model.ValidationError{Fields: []model.FieldError{
		{Field: "file", Message: "the file is not a valid Excel workbook"},
	}}
	f, err := excelize.OpenReader(bytes.NewReader(content))
	if err != nil {
		return nil, malformed
	}
	defer func() { _ = f.Close() }()

	sheets := f.GetSheetList()
	if len(sheets) == 0 {
		return nil, malformed
	}
	rows, err := f.GetRows(sheets[0])
	if err != nil {
		return nil, malformed
	}
	return rows, nil
}

// parseImportRecords resolves the header columns and projects each data row into
// a parsedImportRow. Malformed/missing header → file-level ValidationError
// (0-persist contract). > maxImportRows data rows → ImportRowLimitError.
func parseImportRecords(records [][]string) ([]parsedImportRow, error) {
	if len(records) == 0 {
		return nil, model.ValidationError{Fields: []model.FieldError{
			{Field: "file", Message: "the file is empty"},
		}}
	}

	header := records[0]
	col := map[string]int{}
	for i, name := range header {
		clean := strings.ToLower(strings.TrimSpace(strings.TrimPrefix(name, "\ufeff")))
		if _, dup := col[clean]; !dup && clean != "" {
			col[clean] = i
		}
	}
	emailIdx, hasEmail := col["email"]
	nameIdx, hasName := col["full_name"]
	if !hasEmail || !hasName {
		return nil, model.ValidationError{Fields: []model.FieldError{
			{Field: "file", Message: "the header row must include the columns 'email' and 'full_name'"},
		}}
	}
	classIdx, hasClass := col["class_name"]

	at := func(record []string, idx int, present bool) string {
		if !present || idx >= len(record) {
			return ""
		}
		return strings.TrimSpace(record[idx])
	}

	// Skip fully-blank data rows before counting (P4/P3). Excel and CSV exports
	// commonly carry trailing or interspersed empty records (`,,`); those must
	// not consume the maxImportRows budget or surface as spurious INVALID_EMAIL
	// skips. rowNumber keeps the ORIGINAL 1-based data-row position so the
	// error-report maps back to what the user saw in the file.
	out := make([]parsedImportRow, 0, len(records)-1)
	for i, record := range records[1:] {
		email := at(record, emailIdx, true)
		fullName := at(record, nameIdx, true)
		className := at(record, classIdx, hasClass)
		if email == "" && fullName == "" && className == "" {
			continue
		}
		out = append(out, parsedImportRow{
			rowNumber: i + 1,
			email:     email,
			fullName:  fullName,
			className: className,
		})
	}

	if len(out) > maxImportRows {
		return nil, &ImportRowLimitError{Limit: maxImportRows, Got: len(out)}
	}
	return out, nil
}

// -----------------------------------------------------------------------------
// Classification
// -----------------------------------------------------------------------------

// classifiedImportRow is a parsed row plus its resolved classification + the
// DB handles ConfirmImport needs (student user id, resolved class id).
type classifiedImportRow struct {
	rowNumber int
	rawEmail  string
	normEmail string
	fullName  string
	className string
	status    string
	errorCode string

	classID           pgtype.UUID
	classIDValid      bool
	userID            pgtype.UUID
	userIDValid       bool // an EXISTING global account resolved
	userNeverAccepted bool // existing account with no password + no google_id (D4)
	persisted         bool // set by ConfirmImport's fan-out
}

// classifyImportRows classifies every parsed row against the tenant DB (RLS
// scoped — MUST run inside a tenant tx for ListClasses). Both preview and
// confirm call this, so preview and confirm agree on the classification rules.
func classifyImportRows(ctx context.Context, q *generated.Queries, tc model.TenantContext, parsed []parsedImportRow) ([]classifiedImportRow, error) {
	centerUUID, err := uuid.Parse(tc.CenterID)
	if err != nil {
		return nil, &ForbiddenError{Reason: "invalid tenant context"}
	}

	classes, err := q.ListClasses(ctx)
	if err != nil {
		return nil, fmt.Errorf("classify import: list classes: %w", err)
	}
	classesByName := map[string][]pgtype.UUID{}
	for _, c := range classes {
		// D2 — only enrollable classes (upcoming/active) resolve by name.
		// Including ended/paused classes would enroll students into a dead class
		// and let an ended+active same-name pair falsely trip CLASS_NAME_AMBIGUOUS.
		if c.Status != classStatusUpcoming && c.Status != classStatusActive {
			continue
		}
		key := strings.ToLower(strings.TrimSpace(c.Name))
		classesByName[key] = append(classesByName[key], c.ID)
	}

	seen := map[string]bool{}
	out := make([]classifiedImportRow, 0, len(parsed))
	for _, p := range parsed {
		row := classifiedImportRow{
			rowNumber: p.rowNumber,
			rawEmail:  p.email,
			fullName:  p.fullName,
			className: p.className,
		}
		if err := classifyOneRow(ctx, q, centerUUID, classesByName, seen, &row); err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, nil
}

// classifyOneRow computes the status + error + resolved handles for one row.
// First failing check wins; a valid row lands new_user / existing_user /
// unassigned. Mutates row in place.
func classifyOneRow(
	ctx context.Context, q *generated.Queries, centerUUID uuid.UUID,
	classesByName map[string][]pgtype.UUID, seen map[string]bool, row *classifiedImportRow,
) error {
	fail := func(code string) {
		row.status = importStatusValidationError
		row.errorCode = code
	}

	row.normEmail = normalizeImportEmail(row.rawEmail)
	if row.normEmail == "" {
		fail(importErrInvalidEmail)
		return nil
	}
	if seen[row.normEmail] {
		fail(importErrDuplicateEmail)
		return nil
	}
	// NB: seen[normEmail] is marked only once the row is fully valid (below), so
	// an earlier row that fails a LATER check does not claim the dedup slot and
	// force a subsequent VALID row with the same email to be skipped (P4).

	if row.fullName == "" {
		fail(importErrMissingName)
		return nil
	}

	if row.className != "" {
		matches := classesByName[strings.ToLower(row.className)]
		switch {
		case len(matches) == 0:
			fail(importErrClassNotFound)
			return nil
		case len(matches) > 1:
			fail(importErrClassAmbiguous)
			return nil
		default:
			row.classID = matches[0]
			row.classIDValid = true
		}
	}

	// Resolve the account. A global users row may exist without any membership
	// (existing_user, linked) — but a membership in ANOTHER center violates the
	// one-center invariant.
	user, err := q.GetUserByEmail(ctx, row.normEmail)
	switch {
	case err == nil:
		// Total memberships across ALL centers (RLS-bypassing SECURITY DEFINER) —
		// a plain COUNT under this tenant tx cannot see a membership in another
		// center. Subtract the caller-center membership (RLS-visible) to detect
		// the one-center-invariant violation.
		total, cerr := q.CountCenterMembershipsForUserAllCenters(ctx, user.ID)
		if cerr != nil {
			return fmt.Errorf("classify import: count memberships: %w", cerr)
		}
		hereCount := int64(0)
		member, merr := q.GetCenterMemberByUserAndCenter(ctx, generated.GetCenterMemberByUserAndCenterParams{
			UserID:   user.ID,
			CenterID: pgUUID(centerUUID),
		})
		switch {
		case merr == nil:
			hereCount = 1
			// D1 — an existing NON-student member (owner/admin/teacher, or the
			// operator's own account) must NEVER be silently demoted by the
			// unconditional student-role upsert on confirm. Skip the row.
			if member.Role != model.RoleStudent {
				fail(importErrUserAlreadyStaff)
				return nil
			}
		case errors.Is(merr, pgx.ErrNoRows):
			// Not a member here — the other-center check below decides.
		default:
			return fmt.Errorf("classify import: get membership: %w", merr)
		}
		if total-hereCount > 0 {
			fail(importErrUserInAnotherCenter)
			return nil
		}
		row.userID = user.ID
		row.userIDValid = true
		// D4 — an existing account that has never accepted (no password AND no
		// Google identity) is still awaiting its invite claim; re-import may
		// re-enqueue the invite to recover a dropped first email.
		row.userNeverAccepted = !user.PasswordHash.Valid && !user.GoogleID.Valid
	case errors.Is(err, pgx.ErrNoRows):
		// New account — no users row yet.
	default:
		return fmt.Errorf("classify import: lookup user: %w", err)
	}

	// The row passed every validation — claim the dedup slot now (P4) so a later
	// row with the same email is the one flagged DUPLICATE_EMAIL.
	seen[row.normEmail] = true

	switch {
	case !row.classIDValid:
		row.status = importStatusUnassigned
	case row.userIDValid:
		row.status = importStatusExistingUser
	default:
		row.status = importStatusNewUser
	}
	return nil
}

// normalizeImportEmail lowercases + trims a parseable address, returning "" for
// an empty or unparseable email (which the caller flags INVALID_EMAIL). Mirrors
// normalizeSpawnEmail so import + spawn dedup identically.
func normalizeImportEmail(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	parsed, err := mail.ParseAddress(raw)
	if err != nil {
		return ""
	}
	return strings.ToLower(strings.TrimSpace(parsed.Address))
}
