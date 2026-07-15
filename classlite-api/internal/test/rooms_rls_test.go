// Story 2.5b — R1 discharge (Task 2, AC8 + AC12): RLS matrix for `rooms`.
//
// Four patterns per the story-spec 8-row minimum split (see header of
// `terms_rls_test.go`):
//
//   Pattern 1  CrossTenantRead   — tenant A cannot SELECT tenant B's rows.
//   Pattern 2  CrossTenantInsert — WITH CHECK guard (SQLSTATE 42501).
//   Pattern 3  CrossTenantWrite  — silent USING drop on cross-tenant UPDATE.
//   AC6        UniqueRoomName    — UNIQUE(center_id, LOWER(name)) DB
//                                  constraint fires as SQLSTATE 23505 on
//                                  case-insensitive duplicate.
//
// Migration: 20260714120300_create_rooms.up.sql (Task 1).
//
// Expected RED against the current codebase: `relation "rooms" does not
// exist`. Amelia flips green by landing Task 1.1 (migration) + Task 2.
//
// GREEN CONTRACT for the uniqueness test: the sqlc-emitted error is a
// `*pgconn.PgError` with `Code == "23505"`. Service layer maps this to
// `service.RoomNameTakenError` per AC6; handler layer maps that error type
// to HTTP 409 `ROOM_NAME_TAKEN` per Task 4's `internal/handler/errors.go`
// amendment. The test asserts on SQLSTATE at the raw-SQL layer — the
// higher layers' mapping is tested in `room_handler_atdd_test.go`.

package test

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
)

// insertRoomRaw inserts a rooms row via raw SQL. Tenant context must
// already be set. Capacity fixed at 20 (mid-range per the 1..500 CHECK).
func insertRoomRaw(t *testing.T, db *TxDB, centerID uuid.UUID, name string) uuid.UUID {
	t.Helper()
	id := uuid.New()
	_, err := db.Exec(context.Background(),
		`INSERT INTO rooms (id, center_id, name, description, capacity)
		 VALUES ($1, $2, $3, NULL, 20)`,
		id, centerID, name,
	)
	if err != nil {
		t.Fatalf("insert rooms row (%s): %v", name, err)
	}
	return id
}

// -----------------------------------------------------------------------------
// Pattern 1 — CrossTenantRead
// -----------------------------------------------------------------------------
func TestRLS_Room_CrossTenantRead(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

	TenantContext(t, db, centerB.ID)
	insertRoomRaw(t, db, uuid.UUID(centerB.ID.Bytes), "Room B-1")

	TenantContext(t, db, centerA.ID)
	var visibleB int
	if err := db.QueryRow(ctx,
		"SELECT count(*) FROM rooms WHERE center_id = $1",
		centerB.ID,
	).Scan(&visibleB); err != nil {
		t.Fatalf("broad count as tenant A: %v", err)
	}
	if visibleB != 0 {
		t.Errorf("RLS VIOLATION: tenant A saw %d tenant B rooms rows, expected 0", visibleB)
	}
}

// -----------------------------------------------------------------------------
// Pattern 2 — CrossTenantInsert (WITH CHECK guard)
// -----------------------------------------------------------------------------
func TestRLS_Room_CrossTenantInsert(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

	TenantContext(t, db, centerA.ID)
	id := uuid.New()
	_, err := db.Exec(ctx,
		`INSERT INTO rooms (id, center_id, name, description, capacity)
		 VALUES ($1, $2, 'hostile', NULL, 20)`,
		id, centerB.ID,
	)
	AssertRLSViolation(t, err, "rooms cross-tenant INSERT with WITH CHECK forced center_id=tenantB")
}

// -----------------------------------------------------------------------------
// Pattern 3 — CrossTenantWrite (UPDATE)
// -----------------------------------------------------------------------------
func TestRLS_Room_CrossTenantWrite(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

	TenantContext(t, db, centerB.ID)
	rowID := insertRoomRaw(t, db, uuid.UUID(centerB.ID.Bytes), "Original Room")

	TenantContext(t, db, centerA.ID)
	tag, err := db.Exec(ctx,
		`UPDATE rooms SET name = 'Hacked' WHERE id = $1`, rowID,
	)
	if err != nil {
		t.Fatalf("UPDATE returned error (expected silent 0-rows): %v", err)
	}
	if rows := tag.RowsAffected(); rows != 0 {
		t.Errorf("RLS VIOLATION: tenant A UPDATE affected %d rows on tenant B's rooms, expected 0", rows)
	}

	TenantContext(t, db, centerB.ID)
	var name string
	if err := db.QueryRow(ctx,
		`SELECT name FROM rooms WHERE id = $1`, rowID,
	).Scan(&name); err != nil {
		t.Fatalf("re-read as tenant B: %v", err)
	}
	if name != "Original Room" {
		t.Errorf("RLS VIOLATION: tenant A UPDATE against tenant B room succeeded (name=%q)", name)
	}
}

// -----------------------------------------------------------------------------
// AC6 — UNIQUE(center_id, LOWER(name)) case-insensitive duplicate blocked.
// SQLSTATE 23505 (unique_violation). Service maps → RoomNameTakenError
// → 409 ROOM_NAME_TAKEN at the handler layer (asserted separately in
// `room_handler_atdd_test.go`).
// -----------------------------------------------------------------------------
func TestRLS_Room_UniqueNameCaseInsensitive(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	TenantContext(t, db, center.ID)
	insertRoomRaw(t, db, uuid.UUID(center.ID.Bytes), "Room A")

	// Case-only difference must collide against the LOWER(name) unique index.
	id := uuid.New()
	_, err := db.Exec(ctx,
		`INSERT INTO rooms (id, center_id, name, description, capacity)
		 VALUES ($1, $2, 'room a', NULL, 20)`,
		id, center.ID,
	)
	if err == nil {
		t.Fatalf("AC6 VIOLATION: second INSERT with case-only difference succeeded — UNIQUE(center_id, LOWER(name)) index missing or wrong")
	}
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		t.Fatalf("AC6: expected *pgconn.PgError, got %T: %v", err, err)
	}
	if pgErr.Code != "23505" {
		t.Errorf("AC6: expected SQLSTATE 23505 (unique_violation), got %s (%s)", pgErr.Code, pgErr.Message)
	}
}
