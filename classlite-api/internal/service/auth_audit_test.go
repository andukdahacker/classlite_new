package service_test

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/ducdo/classlite-api/internal/test"
	"github.com/google/uuid"
)

type storedAuthAuditRow struct {
	UserID     string
	Event      string
	EntityType string
	EntityID   string
	Changes    []byte
	IPAddress  *string
}

func fetchAuthAuditRowsForUser(t *testing.T, db *test.TxDB, userID string) []storedAuthAuditRow {
	t.Helper()
	rows, err := db.Tx.Query(
		context.Background(),
		`SELECT user_id::text, event, entity_type, entity_id::text, changes, ip_address
		 FROM auth_audit_logs
		 WHERE user_id = $1::uuid
		 ORDER BY created_at ASC`,
		userID,
	)
	if err != nil {
		t.Fatalf("query auth_audit_logs: %v", err)
	}
	defer rows.Close()

	var out []storedAuthAuditRow
	for rows.Next() {
		var row storedAuthAuditRow
		if err := rows.Scan(&row.UserID, &row.Event, &row.EntityType, &row.EntityID, &row.Changes, &row.IPAddress); err != nil {
			t.Fatalf("scan auth_audit_logs: %v", err)
		}
		out = append(out, row)
	}
	return out
}

func TestAuthAuditLogger_Log_InsertsRow(t *testing.T) {
	db := test.SetupDB(t)
	user := test.CreateUser(t, db, "auth-audit@example.com", "Auth Audit")

	logger := service.NewPgAuthAuditLogger(db)
	ctx := context.WithValue(context.Background(), model.IPAddress, "203.0.113.7")

	entityID := uuid.New()
	userUUID, err := uuid.Parse(test.UUIDString(user.ID))
	if err != nil {
		t.Fatalf("parse user uuid: %v", err)
	}

	err = logger.Log(ctx, service.AuthAuditEntry{
		UserID:     userUUID,
		Event:      "user.registered",
		EntityType: "user",
		EntityID:   userUUID,
		Changes:    service.Changes{Before: nil, After: map[string]any{"emailVerified": false}},
	})
	if err != nil {
		t.Fatalf("Log: %v", err)
	}

	rows := fetchAuthAuditRowsForUser(t, db, test.UUIDString(user.ID))
	if len(rows) != 1 {
		t.Fatalf("expected 1 audit row, got %d", len(rows))
	}
	row := rows[0]
	if row.Event != "user.registered" {
		t.Errorf("event = %q, want user.registered", row.Event)
	}
	if row.EntityType != "user" {
		t.Errorf("entity_type = %q, want user", row.EntityType)
	}
	if row.IPAddress == nil || *row.IPAddress != "203.0.113.7" {
		t.Errorf("ip_address = %v, want 203.0.113.7", row.IPAddress)
	}
	_ = entityID // captured into EntityID above

	var c service.Changes
	if err := json.Unmarshal(row.Changes, &c); err != nil {
		t.Fatalf("unmarshal changes: %v", err)
	}
	if c.After == nil {
		t.Errorf("changes.after missing")
	}
}

func TestAuthAuditLogger_Log_WithoutIPLeavesNullColumn(t *testing.T) {
	db := test.SetupDB(t)
	user := test.CreateUser(t, db, "no-ip@example.com", "No IP")

	logger := service.NewPgAuthAuditLogger(db)
	ctx := context.Background()

	userUUID, _ := uuid.Parse(test.UUIDString(user.ID))
	err := logger.Log(ctx, service.AuthAuditEntry{
		UserID:     userUUID,
		Event:      "user.verification_resent",
		EntityType: "user",
		EntityID:   userUUID,
		Changes:    service.Changes{},
	})
	if err != nil {
		t.Fatalf("Log: %v", err)
	}

	rows := fetchAuthAuditRowsForUser(t, db, test.UUIDString(user.ID))
	if len(rows) != 1 {
		t.Fatalf("expected 1 row, got %d", len(rows))
	}
	if rows[0].IPAddress != nil {
		t.Errorf("ip_address should be NULL when ctx has no IPAddress, got %q", *rows[0].IPAddress)
	}
}

func TestAuthAuditLogger_Log_AppendOnlyEnforced(t *testing.T) {
	// REVOKE UPDATE/DELETE/TRUNCATE on auth_audit_logs FROM classlite_app means
	// even SQL fired through the app role must fail.
	db := test.SetupDB(t)
	user := test.CreateUser(t, db, "append-only@example.com", "Append Only")

	logger := service.NewPgAuthAuditLogger(db)
	userUUID, _ := uuid.Parse(test.UUIDString(user.ID))
	if err := logger.Log(context.Background(), service.AuthAuditEntry{
		UserID:     userUUID,
		Event:      "user.registered",
		EntityType: "user",
		EntityID:   userUUID,
	}); err != nil {
		t.Fatalf("Log: %v", err)
	}

	// Verify UPDATE is denied
	_, err := db.Tx.Exec(context.Background(), `UPDATE auth_audit_logs SET event = 'tampered' WHERE user_id = $1::uuid`, test.UUIDString(user.ID))
	if err == nil {
		t.Fatal("expected UPDATE on auth_audit_logs to be denied")
	}
}
