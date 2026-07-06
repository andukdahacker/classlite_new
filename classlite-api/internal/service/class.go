// Package service — Story 2.2 ClassService.
//
// Spawn is the multi-class transactional fan-out endpoint. It reads the
// caller's persona + email BEFORE opening the tx, resolves each class's
// teacher through Branch A/B/C/D (AC4), then in ONE transaction: reads the
// template under RLS, verifies Branch B memberships inside the tenant scope,
// inserts N classes + M invite rows (deduped per unique lowercased email),
// and writes one class.spawned audit row per class.
//
// Invite emails are enqueued OUTSIDE the tx via EmailRetryQueue — the invite
// ROW is the durable contract; the email is a best-effort affordance. See
// Reframe 3 in the story Dev Notes.
package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"net/mail"
	"strings"
	"time"
	"unicode"
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
	cohortNameMinLen    = 1
	cohortNameMaxLen    = 120
	spawnClassesMin     = 1
	spawnClassesMax     = 20
	spawnStartDateDrift = 30 * 24 * time.Hour
	// spawnStartDateFutureCap ceilings startDate at 1 year ahead (C1-12
	// review fix — prevents accidental / hostile year-9999 schedules).
	spawnStartDateFutureCap = 365 * 24 * time.Hour
	// spawnDeadline caps the whole Spawn operation. Bounds the pool-connection
	// hold on 20-class fan-outs against a slow DB (C1-09 review fix).
	spawnDeadline      = 30 * time.Second
	classSpawnedAction = "class.spawned"
	classSpawnedEntity = "class"
)

// InviteSender is the constructor seam ClassService uses to enqueue invite
// emails after the spawn tx commits. Matches service.EmailRetryQueue's
// signature; the compile-time assertion below locks it.
type InviteSender interface {
	Enqueue(job EmailJob) (accepted bool)
}

// Compile-time assertion: InProcessRetryQueue satisfies InviteSender.
var _ InviteSender = (*InProcessRetryQueue)(nil)

// SpawnClassInput is a single class entry in the spawn payload. TeacherEmail
// is nullable; empty or nil triggers Branch D (unless Founder + index 0 → AC6).
type SpawnClassInput struct {
	CohortName   string
	StartDate    string // "2006-01-02"
	TeacherEmail *string
}

// SpawnInput is the decoded POST body. classes.length must be [1, 20].
type SpawnInput struct {
	Classes []SpawnClassInput
}

// SpawnedClass is a wire-format row in the spawn response's classes[] array.
// Field order mirrors api.yaml SpawnedClass.
type SpawnedClass struct {
	ID                      string     `json:"id"`
	Name                    string     `json:"name"`
	StartDate               string     `json:"startDate"`
	TeacherID               *uuid.UUID `json:"teacherId"`
	TeacherEmail            *string    `json:"teacherEmail"`
	PendingTeacherEmail     *string    `json:"pendingTeacherEmail"`
	TeacherStatus           string     `json:"teacherStatus"`
	TeacherAssignmentReason string     `json:"teacherAssignmentReason"`
}

// SpawnInviteEntry surfaces per-invite outcome so the wizard done screen
// can render truth to the owner without a second round-trip (Sally-B1 fold).
type SpawnInviteEntry struct {
	Email                string `json:"email"`
	ClassIndices         []int  `json:"classIndices"`
	Enqueued             bool   `json:"enqueued"`
	ReusedExistingInvite bool   `json:"reusedExistingInvite"`
	ExpiresAt            string `json:"expiresAt"`
}

// SpawnResult is the {data} payload for POST /api/templates/{id}/spawn.
type SpawnResult struct {
	Classes     []SpawnedClass     `json:"classes"`
	Invites     []SpawnInviteEntry `json:"invites"`
	InvitesSent int                `json:"invitesSent"`
}

// TeacherStatus + TeacherAssignmentReason enums — mirrored on the response.
const (
	teacherStatusAssigned   = "assigned"
	teacherStatusInvited    = "invited"
	teacherStatusUnassigned = "unassigned"

	reasonExplicitSelf   = "explicit_self"
	reasonExplicitMember = "explicit_member"
	reasonFounderAuto    = "founder_auto"
	reasonInvited        = "invited"
	reasonUnassigned     = "unassigned"

	personaFounder = "founder"
)

// ClassService owns Spawn.
type ClassService struct {
	db      AuthDB
	audit   AuditLogger
	inviter InviteSender
	clk     clock.Clock

	// acceptURLBase is the invite accept URL base — production wires it
	// from Config.AcceptURLBase; tests default to a localhost value.
	acceptURLBase string
}

// NewClassService constructs a ClassService bound to the given seams. clk
// is used for expires_at + audit timestamps + startDate drift check.
func NewClassService(db AuthDB, audit AuditLogger, inviter InviteSender, clk clock.Clock) *ClassService {
	return &ClassService{
		db:            db,
		audit:         audit,
		inviter:       inviter,
		clk:           clk,
		acceptURLBase: "http://localhost:5173/invite",
	}
}

// SetAcceptURLBase overrides the default invite accept URL base.
// Production main.go calls this with the configured URL.
func (s *ClassService) SetAcceptURLBase(base string) {
	s.acceptURLBase = strings.TrimRight(base, "/")
}

// classPlan is the intermediate per-class state built during pre-tx resolution.
// Branch B upgrades from candidate to confirmed inside the tx.
type classPlan struct {
	Input         SpawnClassInput
	Index         int
	CohortName    string
	StartDate     time.Time
	NormalizedTE  string  // lowercased teacherEmail — empty for nil/whitespace
	Branch        rune    // 'A', 'B', 'C', 'D' — final assignment
	TeacherID     *uuid.UUID
	TeacherEmail  *string
	PendingEmail  *string
	Reason        string
	// For Branch B candidates that need to be verified inside the tx.
	BranchBCandidate *uuid.UUID // resolved user_id from pre-tx lookup; nil = definitely not a system user
}

// inviteBucket tracks per-lowercased-email invite state through the tx.
type inviteBucket struct {
	Email        string
	ClassIndices []int
	RawToken     string
	InviteID     uuid.UUID
	ExpiresAt    time.Time
	ReusedExisting bool
	// enqueued is populated post-commit.
}

// Spawn is the transactional entry point. userID comes from tc.UserID (parsed
// at the handler layer for type safety); templateID is parsed from the path.
func (s *ClassService) Spawn(
	ctx context.Context, tc model.TenantContext,
	userID uuid.UUID, templateID uuid.UUID, in SpawnInput,
) (*SpawnResult, error) {
	// R2-P22 — pull request_id from parent ctx BEFORE we wrap it in a timeout;
	// used to correlate every slog line in Spawn back to the HTTP request.
	requestID, _ := ctx.Value(model.RequestID).(string)

	// Preserve the caller's ctx for the post-commit best-effort enqueue loop
	// (R2-P3). The 30s deadline below is meant to bound the tx, not to silently
	// drop email attempts on remaining buckets after commit succeeds.
	parentCtx := ctx

	// C1-09 review fix — bound the whole spawn operation. A 20-class fan-out
	// on a slow DB previously pinned a pool connection until the client
	// disconnected (or forever). 30s matches Story 2.1's onboarding tx budget.
	ctx, cancel := context.WithTimeout(ctx, spawnDeadline)
	defer cancel()

	// Pre-tx: read caller persona + email (one query on users, no RLS).
	q := generated.New(s.db)
	callerInfo, err := q.GetUserPersonaAndEmail(ctx, pgUUID(userID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("spawn: caller user %s not found", userID)
		}
		return nil, fmt.Errorf("spawn: read caller persona/email: %w", err)
	}
	callerEmailNormalized := normalizeSpawnEmail(callerInfo.Email)
	callerPersona := ""
	if callerInfo.Persona.Valid {
		callerPersona = callerInfo.Persona.String
	}

	// Pre-tx: validate + resolve teacher branches. The raw DB email is passed
	// alongside the normalized form so Branch A can render the DB value
	// (R2-P25) and the Sally-B4 belt can compare against the un-normalized
	// address (R2-P31).
	plans, err := s.resolveTeacherBranches(ctx, in, userID, callerInfo.Email, callerEmailNormalized, callerPersona)
	if err != nil {
		return nil, err
	}

	// Open tx.
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("spawn: begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()

	if err := store.SetTenantContext(ctx, tx, tc); err != nil {
		return nil, fmt.Errorf("spawn: %w", err)
	}
	txQ := generated.New(tx)

	// Read template INSIDE tx after SET LOCAL (Winston-W-S5) — otherwise the
	// caller's OWN custom template would return pgx.ErrNoRows via RLS
	// invisibility under empty app.current_tenant_id.
	tmpl, err := txQ.GetTemplateByID(ctx, pgUUID(templateID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, model.NotFoundError{Resource: "class_template", ID: templateID.String(), Code: "TEMPLATE_NOT_FOUND"}
		}
		return nil, fmt.Errorf("spawn: read template: %w", err)
	}

	// Parse centerID once; reused for the center lookup below AND every
	// per-invite / per-class INSERT further down.
	centerUUID, err := uuid.Parse(tc.CenterID)
	if err != nil {
		return nil, fmt.Errorf("spawn: parse centerID: %w", err)
	}

	// Look up the caller's center name inside the tx so the invite email's
	// subject and body reference the CENTER (not the class template). C1-02
	// review fix — RenderInviteEmail's first parameter is `centerName` per
	// email_templates.go; previously the code passed `tmpl.Name`, producing
	// subjects like "You're invited to Writing Bootcamp 6.5" instead of the
	// actual center name.
	centerRow, err := txQ.GetCenterByID(ctx, pgUUID(centerUUID))
	if err != nil {
		return nil, fmt.Errorf("spawn: read center: %w", err)
	}
	centerName := centerRow.Name

	// Verify Branch B candidates inside the tx (RLS scoped to caller center).
	// Downgrades to Branch C if the candidate is not a member of THIS center.
	if err := s.verifyBranchBInsideTx(ctx, txQ, centerUUID, plans); err != nil {
		return nil, err
	}

	// Build invite buckets from all Branch C plans, keyed on lowercased email.
	buckets := aggregateInviteBuckets(plans)
	now := s.clk.Now()
	// C1-20 review fix — prefer users.full_name for the invite email's
	// inviter-name field. Fall back to the email's local-part only if
	// full_name is empty (legacy data). Previously always the local-part,
	// which leaked the caller's raw email address into outbound copy.
	inviterName := strings.TrimSpace(callerInfo.FullName)
	if inviterName == "" {
		inviterName = strings.TrimSpace(strings.Split(callerInfo.Email, "@")[0])
	}

	for i := range buckets {
		bucket := &buckets[i]
		bucket.ExpiresAt = now.Add(inviteTTL)

		raw, err := newPasswordResetToken()
		if err != nil {
			return nil, fmt.Errorf("spawn: generate invite token: %w", err)
		}
		tokenHash := hashInviteTokenHex(raw)
		newInviteID := model.NewID()

		// SAVEPOINT wraps the invite INSERT so a unique-violation on
		// idx_invites_center_email_active leaves the outer tx usable. Postgres
		// 25P02 posture: any error inside a tx aborts the whole tx until
		// ROLLBACK / ROLLBACK TO savepoint. Same fix Story 2.1 applied to the
		// slug retry loop.
		if _, err := tx.Exec(ctx, "SAVEPOINT invite_insert"); err != nil {
			return nil, fmt.Errorf("spawn: savepoint invite_insert: %w", err)
		}
		row, err := txQ.CreateInviteFull(ctx, generated.CreateInviteFullParams{
			ID:         pgUUID(newInviteID),
			CenterID:   pgUUID(centerUUID),
			InviterID:  pgUUID(userID),
			Email:      bucket.Email,
			Name:       pgtype.Text{Valid: false},
			Role:       "teacher",
			TokenHash:  tokenHash,
			ExpiresAt:  pgtype.Timestamptz{Time: bucket.ExpiresAt, Valid: true},
		})
		if err != nil {
			// Roll back to the savepoint regardless of failure kind so the
			// outer tx stays usable — belt-and-suspenders even for non-race
			// errors that we then re-return.
			if _, rbErr := tx.Exec(ctx, "ROLLBACK TO SAVEPOINT invite_insert"); rbErr != nil {
				return nil, fmt.Errorf("spawn: rollback to savepoint after invite insert: %w", rbErr)
			}
			// Race: idx_invites_center_email_active blocked us. Reuse existing.
			if isConstraintViolation(err, "idx_invites_center_email_active") {
				existing, lookupErr := txQ.GetActiveInviteByEmail(ctx, generated.GetActiveInviteByEmailParams{
					CenterID: pgUUID(centerUUID),
					Email:    bucket.Email,
				})
				if lookupErr != nil {
					return nil, fmt.Errorf("spawn: lookup racing invite for %s: %w", bucket.Email, lookupErr)
				}
				bucket.InviteID = uuidFromPg(existing.ID)
				// C1-08 review fix — guard against a zero-time pgtype.Timestamptz
				// (Valid=false) leaking `0001-01-01T00:00:00Z` into the wire response.
				// Any invite row is written with expires_at NOT NULL, so a
				// !Valid read means the DB row is corrupt — bail loud.
				if !existing.ExpiresAt.Valid {
					return nil, fmt.Errorf("spawn: reused invite for %s has invalid expires_at", bucket.Email)
				}
				bucket.ExpiresAt = existing.ExpiresAt.Time
				bucket.ReusedExisting = true
				bucket.RawToken = "" // do not resend
				// R2-P4 — RELEASE the savepoint on the reuse path so it doesn't
				// stack across bucket iterations.
				if _, err := tx.Exec(ctx, "RELEASE SAVEPOINT invite_insert"); err != nil {
					return nil, fmt.Errorf("spawn: release savepoint on reuse: %w", err)
				}
				slog.Info("spawn_invite_reused_existing",
					"request_id", requestID,
					"center_id", tc.CenterID,
					"email_hash", hashEmailForLog(bucket.Email),
				)
				continue
			}
			return nil, fmt.Errorf("spawn: insert invite for %s: %w", bucket.Email, err)
		}
		if _, err := tx.Exec(ctx, "RELEASE SAVEPOINT invite_insert"); err != nil {
			return nil, fmt.Errorf("spawn: release savepoint invite_insert: %w", err)
		}
		bucket.InviteID = uuidFromPg(row.ID)
		bucket.RawToken = raw
	}

	// Insert classes + audit rows.
	spawned := make([]SpawnedClass, 0, len(plans))
	for _, p := range plans {
		classID := model.NewID()
		var teacherPg pgtype.UUID
		if p.TeacherID != nil {
			teacherPg = pgUUID(*p.TeacherID)
		}
		var pendingText pgtype.Text
		if p.PendingEmail != nil {
			pendingText = pgtype.Text{String: *p.PendingEmail, Valid: true}
		}

		targetBand := tmpl.TargetBand
		primarySkill := pgtype.Text{String: tmpl.PrimarySkill, Valid: true}
		sessionCount := pgtype.Int4{Int32: tmpl.SessionCount, Valid: true}
		startPg := pgtype.Date{Time: p.StartDate, Valid: true}

		row, err := txQ.CreateClass(ctx, generated.CreateClassParams{
			ID:                  pgUUID(classID),
			CenterID:            pgUUID(centerUUID),
			TemplateID:          pgUUID(templateID),
			Name:                p.CohortName,
			TargetBand:          targetBand,
			PrimarySkill:        primarySkill,
			SessionCount:        sessionCount,
			Status:              "upcoming",
			TeacherID:           teacherPg,
			PendingTeacherEmail: pendingText,
			StartDate:           startPg,
		})
		if err != nil {
			return nil, fmt.Errorf("spawn: insert class[%d]: %w", p.Index, err)
		}

		// C1-17 review fix — record enough teacher-resolution state that a
		// forensic reviewer can distinguish Branch A / B (assigned) from
		// Branch C (invited) from Branch D (unassigned) from the audit row
		// alone. Previously teacher_status / pending_teacher_email /
		// assignment_reason were absent, so audit was ambiguous on "why was
		// Bob assigned to this class".
		afterAudit := map[string]any{
			"name":                      row.Name,
			"template_id":               templateID.String(),
			"start_date":                p.StartDate.Format("2006-01-02"),
			"teacher_id":                uuidPtrString(p.TeacherID),
			"teacher_status":            branchToStatus(p.Branch),
			"teacher_assignment_reason": string(p.Reason),
			"pending_teacher_email":     nil,
		}
		if p.PendingEmail != nil {
			afterAudit["pending_teacher_email"] = *p.PendingEmail
		}
		changes := Changes{
			Before: nil,
			After:  afterAudit,
		}
		if err := s.audit.LogWithinTx(ctx, tx, tc, classSpawnedAction, classSpawnedEntity, classID, changes); err != nil {
			return nil, fmt.Errorf("spawn: audit class[%d]: %w", p.Index, err)
		}

		spawned = append(spawned, SpawnedClass{
			ID:                      classID.String(),
			Name:                    row.Name,
			StartDate:               p.StartDate.Format("2006-01-02"),
			TeacherID:               p.TeacherID,
			TeacherEmail:            p.TeacherEmail,
			PendingTeacherEmail:     p.PendingEmail,
			TeacherStatus:           branchToStatus(p.Branch),
			TeacherAssignmentReason: p.Reason,
		})
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("spawn: commit: %w", err)
	}
	// R2-P3 — release the tx-scoped deadline now that the tx is durable, then
	// run the post-commit enqueue loop under the caller's ctx (without cancel)
	// so a 30s tx budget doesn't silently drop remaining email attempts.
	cancel()
	enqueueCtx := context.WithoutCancel(parentCtx)
	_ = enqueueCtx // reserved for future ctx-aware enqueue (Enqueue is fire-and-forget today)

	// Post-commit: enqueue invite emails (best-effort per Reframe 3).
	// centerName captured pre-commit inside the tx above (C1-02 review fix).
	//
	// C1-14 review fix (documented drift) — an in-process crash between
	// tx.Commit and s.inviter.Enqueue leaves an invite ROW without an email
	// attempt. The invite ROW is the durable contract; the owner can resend
	// via the (post-v1) Epic 7 UI. Ops can grep the log lines below by
	// `spawn_invite_email_enqueue_rejected` (channel full) or by
	// `spawn_invite_enqueued` (successfully queued) to reconcile. A durable
	// reconciler is filed as FU-2-2-J.
	invitesResp := make([]SpawnInviteEntry, 0, len(buckets))
	newlyCreatedAndEnqueued := 0
	for _, bucket := range buckets {
		entry := SpawnInviteEntry{
			Email:                bucket.Email,
			ClassIndices:         bucket.ClassIndices,
			ReusedExistingInvite: bucket.ReusedExisting,
			ExpiresAt:            bucket.ExpiresAt.UTC().Format(time.RFC3339),
		}
		if bucket.ReusedExisting {
			// No email attempt — the reused row already has its own raw
			// token that we don't hold.
			entry.Enqueued = false
			invitesResp = append(invitesResp, entry)
			continue
		}
		acceptURL := fmt.Sprintf("%s/%s", s.acceptURLBase, bucket.RawToken)
		// R2-P2 — strip CR/LF and non-printable runes from centerName +
		// inviterName immediately before render. Guards SMTP header injection
		// since centers.name isn't validated with a CR/LF ban in Story 2.1.
		safeCenterName := stripCRLFAndControls(centerName)
		safeInviterName := stripCRLFAndControls(inviterName)
		subject, body := RenderInviteEmail(safeCenterName, safeInviterName, "teacher", acceptURL)
		accepted := s.inviter.Enqueue(EmailJob{To: bucket.Email, Subject: subject, HTML: body})
		entry.Enqueued = accepted
		if !accepted {
			slog.Warn("spawn_invite_email_enqueue_rejected",
				"request_id", requestID,
				"center_id", tc.CenterID,
				"invite_id", bucket.InviteID.String(),
				"to_hash", hashEmailForLog(bucket.Email),
			)
		} else {
			newlyCreatedAndEnqueued++
		}
		invitesResp = append(invitesResp, entry)
	}

	return &SpawnResult{
		Classes:     spawned,
		Invites:     invitesResp,
		InvitesSent: newlyCreatedAndEnqueued,
	}, nil
}

// resolveTeacherBranches validates each SpawnClassInput and computes its
// Branch (A/B/C/D). Runs BEFORE the tx opens so a validation failure never
// costs a pool connection.
func (s *ClassService) resolveTeacherBranches(
	ctx context.Context, in SpawnInput,
	userID uuid.UUID, callerEmailRaw, callerEmailNormalized, callerPersona string,
) ([]classPlan, error) {
	if len(in.Classes) < spawnClassesMin || len(in.Classes) > spawnClassesMax {
		return nil, model.ValidationError{Fields: []model.FieldError{{
			Field:   "classes",
			Message: fmt.Sprintf("must contain between %d and %d entries", spawnClassesMin, spawnClassesMax),
		}}}
	}

	// C1-13 review fix — normalize to UTC before day-boundary comparisons.
	// R2-P27 — truncate to the day boundary so jitter around UTC midnight
	// can't flip startDate accept/reject over a single-second reference.
	now := s.clk.Now().UTC().Truncate(24 * time.Hour)
	earliestStart := now.Add(-spawnStartDateDrift)
	// C1-12 review fix — cap startDate to 1 year in the future so operators
	// can't schedule classes into 9999 by accident (or maliciously).
	latestStart := now.Add(spawnStartDateFutureCap)

	var fields []model.FieldError
	plans := make([]classPlan, 0, len(in.Classes))
	q := generated.New(s.db)

	// R2-P34 — track cohort names case-insensitively per payload so a wizard
	// reload can't smuggle "Cohort A" twice into the same fan-out. Value is
	// the index of the FIRST occurrence so the collision message can point
	// the owner back to the source of truth.
	seenCohortNames := map[string]int{}

	for i, c := range in.Classes {
		// C1-15 review fix — collect ALL field errors for this class before
		// advancing so the wizard can surface every problem in one round-trip.
		classErrCount := len(fields)

		cohort := strings.TrimSpace(c.CohortName)
		runeCount := utf8.RuneCountInString(cohort)
		if runeCount < cohortNameMinLen {
			fields = append(fields, model.FieldError{
				Field:   fmt.Sprintf("classes[%d].cohortName", i),
				Message: "must be at least 1 character",
			})
		} else if runeCount > cohortNameMaxLen {
			fields = append(fields, model.FieldError{
				Field:   fmt.Sprintf("classes[%d].cohortName", i),
				Message: fmt.Sprintf("must be at most %d characters", cohortNameMaxLen),
			})
		} else {
			// R2-P34 — dedupe cohort names case-insensitively.
			cohortKey := strings.ToLower(cohort)
			if firstIdx, dup := seenCohortNames[cohortKey]; dup {
				fields = append(fields, model.FieldError{
					Field:   fmt.Sprintf("classes[%d].cohortName", i),
					Code:    "DUPLICATE_COHORT_NAME",
					Message: fmt.Sprintf("cohort name already used at index %d", firstIdx),
				})
			} else {
				seenCohortNames[cohortKey] = i
			}
		}

		// R2-P26 — distinct startDate error codes. Trim first: an empty string
		// after trim is MISSING_START_DATE (semantically distinct from a
		// malformed non-empty value that fails INVALID_START_DATE_FORMAT).
		trimmedStart := strings.TrimSpace(c.StartDate)
		var startDate time.Time
		if trimmedStart == "" {
			fields = append(fields, model.FieldError{
				Field:   fmt.Sprintf("classes[%d].startDate", i),
				Code:    "MISSING_START_DATE",
				Message: "startDate is required",
			})
		} else {
			var err error
			startDate, err = time.Parse("2006-01-02", trimmedStart)
			if err != nil {
				fields = append(fields, model.FieldError{
					Field:   fmt.Sprintf("classes[%d].startDate", i),
					Code:    "INVALID_START_DATE_FORMAT",
					Message: "must be YYYY-MM-DD",
				})
			} else if startDate.Before(earliestStart) {
				fields = append(fields, model.FieldError{
					Field:   fmt.Sprintf("classes[%d].startDate", i),
					Message: "must not be more than 30 days in the past",
				})
			} else if startDate.After(latestStart) {
				fields = append(fields, model.FieldError{
					Field:   fmt.Sprintf("classes[%d].startDate", i),
					Message: "must not be more than 1 year in the future",
				})
			}
		}

		// If either cohortName or startDate had a hard failure, skip the
		// teacher-branch resolution for this class — its plan is unusable.
		if len(fields) > classErrCount {
			continue
		}

		plan := classPlan{Input: c, Index: i, CohortName: cohort, StartDate: startDate}

		// Teacher email — nil/whitespace / valid / malformed.
		raw := ""
		if c.TeacherEmail != nil {
			raw = strings.TrimSpace(*c.TeacherEmail)
		}
		if raw == "" {
			// Branch D — unless Founder auto-assign kicks in on classes[0].
			if i == 0 && callerPersona == personaFounder {
				// R2-P33 — a Founder row with an unparseable stored email is
				// database corruption. Surface it loudly as a 500 instead of
				// silently downgrading to Branch D; AC6's MUST is unambiguous.
				if callerEmailNormalized == "" {
					return nil, fmt.Errorf("spawn: corrupt Founder email row for user %s", userID)
				}
				plan.Branch = 'A'
				// R2-P6 — callerEmailNormalized is already the normalized
				// address string; the second mail.ParseAddress round-trip was
				// redundant and had a theoretical nil-deref path.
				emailCopy := callerEmailNormalized
				uid := userID
				plan.TeacherID = &uid
				plan.TeacherEmail = &emailCopy
				plan.Reason = reasonFounderAuto
			} else {
				plan.Branch = 'D'
				plan.Reason = reasonUnassigned
			}
			plans = append(plans, plan)
			continue
		}

		parsed, err := mail.ParseAddress(raw)
		if err != nil {
			fields = append(fields, model.FieldError{
				Field:   fmt.Sprintf("classes[%d].teacherEmail", i),
				Code:    "INVALID_TEACHER_EMAIL",
				Message: "must be a valid email address",
			})
			continue
		}
		payloadNormalized := normalizeSpawnEmail(parsed.Address)
		plan.NormalizedTE = payloadNormalized

		// Branch A — caller's own email.
		if payloadNormalized == callerEmailNormalized {
			plan.Branch = 'A'
			uid := userID
			plan.TeacherID = &uid
			// R2-P25 — Branch A response reflects the DB-stored user email,
			// not the payload-derived normalized form. Copy `callerEmailRaw`
			// (the users.email value) into a local so we can address it.
			emailCopy := callerEmailRaw
			plan.TeacherEmail = &emailCopy
			plan.Reason = reasonExplicitSelf
			plans = append(plans, plan)
			continue
		}

		// Sally-B4 belt: parsed-address equality with different case/whitespace
		// should have collapsed to Branch A. If not, a normalization drift bug
		// slipped through — surface SELF_INVITE_BLOCKED.
		//
		// R2-P31 — the previous belt compared two already-lowercased strings
		// (payloadNormalized vs callerEmailNormalized via EqualFold) and was
		// dead: it could never fire because Branch A above catches that path.
		// Rewritten to compare parsed.Address against the RAW DB email
		// (case-insensitive) AND only when Branch A's normalized-equality
		// check missed — the exact "normalization drift" signal this canary
		// exists to catch.
		if callerEmailRaw != "" && strings.EqualFold(parsed.Address, callerEmailRaw) && payloadNormalized != callerEmailNormalized {
			fields = append(fields, model.FieldError{
				Field:   fmt.Sprintf("classes[%d].teacherEmail", i),
				Code:    "SELF_INVITE_BLOCKED",
				Message: "you cannot invite yourself",
			})
			continue
		}

		// Branch B candidate — check if the user exists at all. Membership
		// check happens INSIDE the tx for RLS scoping.
		user, err := q.GetUserByEmail(ctx, payloadNormalized)
		if err == nil {
			uid := uuidFromPg(user.ID)
			plan.BranchBCandidate = &uid
			plan.Branch = 'B' // provisional
			emailCopy := normalizeSpawnEmail(user.Email)
			plan.TeacherEmail = &emailCopy
			plan.Reason = reasonExplicitMember
			plans = append(plans, plan)
			continue
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("spawn: lookup teacher %s: %w", payloadNormalized, err)
		}

		// Branch C — email doesn't map to any existing user.
		plan.Branch = 'C'
		emailCopy := payloadNormalized
		plan.PendingEmail = &emailCopy
		plan.Reason = reasonInvited
		plans = append(plans, plan)
	}

	if len(fields) > 0 {
		return nil, model.ValidationError{Fields: fields}
	}
	return plans, nil
}

// verifyBranchBInsideTx checks that each Branch B candidate is a member of
// THIS center under RLS-scoped read. Missing membership downgrades the plan
// to Branch C (invite path).
//
// R2-P32 — the count query is now `CountCenterMembersByUserAndCenter` which
// includes an explicit `center_id = $2` predicate. RLS remains the primary
// tenant boundary (this function still runs inside a tx with
// `SET LOCAL app.current_tenant_id`), but the explicit predicate is a
// belt-and-suspenders guard: if RLS is ever dropped, misconfigured, or this
// helper gets called on the raw pool, the query would still refuse to leak
// cross-center memberships.
func (s *ClassService) verifyBranchBInsideTx(
	ctx context.Context, q *generated.Queries, centerUUID uuid.UUID, plans []classPlan,
) error {
	for i := range plans {
		p := &plans[i]
		if p.Branch != 'B' || p.BranchBCandidate == nil {
			continue
		}
		count, err := q.CountCenterMembersByUserAndCenter(ctx, generated.CountCenterMembersByUserAndCenterParams{
			UserID:   pgUUID(*p.BranchBCandidate),
			CenterID: pgUUID(centerUUID),
		})
		if err != nil {
			return fmt.Errorf("spawn: verify branch B[%d]: %w", p.Index, err)
		}
		if count > 0 {
			// Confirmed member.
			p.TeacherID = p.BranchBCandidate
			continue
		}
		// Downgrade to Branch C.
		p.Branch = 'C'
		p.TeacherID = nil
		emailCopy := p.NormalizedTE
		if emailCopy == "" && p.TeacherEmail != nil {
			emailCopy = *p.TeacherEmail
			// R2-P30 — the fallback source may be a mixed-case pre-2.2
			// users.email row; force-lowercase so it lands in the same
			// invite dedup bucket as the payload-derived normalized form.
			emailCopy = strings.ToLower(emailCopy)
		}
		p.PendingEmail = &emailCopy
		p.TeacherEmail = nil
		p.Reason = reasonInvited
	}
	return nil
}

// aggregateInviteBuckets consolidates all Branch C plans into one bucket per
// unique lowercased email (AC5 in-payload dedup).
func aggregateInviteBuckets(plans []classPlan) []inviteBucket {
	byEmail := map[string]int{}
	buckets := make([]inviteBucket, 0)
	for _, p := range plans {
		if p.Branch != 'C' || p.PendingEmail == nil {
			continue
		}
		email := *p.PendingEmail
		if idx, ok := byEmail[email]; ok {
			buckets[idx].ClassIndices = append(buckets[idx].ClassIndices, p.Index)
			continue
		}
		byEmail[email] = len(buckets)
		buckets = append(buckets, inviteBucket{
			Email:        email,
			ClassIndices: []int{p.Index},
		})
	}
	return buckets
}

// branchToStatus renders the Branch discriminator into the teacherStatus enum.
func branchToStatus(b rune) string {
	switch b {
	case 'A', 'B':
		return teacherStatusAssigned
	case 'C':
		return teacherStatusInvited
	default:
		return teacherStatusUnassigned
	}
}

// normalizeSpawnEmail runs the AC4 normalization: parse → lowercase → trim.
// Preserves empty string on empty input for the callerEmailNormalized guard.
func normalizeSpawnEmail(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	parsed, err := mail.ParseAddress(s)
	if err != nil {
		return ""
	}
	return strings.ToLower(strings.TrimSpace(parsed.Address))
}

// uuidFromPg converts a valid pgtype.UUID to google/uuid.UUID.
// Returns uuid.Nil for the invalid case; call sites should not construct
// these against unvalidated data.
func uuidFromPg(u pgtype.UUID) uuid.UUID {
	if !u.Valid {
		return uuid.Nil
	}
	return uuid.UUID(u.Bytes)
}

// uuidPtrString returns the canonical UUID text for a *uuid.UUID or nil if
// the pointer is nil. Used by audit changes.after.teacher_id.
func uuidPtrString(id *uuid.UUID) any {
	if id == nil {
		return nil
	}
	return id.String()
}

// stripCRLFAndControls removes carriage returns, line feeds, tabs, and any
// non-printable runes from s. Used to sanitize user-controlled strings
// (centerName, inviterName) immediately before they land in an SMTP header
// or subject line — Story 2.1 did not enforce a CR/LF ban on centers.name,
// so this is defense-in-depth against header injection.
func stripCRLFAndControls(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	for _, r := range s {
		if r == '\r' || r == '\n' || r == '\t' {
			continue
		}
		if !unicode.IsPrint(r) {
			continue
		}
		b.WriteRune(r)
	}
	return b.String()
}

// hashEmailForLog returns a truncated SHA-256 hex digest of the lowercased
// email suitable for log correlation without persisting the raw address to
// retention storage (GDPR posture, R2-P21).
func hashEmailForLog(email string) string {
	h := sha256.Sum256([]byte(strings.ToLower(email)))
	return hex.EncodeToString(h[:8])
}
