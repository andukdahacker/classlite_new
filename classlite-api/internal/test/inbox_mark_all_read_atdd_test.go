// inbox_mark_all_read_atdd_test.go — Story 10-1b · AC6 / Task 1.4 (P0).
// POST /api/inbox/read-all — the ONLY net-new backend in 10-1b: a thin handler
// over the EXISTING NotificationService.MarkAllRead + MarkAllReadForUser query.
//
// RED (`//go:build atdd_red_phase`): RUNTIME-gated. This file COMPILES against the
// shipped 10-1a seam (newInboxSrv, n101* helpers) and FAILS at runtime because the
// route POST /api/inbox/read-all is not mounted yet → 404 (same runtime-gated style
// as 10-1a's 0.4 crossing-publish specimen). Dev strips the build tag once green.
//
// GREEN SEAM (dev implements to match):
//   - handler.InboxHandler.MarkAllRead(w,r) → svc.MarkAllRead(ctx,tc) (ALREADY EXISTS,
//     notification_service.go:681) → WriteEnvelope{status:"ok"} (new EnvelopeStatusAck,
//     NO id — NOT EnvelopeNotificationAck).
//   - newInboxSrv + main.go: mux.Handle("POST /api/inbox/read-all", chain(h.MarkAllRead)).
//
// WHAT THIS PINS (party-mode, Murat):
//   - caller-scoped: after read-all the caller's active-unread count → 0.
//   - BH7 regression guard: an ARCHIVED-but-unread row keeps read_at = NULL
//     (MarkAllReadForUser must retain `AND archived_at IS NULL` — the 10-1a
//     code-review patch; a revert of that patch must FAIL here).
//   - caller-scoping: a DIFFERENT user in the SAME center is untouched (user_id predicate).
//
// Cross-TENANT isolation inherits 10-1a's notifications RLS 6-grid (the center_id
// GUC on every query); the net-new verb's user_id-scoping + BH7 are what THIS red
// owns directly. The committed raw-pool cross-tenant leg (AC6(ii)) is now asserted
// below via a superuser-pool center B (code-review 10-1b P1).
package test

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
)

func TestInbox_MarkAllRead_CallerScoped_ArchivedStaysUnread_ATDD(t *testing.T) {
	db := SetupDB(t)
	clk := clock.NewMockClock(time.Date(2026, 10, 7, 12, 0, 0, 0, time.UTC))

	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	TenantContext(t, db, center.ID)

	centerUUID := qaUUIDFromPg(center.ID)
	caller := qaSeedMember(t, db, centerUUID, "n101b-caller@example.com", "The Caller", "student")
	other := qaSeedMember(t, db, centerUUID, "n101b-other@example.com", "Someone Else", "student")
	n101VerifyCenterMembers(t, db, center.ID) // POST /api/inbox/read-all rides the verified chain.

	// Caller: 2 active-unread + 1 ARCHIVED-unread (the BH7 target).
	n101InsertNotif(t, db, center.ID, qaPgUUID(caller), n101TypeAssignmentCreated, false, false)
	n101InsertNotif(t, db, center.ID, qaPgUUID(caller), n101TypeGradeReleased, false, false)
	archived := n101InsertNotif(t, db, center.ID, qaPgUUID(caller), n101TypeScheduleChanged, false, true)
	// Other user, same center: 1 active-unread (the caller-scoping target).
	n101InsertNotif(t, db, center.ID, qaPgUUID(other), n101TypeAssignmentCreated, false, false)

	// Cross-TENANT leg (AC6(ii) — the net-new verb's RLS inheritance; this verb
	// was never in 10-1a's AC2 grid so its cross-tenant 0-row behavior needs its
	// own assertion). A COMMITTED center B (superuser pool, auto-cleanup) with its
	// own active-unread row — read-all runs under center A's tenant context, so RLS
	// must make B's rows unreachable. A revert of the center_id scoping fails here.
	centerB := n101NewCenter(t, 0)
	userB := n101SeedMemberOnPool(t, centerB, "n101b-tenantB@example.com", "Tenant B User", "student")
	sp := SuperuserPool(t)
	tenantBRow := n101InsertNotif(t, sp, centerB, userB, n101TypeAssignmentCreated, false, false)

	srv := newInboxSrv(t, db, clk)
	callerTok := SignAccessTokenForRole(t, qaPgUUID(caller), UUIDString(center.ID), "student")

	// Precondition: caller has 2 unread (the archived row is excluded from the count).
	if st, unread := n101CountUnread(t, srv, callerTok); st != http.StatusOK || unread != 2 {
		t.Fatalf("precondition: GET /count status=%d unread=%d, want 200/2", st, unread)
	}

	// ACT — mark all read.
	rec := n101do(t, srv, http.MethodPost, "/api/inbox/read-all", callerTok)
	if rec.Code != http.StatusOK {
		t.Fatalf("POST /api/inbox/read-all status = %d, want 200 (route not mounted yet → RED)", rec.Code)
	}

	// Envelope shape (AC6 / TEST-BE-3) — the net-new EnvelopeStatusAck is {data:{status}},
	// NOT just a 200. Assert the body, not only the code.
	var ack struct {
		Data struct {
			Status string `json:"status"`
		} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &ack); err != nil {
		t.Fatalf("decode read-all envelope: %v (body=%s)", err, rec.Body.String())
	}
	if ack.Data.Status != "ok" {
		t.Errorf("read-all envelope data.status = %q, want \"ok\" ({data:{status}} shape)", ack.Data.Status)
	}

	ctx := context.Background()

	// (1) caller active-unread → 0.
	if _, unread := n101CountUnread(t, srv, callerTok); unread != 0 {
		t.Errorf("after read-all caller unread = %d, want 0", unread)
	}

	// (2) BH7 — the archived-but-unread row MUST still be read_at IS NULL.
	var archivedStillUnread int
	if err := db.QueryRow(ctx,
		`SELECT count(*) FROM notifications WHERE id = $1 AND read_at IS NULL`,
		archived,
	).Scan(&archivedStillUnread); err != nil {
		t.Fatalf("read archived row: %v", err)
	}
	if archivedStillUnread != 1 {
		t.Errorf("BH7 VIOLATION: read-all stamped an ARCHIVED row — MarkAllReadForUser dropped `AND archived_at IS NULL` (read_at-IS-NULL count = %d, want 1)", archivedStillUnread)
	}

	// (3) caller-scoping — the other same-center user's unread row is untouched.
	var otherUnread int
	if err := db.QueryRow(ctx,
		`SELECT count(*) FROM notifications WHERE center_id = $1 AND user_id = $2 AND read_at IS NULL AND archived_at IS NULL`,
		center.ID, qaPgUUID(other),
	).Scan(&otherUnread); err != nil {
		t.Fatalf("read other-user rows: %v", err)
	}
	if otherUnread != 1 {
		t.Errorf("caller-scoping VIOLATION: read-all touched another user's rows (other unread = %d, want 1)", otherUnread)
	}

	// (4) cross-TENANT — center B's unread row is UNTOUCHED (RLS inheritance, not
	// merely the user_id predicate). Read via the superuser pool so the assertion
	// sees the row's ACTUAL read_at (not an RLS-filtered 0 that would pass vacuously).
	var tenantBStillUnread int
	if err := sp.QueryRow(ctx,
		`SELECT count(*) FROM notifications WHERE id = $1 AND read_at IS NULL`,
		tenantBRow,
	).Scan(&tenantBStillUnread); err != nil {
		t.Fatalf("read tenant-B row: %v", err)
	}
	if tenantBStillUnread != 1 {
		t.Errorf("CROSS-TENANT LEAK: read-all by a center-A caller stamped a center-B row (read_at-IS-NULL count = %d, want 1)", tenantBStillUnread)
	}
}
