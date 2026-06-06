// role_revalidation_test_atdd.go — Story 1.5 ATDD red-phase scaffolds.
//
// ACCEPTANCE CRITERIA COVERED
//   AC-1.5-13  Service-layer mutations re-fetch user role from DB and
//              never trust the JWT role claim alone (R15 / SEC-1)
//
// PATTERN: pick any mutating service method (the project doesn't have
// many yet — Story 1.4 RegisterUser doesn't gate on role). When Epic 7
// lands the enrollment service, the canonical test moves there. For
// Story 1.5 we use a synthetic guarded operation on AuthService that
// the impl will provide: AuthService.AdminInviteStaff (Owner-only).
//
// The TEST asserts: even with a valid JWT carrying role=owner, if the
// DB role for that (user_id, center_id) pair is revoked OR demoted,
// the mutation returns ForbiddenError.

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

// TestServiceMutation_AC13_DemotedUser_RejectedDespiteValidJWT proves
// that a JWT claim is not sufficient — the service must re-check the
// current center_members row before performing the mutation.
func TestServiceMutation_AC13_DemotedUser_RejectedDespiteValidJWT(t *testing.T) {
	db := test.SetupDB(t)
	mockClock := clock.NewMockClock(time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC))

	center := test.CreateCenterWithID(t, db, test.TenantAID, "Tenant A", "TENA")
	owner := test.CreateUser(t, db, "owner@example.com", "Owner")
	_ = test.TenantContext(t, db, center.ID)
	_ = test.CreateCenterMember(t, db, owner.ID, center.ID, "owner")

	svc := newAuthServiceWithClock(t, db, mockClock)

	// TenantContext claims role=owner — would-be-valid if JWT were trusted alone.
	tc := model.TenantContext{
		CenterID: test.TenantAID,
		UserID:   uuidToString(owner.ID),
		Role:     "owner",
	}

	// Sanity: the mutation succeeds while the user really is Owner.
	if err := svc.AdminInviteStaff(context.Background(), tc, "newteacher@example.com", "teacher"); err != nil {
		t.Fatalf("pre-demotion AdminInviteStaff: expected success, got %v", err)
	}

	// Demote the user in the DB while keeping the JWT role=owner.
	if _, err := db.Exec(context.Background(),
		`UPDATE center_members SET role = 'teacher' WHERE user_id = $1 AND center_id = $2`,
		owner.ID, center.ID,
	); err != nil {
		t.Fatalf("demote owner in DB: %v", err)
	}

	// Same call, same JWT claim — but DB now says teacher. Service must reject.
	err := svc.AdminInviteStaff(context.Background(), tc, "another@example.com", "teacher")
	var forbiddenErr *service.ForbiddenError
	if !errors.As(err, &forbiddenErr) {
		t.Fatalf("post-demotion AdminInviteStaff: expected ForbiddenError (role re-val from DB), got %T (%v). "+
			"This means the service trusted the JWT claim instead of re-fetching role from center_members.", err, err)
	}
}

// TestServiceMutation_AC13_RevokedMember_RejectedDespiteValidJWT covers
// the harder case: not just demotion but full membership revocation
// (center_members.status='revoked' or row deleted).
func TestServiceMutation_AC13_RevokedMember_RejectedDespiteValidJWT(t *testing.T) {
	db := test.SetupDB(t)
	mockClock := clock.NewMockClock(time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC))

	center := test.CreateCenterWithID(t, db, test.TenantAID, "Tenant A", "TENA")
	owner := test.CreateUser(t, db, "owner@example.com", "Owner")
	_ = test.TenantContext(t, db, center.ID)
	_ = test.CreateCenterMember(t, db, owner.ID, center.ID, "owner")

	svc := newAuthServiceWithClock(t, db, mockClock)

	tc := model.TenantContext{
		CenterID: test.TenantAID,
		UserID:   uuidToString(owner.ID),
		Role:     "owner",
	}

	// Revoke the member.
	if _, err := db.Exec(context.Background(),
		`DELETE FROM center_members WHERE user_id = $1 AND center_id = $2`,
		owner.ID, center.ID,
	); err != nil {
		t.Fatalf("revoke owner in DB: %v", err)
	}

	err := svc.AdminInviteStaff(context.Background(), tc, "another@example.com", "teacher")
	var forbiddenErr *service.ForbiddenError
	if !errors.As(err, &forbiddenErr) {
		t.Fatalf("revoked-member call: expected ForbiddenError, got %T (%v). "+
			"This means the service trusted the JWT claim instead of re-fetching the active center_members row.", err, err)
	}
}

// uuidToString is a tiny helper because pgtype.UUID needs a tiny dance
// to render as a canonical string. The real impl will probably expose a
// String() helper on model.TenantContext factory; for now do it inline.
func uuidToString(u interface{ MarshalJSON() ([]byte, error) }) string {
	b, _ := u.MarshalJSON()
	if len(b) >= 2 {
		return string(b[1 : len(b)-1])
	}
	return ""
}
