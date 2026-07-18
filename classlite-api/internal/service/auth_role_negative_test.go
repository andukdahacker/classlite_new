// Story 1.5 role-negative coverage (TA pass).
//
// AC13's canonical role-revalidation gate (AdminInviteStaff) is exercised
// by ATDD for "demoted owner" and "revoked member". This file expands the
// negative matrix so every non-owner role (teacher, student, fabricated)
// AND every malformed-TenantContext shape is rejected the same way —
// pointer ForbiddenError — and that the rejection audit is consistent.
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

// nonOwnerRoles enumerates every non-Owner+non-Admin role that is DB-legal.
//
// Story 2.6 (AC1) added a CHECK constraint restricting center_members.role
// to {owner, admin, teacher, student} — fabricated values like `viewer`
// can no longer be persisted, so the "defense in depth against a
// synthetic role" case is now guarded by the DB itself (SQLSTATE 23514
// on INSERT) and needs no service-layer test row.
//
// Story 2.6 also widened AdminInviteStaff's DB-role allowlist to
// {owner, admin} — Admin callers are now permitted to invite non-Owner
// roles — so `admin` moves OUT of this list and into a dedicated
// success-path test (see the AC9 hierarchy matrix in auth_admin_test.go).
var nonOwnerRoles = []string{"teacher", "student"}

func TestAdminInviteStaff_AC13_NonOwnerRoles_Rejected(t *testing.T) {
	for _, role := range nonOwnerRoles {
		t.Run(role, func(t *testing.T) {
			db := test.SetupDB(t)
			mc := clock.NewMockClock(time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC))

			center := test.CreateCenterWithID(t, db, test.TenantAID, "Tenant A", "TENA")
			user := test.CreateUser(t, db, role+"@example.com", "Role "+role)
			_ = test.TenantContext(t, db, center.ID)
			_ = test.CreateCenterMember(t, db, user.ID, center.ID, role)

			svc := newAuthServiceWithClock(t, db, mc)
			tc := model.TenantContext{
				CenterID: test.TenantAID,
				UserID:   test.UUIDString(user.ID),
				Role:     "owner", // JWT lies — DB is the truth
			}

			_, err := svc.AdminInviteStaff(context.Background(), tc, "invitee@example.com", "teacher")
			var fe *service.ForbiddenError
			if !errors.As(err, &fe) {
				t.Fatalf("role=%s: expected ForbiddenError, got %T (%v)", role, err, err)
			}
			if fe.Reason != "insufficient role" {
				t.Errorf("role=%s: reason = %q, want insufficient role", role, fe.Reason)
			}
		})
	}
}

// AC13: bad CenterID in the TenantContext (e.g., malformed UUID injected
// by an attacker who somehow bypassed middleware) returns Forbidden, not
// 500. Defense in depth — the service must not trust any TC field shape.
func TestAdminInviteStaff_AC13_MalformedCenterID_Forbidden(t *testing.T) {
	db := test.SetupDB(t)
	mc := clock.NewMockClock(time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC))
	svc := newAuthServiceWithClock(t, db, mc)

	tc := model.TenantContext{
		CenterID: "not-a-valid-uuid",
		UserID:   "00000000-0000-0000-0000-000000000001",
		Role:     "owner",
	}
	_, err := svc.AdminInviteStaff(context.Background(), tc, "x@example.com", "teacher")
	var fe *service.ForbiddenError
	if !errors.As(err, &fe) {
		t.Fatalf("malformed CenterID: expected ForbiddenError, got %T (%v)", err, err)
	}
}

// AC13: bad UserID (any non-UUID string) — same defense.
func TestAdminInviteStaff_AC13_MalformedUserID_Forbidden(t *testing.T) {
	db := test.SetupDB(t)
	mc := clock.NewMockClock(time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC))
	svc := newAuthServiceWithClock(t, db, mc)

	tc := model.TenantContext{
		CenterID: test.TenantAID,
		UserID:   "not-a-uuid",
		Role:     "owner",
	}
	_, err := svc.AdminInviteStaff(context.Background(), tc, "x@example.com", "teacher")
	var fe *service.ForbiddenError
	if !errors.As(err, &fe) {
		t.Fatalf("malformed UserID: expected ForbiddenError, got %T (%v)", err, err)
	}
}

// AC13 P2: when a real owner triggers AdminInviteStaff successfully, an
// `invites` row IS created under the tenant context. Verifies the
// SET LOCAL app.current_tenant_id wiring inside the service.
func TestAdminInviteStaff_AC13_OwnerSuccess_WritesInviteRow(t *testing.T) {
	db := test.SetupDB(t)
	mc := clock.NewMockClock(time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC))

	center := test.CreateCenterWithID(t, db, test.TenantAID, "Tenant A", "TENA")
	owner := test.CreateUser(t, db, "owner-real@example.com", "Real Owner")
	_ = test.TenantContext(t, db, center.ID)
	_ = test.CreateCenterMember(t, db, owner.ID, center.ID, "owner")

	svc := newAuthServiceWithClock(t, db, mc)
	tc := model.TenantContext{
		CenterID: test.TenantAID,
		UserID:   test.UUIDString(owner.ID),
		Role:     "owner",
	}
	if _, err := svc.AdminInviteStaff(context.Background(), tc, "newbie@example.com", "teacher"); err != nil {
		t.Fatalf("owner AdminInviteStaff: %v", err)
	}

	var inviteCount int
	_ = db.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM invites WHERE center_id = $1 AND email = $2`,
		center.ID, "newbie@example.com",
	).Scan(&inviteCount)
	if inviteCount != 1 {
		t.Errorf("expected 1 invite row for newbie@example.com, got %d", inviteCount)
	}
}

// AC13 P2: every rejection path emits the auth.role_revalidation_blocked
// audit event. The audit row's Before.jwtRole + After.dbRole fields are
// the canonical forensic trail for "JWT claim out of sync with DB".
func TestAdminInviteStaff_AC13_RejectionEmitsAuditRow(t *testing.T) {
	db := test.SetupDB(t)
	mc := clock.NewMockClock(time.Date(2026, 6, 5, 12, 0, 0, 0, time.UTC))

	center := test.CreateCenterWithID(t, db, test.TenantAID, "Tenant A", "TENA")
	teacher := test.CreateUser(t, db, "audit-t@example.com", "Audit Teacher")
	_ = test.TenantContext(t, db, center.ID)
	_ = test.CreateCenterMember(t, db, teacher.ID, center.ID, "teacher")

	svc := newAuthServiceWithClock(t, db, mc)
	tc := model.TenantContext{
		CenterID: test.TenantAID,
		UserID:   test.UUIDString(teacher.ID),
		Role:     "owner",
	}
	_, _ = svc.AdminInviteStaff(context.Background(), tc, "victim@example.com", "teacher")

	var rows int
	_ = db.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM auth_audit_logs WHERE event = 'auth.role_revalidation_blocked' AND user_id = $1`,
		teacher.ID,
	).Scan(&rows)
	if rows != 1 {
		t.Errorf("expected 1 role_revalidation_blocked audit row, got %d", rows)
	}
}
