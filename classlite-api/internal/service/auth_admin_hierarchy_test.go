// Story 2.6 (AC9) service-layer hierarchy matrix for AdminInviteStaff.
//
// Rows:
//   1. Owner  → Teacher  (success + invite row + audit)
//   2. Owner  → Owner    (success + invite row + audit — FR-11 permits)
//   3. Admin  → Teacher  (success + invite row + audit)
//   4. Admin  → Admin    (success + invite row + audit)
//   5. Admin  → Owner    (RoleAssignmentForbiddenError + no invite row +
//                         center.invite.role_assignment_blocked audit)
//   6. SEC-1 defense: JWT role="owner" but DB role="teacher" — covered by
//                     the shipped role_revalidation_atdd_test.go pair
//                     (Demoted + Revoked). Story 2.6 owns R15 discharge
//                     via that shipped coverage; this file extends the
//                     matrix with the FR-11 rows the shipped file
//                     doesn't reach.
//   7. Duplicate active invite (unexpired + unaccepted) → *InviteEmailTakenError
//      (belt for the AC8 dup gate — the handler test in
//      invites_handler_atdd_test.go asserts the wire envelope shape).
//
// Pragmatic deviation from AC9's "mocked store per TEST-BE-4" wording:
// AuthService is not constructed against a store interface today — it
// takes a raw pool. Shipped SEC-1 tests (role_revalidation_atdd_test.go)
// use real DB via test.SetupDB and matched-shape audit assertions. This
// file follows the shipped convention. Refactoring AuthService to be
// store-interface-driven for one test is out of scope for Story 2.6 —
// it would touch every AuthService callsite in cmd/api/main.go. If TEST-BE-4
// discipline is later applied uniformly across auth services, this file
// becomes the first migration site (single source of truth for the AC9
// matrix).
package service_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/ducdo/classlite-api/internal/test"
)

// hierarchyCase describes one row of the AC9 service matrix.
type hierarchyCase struct {
	name        string
	callerRole  string
	targetRole  string
	wantInvite  bool                             // did the row land?
	wantErrType func(err error, t *testing.T)    // typed error assertion (nil for success)
	auditEvent  string                           // expected audit event name (empty for none)
}

func TestAdminInviteStaff_AC9_HierarchyMatrix(t *testing.T) {
	// Row 1 + Row 3 look identical on the wire ("Admin/Owner → Teacher succeeds"),
	// but each exercises a different DB-role branch inside the service. Keep
	// them as separate rows so a regression in one caller path (e.g. Admin
	// slips into the SEC-1 rejection arm) surfaces distinctly.
	cases := []hierarchyCase{
		{
			name:       "owner_invites_teacher",
			callerRole: "owner",
			targetRole: "teacher",
			wantInvite: true,
			auditEvent: "center.invite.sent",
		},
		{
			name:       "owner_invites_owner",
			callerRole: "owner",
			targetRole: "owner",
			wantInvite: true,
			auditEvent: "center.invite.sent",
		},
		{
			name:       "admin_invites_teacher",
			callerRole: "admin",
			targetRole: "teacher",
			wantInvite: true,
			auditEvent: "center.invite.sent",
		},
		{
			name:       "admin_invites_admin",
			callerRole: "admin",
			targetRole: "admin",
			wantInvite: true,
			auditEvent: "center.invite.sent",
		},
		{
			name:       "admin_invites_owner_BLOCKED",
			callerRole: "admin",
			targetRole: "owner",
			wantInvite: false,
			wantErrType: func(err error, t *testing.T) {
				var forbidden *service.RoleAssignmentForbiddenError
				if !errors.As(err, &forbidden) {
					t.Fatalf("expected *RoleAssignmentForbiddenError, got %T (%v)", err, err)
				}
			},
			auditEvent: "center.invite.role_assignment_blocked",
		},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			db := test.SetupDB(t)
			mc := clock.NewMockClock(time.Date(2026, 7, 17, 12, 0, 0, 0, time.UTC))
			svc := newAuthServiceWithClock(t, db, mc)

			center := test.CreateCenterWithID(t, db, test.TenantAID, "Tenant A", "TENA")
			caller := test.CreateUser(t, db, "caller-"+tc.name+"@example.com", "Caller "+tc.name)
			_ = test.TenantContext(t, db, center.ID)
			_ = test.CreateCenterMember(t, db, caller.ID, center.ID, tc.callerRole)

			ctxJWT := model.TenantContext{
				CenterID: test.TenantAID,
				UserID:   test.UUIDString(caller.ID),
				Role:     tc.callerRole,
			}

			inviteEmail := "target-" + tc.name + "@example.com"
			result, err := svc.AdminInviteStaff(context.Background(), ctxJWT, inviteEmail, tc.targetRole)

			if tc.wantErrType != nil {
				tc.wantErrType(err, t)
			} else if err != nil {
				t.Fatalf("expected success, got %v", err)
			}

			var inviteCount int
			_ = db.QueryRow(context.Background(),
				`SELECT COUNT(*) FROM invites WHERE center_id = $1 AND email = $2`,
				center.ID, inviteEmail,
			).Scan(&inviteCount)
			if tc.wantInvite && inviteCount != 1 {
				t.Errorf("expected 1 invite row, got %d", inviteCount)
			}
			if !tc.wantInvite && inviteCount != 0 {
				t.Errorf("expected 0 invite rows, got %d", inviteCount)
			}
			if tc.wantInvite {
				if result == nil {
					t.Fatal("expected non-nil InviteResult on success")
				}
				if result.Role != tc.targetRole {
					t.Errorf("InviteResult.Role = %q, want %q", result.Role, tc.targetRole)
				}
				if result.Email != inviteEmail {
					t.Errorf("InviteResult.Email = %q, want %q", result.Email, inviteEmail)
				}
				if result.ExpiresAt.Before(mc.Now()) {
					t.Errorf("InviteResult.ExpiresAt %s in the past", result.ExpiresAt)
				}
			}

			if tc.auditEvent != "" {
				var auditRows int
				_ = db.QueryRow(context.Background(),
					`SELECT COUNT(*) FROM auth_audit_logs WHERE event = $1 AND user_id = $2`,
					tc.auditEvent, caller.ID,
				).Scan(&auditRows)
				if auditRows != 1 {
					t.Errorf("expected 1 %s audit row, got %d", tc.auditEvent, auditRows)
				}
			}
		})
	}
}

// TestAdminInviteStaff_AC8_DuplicateActiveInvite covers the AC8 duplicate
// gate — the same (center_id, email) pair with an unexpired+unaccepted
// row returns *InviteEmailTakenError. Belt-and-suspenders alongside the
// handler-layer envelope test in invites_handler_atdd_test.go.
func TestAdminInviteStaff_AC8_DuplicateActiveInvite(t *testing.T) {
	db := test.SetupDB(t)
	mc := clock.NewMockClock(time.Date(2026, 7, 17, 12, 0, 0, 0, time.UTC))
	svc := newAuthServiceWithClock(t, db, mc)

	center := test.CreateCenterWithID(t, db, test.TenantAID, "Tenant A", "TENA")
	owner := test.CreateUser(t, db, "dup-owner@example.com", "Dup Owner")
	_ = test.TenantContext(t, db, center.ID)
	_ = test.CreateCenterMember(t, db, owner.ID, center.ID, "owner")

	tc := model.TenantContext{
		CenterID: test.TenantAID,
		UserID:   test.UUIDString(owner.ID),
		Role:     "owner",
	}

	if _, err := svc.AdminInviteStaff(context.Background(), tc, "dup-target@example.com", "teacher"); err != nil {
		t.Fatalf("first invite: %v", err)
	}
	_, err := svc.AdminInviteStaff(context.Background(), tc, "dup-target@example.com", "teacher")
	var taken *service.InviteEmailTakenError
	if !errors.As(err, &taken) {
		t.Fatalf("second invite: expected *InviteEmailTakenError, got %T (%v)", err, err)
	}
	if taken.Email != "dup-target@example.com" {
		t.Errorf("Email = %q, want dup-target@example.com", taken.Email)
	}

	// Case-insensitive dedup: `Dup-Target@ExAmPle.com` collides too.
	_, err = svc.AdminInviteStaff(context.Background(), tc, "Dup-Target@ExAmPle.com", "teacher")
	if !errors.As(err, &taken) {
		t.Fatalf("case-variant invite: expected *InviteEmailTakenError, got %T (%v)", err, err)
	}
}

// TestAdminInviteStaff_AC8_StudentRoleRejected covers the wire-schema
// contract (api.yaml InviteStaffRequest.role enum = [owner,admin,teacher])
// at the service layer so a future caller that bypasses the OpenAPI-derived
// validator still hits 422.
func TestAdminInviteStaff_AC8_StudentRoleRejected(t *testing.T) {
	db := test.SetupDB(t)
	mc := clock.NewMockClock(time.Date(2026, 7, 17, 12, 0, 0, 0, time.UTC))
	svc := newAuthServiceWithClock(t, db, mc)

	center := test.CreateCenterWithID(t, db, test.TenantAID, "Tenant A", "TENA")
	owner := test.CreateUser(t, db, "reject-owner@example.com", "Reject Owner")
	_ = test.TenantContext(t, db, center.ID)
	_ = test.CreateCenterMember(t, db, owner.ID, center.ID, "owner")

	tc := model.TenantContext{
		CenterID: test.TenantAID,
		UserID:   test.UUIDString(owner.ID),
		Role:     "owner",
	}
	_, err := svc.AdminInviteStaff(context.Background(), tc, "student-target@example.com", "student")
	var val model.ValidationError
	if !errors.As(err, &val) {
		t.Fatalf("expected model.ValidationError, got %T (%v)", err, err)
	}
	if len(val.Fields) == 0 || val.Fields[0].Field != "role" {
		t.Errorf("expected role field error, got %+v", val.Fields)
	}
}
