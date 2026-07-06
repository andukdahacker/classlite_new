// ATDD specimens for Story 2.2 — ClassService.Spawn.
//
// Expected to FAIL against current codebase:
//   - service.NewClassService does not exist yet (Task 7.1)
//   - service.SpawnInput / SpawnClassInput / SpawnResult DTOs do not exist (Task 5.1)
//   - service.InviteSender interface not defined (Task 7.1)
//   - service.ClassService method Spawn(ctx, tc, userID, templateID, input) not implemented (Task 7.2)
//   - classes / class_templates / template_sessions / invites unique index migrations not applied (Task 2.1–2.5)
//
// Coverage — AC4, AC5, AC6, AC9 branch matrix at the service layer. Handler-
// level integration lives in internal/handler/template_handler_atdd_test.go.
//
// Per Story 2.2 Task 0.1 hand-off list. Sibling to Story 2.1's
// service/onboarding_test.go — no HTTP round-trip, straight service call
// with real DB (SetupRawPool for tx commit) + injected AuditLogger and
// InviteSender seams.

package service_test

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/ducdo/classlite-api/internal/test"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// -----------------------------------------------------------------------------
// Test doubles (declared in-file until Task 11.6's story_2_2_helpers.go lands)
// -----------------------------------------------------------------------------

// brokenAuditLogger returns a non-nil error from LogWithinTx to prove
// spawn tx atomicity (AC9). Sibling to the Story 2.1 shape in
// internal/handler/center_handler_atdd_test.go — a compile-time assertion
// below pins the interface signature.
type brokenAuditLogger struct{ err error }

func (b *brokenAuditLogger) LogWithinTx(
	_ context.Context, _ pgx.Tx, _ model.TenantContext,
	_, _ string, _ uuid.UUID, _ any,
) error {
	return b.err
}

var _ service.AuditLogger = (*brokenAuditLogger)(nil)

// realAuditLogger delegates to service.AuditService for the tests that
// exercise the happy path with real audit rows.
type realAuditLogger struct{ inner *service.AuditService }

func (r *realAuditLogger) LogWithinTx(
	ctx context.Context, tx pgx.Tx, tc model.TenantContext,
	action, entityType string, entityID uuid.UUID, changes any,
) error {
	return r.inner.LogWithinTx(ctx, tx, tc, action, entityType, entityID, changes)
}

// MockInviteSender records every Enqueue call so the branch-C dedup +
// buffer-full tests can assert on it. Story 2.2 Task 7.1 defines
// service.InviteSender as `Enqueue(job EmailJob) (accepted bool)` (the
// existing service.EmailRetryQueue signature).
type MockInviteSender struct {
	mu       sync.Mutex
	Calls    []service.EmailJob
	Accepted bool // return value for every Enqueue call
}

func (m *MockInviteSender) Enqueue(job service.EmailJob) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.Calls = append(m.Calls, job)
	return m.Accepted
}

// Compile-time interface assertion — locks the InviteSender shape.
var _ service.InviteSender = (*MockInviteSender)(nil)

// -----------------------------------------------------------------------------
// AC4 Branch A — self-assign via caller email match
// -----------------------------------------------------------------------------

func TestClassService_Spawn_AC04_BranchA_SelfAssignByEmail(t *testing.T) {
	pool := test.SetupRawPool(t)
	owner := test.CreateUserOnPool(t, pool, "self-assign@example.com", "Owner")
	test.MarkUserEmailVerifiedOnPool(t, pool, owner.ID)

	// Green-phase helpers (Task 11.6): create a center + custom template
	// under raw pool. If missing, compile fails — that's the red phase.
	centerID := test.CreateCenterForOwner(t, pool, owner.ID)
	templateID := test.CreateClassTemplate(t, pool, centerID, "Test Template")
	t.Cleanup(func() { test.PurgeUserAndOwnedCenters(t, pool, owner.ID) })

	auditSvc := service.NewAuditService(pool)
	inviter := &MockInviteSender{Accepted: true}
	svc := service.NewClassService(pool, &realAuditLogger{inner: auditSvc}, inviter, clock.RealClock{})

	tc := model.TenantContext{
		CenterID: test.UUIDString(centerID),
		UserID:   test.UUIDString(owner.ID),
	}
	ownerUUID := test.MustParseUUID(t, test.UUIDString(owner.ID))
	tmplUUID := test.MustParseUUID(t, test.UUIDString(templateID))

	result, err := svc.Spawn(context.Background(), tc, ownerUUID, tmplUUID, service.SpawnInput{
		Classes: []service.SpawnClassInput{
			{CohortName: "Self Cohort", StartDate: "2026-08-01", TeacherEmail: strPtr("self-assign@example.com")},
		},
	})
	if err != nil {
		t.Fatalf("AC4 Branch A: spawn errored: %v", err)
	}
	if len(result.Classes) != 1 {
		t.Fatalf("AC4 Branch A: want 1 class, got %d", len(result.Classes))
	}
	c := result.Classes[0]
	if c.TeacherID == nil || *c.TeacherID != ownerUUID {
		t.Errorf("AC4 Branch A: teacherID MUST equal caller's userID (identity from TenantContext, NEVER by email lookup — closes Murat-M-S1). got %v", c.TeacherID)
	}
	if c.TeacherStatus != "assigned" {
		t.Errorf("AC4 Branch A: teacherStatus MUST be 'assigned', got %q", c.TeacherStatus)
	}
	if c.TeacherAssignmentReason != "explicit_self" {
		t.Errorf("AC4 Branch A: teacherAssignmentReason MUST be 'explicit_self', got %q", c.TeacherAssignmentReason)
	}
	if c.PendingTeacherEmail != nil {
		t.Errorf("AC4 Branch A: pendingTeacherEmail MUST be nil, got %q", *c.PendingTeacherEmail)
	}
	if len(inviter.Calls) != 0 {
		t.Errorf("AC4 Branch A: no invite email should be enqueued, got %d Enqueue calls", len(inviter.Calls))
	}
	if result.InvitesSent != 0 {
		t.Errorf("AC4 Branch A: invitesSent MUST be 0, got %d", result.InvitesSent)
	}
}

// -----------------------------------------------------------------------------
// AC4 Branch B — existing center member (non-caller)
// -----------------------------------------------------------------------------

func TestClassService_Spawn_AC04_BranchB_ExistingMemberAssigns(t *testing.T) {
	pool := test.SetupRawPool(t)
	owner := test.CreateUserOnPool(t, pool, "owner@example.com", "Owner")
	teacher := test.CreateUserOnPool(t, pool, "teacher@example.com", "Teacher")
	test.MarkUserEmailVerifiedOnPool(t, pool, owner.ID)

	centerID := test.CreateCenterForOwner(t, pool, owner.ID)
	test.AddCenterMember(t, pool, centerID, teacher.ID, "teacher")
	templateID := test.CreateClassTemplate(t, pool, centerID, "Test Template")
	t.Cleanup(func() {
		test.PurgeUserAndOwnedCenters(t, pool, owner.ID)
		test.PurgeUserAndOwnedCenters(t, pool, teacher.ID)
	})

	inviter := &MockInviteSender{Accepted: true}
	svc := service.NewClassService(pool, &realAuditLogger{inner: service.NewAuditService(pool)}, inviter, clock.RealClock{})
	tc := model.TenantContext{CenterID: test.UUIDString(centerID), UserID: test.UUIDString(owner.ID)}

	result, err := svc.Spawn(context.Background(), tc,
		test.MustParseUUID(t, test.UUIDString(owner.ID)),
		test.MustParseUUID(t, test.UUIDString(templateID)),
		service.SpawnInput{
			Classes: []service.SpawnClassInput{
				{CohortName: "B Cohort", StartDate: "2026-08-01", TeacherEmail: strPtr("teacher@example.com")},
			},
		})
	if err != nil {
		t.Fatalf("AC4 Branch B: spawn errored: %v", err)
	}
	c := result.Classes[0]
	teacherUUID := test.MustParseUUID(t, test.UUIDString(teacher.ID))
	if c.TeacherID == nil || *c.TeacherID != teacherUUID {
		t.Errorf("AC4 Branch B: teacherID MUST equal existing member's userID, got %v", c.TeacherID)
	}
	if c.TeacherStatus != "assigned" || c.TeacherAssignmentReason != "explicit_member" {
		t.Errorf("AC4 Branch B: want (assigned, explicit_member), got (%q, %q)", c.TeacherStatus, c.TeacherAssignmentReason)
	}
	if len(inviter.Calls) != 0 {
		t.Errorf("AC4 Branch B: no invite email should be enqueued, got %d", len(inviter.Calls))
	}
}

// -----------------------------------------------------------------------------
// AC4 Branch C — non-member creates invite
// -----------------------------------------------------------------------------

func TestClassService_Spawn_AC04_BranchC_NonMemberCreatesInvite(t *testing.T) {
	pool := test.SetupRawPool(t)
	owner := test.CreateUserOnPool(t, pool, "owner@example.com", "Owner")
	test.MarkUserEmailVerifiedOnPool(t, pool, owner.ID)
	centerID := test.CreateCenterForOwner(t, pool, owner.ID)
	templateID := test.CreateClassTemplate(t, pool, centerID, "Test Template")
	t.Cleanup(func() { test.PurgeUserAndOwnedCenters(t, pool, owner.ID) })

	inviter := &MockInviteSender{Accepted: true}
	svc := service.NewClassService(pool, &realAuditLogger{inner: service.NewAuditService(pool)}, inviter, clock.RealClock{})
	tc := model.TenantContext{CenterID: test.UUIDString(centerID), UserID: test.UUIDString(owner.ID)}

	result, err := svc.Spawn(context.Background(), tc,
		test.MustParseUUID(t, test.UUIDString(owner.ID)),
		test.MustParseUUID(t, test.UUIDString(templateID)),
		service.SpawnInput{
			Classes: []service.SpawnClassInput{
				{CohortName: "C Cohort", StartDate: "2026-08-01", TeacherEmail: strPtr("stranger@example.com")},
			},
		})
	if err != nil {
		t.Fatalf("AC4 Branch C: spawn errored: %v", err)
	}
	c := result.Classes[0]
	if c.TeacherID != nil {
		t.Errorf("AC4 Branch C: teacherID MUST be nil (privacy — do NOT leak 'user exists'), got %v", *c.TeacherID)
	}
	if c.PendingTeacherEmail == nil || *c.PendingTeacherEmail != "stranger@example.com" {
		t.Errorf("AC4 Branch C: pendingTeacherEmail MUST equal normalized payload email, got %v", c.PendingTeacherEmail)
	}
	if c.TeacherStatus != "invited" || c.TeacherAssignmentReason != "invited" {
		t.Errorf("AC4 Branch C: want (invited, invited), got (%q, %q)", c.TeacherStatus, c.TeacherAssignmentReason)
	}
	if len(inviter.Calls) != 1 {
		t.Errorf("AC4 Branch C: exactly one invite Enqueue call expected, got %d", len(inviter.Calls))
	}
	if result.InvitesSent != 1 {
		t.Errorf("AC4 Branch C: invitesSent MUST be 1, got %d", result.InvitesSent)
	}
	// Response's invites[] array shape (AC3 fold).
	if len(result.Invites) != 1 {
		t.Fatalf("AC3 invites[]: want 1 entry, got %d", len(result.Invites))
	}
	inv := result.Invites[0]
	if inv.Email != "stranger@example.com" {
		t.Errorf("invites[0].email = %q, want lowercased payload email", inv.Email)
	}
	if inv.Enqueued != true {
		t.Errorf("invites[0].enqueued = %v, want true (MockInviteSender.Accepted=true)", inv.Enqueued)
	}
	if inv.ReusedExistingInvite {
		t.Errorf("invites[0].reusedExistingInvite = true, want false (fresh row)")
	}
}

// -----------------------------------------------------------------------------
// AC4 Branch D — null teacherEmail → unassigned (non-founder persona)
// -----------------------------------------------------------------------------

func TestClassService_Spawn_AC04_BranchD_NullEmailNonFounderIsUnassigned(t *testing.T) {
	pool := test.SetupRawPool(t)
	owner := test.CreateUserOnPool(t, pool, "op@example.com", "Op")
	test.MarkUserEmailVerifiedOnPool(t, pool, owner.ID)
	test.SetUserPersonaOnPool(t, pool, owner.ID, "operator") // NOT founder
	centerID := test.CreateCenterForOwner(t, pool, owner.ID)
	templateID := test.CreateClassTemplate(t, pool, centerID, "T")
	t.Cleanup(func() { test.PurgeUserAndOwnedCenters(t, pool, owner.ID) })

	inviter := &MockInviteSender{Accepted: true}
	svc := service.NewClassService(pool, &realAuditLogger{inner: service.NewAuditService(pool)}, inviter, clock.RealClock{})
	tc := model.TenantContext{CenterID: test.UUIDString(centerID), UserID: test.UUIDString(owner.ID)}

	result, _ := svc.Spawn(context.Background(), tc,
		test.MustParseUUID(t, test.UUIDString(owner.ID)),
		test.MustParseUUID(t, test.UUIDString(templateID)),
		service.SpawnInput{
			Classes: []service.SpawnClassInput{
				{CohortName: "D Cohort", StartDate: "2026-08-01", TeacherEmail: nil},
			},
		})
	c := result.Classes[0]
	if c.TeacherID != nil || c.PendingTeacherEmail != nil {
		t.Errorf("AC4 Branch D non-founder: both teacher fields MUST be nil, got teacherID=%v pending=%v", c.TeacherID, c.PendingTeacherEmail)
	}
	if c.TeacherStatus != "unassigned" || c.TeacherAssignmentReason != "unassigned" {
		t.Errorf("AC4 Branch D: want (unassigned, unassigned), got (%q, %q)", c.TeacherStatus, c.TeacherAssignmentReason)
	}
	if len(inviter.Calls) != 0 {
		t.Errorf("AC4 Branch D: NO invite should be enqueued, got %d", len(inviter.Calls))
	}
}

// -----------------------------------------------------------------------------
// AC6 — Founder auto-assign on classes[0] (Sally-B1 fold)
// -----------------------------------------------------------------------------

func TestClassService_Spawn_AC06_FounderAutoAssignsFirstClass(t *testing.T) {
	pool := test.SetupRawPool(t)
	founder := test.CreateUserOnPool(t, pool, "founder@example.com", "Founder")
	test.MarkUserEmailVerifiedOnPool(t, pool, founder.ID)
	test.SetUserPersonaOnPool(t, pool, founder.ID, "founder")
	centerID := test.CreateCenterForOwner(t, pool, founder.ID)
	templateID := test.CreateClassTemplate(t, pool, centerID, "T")
	t.Cleanup(func() { test.PurgeUserAndOwnedCenters(t, pool, founder.ID) })

	inviter := &MockInviteSender{Accepted: true}
	svc := service.NewClassService(pool, &realAuditLogger{inner: service.NewAuditService(pool)}, inviter, clock.RealClock{})
	tc := model.TenantContext{CenterID: test.UUIDString(centerID), UserID: test.UUIDString(founder.ID)}
	founderUUID := test.MustParseUUID(t, test.UUIDString(founder.ID))

	result, err := svc.Spawn(context.Background(), tc, founderUUID,
		test.MustParseUUID(t, test.UUIDString(templateID)),
		service.SpawnInput{
			Classes: []service.SpawnClassInput{
				{CohortName: "First", StartDate: "2026-08-01", TeacherEmail: nil}, // ← should auto-assign
				{CohortName: "Second", StartDate: "2026-08-08", TeacherEmail: nil}, // ← should stay Branch D
			},
		})
	if err != nil {
		t.Fatalf("AC6: spawn errored: %v", err)
	}
	if result.Classes[0].TeacherID == nil || *result.Classes[0].TeacherID != founderUUID {
		t.Errorf("AC6: classes[0].teacherID MUST equal founder.userID (server-side FR-4 enforcement), got %v", result.Classes[0].TeacherID)
	}
	if result.Classes[0].TeacherAssignmentReason != "founder_auto" {
		t.Errorf("AC6: classes[0].teacherAssignmentReason MUST be 'founder_auto', got %q", result.Classes[0].TeacherAssignmentReason)
	}
	if result.Classes[1].TeacherID != nil || result.Classes[1].TeacherStatus != "unassigned" {
		t.Errorf("AC6: classes[1] MUST stay unassigned (only [0] auto-assigns), got teacherID=%v status=%q", result.Classes[1].TeacherID, result.Classes[1].TeacherStatus)
	}
}

// -----------------------------------------------------------------------------
// AC4b — Self-invite blocked (Sally-B4 belt against normalization drift)
// -----------------------------------------------------------------------------

func TestClassService_Spawn_AC04b_SelfInviteBlocked(t *testing.T) {
	// This test drives Sally-B4's belt-and-suspenders check. In practice
	// Branch A's normalization should catch case/whitespace variants of the
	// caller's own email — so this test protects against a REGRESSION where
	// a future normalization bug lets an owner-typed variant slip through
	// to Branch C. Guard: caller can never invite themselves; server MUST
	// return 422 SELF_INVITE_BLOCKED with strong wording.
	pool := test.SetupRawPool(t)
	owner := test.CreateUserOnPool(t, pool, "user@example.com", "User")
	test.MarkUserEmailVerifiedOnPool(t, pool, owner.ID)
	centerID := test.CreateCenterForOwner(t, pool, owner.ID)
	templateID := test.CreateClassTemplate(t, pool, centerID, "T")
	t.Cleanup(func() { test.PurgeUserAndOwnedCenters(t, pool, owner.ID) })

	// Green-phase implementation MUST normalize the payload symmetrically —
	// so this trailing-space variant should hit Branch A cleanly. The
	// SELF_INVITE_BLOCKED belt fires only if a regression breaks that
	// normalization. Locking both paths here would double-test Branch A;
	// instead the test asserts "one of two acceptable outcomes":
	//   - Branch A fires (correct symmetric normalize) → 200 + explicit_self
	//   - Branch A misses, belt catches it → error with SELF_INVITE_BLOCKED code
	// If neither happens (belt regressed away AND Branch A broke) the caller
	// ends up in Branch C = invites themselves = the exact bug Sally-B4
	// forbids. That's what this test guards.
	inviter := &MockInviteSender{Accepted: true}
	svc := service.NewClassService(pool, &realAuditLogger{inner: service.NewAuditService(pool)}, inviter, clock.RealClock{})
	tc := model.TenantContext{CenterID: test.UUIDString(centerID), UserID: test.UUIDString(owner.ID)}

	result, err := svc.Spawn(context.Background(), tc,
		test.MustParseUUID(t, test.UUIDString(owner.ID)),
		test.MustParseUUID(t, test.UUIDString(templateID)),
		service.SpawnInput{
			Classes: []service.SpawnClassInput{
				{CohortName: "SelfCohort", StartDate: "2026-08-01", TeacherEmail: strPtr("  USER@example.com  ")},
			},
		})

	if err != nil {
		var verr model.ValidationError
		if errors.As(err, &verr) {
			// Belt fired — assert the exact code so Story 2.3b's wizard router works.
			foundBelt := false
			for _, f := range verr.Fields {
				if f.Code == "SELF_INVITE_BLOCKED" {
					foundBelt = true
					break
				}
			}
			if !foundBelt {
				t.Errorf("AC4b: expected VALIDATION_ERROR field.code=SELF_INVITE_BLOCKED, got %#v", verr.Fields)
			}
			return
		}
		t.Fatalf("AC4b: unexpected error type %T: %v", err, err)
	}

	// No error → Branch A must have fired.
	if len(result.Classes) == 0 {
		t.Fatalf("AC4b: spawn returned zero classes with nil error")
	}
	ownerUUID := test.MustParseUUID(t, test.UUIDString(owner.ID))
	c := result.Classes[0]
	if c.TeacherID == nil || *c.TeacherID != ownerUUID {
		t.Errorf("AC4b: symmetric normalize should have hit Branch A — teacherID MUST equal owner. got %v", c.TeacherID)
	}
	// R2-P15 — this test's setup does NOT set persona=founder (see the
	// CreateUserOnPool call above — default persona), so founder_auto is
	// unreachable on this path. Tightening the assertion to require
	// explicit_self exclusively guards against a future regression where the
	// AC6 founder_auto branch fires on non-founder personas.
	if c.TeacherAssignmentReason != "explicit_self" {
		t.Errorf("AC4b: teacherAssignmentReason MUST be explicit_self (non-founder persona), got %q", c.TeacherAssignmentReason)
	}
	// If Branch A fired, no invite must have been sent to the owner.
	for _, call := range inviter.Calls {
		if strings.EqualFold(call.To, "user@example.com") {
			t.Errorf("AC4b Sally-B4: owner MUST never receive their own invite email — got Enqueue(to=%q)", call.To)
		}
	}
}

// -----------------------------------------------------------------------------
// AC5 — Invite dedup within one spawn payload
// -----------------------------------------------------------------------------

func TestClassService_Spawn_AC05_InviteDedupSameEmailAcrossClasses(t *testing.T) {
	pool := test.SetupRawPool(t)
	owner := test.CreateUserOnPool(t, pool, "owner@example.com", "Owner")
	test.MarkUserEmailVerifiedOnPool(t, pool, owner.ID)
	centerID := test.CreateCenterForOwner(t, pool, owner.ID)
	templateID := test.CreateClassTemplate(t, pool, centerID, "T")
	t.Cleanup(func() { test.PurgeUserAndOwnedCenters(t, pool, owner.ID) })

	inviter := &MockInviteSender{Accepted: true}
	svc := service.NewClassService(pool, &realAuditLogger{inner: service.NewAuditService(pool)}, inviter, clock.RealClock{})
	tc := model.TenantContext{CenterID: test.UUIDString(centerID), UserID: test.UUIDString(owner.ID)}

	result, err := svc.Spawn(context.Background(), tc,
		test.MustParseUUID(t, test.UUIDString(owner.ID)),
		test.MustParseUUID(t, test.UUIDString(templateID)),
		service.SpawnInput{
			Classes: []service.SpawnClassInput{
				{CohortName: "Class 1", StartDate: "2026-08-01", TeacherEmail: strPtr("shared@example.com")},
				{CohortName: "Class 2", StartDate: "2026-08-08", TeacherEmail: strPtr("SHARED@example.com")}, // case variant
				{CohortName: "Class 3", StartDate: "2026-08-15", TeacherEmail: strPtr("other@example.com")},
			},
		})
	if err != nil {
		t.Fatalf("AC5: spawn errored: %v", err)
	}

	// TWO unique invite buckets — "shared@example.com" is deduped across
	// classes 1 + 2; "other@example.com" is its own row.
	if len(result.Invites) != 2 {
		t.Errorf("AC5: want 2 unique invite buckets, got %d", len(result.Invites))
	}
	if result.InvitesSent != 2 {
		t.Errorf("AC5: invitesSent (newly-created + enqueued) MUST be 2, got %d", result.InvitesSent)
	}
	// Verify DB-side: exactly 2 active invite rows for this center.
	sp := test.SuperuserPool(t)
	activeCount := test.CountRows(t, sp,
		`SELECT count(*) FROM invites WHERE center_id = $1 AND accepted_at IS NULL`,
		test.MustParseUUID(t, test.UUIDString(centerID)))
	if activeCount != 2 {
		t.Errorf("AC5 dedup at DB: want 2 active invite rows, got %d", activeCount)
	}
	// Verify classIndices grouping surfaces both class positions for the shared invite.
	foundShared := false
	for _, inv := range result.Invites {
		if inv.Email == "shared@example.com" {
			foundShared = true
			if len(inv.ClassIndices) != 2 {
				t.Errorf("AC3 invites[].classIndices: shared email should reference 2 classes, got %v", inv.ClassIndices)
			}
		}
	}
	if !foundShared {
		t.Errorf("AC5: shared@example.com bucket missing from response.invites[]")
	}
}

// -----------------------------------------------------------------------------
// AC5 — race-safe retry-and-reuse when a prior active invite already exists
// -----------------------------------------------------------------------------

func TestClassService_Spawn_AC05_RaceRetryReusesExistingInvite(t *testing.T) {
	pool := test.SetupRawPool(t)
	owner := test.CreateUserOnPool(t, pool, "owner@example.com", "Owner")
	test.MarkUserEmailVerifiedOnPool(t, pool, owner.ID)
	centerID := test.CreateCenterForOwner(t, pool, owner.ID)
	templateID := test.CreateClassTemplate(t, pool, centerID, "T")
	t.Cleanup(func() { test.PurgeUserAndOwnedCenters(t, pool, owner.ID) })

	// Pre-seed an active invite for the target email (simulates a prior spawn
	// that already invited this teacher, or a concurrent spawn racing this one).
	test.SeedActiveInvite(t, pool, centerID, "raced@example.com", owner.ID)

	inviter := &MockInviteSender{Accepted: true}
	svc := service.NewClassService(pool, &realAuditLogger{inner: service.NewAuditService(pool)}, inviter, clock.RealClock{})
	tc := model.TenantContext{CenterID: test.UUIDString(centerID), UserID: test.UUIDString(owner.ID)}

	result, err := svc.Spawn(context.Background(), tc,
		test.MustParseUUID(t, test.UUIDString(owner.ID)),
		test.MustParseUUID(t, test.UUIDString(templateID)),
		service.SpawnInput{
			Classes: []service.SpawnClassInput{
				{CohortName: "Racy", StartDate: "2026-08-01", TeacherEmail: strPtr("raced@example.com")},
			},
		})
	if err != nil {
		t.Fatalf("AC5 race: spawn errored: %v", err)
	}
	inv := result.Invites[0]
	if !inv.ReusedExistingInvite {
		t.Errorf("AC5 race: reusedExistingInvite MUST be true (belt-and-suspenders — DB unique index caught the collision), got false")
	}
	if inv.Enqueued {
		t.Errorf("AC5 race: enqueued MUST be false when reusing (no duplicate email sent), got true")
	}
	if result.InvitesSent != 0 {
		t.Errorf("AC5 race: invitesSent counts only NEWLY-CREATED rows, want 0, got %d", result.InvitesSent)
	}
	sp := test.SuperuserPool(t)
	activeCount := test.CountRows(t, sp,
		`SELECT count(*) FROM invites WHERE center_id = $1 AND LOWER(email) = 'raced@example.com' AND accepted_at IS NULL`,
		test.MustParseUUID(t, test.UUIDString(centerID)))
	if activeCount != 1 {
		t.Errorf("AC5 race: partial unique index MUST keep exactly one active invite, got %d", activeCount)
	}
}

// -----------------------------------------------------------------------------
// AC9 + AC12 audit atomicity — brokenAuditLogger rolls back N classes + invites
// -----------------------------------------------------------------------------

func TestClassService_Spawn_AC09_BrokenAuditRollsBackWholeTx(t *testing.T) {
	pool := test.SetupRawPool(t)
	owner := test.CreateUserOnPool(t, pool, "owner@example.com", "Owner")
	test.MarkUserEmailVerifiedOnPool(t, pool, owner.ID)
	centerID := test.CreateCenterForOwner(t, pool, owner.ID)
	templateID := test.CreateClassTemplate(t, pool, centerID, "T")
	t.Cleanup(func() { test.PurgeUserAndOwnedCenters(t, pool, owner.ID) })

	broken := &brokenAuditLogger{err: errors.New("simulated audit failure")}
	inviter := &MockInviteSender{Accepted: true}
	svc := service.NewClassService(pool, broken, inviter, clock.RealClock{})
	tc := model.TenantContext{CenterID: test.UUIDString(centerID), UserID: test.UUIDString(owner.ID)}

	_, err := svc.Spawn(context.Background(), tc,
		test.MustParseUUID(t, test.UUIDString(owner.ID)),
		test.MustParseUUID(t, test.UUIDString(templateID)),
		service.SpawnInput{
			Classes: []service.SpawnClassInput{
				{CohortName: "A", StartDate: "2026-08-01", TeacherEmail: strPtr("t1@example.com")},
				{CohortName: "B", StartDate: "2026-08-08", TeacherEmail: strPtr("t2@example.com")},
				{CohortName: "C", StartDate: "2026-08-15", TeacherEmail: strPtr("t3@example.com")},
			},
		})
	if err == nil {
		t.Fatalf("AC9: spawn with broken audit MUST error, got nil")
	}

	sp := test.SuperuserPool(t)
	nClasses := test.CountRows(t, sp,
		`SELECT count(*) FROM classes WHERE center_id = $1`,
		test.MustParseUUID(t, test.UUIDString(centerID)))
	if nClasses != 0 {
		t.Errorf("AC9 tx atomicity: %d classes rows survived failed audit — spawn is not all-or-nothing", nClasses)
	}
	nInvites := test.CountRows(t, sp,
		`SELECT count(*) FROM invites WHERE center_id = $1`,
		test.MustParseUUID(t, test.UUIDString(centerID)))
	if nInvites != 0 {
		t.Errorf("AC9 tx atomicity: %d invites rows survived failed audit — invite writes MUST roll back with classes", nInvites)
	}
	// Reframe 3: since tx rolled back, NO email should have been enqueued
	// (enqueue happens AFTER commit — commit never happened).
	if len(inviter.Calls) != 0 {
		t.Errorf("Reframe 3: no email should be enqueued when tx rolls back, got %d Enqueue calls", len(inviter.Calls))
	}
}

// -----------------------------------------------------------------------------
// Murat-M-S3 — invite enqueue buffer full is best-effort, not an error
// -----------------------------------------------------------------------------

func TestClassService_Spawn_InviteEnqueueBufferFullSucceedsBestEffort(t *testing.T) {
	pool := test.SetupRawPool(t)
	owner := test.CreateUserOnPool(t, pool, "owner@example.com", "Owner")
	test.MarkUserEmailVerifiedOnPool(t, pool, owner.ID)
	centerID := test.CreateCenterForOwner(t, pool, owner.ID)
	templateID := test.CreateClassTemplate(t, pool, centerID, "T")
	t.Cleanup(func() { test.PurgeUserAndOwnedCenters(t, pool, owner.ID) })

	inviter := &MockInviteSender{Accepted: false} // ← buffer full
	svc := service.NewClassService(pool, &realAuditLogger{inner: service.NewAuditService(pool)}, inviter, clock.RealClock{})
	tc := model.TenantContext{CenterID: test.UUIDString(centerID), UserID: test.UUIDString(owner.ID)}

	result, err := svc.Spawn(context.Background(), tc,
		test.MustParseUUID(t, test.UUIDString(owner.ID)),
		test.MustParseUUID(t, test.UUIDString(templateID)),
		service.SpawnInput{
			Classes: []service.SpawnClassInput{
				{CohortName: "Cohort", StartDate: "2026-08-01", TeacherEmail: strPtr("pending@example.com")},
			},
		})
	if err != nil {
		t.Fatalf("Murat-M-S3: buffer-full MUST NOT propagate — got %v", err)
	}
	// Class + invite ROW must have committed (durable state).
	sp := test.SuperuserPool(t)
	nClasses := test.CountRows(t, sp,
		`SELECT count(*) FROM classes WHERE center_id = $1`,
		test.MustParseUUID(t, test.UUIDString(centerID)))
	if nClasses != 1 {
		t.Errorf("Reframe 3: 1 class row expected, got %d — invite ROW is durable state independent of email delivery", nClasses)
	}
	nInvites := test.CountRows(t, sp,
		`SELECT count(*) FROM invites WHERE center_id = $1`,
		test.MustParseUUID(t, test.UUIDString(centerID)))
	if nInvites != 1 {
		t.Errorf("Reframe 3: 1 invite row expected, got %d", nInvites)
	}
	// Response MUST truthfully surface enqueued=false so wizard tells the truth.
	if len(result.Invites) != 1 {
		t.Fatalf("want 1 invite entry in response, got %d", len(result.Invites))
	}
	if result.Invites[0].Enqueued {
		t.Errorf("Sally-B2 fold: invites[0].enqueued MUST be false when EmailRetryQueue buffer is full — otherwise the wizard lies about delivery")
	}
	if result.InvitesSent != 0 {
		t.Errorf("invitesSent counts (newly-created && enqueued), want 0, got %d", result.InvitesSent)
	}
}

// -----------------------------------------------------------------------------
// Murat-M-B3 — post-accept re-invite lands in Branch B, not Branch C
// -----------------------------------------------------------------------------

func TestClassService_Spawn_PostAcceptReInviteLandsInBranchB(t *testing.T) {
	pool := test.SetupRawPool(t)
	owner := test.CreateUserOnPool(t, pool, "owner@example.com", "Owner")
	teacher := test.CreateUserOnPool(t, pool, "teacher@example.com", "Teacher")
	test.MarkUserEmailVerifiedOnPool(t, pool, owner.ID)
	centerID := test.CreateCenterForOwner(t, pool, owner.ID)
	// Simulate the aftermath of a prior accepted invite: teacher is now a
	// center_members row for this center, AND an accepted invites row lingers
	// (accepted_at IS NOT NULL — outside the partial-unique-index window).
	test.AddCenterMember(t, pool, centerID, teacher.ID, "teacher")
	test.SeedAcceptedInvite(t, pool, centerID, "teacher@example.com", owner.ID, teacher.ID)
	templateID := test.CreateClassTemplate(t, pool, centerID, "T")
	t.Cleanup(func() {
		test.PurgeUserAndOwnedCenters(t, pool, owner.ID)
		test.PurgeUserAndOwnedCenters(t, pool, teacher.ID)
	})

	inviter := &MockInviteSender{Accepted: true}
	svc := service.NewClassService(pool, &realAuditLogger{inner: service.NewAuditService(pool)}, inviter, clock.RealClock{})
	tc := model.TenantContext{CenterID: test.UUIDString(centerID), UserID: test.UUIDString(owner.ID)}
	teacherUUID := test.MustParseUUID(t, test.UUIDString(teacher.ID))

	result, err := svc.Spawn(context.Background(), tc,
		test.MustParseUUID(t, test.UUIDString(owner.ID)),
		test.MustParseUUID(t, test.UUIDString(templateID)),
		service.SpawnInput{
			Classes: []service.SpawnClassInput{
				{CohortName: "Post-Accept Cohort", StartDate: "2026-08-01", TeacherEmail: strPtr("teacher@example.com")},
			},
		})
	if err != nil {
		t.Fatalf("Murat-M-B3: spawn errored: %v", err)
	}
	c := result.Classes[0]
	if c.TeacherID == nil || *c.TeacherID != teacherUUID {
		t.Errorf("Murat-M-B3: post-accept caller MUST land in Branch B (existing member) — teacherID = teacher.userID. got %v", c.TeacherID)
	}
	if c.TeacherAssignmentReason != "explicit_member" {
		t.Errorf("Murat-M-B3: teacherAssignmentReason MUST be 'explicit_member', got %q — checking center_members BEFORE the invites table is the primary defense", c.TeacherAssignmentReason)
	}
	if result.InvitesSent != 0 || len(inviter.Calls) != 0 {
		t.Errorf("Murat-M-B3: NO new invite for an already-accepted member. got invitesSent=%d Enqueue=%d", result.InvitesSent, len(inviter.Calls))
	}
}

// -----------------------------------------------------------------------------
// AC3 — 404 TEMPLATE_NOT_FOUND when template belongs to another tenant
// (Winston-W-S5 fold — template read is INSIDE tx after SET LOCAL)
// -----------------------------------------------------------------------------

func TestClassService_Spawn_TemplateFromOtherTenantReturns404(t *testing.T) {
	pool := test.SetupRawPool(t)
	owner := test.CreateUserOnPool(t, pool, "owner@example.com", "Owner")
	other := test.CreateUserOnPool(t, pool, "other@example.com", "Other")
	test.MarkUserEmailVerifiedOnPool(t, pool, owner.ID)
	test.MarkUserEmailVerifiedOnPool(t, pool, other.ID)
	ownerCenter := test.CreateCenterForOwner(t, pool, owner.ID)
	otherCenter := test.CreateCenterForOwner(t, pool, other.ID)
	otherTemplateID := test.CreateClassTemplate(t, pool, otherCenter, "Other's Template")
	t.Cleanup(func() {
		test.PurgeUserAndOwnedCenters(t, pool, owner.ID)
		test.PurgeUserAndOwnedCenters(t, pool, other.ID)
	})

	inviter := &MockInviteSender{Accepted: true}
	svc := service.NewClassService(pool, &realAuditLogger{inner: service.NewAuditService(pool)}, inviter, clock.RealClock{})
	tc := model.TenantContext{CenterID: test.UUIDString(ownerCenter), UserID: test.UUIDString(owner.ID)}

	_, err := svc.Spawn(context.Background(), tc,
		test.MustParseUUID(t, test.UUIDString(owner.ID)),
		test.MustParseUUID(t, test.UUIDString(otherTemplateID)),
		service.SpawnInput{
			Classes: []service.SpawnClassInput{
				{CohortName: "X", StartDate: "2026-08-01", TeacherEmail: nil},
			},
		})
	if err == nil {
		t.Fatalf("expected NotFoundError, got nil (RLS should render other tenant's template invisible)")
	}
	var nfErr model.NotFoundError
	if !errors.As(err, &nfErr) {
		t.Errorf("want model.NotFoundError, got %T: %v", err, err)
	}
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

func strPtr(s string) *string { return &s }
