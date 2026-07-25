// Story 2.7 — R1 (score 9) adversarial RLS grid for bulk import. An import
// committed by tenant A must be INVISIBLE and IMMUTABLE to tenant B, at both
// read and write (TEST-BE-1). This complements the handler-level cross-tenant
// FILE-KEY 403 (student_import_handler_atdd_test.go): that guards the GetObject
// read path; THIS guards the persisted rows. Both are required — neither
// catches the other's leak (story Blocker #4).
//
// Compiled only under `-tags atdd_red_phase`. Mirrors enrollments_rls_test.go.
package test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// importConfirmAs POSTs a confirm request to the import mux with the given
// bearer token and returns the recorder.
func importConfirmAs(t *testing.T, mux http.Handler, token, key string) *httptest.ResponseRecorder {
	t.Helper()
	payload, _ := json.Marshal(map[string]any{"key": key, "importId": uuid.NewString()})
	req := httptest.NewRequest(http.MethodPost, "/api/students/import", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	return rec
}

// countUnderTenant runs a COUNT on the app-role pool WITH RLS context set to the
// given center — i.e. exactly what a request for that tenant would see.
func countUnderTenant(t *testing.T, pool *pgxpool.Pool, centerID, query string, args ...any) int {
	t.Helper()
	ctx := context.Background()
	conn, err := pool.Acquire(ctx)
	if err != nil {
		t.Fatalf("acquire app conn: %v", err)
	}
	defer conn.Release()
	tx, err := conn.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, fmt.Sprintf("SET LOCAL app.current_tenant_id = '%s'", centerID)); err != nil {
		t.Fatalf("set tenant %s: %v", centerID, err)
	}
	var n int
	if err := tx.QueryRow(ctx, query, args...).Scan(&n); err != nil {
		t.Fatalf("count under tenant %s: %v", centerID, err)
	}
	return n
}

func seedImportRLSCenters(t *testing.T) (mux http.Handler, ownerTok, centerAID, centerBID, importKey, studentEmail string) {
	t.Helper()
	pool := SetupRawPool(t)
	sp := SuperuserPool(t)
	ctx := context.Background()
	sfx := uuid.NewString()[:8]

	owner := CreateUserOnPool(t, pool, "ownerA-"+sfx+"@example.com", "Owner A")
	MarkUserEmailVerifiedOnPool(t, pool, owner.ID)
	centerAPg := CreateCenterForOwner(t, pool, owner.ID)
	centerAID = UUIDString(centerAPg)

	if err := sp.QueryRow(ctx,
		`INSERT INTO centers (name, short_code) VALUES ($1,$2) RETURNING id`,
		"Center B "+sfx, "cb-"+sfx).Scan(&centerBID); err != nil {
		t.Fatalf("insert center B: %v", err)
	}

	studentEmail = "victim-" + sfx + "@example.com"
	className := "RLS Class " + sfx
	SeedClass(t, centerAID, className, "active", nil, nil)

	srv := NewStudentImportTestServerBareMux(t, pool)
	importKey = fmt.Sprintf("%s/imports/%s.csv", centerAID, uuid.NewString())
	srv.Storage.SeedObject(importKey, []byte(
		"email,full_name,class_name\n"+studentEmail+",Victim Student,"+className+"\n"))

	t.Cleanup(func() {
		var uid string
		if err := sp.QueryRow(ctx, `SELECT id FROM users WHERE lower(email)=lower($1)`, studentEmail).Scan(&uid); err == nil {
			_, _ = sp.Exec(ctx, `DELETE FROM enrollments WHERE student_id = $1`, uid)
			_, _ = sp.Exec(ctx, `DELETE FROM center_members WHERE user_id = $1`, uid)
			_, _ = sp.Exec(ctx, `DELETE FROM invites WHERE lower(email)=lower($1)`, studentEmail)
			_, _ = sp.Exec(ctx, `DELETE FROM users WHERE id = $1`, uid)
		}
		_, _ = sp.Exec(ctx, `DELETE FROM audit_logs WHERE entity_type='center' AND entity_id = $1`, centerAID)
		_, _ = sp.Exec(ctx, `DELETE FROM enrollments WHERE center_id = $1`, centerAID)
		_, _ = sp.Exec(ctx, `DELETE FROM centers WHERE id = $1`, centerBID)
	})

	return srv.Mux, SignAccessTokenForRole(t, owner.ID, centerAID, "owner"), centerAID, centerBID, importKey, studentEmail
}

// -----------------------------------------------------------------------------
// R1 READ isolation — tenant B cannot see tenant A's imported member/enrollment.
// -----------------------------------------------------------------------------

func TestRLS_Import_CrossTenantRead(t *testing.T) {
	pool := SetupRawPool(t)
	mux, ownerTok, centerAID, centerBID, key, email := seedImportRLSCenters(t)

	rec := importConfirmAs(t, mux, ownerTok, key)
	if rec.Code != http.StatusOK {
		t.Fatalf("owner A confirm → %d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}

	// Tenant A sees its imported enrollment...
	if n := countUnderTenant(t, pool, centerAID,
		`SELECT count(*) FROM enrollments en JOIN users u ON u.id = en.student_id WHERE lower(u.email)=lower($1)`, email); n != 1 {
		t.Fatalf("tenant A enrollment visibility = %d, want 1 (setup sanity)", n)
	}
	// ...tenant B sees NOTHING.
	if n := countUnderTenant(t, pool, centerBID,
		`SELECT count(*) FROM enrollments en JOIN users u ON u.id = en.student_id WHERE lower(u.email)=lower($1)`, email); n != 0 {
		t.Errorf("RLS VIOLATION: tenant B can read tenant A's imported enrollment (count=%d)", n)
	}
	if n := countUnderTenant(t, pool, centerBID,
		`SELECT count(*) FROM center_members WHERE center_id = $1`, centerAID); n != 0 {
		t.Errorf("RLS VIOLATION: tenant B can read tenant A's center_members (count=%d)", n)
	}
}

// -----------------------------------------------------------------------------
// R1 WRITE isolation — tenant B's UPDATE against tenant A's imported enrollment
// affects 0 rows (a 0-row UPDATE is not an error in Postgres — assert the row is
// unmutated).
// -----------------------------------------------------------------------------

func TestRLS_Import_CrossTenantWrite(t *testing.T) {
	pool := SetupRawPool(t)
	sp := SuperuserPool(t)
	ctx := context.Background()
	mux, ownerTok, _, centerBID, key, email := seedImportRLSCenters(t)

	rec := importConfirmAs(t, mux, ownerTok, key)
	if rec.Code != http.StatusOK {
		t.Fatalf("owner A confirm → %d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}

	// Attempt to withdraw tenant A's enrollment while scoped to tenant B.
	conn, err := pool.Acquire(ctx)
	if err != nil {
		t.Fatalf("acquire app conn: %v", err)
	}
	defer conn.Release()
	tx, err := conn.Begin(ctx)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	if _, err := tx.Exec(ctx, fmt.Sprintf("SET LOCAL app.current_tenant_id = '%s'", centerBID)); err != nil {
		_ = tx.Rollback(ctx)
		t.Fatalf("set tenant B: %v", err)
	}
	tag, err := tx.Exec(ctx,
		`UPDATE enrollments SET status = 'withdrawn'
		 WHERE student_id = (SELECT id FROM users WHERE lower(email) = lower($1))`, email)
	if err != nil {
		_ = tx.Rollback(ctx)
		t.Fatalf("cross-tenant update errored (want 0-rows, not error): %v", err)
	}
	_ = tx.Commit(ctx)
	if tag.RowsAffected() != 0 {
		t.Errorf("RLS VIOLATION: tenant B UPDATE affected %d tenant-A enrollment rows, want 0", tag.RowsAffected())
	}

	// Re-verify via superuser that the row is still active.
	var status string
	if err := sp.QueryRow(ctx,
		`SELECT en.status FROM enrollments en JOIN users u ON u.id = en.student_id WHERE lower(u.email) = lower($1)`,
		email).Scan(&status); err != nil {
		t.Fatalf("re-fetch enrollment status: %v", err)
	}
	if status != "active" {
		t.Errorf("enrollment status = %q, want active (cross-tenant write must not mutate)", status)
	}
}
