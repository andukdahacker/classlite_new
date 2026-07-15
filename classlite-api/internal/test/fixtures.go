package test

import (
	"context"
	"testing"

	"github.com/ducdo/classlite-api/internal/store/generated"
	"github.com/jackc/pgx/v5/pgtype"
)

// Deterministic tenant IDs for adversarial testing (TEST-BE-1).
const (
	TenantAID = "00000000-0000-0000-0000-000000000001"
	TenantBID = "00000000-0000-0000-0000-000000000002"
)

// CreateUser inserts a user with the given email and full name.
//
// Serializes with concurrent CreateUserOnPool calls on the same email via
// a PostgreSQL transaction-scoped advisory lock. Without this, a
// CreateUserOnPool call in another test binary (Go's default per-package
// parallelism) could hold a committed row on `owner@example.com` while
// this SetupDB-wrapped CreateUser tries to insert the same email in its
// own tx and dies on the `idx_users_email` unique index. pg_advisory_xact_lock
// contends with pg_advisory_lock on the same key, so blocking here waits
// for the CreateUserOnPool caller's t.Cleanup to purge the row + release
// the session lock. Lock releases automatically at tx end (t.Cleanup →
// tx.Rollback).
func CreateUser(t *testing.T, db *TxDB, email, fullName string) generated.User {
	t.Helper()

	ctx := context.Background()
	if _, err := db.Tx.Exec(
		ctx,
		`SELECT pg_advisory_xact_lock($1)`,
		advisoryLockKeyForEmail(email),
	); err != nil {
		t.Fatalf("pg_advisory_xact_lock for %q: %v", email, err)
	}

	queries := generated.New(db)
	user, err := queries.CreateUser(ctx, generated.CreateUserParams{
		Email:    email,
		FullName: fullName,
	})
	if err != nil {
		t.Fatalf("create user %s: %v", email, err)
	}
	return user
}

// CreateCenter inserts a center with the given name and short code.
func CreateCenter(t *testing.T, db *TxDB, name, shortCode string) generated.Center {
	t.Helper()

	queries := generated.New(db)
	center, err := queries.CreateCenter(context.Background(), generated.CreateCenterParams{
		Name:      name,
		ShortCode: shortCode,
	})
	if err != nil {
		t.Fatalf("create center %s: %v", name, err)
	}
	return center
}

// CreateCenterWithID inserts a center with a specific UUID.
// Used for deterministic tenant IDs in adversarial tests (TEST-BE-1).
func CreateCenterWithID(t *testing.T, db *TxDB, id, name, shortCode string) generated.Center {
	t.Helper()

	ctx := context.Background()
	row := db.QueryRow(ctx,
		`INSERT INTO centers (id, name, short_code)
		 VALUES ($1, $2, $3)
		 RETURNING id, name, short_code, brand_color, logo_url, timezone, google_meet_connected, created_at`,
		id, name, shortCode,
	)
	var center generated.Center
	err := row.Scan(
		&center.ID, &center.Name, &center.ShortCode,
		&center.BrandColor, &center.LogoUrl, &center.Timezone,
		&center.GoogleMeetConnected, &center.CreatedAt,
	)
	if err != nil {
		t.Fatalf("create center with id %s: %v", id, err)
	}
	return center
}

// CreateCenterMember inserts a center member. Must be called after setting
// the tenant context via TenantContext for the target center.
func CreateCenterMember(t *testing.T, db *TxDB, userID, centerID pgtype.UUID, role string) generated.CenterMember {
	t.Helper()

	queries := generated.New(db)
	member, err := queries.CreateCenterMember(context.Background(), generated.CreateCenterMemberParams{
		UserID:   userID,
		CenterID: centerID,
		Role:     role,
	})
	if err != nil {
		t.Fatalf("create center member: %v", err)
	}
	return member
}
