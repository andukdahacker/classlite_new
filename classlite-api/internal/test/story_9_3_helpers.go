// Story 9-3 (Payment Failure, Grace Period & Invoices) test helpers.
//
// SEAM-LIGHT, UNTAGGED (the 9-2a/9-1a convention): this file carries NO build tag, so it
// compiles into the `test` package on every build. It references ONLY already-green symbols
// (SuperuserPool, scanCount, mustJSON, UUIDString, billingEpoch, newBillingCenter,
// seedFreeClass, pkSetSnapshot/assertPKSetPreserved — all from the 9-1a/9-2a helpers) plus
// raw SQL against the NEW 9-3 columns/tables. The raw readers below hit columns that do not
// exist until the 20261005120000+ migration lands, so they fail at RUNTIME — never at
// compile time, and never reached by the green suite (only the tagged 9-3 red tests call
// them). The RED signal therefore lives entirely in the tagged *_atdd_test.go files, which
// reference the missing Go seams:
//
//	GREEN-PHASE SEAMS the 9-3 reds compile against (RED compile-fails on these):
//	  · (svc *service.BillingService).SetEmailSender(service.EmailSender) — the grace machine
//	      needs an email sender (BillingService has none today); setter mirrors SetCheckoutSuccessURL.
//	  · (svc *service.BillingService).HandleGraceTick(ctx, tc) error — the per-center grace tick
//	      the billing_grace_tick worker calls on dequeue (GFW-7/SEC-6). Computes the elapsed-day
//	      action at clk.Now(): day 0/3/5/6 warning email, day 3/5 Polar re-collect + grace_retry_count++,
//	      day 7 ExpireGraceToFree (zero-deletion apply), idempotent per day, reschedules the next tick.
//	  · (svc *service.BillingService).ProcessPolarEvent(...) — EXISTS; new dispatch CASES only:
//	      a payment-failure event → enterGrace (past_due + grace_period_start + first tick, idempotent
//	      target-state); order.paid/subscription.active WHILE past_due → recovery (ClearGrace + cancel
//	      ticks + restore). No new signature — the behavior is what the reds assert.
//	  · migrations 20261005120000+: subscriptions.grace_period_start / payment_failed_at /
//	      grace_retry_count; the billing_grace_tick JobType on the existing jobs queue.
//
// Convention notes:
//   - D6 event-name caveat: the Polar payment-failure wire name is a PROVIDER FACT to verify
//     against current Polar docs at dev time (candidates: subscription.past_due /
//     order.payment_failed / invoice.payment_failed) and cite in the Dev Agent Record. The
//     reds pin ONE candidate (polarPaymentFailedType) — the dispatcher must map whichever
//     Polar actually sends; swap this const at green if the verified name differs.
//   - D2 retry caveat: whether Polar exposes a manual re-collect call vs auto-retries is also
//     a provider fact. The reds anchor the "retry requested" assertion on grace_retry_count
//     (DB-observable, provider-agnostic), NOT on a MockClient call shape — robust to D2.
//   - knowledge_files is the AC7 wording; the real table is `files` (Story 4.4a). The R24
//     snapshot uses `files`.
//   - R24 reuses pkSetSnapshot/assertPKSetPreserved from story_9_2a_helpers.go verbatim.

package test

import (
	"context"
	"testing"
	"time"

	"github.com/ducdo/classlite-api/internal/model"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// --- Polar payment-failure / recovery event builders --------------------------------

// polarPaymentFailedType is the event name that STARTS our grace clock (D2/D6 — VERIFY the
// real Polar wire name at dev time and cite; the dispatcher must map whichever Polar sends).
const polarPaymentFailedType = "subscription.past_due"

// polarPaymentFailed builds the payment-failure event JSON carrying metadata.center_id for
// the inherited confused-deputy tenant resolution (R11/SEC-7 — never raw-body tenant trust).
func polarPaymentFailed(centerID pgtype.UUID, polarSubID string) []byte {
	return mustJSON(map[string]any{
		"type": polarPaymentFailedType,
		"data": map[string]any{
			"id":       polarSubID,
			"status":   "past_due",
			"metadata": map[string]any{"center_id": UUIDString(centerID)},
		},
	})
}

// polarRecoveryActive builds the subscription.active event that, delivered WHILE the center
// is past_due, is treated as RECOVERY (D6). Reuses the active-subscription envelope shape.
func polarRecoveryActive(centerID pgtype.UUID, polarSubID, plan, cycle string, periodStart, periodEnd time.Time) []byte {
	return mustJSON(map[string]any{
		"type": "subscription.active",
		"data": map[string]any{
			"id":                   polarSubID,
			"status":               "active",
			"product_plan":         plan,
			"recurring_interval":   cycle,
			"current_period_start": periodStart.Format(time.RFC3339),
			"current_period_end":   periodEnd.Format(time.RFC3339),
			"metadata":             map[string]any{"center_id": UUIDString(centerID)},
		},
	})
}

// bindPolarSubscription stamps the center's real polar_subscription_id so the payment-failure
// / recovery reds exercise the SECURE resolution path (persisted-sub-id-wins → the 9-2a D20
// confused-deputy guard), NOT raw-body metadata trust (SEC-7). Call it before firing an event
// whose data.id is that same sub id.
func bindPolarSubscription(t *testing.T, centerID pgtype.UUID, polarSubID string) {
	t.Helper()
	if _, err := SuperuserPool(t).Exec(context.Background(),
		`UPDATE subscriptions SET polar_subscription_id = $2 WHERE center_id = $1`, centerID, polarSubID); err != nil {
		t.Fatalf("bind polar subscription: %v", err)
	}
}

// --- Raw readers for the new 9-3 grace columns (RUNTIME-only until the migration lands) ---

// readGraceState value-scans the D8 grace-tracking columns. graceStart/paymentFailedAt are
// NULL (→ nil) when the center is not in grace.
func readGraceState(t *testing.T, centerID pgtype.UUID) (status string, graceStart, paymentFailedAt *time.Time, retryCount int) {
	t.Helper()
	if err := SuperuserPool(t).QueryRow(context.Background(),
		`SELECT status, grace_period_start, payment_failed_at, grace_retry_count
		   FROM subscriptions WHERE center_id = $1`, centerID,
	).Scan(&status, &graceStart, &paymentFailedAt, &retryCount); err != nil {
		t.Fatalf("read grace state: %v", err)
	}
	return
}

// countPendingGraceTicks counts the center's not-yet-terminal billing_grace_tick jobs (D5).
// The recovery + day-7 paths MUST cancel these — a non-zero count after either is a stray
// tick that would send a phantom email / re-downgrade.
func countPendingGraceTicks(t *testing.T, centerID pgtype.UUID) int {
	return scanCount(t,
		`SELECT count(*) FROM jobs
		  WHERE center_id = $1 AND type = 'billing_grace_tick'
		    AND status IN ('pending','processing')`, centerID)
}

// countAICreditsRows proves the center's ai_credits row SURVIVES a downgrade. ai_credits is
// center-keyed (no id column) so it is excluded from the id-based pkSetSnapshot set and
// asserted by survival-count instead (AC7 "+ ai_credits rows survive").
func countAICreditsRows(t *testing.T, centerID pgtype.UUID) int {
	return scanCount(t, `SELECT count(*) FROM ai_credits WHERE center_id = $1`, centerID)
}

// --- R24 content seeders (superuser raw inserts; mirror the attempt_read_test shapes) -----

// graceSnapshotTables is the R24 no-delete set (AC7). All are id-keyed so pkSetSnapshot works;
// `files` is the real table behind the AC's "knowledge_files" wording. ai_credits is asserted
// separately (center-keyed — countAICreditsRows).
var graceSnapshotTables = []string{
	"classes", "exercises", "assignments", "submissions", "enrollments", "files",
	"ai_credit_ledger", "subscriptions", "invoices",
}

func seedGraceExercise(t *testing.T, centerID, creatorID pgtype.UUID) uuid.UUID {
	t.Helper()
	id := uuid.New()
	if _, err := SuperuserPool(t).Exec(context.Background(),
		`INSERT INTO exercises (id, center_id, created_by, code, title, skill, content, schema_version)
		 VALUES ($1,$2,$3,$4,'Grace Ex','reading','{"sections":[]}',1)`,
		id, centerID, creatorID, "GRC-"+id.String()[:8]); err != nil {
		t.Fatalf("seed grace exercise: %v", err)
	}
	return id
}

func seedGraceAssignment(t *testing.T, centerID, creatorID pgtype.UUID, exerciseID, classID uuid.UUID) uuid.UUID {
	t.Helper()
	id := uuid.New()
	if _, err := SuperuserPool(t).Exec(context.Background(),
		`INSERT INTO assignments (id, center_id, exercise_id, class_id, created_by, status, deadline_at, hard_deadline_at, late_penalty)
		 VALUES ($1,$2,$3,$4,$5,'open',$6,NULL,1.5)`,
		id, centerID, exerciseID, classID, creatorID, billingEpoch.AddDate(0, 1, 0)); err != nil {
		t.Fatalf("seed grace assignment: %v", err)
	}
	return id
}

func seedGraceSubmission(t *testing.T, centerID pgtype.UUID, assignmentID, studentID uuid.UUID) uuid.UUID {
	t.Helper()
	id := uuid.New()
	now := billingEpoch
	if _, err := SuperuserPool(t).Exec(context.Background(),
		`INSERT INTO submissions (id, center_id, assignment_id, student_id, status, content, schema_version, started_at, created_at, updated_at)
		 VALUES ($1,$2,$3,$4,'submitted','{}',1,$5,$5,$5)`,
		id, centerID, assignmentID, studentID, now); err != nil {
		t.Fatalf("seed grace submission: %v", err)
	}
	return id
}

func seedGraceFile(t *testing.T, centerID, uploaderID pgtype.UUID) uuid.UUID {
	t.Helper()
	id := uuid.New()
	short := id.String()[:8]
	if _, err := SuperuserPool(t).Exec(context.Background(),
		`INSERT INTO files (id, center_id, name, slug, object_key, content_type, size_bytes, uploaded_by)
		 VALUES ($1,$2,'Grace.pdf',$3,$4,'application/pdf',1024,$5)`,
		id, centerID, "grace-"+short, UUIDString(centerID)+"/knowledge/"+short+".pdf", uploaderID); err != nil {
		t.Fatalf("seed grace file: %v", err)
	}
	return id
}

// seedTeacherSeat raw-inserts a teacher user + center_member (role='teacher') so the R3
// read-only reds can build a center that is OVER the Free teacher-seat cap (grandfathered
// after a downgrade). Returns the teacher's user id.
func seedTeacherSeat(t *testing.T, centerID pgtype.UUID) uuid.UUID {
	t.Helper()
	sp := SuperuserPool(t)
	ctx := context.Background()
	uid := uuid.New()
	email := "teacher-" + uid.String()[:8] + "@example.com"
	if _, err := sp.Exec(ctx,
		`INSERT INTO users (id, email, full_name, password_hash, email_verified) VALUES ($1,$2,'Teacher','x',true)`,
		uid, email); err != nil {
		t.Fatalf("seed teacher user: %v", err)
	}
	if _, err := sp.Exec(ctx,
		`INSERT INTO center_members (center_id, user_id, role) VALUES ($1,$2,'teacher')`,
		centerID, uid); err != nil {
		t.Fatalf("seed teacher member: %v", err)
	}
	t.Cleanup(func() {
		c := context.Background()
		_, _ = sp.Exec(c, `DELETE FROM center_members WHERE user_id = $1`, uid)
		_, _ = sp.Exec(c, `DELETE FROM users WHERE id = $1`, uid)
	})
	return uid
}

// seedGraceContent seeds one row into each content table (classes+enrollments via the shared
// seedFreeClass; exercises/assignments/submissions/files raw) so the R24 snapshot has real
// rows to prove survive the downgrade.
func seedGraceContent(t *testing.T, pool *pgxpool.Pool, centerID pgtype.UUID, tc model.TenantContext) {
	t.Helper()
	ownerUUID := MustParseUUID(t, tc.UserID)
	ownerPG := NewPGUUIDFromString(tc.UserID)
	classID, spares := seedFreeClass(t, pool, tc, 2, 1) // 1 class, 2 active enrollments, 1 spare student
	exID := seedGraceExercise(t, centerID, ownerPG)
	asgID := seedGraceAssignment(t, centerID, ownerPG, exID, classID)
	student := ownerUUID
	if len(spares) > 0 {
		student = spares[0]
	}
	seedGraceSubmission(t, centerID, asgID, student)
	seedGraceFile(t, centerID, ownerPG)
}
