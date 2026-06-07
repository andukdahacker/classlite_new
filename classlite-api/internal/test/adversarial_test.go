package test

import (
	"context"
	"testing"
	"time"

	"github.com/ducdo/classlite-api/internal/store/generated"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// timestampParam creates a valid pgtype.Timestamptz from a time.Time.
func timestampParam(t time.Time) pgtype.Timestamptz {
	return pgtype.Timestamptz{Time: t, Valid: true}
}

// resetTenantContext clears the tenant context by setting it to empty string.
// The NULLIF pattern in RLS policies converts this to NULL → zero rows.
func resetTenantContext(t *testing.T, db *TxDB) {
	t.Helper()
	_, err := db.Tx.Exec(context.Background(), "SET LOCAL app.current_tenant_id = ''")
	if err != nil {
		t.Fatalf("reset tenant context: %v", err)
	}
}

// resetTenantContextToDefault resets the setting entirely.
func resetTenantContextToDefault(t *testing.T, db *TxDB) {
	t.Helper()
	_, err := db.Tx.Exec(context.Background(), "RESET app.current_tenant_id")
	if err != nil {
		t.Fatalf("reset tenant context to default: %v", err)
	}
}

// --- center_members RLS tests ---

func TestRLS_CenterMembers_CrossTenantRead(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()
	queries := generated.New(db)

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")
	userA := CreateUser(t, db, "alice@example.com", "Alice")
	userB := CreateUser(t, db, "bob@example.com", "Bob")

	// Insert member into center A under tenant A context
	TenantContext(t, db, centerA.ID)
	_, err := queries.CreateCenterMember(ctx, generated.CreateCenterMemberParams{
		UserID:   userA.ID,
		CenterID: centerA.ID,
		Role:     "owner",
	})
	if err != nil {
		t.Fatalf("create center member A: %v", err)
	}

	// Insert member into center B under tenant B context
	TenantContext(t, db, centerB.ID)
	_, err = queries.CreateCenterMember(ctx, generated.CreateCenterMemberParams{
		UserID:   userB.ID,
		CenterID: centerB.ID,
		Role:     "owner",
	})
	if err != nil {
		t.Fatalf("create center member B: %v", err)
	}

	// Switch to tenant A — should only see tenant A's member
	TenantContext(t, db, centerA.ID)
	members, err := queries.ListCenterMembersByCenter(ctx, centerA.ID)
	if err != nil {
		t.Fatalf("list center members as tenant A: %v", err)
	}
	if len(members) != 1 {
		t.Errorf("RLS VIOLATION: expected 1 member for tenant A, got %d", len(members))
	}

	// Tenant A querying center B's members — should get zero
	membersB, err := queries.ListCenterMembersByCenter(ctx, centerB.ID)
	if err != nil {
		t.Fatalf("list center B members as tenant A: %v", err)
	}
	if len(membersB) != 0 {
		t.Errorf("RLS VIOLATION: tenant A can read tenant B data, got %d rows", len(membersB))
	}
}

func TestRLS_CenterMembers_CrossTenantWrite(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")
	userB := CreateUser(t, db, "bob@example.com", "Bob")

	// Create member in center B
	TenantContext(t, db, centerB.ID)
	queries := generated.New(db)
	_, err := queries.CreateCenterMember(ctx, generated.CreateCenterMemberParams{
		UserID:   userB.ID,
		CenterID: centerB.ID,
		Role:     "teacher",
	})
	if err != nil {
		t.Fatalf("create center member B: %v", err)
	}

	// Switch to tenant A — attempt to UPDATE tenant B's member
	TenantContext(t, db, centerA.ID)
	tag, err := db.Exec(ctx,
		"UPDATE center_members SET role = 'owner' WHERE user_id = $1 AND center_id = $2",
		userB.ID, centerB.ID)
	if err != nil {
		t.Fatalf("cross-tenant update: %v", err)
	}
	if tag.RowsAffected() != 0 {
		t.Errorf("RLS VIOLATION: cross-tenant UPDATE affected %d rows", tag.RowsAffected())
	}

	// Verify original data unchanged
	TenantContext(t, db, centerB.ID)
	member, err := queries.GetCenterMemberByUserAndCenter(ctx, generated.GetCenterMemberByUserAndCenterParams{
		UserID:   userB.ID,
		CenterID: centerB.ID,
	})
	if err != nil {
		t.Fatalf("get member as tenant B: %v", err)
	}
	if member.Role != "teacher" {
		t.Errorf("RLS VIOLATION: cross-tenant write succeeded, role changed to %q", member.Role)
	}
}

func TestRLS_CenterMembers_CrossTenantDelete(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")
	userB := CreateUser(t, db, "bob@example.com", "Bob")

	// Create member in center B
	TenantContext(t, db, centerB.ID)
	queries := generated.New(db)
	_, err := queries.CreateCenterMember(ctx, generated.CreateCenterMemberParams{
		UserID:   userB.ID,
		CenterID: centerB.ID,
		Role:     "teacher",
	})
	if err != nil {
		t.Fatalf("create center member B: %v", err)
	}

	// Switch to tenant A — attempt to DELETE
	TenantContext(t, db, centerA.ID)
	tag, err := db.Exec(ctx,
		"DELETE FROM center_members WHERE user_id = $1 AND center_id = $2",
		userB.ID, centerB.ID)
	if err != nil {
		t.Fatalf("cross-tenant delete: %v", err)
	}
	if tag.RowsAffected() != 0 {
		t.Errorf("RLS VIOLATION: cross-tenant DELETE affected %d rows", tag.RowsAffected())
	}

	// Verify data still exists
	TenantContext(t, db, centerB.ID)
	members, err := queries.ListCenterMembersByCenter(ctx, centerB.ID)
	if err != nil {
		t.Fatalf("list members as tenant B: %v", err)
	}
	if len(members) != 1 {
		t.Errorf("RLS VIOLATION: cross-tenant delete removed data, got %d rows", len(members))
	}
}

func TestRLS_CenterMembers_CrossTenantInsert(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")
	userA := CreateUser(t, db, "alice@example.com", "Alice")

	// Set tenant A context — attempt to insert into center B
	TenantContext(t, db, centerA.ID)
	queries := generated.New(db)
	_, err := queries.CreateCenterMember(ctx, generated.CreateCenterMemberParams{
		UserID:   userA.ID,
		CenterID: centerB.ID,
		Role:     "teacher",
	})
	if err == nil {
		t.Error("RLS VIOLATION: cross-tenant INSERT should have been rejected")
	}
}

func TestRLS_CenterMembers_NullTenant(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	user := CreateUser(t, db, "alice@example.com", "Alice")

	// Insert under correct tenant context
	TenantContext(t, db, center.ID)
	queries := generated.New(db)
	_, err := queries.CreateCenterMember(ctx, generated.CreateCenterMemberParams{
		UserID:   user.ID,
		CenterID: center.ID,
		Role:     "owner",
	})
	if err != nil {
		t.Fatalf("create member: %v", err)
	}

	// Reset tenant context to empty → NULLIF converts to NULL → zero rows
	resetTenantContext(t, db)
	members, err := queries.ListCenterMembersByCenter(ctx, center.ID)
	if err != nil {
		t.Fatalf("list with null tenant: %v", err)
	}
	if len(members) != 0 {
		t.Errorf("RLS VIOLATION: null tenant returned %d rows, expected 0", len(members))
	}
}

func TestRLS_CenterMembers_UnsetTenant(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	user := CreateUser(t, db, "alice@example.com", "Alice")

	// Insert under correct tenant context
	TenantContext(t, db, center.ID)
	queries := generated.New(db)
	_, err := queries.CreateCenterMember(ctx, generated.CreateCenterMemberParams{
		UserID:   user.ID,
		CenterID: center.ID,
		Role:     "owner",
	})
	if err != nil {
		t.Fatalf("create member: %v", err)
	}

	// Reset setting entirely — current_setting(..., true) returns ''
	resetTenantContextToDefault(t, db)
	members, err := queries.ListCenterMembersByCenter(ctx, center.ID)
	if err != nil {
		t.Fatalf("list with unset tenant: %v", err)
	}
	if len(members) != 0 {
		t.Errorf("RLS VIOLATION: unset tenant returned %d rows, expected 0", len(members))
	}
}

// --- invites RLS tests ---

func TestRLS_Invites_CrossTenantRead(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")
	inviterA := CreateUser(t, db, "alice@example.com", "Alice")
	inviterB := CreateUser(t, db, "bob@example.com", "Bob")

	queries := generated.New(db)
	expires := timestampParam(time.Now().Add(24 * time.Hour))

	// Create invite in center A
	TenantContext(t, db, centerA.ID)
	_, err := queries.CreateInvite(ctx, generated.CreateInviteParams{
		CenterID:  centerA.ID,
		InviterID: inviterA.ID,
		Email:     "new-teacher@example.com",
		Role:      "teacher",
		TokenHash: "hash-invite-token-a",
		ExpiresAt: expires,
	})
	if err != nil {
		t.Fatalf("create invite A: %v", err)
	}

	// Create invite in center B
	TenantContext(t, db, centerB.ID)
	_, err = queries.CreateInvite(ctx, generated.CreateInviteParams{
		CenterID:  centerB.ID,
		InviterID: inviterB.ID,
		Email:     "new-student@example.com",
		Role:      "student",
		TokenHash: "hash-invite-token-b",
		ExpiresAt: expires,
	})
	if err != nil {
		t.Fatalf("create invite B: %v", err)
	}

	// Tenant A should only see their invites
	TenantContext(t, db, centerA.ID)
	invites, err := queries.ListInvitesByCenter(ctx, centerA.ID)
	if err != nil {
		t.Fatalf("list invites as tenant A: %v", err)
	}
	if len(invites) != 1 {
		t.Errorf("RLS VIOLATION: expected 1 invite for tenant A, got %d", len(invites))
	}

	// Tenant A querying center B invites — zero
	invitesB, err := queries.ListInvitesByCenter(ctx, centerB.ID)
	if err != nil {
		t.Fatalf("list center B invites as tenant A: %v", err)
	}
	if len(invitesB) != 0 {
		t.Errorf("RLS VIOLATION: tenant A can read tenant B invites, got %d rows", len(invitesB))
	}
}

func TestRLS_Invites_CrossTenantWrite(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")
	inviterB := CreateUser(t, db, "bob@example.com", "Bob")

	queries := generated.New(db)
	expires := timestampParam(time.Now().Add(24 * time.Hour))

	// Create invite in center B
	TenantContext(t, db, centerB.ID)
	invite, err := queries.CreateInvite(ctx, generated.CreateInviteParams{
		CenterID:  centerB.ID,
		InviterID: inviterB.ID,
		Email:     "victim@example.com",
		Role:      "teacher",
		TokenHash: "hash-invite-token-b",
		ExpiresAt: expires,
	})
	if err != nil {
		t.Fatalf("create invite B: %v", err)
	}

	// Switch to tenant A — attempt to mark accepted via raw UPDATE to check rows affected
	TenantContext(t, db, centerA.ID)
	tag, err := db.Exec(ctx, "UPDATE invites SET accepted_at = now() WHERE id = $1", invite.ID)
	if err != nil {
		t.Fatalf("cross-tenant update invite: %v", err)
	}
	if tag.RowsAffected() != 0 {
		t.Errorf("RLS VIOLATION: cross-tenant UPDATE on invite affected %d rows", tag.RowsAffected())
	}

	// Verify invite unchanged as tenant B. ListInvitesByCenter is the
	// closest RLS-respecting accessor now that GetInviteByToken is gone
	// (Story 1.6 — token-based reads go through SECURITY DEFINER).
	TenantContext(t, db, centerB.ID)
	invitesB, err := queries.ListInvitesByCenter(ctx, centerB.ID)
	if err != nil {
		t.Fatalf("list invites as tenant B: %v", err)
	}
	var stillUnaccepted bool
	for _, inv := range invitesB {
		if inv.ID == invite.ID {
			stillUnaccepted = !inv.AcceptedAt.Valid
			break
		}
	}
	if !stillUnaccepted {
		t.Error("RLS VIOLATION: cross-tenant UPDATE on invite succeeded")
	}
}

func TestRLS_Invites_CrossTenantInsert(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	centerA := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	centerB := CreateCenterWithID(t, db, TenantBID, "Center B", "center-b")
	inviterA := CreateUser(t, db, "alice@example.com", "Alice")

	queries := generated.New(db)
	expires := timestampParam(time.Now().Add(24 * time.Hour))

	// Set tenant A — attempt to create invite for center B
	TenantContext(t, db, centerA.ID)
	_, err := queries.CreateInvite(ctx, generated.CreateInviteParams{
		CenterID:  centerB.ID,
		InviterID: inviterA.ID,
		Email:     "hacker@example.com",
		Role:      "owner",
		TokenHash: "hash-evil-invite",
		ExpiresAt: expires,
	})
	if err == nil {
		t.Error("RLS VIOLATION: cross-tenant INSERT on invites should have been rejected")
	}
}

func TestRLS_Invites_NullTenant(t *testing.T) {
	db := SetupDB(t)
	ctx := context.Background()

	center := CreateCenterWithID(t, db, TenantAID, "Center A", "center-a")
	inviter := CreateUser(t, db, "alice@example.com", "Alice")

	queries := generated.New(db)
	expires := timestampParam(time.Now().Add(24 * time.Hour))

	TenantContext(t, db, center.ID)
	_, err := queries.CreateInvite(ctx, generated.CreateInviteParams{
		CenterID:  center.ID,
		InviterID: inviter.ID,
		Email:     "test@example.com",
		Role:      "teacher",
		TokenHash: "hash-token-1",
		ExpiresAt: expires,
	})
	if err != nil {
		t.Fatalf("create invite: %v", err)
	}

	// Null tenant — zero rows
	resetTenantContext(t, db)
	invites, err := queries.ListInvitesByCenter(ctx, center.ID)
	if err != nil {
		t.Fatalf("list with null tenant: %v", err)
	}
	if len(invites) != 0 {
		t.Errorf("RLS VIOLATION: null tenant returned %d invite rows, expected 0", len(invites))
	}
}

// --- SQL injection rejection test (AC4) ---

func TestRLS_SQLInjection_TenantID(t *testing.T) {
	// Verify that SQL injection payloads are rejected by uuid.Parse,
	// the same guard used in production store.SetTenantContext.
	injectionPayloads := []string{
		"'; DROP TABLE users; --",
		"00000000-0000-0000-0000-000000000001' OR '1'='1",
		"<script>alert(1)</script>",
		"' UNION SELECT * FROM users --",
		"",
	}

	for _, payload := range injectionPayloads {
		_, err := uuid.Parse(payload)
		if err == nil {
			t.Errorf("SQL injection payload accepted as valid UUID: %q", payload)
		}
	}
}
