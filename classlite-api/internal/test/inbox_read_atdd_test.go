// Story 10-1a · Task 0.5 / AC3 / AC4 / AC5 — the inbox read API: own active rows
// only, lightweight unread count, caller-scoped mark-read/archive with
// non-disclosure 404s, and the idempotency-vs-404 trap.
//
// RED (`//go:build atdd_red_phase`): compile-FAILS on
//
//	service.NewNotificationService / handler.NewInboxHandler + methods (newInboxSrv).
//
// Rows are staged by raw SQL (n101InsertNotif) so this also RUNTIME-depends on
// migration 20261006140000.
//
// AC5 trap (Murat): the mark-read SQL is `UPDATE … WHERE id=$ AND user_id=$`
// (ownership-gated) and MUST NOT be gated on `read_at IS NULL` — a 2nd read on an
// already-read row returns 200 no-op, NOT 404. Cross-user read AND archive each
// return 404 NOT_FOUND (0-row RETURNING → NotFoundError), asserted separately.
package test

import (
	"net/http"
	"testing"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
)

func TestInbox_Read_OwnActiveOnly_CountAndIdempotency_ATDD(t *testing.T) {
	db := SetupDB(t)
	clk := clock.NewMockClock(time.Date(2026, 10, 6, 12, 0, 0, 0, time.UTC))

	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	TenantContext(t, db, center.ID)
	centerUUID := qaUUIDFromPg(center.ID)

	caller := qaSeedMember(t, db, centerUUID, "n101-caller@example.com", "The Caller", "student")
	other := qaSeedMember(t, db, centerUUID, "n101-other@example.com", "Someone Else", "student")
	n101VerifyCenterMembers(t, db, center.ID) // GET /api/inbox requires a verified caller

	// Caller: 2 active-unread, 1 active-read, 1 archived.
	unread1 := n101InsertNotif(t, db, center.ID, qaPgUUID(caller), n101TypeAssignmentCreated, false, false)
	n101InsertNotif(t, db, center.ID, qaPgUUID(caller), n101TypeScheduleChanged, false, false)
	n101InsertNotif(t, db, center.ID, qaPgUUID(caller), n101TypeGradeReleased, true, false)
	n101InsertNotif(t, db, center.ID, qaPgUUID(caller), n101TypeQuestionAsked, false, true)
	// Another user's row — the non-disclosure target.
	otherRow := n101InsertNotif(t, db, center.ID, qaPgUUID(other), n101TypeAssignmentCreated, false, false)

	srv := newInboxSrv(t, db, clk)
	tok := SignAccessTokenForRole(t, qaPgUUID(caller), UUIDString(center.ID), "student")

	// AC3 — own active rows only (3: two unread + one read; NOT the archived, NOT other's).
	status, env := n101GetInbox(t, srv, tok, "page=1&page_size=20")
	if status != http.StatusOK {
		t.Fatalf("GET /api/inbox status = %d, want 200", status)
	}
	if len(env.Data) != 3 {
		t.Errorf("caller active queue must be 3 rows (archived excluded), got %d", len(env.Data))
	}
	if env.Meta.Pagination.Total != 3 {
		t.Errorf("pagination.total = %d, want 3", env.Meta.Pagination.Total)
	}
	for _, it := range env.Data {
		if it.ArchivedAt != nil {
			t.Errorf("archived row leaked into active queue: %s", it.ID)
		}
		if it.ID == UUIDString(otherRow) {
			t.Errorf("non-disclosure: caller saw another user's row %s", it.ID)
		}
	}

	// AC4 — lightweight unread count = 2.
	cstatus, unread := n101CountUnread(t, srv, tok)
	if cstatus != http.StatusOK {
		t.Fatalf("GET /api/inbox/count status = %d, want 200", cstatus)
	}
	if unread != 2 {
		t.Errorf("unread count = %d, want 2", unread)
	}

	// AC5 — cross-user read AND archive each 404 (non-disclosure, never 403).
	if code := n101do(t, srv, http.MethodPost, "/api/inbox/"+UUIDString(otherRow)+"/read", tok).Code; code != http.StatusNotFound {
		t.Errorf("cross-user POST /read status = %d, want 404 NOT_FOUND", code)
	}
	if code := n101do(t, srv, http.MethodPost, "/api/inbox/"+UUIDString(otherRow)+"/archive", tok).Code; code != http.StatusNotFound {
		t.Errorf("cross-user POST /archive status = %d, want 404 NOT_FOUND", code)
	}

	// AC5 — mark-read idempotency: 2nd read on an already-read row is 200 no-op.
	readPath := "/api/inbox/" + UUIDString(unread1) + "/read"
	if code := n101do(t, srv, http.MethodPost, readPath, tok).Code; code != http.StatusOK {
		t.Fatalf("first POST /read status = %d, want 200", code)
	}
	if code := n101do(t, srv, http.MethodPost, readPath, tok).Code; code != http.StatusOK {
		t.Errorf("IDEMPOTENCY TRAP: 2nd POST /read on an already-read row status = %d, want 200 no-op (SQL must be id+user_id gated, NOT read_at IS NULL)", code)
	}

	// After marking one read, unread drops to 1.
	if _, unread := n101CountUnread(t, srv, tok); unread != 1 {
		t.Errorf("unread after one read = %d, want 1", unread)
	}

	// AC5 — archive removes the row from the active queue AND the unread count.
	if code := n101do(t, srv, http.MethodPost, "/api/inbox/"+UUIDString(unread1)+"/archive", tok).Code; code != http.StatusOK {
		t.Fatalf("POST /archive own row status = %d, want 200", code)
	}
	_, env = n101GetInbox(t, srv, tok, "")
	for _, it := range env.Data {
		if it.ID == UUIDString(unread1) {
			t.Errorf("archived row %s must leave the active queue", it.ID)
		}
	}

	// AC3 — a caller with no rows gets data:[] + total:0, not an error.
	empty := qaSeedMember(t, db, centerUUID, "n101-empty@example.com", "Empty Inbox", "student")
	n101VerifyCenterMembers(t, db, center.ID) // verify the just-seeded empty-inbox caller
	emptyTok := SignAccessTokenForRole(t, qaPgUUID(empty), UUIDString(center.ID), "student")
	estatus, eenv := n101GetInbox(t, srv, emptyTok, "")
	if estatus != http.StatusOK {
		t.Fatalf("empty-inbox GET status = %d, want 200", estatus)
	}
	if len(eenv.Data) != 0 || eenv.Meta.Pagination.Total != 0 {
		t.Errorf("empty inbox must be data:[] total:0, got %d rows total=%d", len(eenv.Data), eenv.Meta.Pagination.Total)
	}
}
