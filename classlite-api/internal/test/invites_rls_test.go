// Story 2.6 (AC9 Task 5.5) — invite row store-shape + RLS assertions.
//
// The AC9 hierarchy + envelope matrices exercise the invite persistence
// happy path; this file locks down the row shape (token_hash format,
// expires_at delta, role column) and the RLS invariant that a Tenant B
// caller must not see Tenant A's invite rows even when authenticated
// against A's center at token-issue time.
//
// Kept in the `test` package so the tenant-context helpers (SetupDB /
// SetLocalTenant / TenantAID / TenantBID) are directly reachable
// without export detours.
package test

import (
	"context"
	"regexp"
	"testing"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
)

var lowerHex64 = regexp.MustCompile(`^[0-9a-f]{64}$`)

// TestInvite_RowShapeAndCrossTenantIsolation combines two invariants that
// share fixture setup:
//
//  1. Row shape — after AdminInviteStaff succeeds, the persisted row has
//     the expected sha256-hex token_hash format, the 7-day expires_at
//     delta relative to the mock clock, and the role column matches the
//     invited role.
//  2. RLS isolation — Tenant B under its own SET LOCAL cannot see the
//     invite row created for Tenant A. The bare-pool scan reads across
//     tenants; the tenant-scoped tx read returns zero rows.
func TestInvite_RowShapeAndCrossTenantIsolation(t *testing.T) {
	db := SetupDB(t)
	mc := clock.NewMockClock(time.Date(2026, 7, 17, 12, 0, 0, 0, time.UTC))

	// Tenant A + Owner caller.
	centerA := CreateCenterWithID(t, db, TenantAID, "Tenant A", "TENA")
	ownerA := CreateUser(t, db, "rowshape-owner@example.com", "Row Owner")
	_ = TenantContext(t, db, centerA.ID)
	_ = CreateCenterMember(t, db, ownerA.ID, centerA.ID, "owner")

	// Tenant B + a second owner (used only for the cross-tenant RLS probe).
	centerB := CreateCenterWithID(t, db, TenantBID, "Tenant B", "TENB")
	_ = CreateUser(t, db, "rowshape-owner-b@example.com", "Row Owner B")
	_ = TenantContext(t, db, centerB.ID)

	authSvc := newAuthServiceForInviteRowTest(t, db, mc)
	tc := model.TenantContext{
		CenterID: TenantAID,
		UserID:   UUIDString(ownerA.ID),
		Role:     "owner",
	}

	result, err := authSvc.AdminInviteStaff(context.Background(), tc,
		"rowshape-target@example.com", "teacher")
	if err != nil {
		t.Fatalf("AdminInviteStaff: %v", err)
	}

	// -----------------------------------------------------------------
	// (1) Row shape assertions (bare pool read; SET LOCAL not set so RLS
	// only allows reading if the connection has no app.current_tenant_id
	// set OR the shipped `invites` policy permits cross-tenant reads
	// from an unset tenant; see the RLS probe below for the actual
	// isolation check).
	// -----------------------------------------------------------------
	var rowRole, rowEmail, tokenHash string
	var expiresAt time.Time
	// SET the current_tenant_id to Tenant A so the RLS predicate passes.
	if _, err := db.Exec(context.Background(),
		`SELECT set_config('app.current_tenant_id', $1, false)`, TenantAID); err != nil {
		t.Fatalf("set tenant A: %v", err)
	}
	if err := db.QueryRow(context.Background(),
		`SELECT role, email, token_hash, expires_at FROM invites WHERE id = $1`,
		result.ID,
	).Scan(&rowRole, &rowEmail, &tokenHash, &expiresAt); err != nil {
		t.Fatalf("read persisted invite row: %v", err)
	}
	if rowRole != "teacher" {
		t.Errorf("row role = %q, want teacher", rowRole)
	}
	if rowEmail != "rowshape-target@example.com" {
		t.Errorf("row email = %q, want rowshape-target@example.com", rowEmail)
	}
	if !lowerHex64.MatchString(tokenHash) {
		t.Errorf("token_hash %q must be lowercase 64-char hex (sha256)", tokenHash)
	}
	expectedExpiry := mc.Now().Add(7 * 24 * time.Hour)
	if !expiresAt.Equal(expectedExpiry) {
		t.Errorf("expires_at = %s, want %s (mock clock + 7d)", expiresAt, expectedExpiry)
	}

	// -----------------------------------------------------------------
	// (2) RLS isolation — Tenant B under its own SET LOCAL must observe
	// zero invite rows for Tenant A's invited email.
	// -----------------------------------------------------------------
	if _, err := db.Exec(context.Background(),
		`SELECT set_config('app.current_tenant_id', $1, false)`, TenantBID); err != nil {
		t.Fatalf("set tenant B: %v", err)
	}
	var visibleFromB int
	if err := db.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM invites WHERE email = $1`,
		"rowshape-target@example.com",
	).Scan(&visibleFromB); err != nil {
		t.Fatalf("cross-tenant probe: %v", err)
	}
	if visibleFromB != 0 {
		t.Errorf("RLS VIOLATION: tenant B saw %d Tenant-A invite rows for rowshape-target@example.com",
			visibleFromB)
	}
}

func newAuthServiceForInviteRowTest(t *testing.T, db *TxDB, mc clock.Clock) *service.AuthService {
	t.Helper()
	svc := service.NewAuthServiceWithClock(db, service.BcryptHasher{Cost: 4},
		&service.MockEmailSender{}, service.NewPgAuthAuditLogger(db),
		service.NewEmailRetryQueue(&service.MockEmailSender{}, 4),
		"http://localhost/verify", mc)
	svc.SetJWTSigner(jwtSigner())
	return svc
}
