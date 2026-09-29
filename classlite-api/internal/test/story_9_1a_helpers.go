// Story 9-1a (Plan Tiers & Limit Enforcement — backend) test helpers.
//
// Green-phase: the tag is removed and the greenfield seams (internal/plan,
// service.BillingService, the subscriptions/ai_credits tables, the enrollment gate,
// NewBillingTestServerForRole) now exist, so this joins the normal build.
//
// newBillingCenter seeds a committed center on the raw pool (superuser, no RLS) with a
// subscription + ai_credits row AND an owner user + owner center_member — the owner's id
// is the returned TenantContext.UserID (the ai_credit_ledger rows the billing service
// writes carry a NOT-NULL user_id FK, and the enrollment path re-validates the caller as
// an owner/admin center_member). available = (allocation-used)+addon.
package test

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/event"
	"github.com/ducdo/classlite-api/internal/handler"
	"github.com/ducdo/classlite-api/internal/middleware"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// billingEpoch is a fixed instant the reset tests advance a MockClock around.
// Date.now()-free (deterministic).
var billingEpoch = time.Date(2026, 9, 15, 3, 0, 0, 0, time.UTC)

// ownerTC returns an owner tenant context for centerID (no user). Retained for callers
// that don't need a persisted actor; newBillingCenter builds a richer tc with UserID.
func ownerTC(centerID pgtype.UUID) model.TenantContext {
	return model.TenantContext{CenterID: UUIDString(centerID), Role: string(model.RoleOwner)}
}

// seedSubscriptionRaw inserts a subscription row for centerID (superuser/raw — no
// RLS). current_period_end is NULL for free.
func seedSubscriptionRaw(t *testing.T, pool *pgxpool.Pool, centerID pgtype.UUID, planName string) {
	t.Helper()
	var periodEnd any
	if planName != "free" {
		periodEnd = billingEpoch.AddDate(0, 1, 0)
	}
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO subscriptions (id, center_id, plan, billing_cycle, status, current_period_start, current_period_end)
		 VALUES ($1, $2, $3, 'monthly', 'active', $4, $5)
		 ON CONFLICT (center_id) DO NOTHING`,
		uuid.New(), centerID, planName, billingEpoch, periodEnd,
	); err != nil {
		t.Fatalf("seed subscription (%s): %v", planName, err)
	}
}

// seedAICreditsRaw inserts the center's ai_credits row (superuser/raw).
func seedAICreditsRaw(t *testing.T, pool *pgxpool.Pool, centerID pgtype.UUID, allocation, used, addon int, resetAt time.Time) {
	t.Helper()
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO ai_credits (id, center_id, monthly_allocation, monthly_used, addon_remaining, reset_at)
		 VALUES ($1, $2, $3, $4, $5, $6)
		 ON CONFLICT (center_id) DO NOTHING`,
		uuid.New(), centerID, allocation, used, addon, resetAt,
	); err != nil {
		t.Fatalf("seed ai_credits: %v", err)
	}
}

// newBillingCenter creates a committed center (superuser, no RLS) on the raw pool with a
// subscription + ai_credits row + an owner user/member, returning its id + an owner
// tenant context whose UserID is that owner.
func newBillingCenter(t *testing.T, planName string, allocation, used, addon int, resetAt time.Time) (pgtype.UUID, model.TenantContext) {
	t.Helper()
	ctx := context.Background()
	centerID := NewPGUUIDFromString(uuid.NewString())
	ownerID := uuid.New()
	sp := SuperuserPool(t)
	short := "bill-" + uuid.NewString()[:8]
	if _, err := sp.Exec(ctx,
		`INSERT INTO centers (id, name, short_code) VALUES ($1, $2, $3)`,
		centerID, "Billing Center", short,
	); err != nil {
		t.Fatalf("create billing center: %v", err)
	}
	if _, err := sp.Exec(ctx,
		`INSERT INTO users (id, email, full_name, password_hash, email_verified) VALUES ($1, $2, 'Owner', 'x', true)`,
		ownerID, "owner-"+short+"@example.com",
	); err != nil {
		t.Fatalf("create billing owner: %v", err)
	}
	if _, err := sp.Exec(ctx,
		`INSERT INTO center_members (center_id, user_id, role) VALUES ($1, $2, 'owner')`,
		centerID, ownerID,
	); err != nil {
		t.Fatalf("create owner member: %v", err)
	}
	seedSubscriptionRaw(t, sp, centerID, planName)
	seedAICreditsRaw(t, sp, centerID, allocation, used, addon, resetAt)
	t.Cleanup(func() { cleanupBillingCenter(t, sp, centerID, ownerID) })
	return centerID, model.TenantContext{CenterID: UUIDString(centerID), UserID: ownerID.String(), Role: string(model.RoleOwner)}
}

func cleanupBillingCenter(t *testing.T, sp *pgxpool.Pool, centerID pgtype.UUID, ownerID uuid.UUID) {
	t.Helper()
	ctx := context.Background()
	for _, tbl := range []string{
		"enrollment_history", "enrollments", "ai_credit_ledger", "ai_credits",
		"subscriptions", "audit_logs", "classes", "center_members",
	} {
		_, _ = sp.Exec(ctx, "DELETE FROM "+tbl+" WHERE center_id = $1", centerID)
	}
	_, _ = sp.Exec(ctx, "DELETE FROM centers WHERE id = $1", centerID)
	_, _ = sp.Exec(ctx, "DELETE FROM users WHERE id = $1", ownerID)
}

// seedFreeClass creates an active class in tc's center with `activeSeats` students
// already enrolled (raw active enrollments) + `spareStudents` extra student members not
// yet enrolled. Returns the class id + the spare student ids (the ones the race/
// grandfather test tries to enrol). Superuser/raw so the committed rows are visible to
// the RLS-scoped enrollment service under the center's tenant context.
func seedFreeClass(t *testing.T, _ *pgxpool.Pool, tc model.TenantContext, activeSeats, spareStudents int) (uuid.UUID, []uuid.UUID) {
	t.Helper()
	ctx := context.Background()
	sp := SuperuserPool(t)
	centerID := MustParseUUID(t, tc.CenterID)
	ownerID := MustParseUUID(t, tc.UserID)
	classID := uuid.New()
	short := uuid.NewString()[:8]

	if _, err := sp.Exec(ctx,
		`INSERT INTO classes (id, center_id, name, status, teacher_id) VALUES ($1, $2, $3, 'active', $4)`,
		classID, centerID, "Free Class "+short, ownerID,
	); err != nil {
		t.Fatalf("seed class: %v", err)
	}

	mkStudent := func(i int, enroll bool) uuid.UUID {
		sid := uuid.New()
		email := "stu-" + short + "-" + uuid.NewString()[:6] + "@example.com"
		if _, err := sp.Exec(ctx,
			`INSERT INTO users (id, email, full_name, password_hash, email_verified) VALUES ($1, $2, 'Student', 'x', true)`,
			sid, email,
		); err != nil {
			t.Fatalf("seed student user: %v", err)
		}
		if _, err := sp.Exec(ctx,
			`INSERT INTO center_members (center_id, user_id, role) VALUES ($1, $2, 'student')`,
			centerID, sid,
		); err != nil {
			t.Fatalf("seed student member: %v", err)
		}
		if enroll {
			if _, err := sp.Exec(ctx,
				`INSERT INTO enrollments (id, center_id, student_id, class_id, status) VALUES ($1, $2, $3, $4, 'active')`,
				uuid.New(), centerID, sid, classID,
			); err != nil {
				t.Fatalf("seed active enrollment: %v", err)
			}
		}
		return sid
	}

	var studentIDs []uuid.UUID
	for i := 0; i < activeSeats; i++ {
		studentIDs = append(studentIDs, mkStudent(i, true))
	}
	spares := make([]uuid.UUID, 0, spareStudents)
	for i := 0; i < spareStudents; i++ {
		sid := mkStudent(i, false)
		studentIDs = append(studentIDs, sid)
		spares = append(spares, sid)
	}
	// Clean up the class + student rows this helper committed (the global users table is
	// not center-cascaded, so delete them explicitly to avoid cross-test pollution). Runs
	// before newBillingCenter's cleanup (t.Cleanup LIFO) so members/enrollments are gone
	// before the center delete.
	t.Cleanup(func() {
		ctx := context.Background()
		_, _ = sp.Exec(ctx, `DELETE FROM enrollments WHERE class_id = $1`, classID)
		_, _ = sp.Exec(ctx, `DELETE FROM enrollment_history WHERE center_id = $1`, centerID)
		_, _ = sp.Exec(ctx, `DELETE FROM classes WHERE id = $1`, classID)
		if len(studentIDs) > 0 {
			_, _ = sp.Exec(ctx, `DELETE FROM center_members WHERE user_id = ANY($1)`, studentIDs)
			_, _ = sp.Exec(ctx, `DELETE FROM users WHERE id = ANY($1)`, studentIDs)
		}
	})
	return classID, spares
}

// newEnrollmentServiceForRace builds a real EnrollmentService bound to the raw pool with
// the Story 9.1a billing gate wired (the seat/enrolment race drives CreateEnrollment →
// CheckStudentPerClass on the real path). nil email queue (post-commit notify skipped).
func newEnrollmentServiceForRace(t *testing.T, pool *pgxpool.Pool) *service.EnrollmentService {
	t.Helper()
	svc := service.NewEnrollmentService(pool, service.NewAuditService(pool), clock.RealClock{}, event.NewBus(), nil)
	svc.SetBillingService(service.NewBillingService(pool))
	return svc
}

// NewBillingTestServerForRole mounts the two Owner-only billing reads on the EXACT
// production chain (extractTenant → requireVerified → requireCenter → RequireRole("owner")
// → ErrorMapper). Mirrors NewStaffTestServerForRole: the test controls the caller's DB
// role via CreateCenterMember (what ExtractTenant reads and RequireRole enforces); this
// helper marks the caller verified and injects the Bearer token.
func NewBillingTestServerForRole(t *testing.T, db storyDB, userID pgtype.UUID, centerID, role string) http.Handler {
	t.Helper()
	markUserVerified(t, db, userID)
	tok := SignAccessTokenForRole(t, userID, centerID, role)
	return &authInjectingHandler{next: newBillingSrv(t, db), token: tok}
}

func newBillingSrv(t *testing.T, db storyDB) http.Handler {
	t.Helper()
	mux := http.NewServeMux()

	billingSvc := service.NewBillingService(db)
	billingHandler := handler.NewBillingHandler(billingSvc, clock.RealClock{})

	extractTenant := middleware.ExtractTenant(db, jwtSigner())
	requireVerified := middleware.RequireVerifiedEmail()
	requireCenter := middleware.RequireCenterContext()
	requireOwner := middleware.RequireRole("owner")
	ownerChain := func(h middleware.HandlerWithError) http.Handler {
		return extractTenant(
			requireVerified(
				requireCenter(
					requireOwner(http.HandlerFunc(middleware.ErrorMapper(h))),
				),
			),
		)
	}
	mux.Handle("GET /api/billing", ownerChain(billingHandler.GetSummary))
	mux.Handle("GET /api/billing/plans", ownerChain(billingHandler.GetPlans))
	return mux
}

// aiCreditsSnapshot reads the raw ai_credits row (superuser, no RLS). available =
// (monthly_allocation - monthly_used) + addon_remaining.
type aiCreditsSnapshot struct {
	Allocation, Used, Addon int
	ResetAt                 time.Time
}

func (s aiCreditsSnapshot) Available() int { return (s.Allocation - s.Used) + s.Addon }

func readAICredits(t *testing.T, centerID pgtype.UUID) aiCreditsSnapshot {
	t.Helper()
	var s aiCreditsSnapshot
	if err := SuperuserPool(t).QueryRow(context.Background(),
		`SELECT monthly_allocation, monthly_used, addon_remaining, reset_at FROM ai_credits WHERE center_id = $1`,
		centerID,
	).Scan(&s.Allocation, &s.Used, &s.Addon, &s.ResetAt); err != nil {
		t.Fatalf("read ai_credits: %v", err)
	}
	return s
}

// latestLedgerBalanceAfter returns balance_after of the newest ledger row for the
// center (D14 — the projection head the ai_credits snapshot must equal).
func latestLedgerBalanceAfter(t *testing.T, centerID pgtype.UUID) int {
	t.Helper()
	var bal int
	if err := SuperuserPool(t).QueryRow(context.Background(),
		`SELECT balance_after FROM ai_credit_ledger WHERE center_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1`,
		centerID,
	).Scan(&bal); err != nil {
		t.Fatalf("read latest ledger balance_after: %v", err)
	}
	return bal
}

func countLedgerByReason(t *testing.T, centerID pgtype.UUID, reason string) int {
	t.Helper()
	var n int
	if err := SuperuserPool(t).QueryRow(context.Background(),
		`SELECT count(*) FROM ai_credit_ledger WHERE center_id = $1 AND reason = $2`,
		centerID, reason,
	).Scan(&n); err != nil {
		t.Fatalf("count ledger by reason %s: %v", reason, err)
	}
	return n
}

// assertLedgerChainIntegrity verifies balance_after[n] == balance_after[n-1] +
// change[n] over all rows in insertion order (D14 chain invariant).
func assertLedgerChainIntegrity(t *testing.T, centerID pgtype.UUID) {
	t.Helper()
	rows, err := SuperuserPool(t).Query(context.Background(),
		`SELECT change, balance_after FROM ai_credit_ledger WHERE center_id = $1 ORDER BY created_at ASC, id ASC`,
		centerID,
	)
	if err != nil {
		t.Fatalf("query ledger chain: %v", err)
	}
	defer rows.Close()
	prev := 0
	first := true
	for rows.Next() {
		var change, balanceAfter int
		if err := rows.Scan(&change, &balanceAfter); err != nil {
			t.Fatalf("scan ledger row: %v", err)
		}
		want := prev + change
		if first {
			want = change // first row: balance_after == change (from zero)
			first = false
		}
		if balanceAfter != want {
			t.Errorf("ledger CHAIN BROKEN: balance_after=%d, want prev(%d)+change(%d)=%d", balanceAfter, prev, change, want)
		}
		prev = balanceAfter
	}
}
