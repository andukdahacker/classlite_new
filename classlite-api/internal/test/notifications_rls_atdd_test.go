// Story 10-1a · Task 0.1 / AC2 / R1 / R2 — the mandatory 6-pattern adversarial
// RLS grid for `notifications`, copied from internal/test/_TEMPLATE_rls_test.go
// and find-replaced for the resource.
//
// RED (`//go:build atdd_red_phase`): compile-FAILS on the sqlc seams
//
//	generated.Notification / generated.NotificationType(+Payment const) /
//	generated.InsertNotification(+Params) / generated.ListInboxForUser(+Params) /
//	generated.MarkNotificationRead(+Params).
//
// It also fails at RUNTIME until migration 20261006140000 creates the table +
// the ENABLE/FORCE 4-policy center_id grid — that runtime failure IS the AC2
// assertion once it compiles.
//
// Pattern 4 (CrossTenantDelete) uses a raw DELETE: `notifications` exposes NO
// delete sqlc query (archive = archived_at, DD1 — no deleted_at), so the grid's
// delete leg is a direct SQL DELETE proven to touch 0 rows cross-tenant.
package test

import (
	"context"
	"testing"
	"time"

	"github.com/ducdo/classlite-api/internal/store/generated"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// rlsNotif is the handle the write/delete patterns mutate.
type rlsNotif struct {
	ID     pgtype.UUID
	UserID pgtype.UUID
}

// seedRLSNotification creates a user + membership + one notification row in the
// CURRENT tenant (caller sets TenantContext first). Returns ids for the mutation
// patterns. Uses the generated.InsertNotification seam on purpose (same compile
// surface the production write side uses).
func seedRLSNotification(t *testing.T, db *TxDB, centerID pgtype.UUID) rlsNotif {
	t.Helper()
	u := CreateUser(t, db, "rls-notif-"+uuid.NewString()[:8]+"@example.com", "RLS Notif User")
	CreateCenterMember(t, db, u.ID, centerID, "student")
	row, err := generated.New(db).InsertNotification(context.Background(), generated.InsertNotificationParams{
		CenterID: centerID,
		UserID:   u.ID,
		Type:     generated.NotificationTypePaymentFailed,
		Title:    "Original title",
		Body:     "Original body",
		Link:     "/settings/billing",
		Metadata: []byte(`{"schemaVersion":1}`),
	})
	if err != nil {
		t.Fatalf("seed notification (is migration 20261006140000 applied?): %v", err)
	}
	return rlsNotif{ID: row.ID, UserID: u.ID}
}

// -----------------------------------------------------------------------------
// Pattern 1 — CrossTenantRead
// -----------------------------------------------------------------------------
func TestRLS_Notification_CrossTenantRead(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()
	queries := generated.New(db)

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

	TenantContext(t, db, centerB.ID)
	seedB := seedRLSNotification(t, db, centerB.ID)

	TenantContext(t, db, centerA.ID)
	rows, err := queries.ListInboxForUser(ctx, generated.ListInboxForUserParams{
		CenterID:   centerB.ID, // deliberately asks for tenant B's data
		UserID:     seedB.UserID,
		Type:       pgtype.Text{Valid: false},
		UnreadOnly: false,
		Limit:      50,
		Offset:     0,
	})
	if err != nil {
		t.Fatalf("list inbox as tenant A: %v", err)
	}
	if len(rows) != 0 {
		t.Errorf("RLS VIOLATION: tenant A read %d tenant B notification rows", len(rows))
	}

	var visible int
	if err := db.QueryRow(ctx,
		"SELECT count(*) FROM notifications WHERE center_id IN ($1, $2)",
		centerA.ID, centerB.ID,
	).Scan(&visible); err != nil {
		t.Fatalf("broad count as tenant A: %v", err)
	}
	if visible != 0 {
		t.Errorf("RLS VIOLATION: tenant A saw %d notification rows across both tenants, expected 0", visible)
	}
}

// -----------------------------------------------------------------------------
// Pattern 2 — CrossTenantInsert (WITH CHECK reject)
// -----------------------------------------------------------------------------
func TestRLS_Notification_CrossTenantInsert(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

	// A real user living in tenant B (so the only thing wrong is the center).
	TenantContext(t, db, centerB.ID)
	victim := CreateUser(t, db, "rls-victim-"+uuid.NewString()[:8]+"@example.com", "Victim")
	CreateCenterMember(t, db, victim.ID, centerB.ID, "student")

	TenantContext(t, db, centerA.ID)
	_, err := generated.New(db).InsertNotification(ctx, generated.InsertNotificationParams{
		CenterID: centerB.ID, // attempt to plant a row into tenant B
		UserID:   victim.ID,
		Type:     generated.NotificationTypePaymentFailed,
		Title:    "x",
		Body:     "x",
		Link:     "/x",
		Metadata: []byte(`{}`),
	})
	if err == nil {
		t.Error("RLS VIOLATION: cross-tenant INSERT on notifications should have been rejected by WITH CHECK")
	}
}

// -----------------------------------------------------------------------------
// Pattern 3 — CrossTenantWrite (UPDATE 0-row)
// -----------------------------------------------------------------------------
func TestRLS_Notification_CrossTenantWrite(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()
	queries := generated.New(db)

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

	TenantContext(t, db, centerB.ID)
	original := seedRLSNotification(t, db, centerB.ID)

	// Tenant A attempts to mark tenant B's row read (ownership params are B's, so
	// the ONLY barrier under test is RLS, not the user_id gate).
	TenantContext(t, db, centerA.ID)
	_, _ = queries.MarkNotificationRead(ctx, generated.MarkNotificationReadParams{
		ID:     original.ID,
		UserID: original.UserID,
		ReadAt: timestampParam(time.Date(2026, 10, 6, 12, 0, 0, 0, time.UTC)),
	})

	// Re-read as tenant B — read_at must still be NULL.
	TenantContext(t, db, centerB.ID)
	var readAt pgtype.Timestamptz
	if err := db.QueryRow(ctx,
		"SELECT read_at FROM notifications WHERE id = $1", original.ID,
	).Scan(&readAt); err != nil {
		t.Fatalf("re-read as tenant B: %v", err)
	}
	if readAt.Valid {
		t.Errorf("RLS VIOLATION: tenant A UPDATE against tenant B row succeeded (read_at was set)")
	}
}

// -----------------------------------------------------------------------------
// Pattern 4 — CrossTenantDelete (raw DELETE 0-row)
// -----------------------------------------------------------------------------
func TestRLS_Notification_CrossTenantDelete(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")

	TenantContext(t, db, centerB.ID)
	target := seedRLSNotification(t, db, centerB.ID)

	TenantContext(t, db, centerA.ID)
	_, _ = db.Exec(ctx, "DELETE FROM notifications WHERE id = $1", target.ID)

	TenantContext(t, db, centerB.ID)
	var stillExists int
	if err := db.QueryRow(ctx,
		"SELECT count(*) FROM notifications WHERE id = $1", target.ID,
	).Scan(&stillExists); err != nil {
		t.Fatalf("count target row as tenant B: %v", err)
	}
	if stillExists != 1 {
		t.Errorf("RLS VIOLATION: cross-tenant DELETE succeeded — tenant B row is gone")
	}
}

// -----------------------------------------------------------------------------
// Pattern 5 — NullTenant (empty string → NULLIF → NULL → zero rows)
// -----------------------------------------------------------------------------
func TestRLS_Notification_NullTenant(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	TenantContext(t, db, center.ID)
	seedRLSNotification(t, db, center.ID)

	resetTenantContext(t, db)
	var count int
	if err := db.QueryRow(ctx,
		"SELECT count(*) FROM notifications WHERE center_id = $1", center.ID,
	).Scan(&count); err != nil {
		t.Fatalf("count with null tenant: %v", err)
	}
	if count != 0 {
		t.Errorf("RLS VIOLATION: null tenant returned %d notification rows, expected 0", count)
	}
}

// -----------------------------------------------------------------------------
// Pattern 6 — UnsetTenant (RESET → zero rows)
// -----------------------------------------------------------------------------
func TestRLS_Notification_UnsetTenant(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	TenantContext(t, db, center.ID)
	seedRLSNotification(t, db, center.ID)

	resetTenantContextToDefault(t, db)
	var count int
	if err := db.QueryRow(ctx,
		"SELECT count(*) FROM notifications WHERE center_id = $1", center.ID,
	).Scan(&count); err != nil {
		t.Fatalf("count with unset tenant: %v", err)
	}
	if count != 0 {
		t.Errorf("RLS VIOLATION: unset tenant returned %d notification rows, expected 0", count)
	}
}
