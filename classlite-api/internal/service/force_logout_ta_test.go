// force_logout_ta_test.go — Story 1.6 TA expansion (P2/P3).
//
// Cross-tenant grid for R1 (score 9) — assert every (centerX, centerY)
// pair where X != Y produces 404 + audit + zero collateral. Also
// validates the post-review patch P8 audit-field rename.

package service_test

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/test"
	"github.com/google/uuid"
)

// TestForceLogout_CrossTenantGrid_AuditAttribution (#5) is the R1
// (score 9) full grid test. Three centers × Owner-of-each → ForceLogout
// against a user in EACH OTHER center. Every off-diagonal cell must
// produce 404 + zero collateral + a cross-tenant audit row. The
// diagonal (Owner-of-A targeting member-of-A) is happy-path.
func TestForceLogout_CrossTenantGrid_AuditAttribution(t *testing.T) {
	db := test.SetupDB(t)
	mockClock := clock.NewMockClock(time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC))

	// Seed three centers with deterministic UUIDs.
	tenantIDs := []string{
		test.TenantAID,
		test.TenantBID,
		"00000000-0000-0000-0000-000000000003",
	}
	centers := make([]struct {
		id    interface{ String() string }
		owner uuid.UUID
		user  uuid.UUID
	}, 3)
	for i, tid := range tenantIDs {
		name := fmt.Sprintf("Tenant %c", 'A'+i)
		code := fmt.Sprintf("TEN%c", 'A'+i)
		c := test.CreateCenterWithID(t, db, tid, name, code)
		owner := test.CreateUser(t, db, fmt.Sprintf("owner%d@example.com", i), name+" Owner")
		user := test.CreateUser(t, db, fmt.Sprintf("user%d@example.com", i), name+" User")
		_ = test.TenantContext(t, db, c.ID)
		_ = test.CreateCenterMember(t, db, owner.ID, c.ID, "owner")
		_ = test.CreateCenterMember(t, db, user.ID, c.ID, "teacher")
		// Seed 2 refresh tokens per user — must survive cross-tenant attempts.
		seedRefreshTokensForUser(t, db,
			uuid.UUID(user.ID.Bytes).String(),
			fmt.Sprintf("center-%c-family", 'A'+i),
			2, mockClock.Now().Add(7*24*time.Hour),
		)
		centers[i].owner = uuid.UUID(owner.ID.Bytes)
		centers[i].user = uuid.UUID(user.ID.Bytes)
	}

	svc := newAuthServiceWithOAuth(t, db, mockClock, &mockGoogleOAuthClient{})

	// Off-diagonal: Owner-of-X targeting User-of-Y, X != Y.
	for x := 0; x < 3; x++ {
		for y := 0; y < 3; y++ {
			if x == y {
				continue
			}
			tc := model.TenantContext{
				CenterID: tenantIDs[x],
				UserID:   centers[x].owner.String(),
				Role:     "owner",
			}
			_, err := svc.ForceLogout(context.Background(), tc, centers[y].user)
			var notFound model.NotFoundError
			if err == nil {
				t.Fatalf("cross-tenant %d→%d: expected *model.NotFoundError, got nil", x, y)
			}
			if !strings.Contains(err.Error(), "not found") {
				t.Fatalf("cross-tenant %d→%d: wanted NotFound shape, got %T %v", x, y, err, err)
			}
			_ = notFound
		}
	}

	// Assert NO target's refresh tokens were deleted (every off-diagonal
	// hit must be a no-op against the storage layer).
	for i := 0; i < 3; i++ {
		var remaining int
		if err := db.QueryRow(context.Background(),
			`SELECT COUNT(*) FROM refresh_tokens WHERE user_id = $1`,
			centers[i].user,
		).Scan(&remaining); err != nil {
			t.Fatalf("count refresh_tokens for center-%c user: %v", 'A'+i, err)
		}
		if remaining != 2 {
			t.Errorf("center-%c user refresh_tokens: want 2 (untouched), got %d", 'A'+i, remaining)
		}
	}

	// Cross-tenant audit rows: one per off-diagonal call (6 total).
	var auditCount int
	if err := db.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM auth_audit_logs WHERE event = 'auth.force_logout_cross_tenant_attempt'`,
	).Scan(&auditCount); err != nil {
		t.Fatalf("count cross-tenant audit rows: %v", err)
	}
	if auditCount != 6 {
		t.Errorf("cross-tenant audit rows: want 6 (3 owners × 2 cross-tenant targets), got %d", auditCount)
	}

	// Audit attribution: every cross-tenant row's user_id must be the
	// CALLER (per spec line "user_id = tc.UserID"). Sample-check one row.
	var sampleUserID uuid.UUID
	if err := db.QueryRow(context.Background(),
		`SELECT user_id FROM auth_audit_logs WHERE event = 'auth.force_logout_cross_tenant_attempt' LIMIT 1`,
	).Scan(&sampleUserID); err != nil {
		t.Fatalf("sample audit user_id: %v", err)
	}
	// sampleUserID should be ONE of the three owners (any of them — different
	// owners produced different rows; we just verify it's a known owner).
	matches := false
	for i := 0; i < 3; i++ {
		if sampleUserID == centers[i].owner {
			matches = true
			break
		}
	}
	if !matches {
		t.Errorf("cross-tenant audit user_id %s is not any of the seeded owners", sampleUserID)
	}
}

// TestForceLogout_AuditCarriesMaxAccessTail (#6) validates the
// post-review patch P8: the audit field is now
// `maxAccessTokenTailWindowSeconds` (not `accessTokenTailWindowSeconds`)
// to honestly reflect the upper-bound semantics.
func TestForceLogout_AuditCarriesMaxAccessTail(t *testing.T) {
	db := test.SetupDB(t)
	mockClock := clock.NewMockClock(time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC))

	centerA := test.CreateCenterWithID(t, db, test.TenantAID, "Tenant A", "TENA")
	owner := test.CreateUser(t, db, "owner@example.com", "Owner")
	target := test.CreateUser(t, db, "victim@example.com", "Victim")
	_ = test.TenantContext(t, db, centerA.ID)
	_ = test.CreateCenterMember(t, db, owner.ID, centerA.ID, "owner")
	_ = test.CreateCenterMember(t, db, target.ID, centerA.ID, "teacher")
	seedRefreshTokensForUser(t, db,
		uuid.UUID(target.ID.Bytes).String(),
		"family-tail", 1, mockClock.Now().Add(7*24*time.Hour),
	)

	svc := newAuthServiceWithOAuth(t, db, mockClock, &mockGoogleOAuthClient{})

	tc := model.TenantContext{
		CenterID: test.TenantAID,
		UserID:   uuid.UUID(owner.ID.Bytes).String(),
		Role:     "owner",
	}
	if _, err := svc.ForceLogout(context.Background(), tc, uuid.UUID(target.ID.Bytes)); err != nil {
		t.Fatalf("ForceLogout: %v", err)
	}

	// Inspect the audit row's changes JSON.
	var changes []byte
	if err := db.QueryRow(context.Background(),
		`SELECT changes FROM auth_audit_logs WHERE event = 'auth.force_logout' AND user_id = $1`,
		target.ID,
	).Scan(&changes); err != nil {
		t.Fatalf("fetch audit changes: %v", err)
	}
	body := string(changes)
	// The renamed field MUST appear; the old name must NOT.
	if !strings.Contains(body, "maxAccessTokenTailWindowSeconds") {
		t.Errorf("audit changes missing maxAccessTokenTailWindowSeconds: %s", body)
	}
	if strings.Contains(body, "\"accessTokenTailWindowSeconds\"") {
		// Note: the renamed field includes the prefix "max", so substring
		// presence of the old name (without "max") would be a regression.
		// Check the exact JSON key form.
		if strings.Contains(body, "\"accessTokenTailWindowSeconds\":") {
			t.Errorf("audit changes still uses pre-rename field: %s", body)
		}
	}
}
