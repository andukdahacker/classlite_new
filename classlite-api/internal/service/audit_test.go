package service_test

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/ducdo/classlite-api/internal/store/generated"
	"github.com/ducdo/classlite-api/internal/test"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

func TestAuditService_Log_Inserts(t *testing.T) {
	db := test.SetupDB(t)
	ctx := context.Background()

	center := test.CreateCenterWithID(t, db, test.TenantAID, "Center A", "center-a")
	user := test.CreateUser(t, db, "alice@example.com", "Alice")

	// Enrol the actor into the center under the matching tenant context.
	test.TenantContext(t, db, center.ID)
	test.CreateCenterMember(t, db, user.ID, center.ID, "owner")

	tc := model.TenantContext{
		CenterID: test.UUIDString(center.ID),
		UserID:   test.UUIDString(user.ID),
		Role:     "owner",
	}
	ctx = context.WithValue(ctx, model.IPAddress, "203.0.113.42")

	svc := service.NewAuditService(db)

	entityID := uuid.New()
	changes := service.Changes{
		Before: map[string]string{"role": "teacher"},
		After:  map[string]string{"role": "admin"},
	}

	if err := svc.Log(ctx, tc, "role.update", "center_member", entityID, changes); err != nil {
		t.Fatalf("Log: %v", err)
	}

	// Re-set tenant context — savepoint commits don't propagate SET LOCAL upward.
	test.TenantContext(t, db, center.ID)

	rows, err := generated.New(db).ListAuditLogsByEntity(ctx, generated.ListAuditLogsByEntityParams{
		CenterID:   center.ID,
		EntityType: "center_member",
		EntityID:   pgtype.UUID{Bytes: entityID, Valid: true},
	})
	if err != nil {
		t.Fatalf("ListAuditLogsByEntity: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("expected 1 audit row, got %d", len(rows))
	}

	row := rows[0]
	if row.Action != "role.update" {
		t.Errorf("action = %q, want %q", row.Action, "role.update")
	}
	if row.EntityType != "center_member" {
		t.Errorf("entity_type = %q", row.EntityType)
	}
	if !row.IpAddress.Valid || row.IpAddress.String != "203.0.113.42" {
		t.Errorf("ip_address = %+v, want 203.0.113.42", row.IpAddress)
	}

	var stored service.Changes
	if err := json.Unmarshal(row.Changes, &stored); err != nil {
		t.Fatalf("unmarshal changes: %v", err)
	}
	if stored.Before == nil || stored.After == nil {
		t.Errorf("expected before/after both set, got %+v", stored)
	}
}

func TestAuditService_Log_OmittedIP(t *testing.T) {
	db := test.SetupDB(t)
	ctx := context.Background()

	center := test.CreateCenterWithID(t, db, test.TenantAID, "Center A", "center-a")
	user := test.CreateUser(t, db, "alice@example.com", "Alice")

	test.TenantContext(t, db, center.ID)
	test.CreateCenterMember(t, db, user.ID, center.ID, "owner")

	tc := model.TenantContext{
		CenterID: test.UUIDString(center.ID),
		UserID:   test.UUIDString(user.ID),
		Role:     "owner",
	}

	svc := service.NewAuditService(db)
	entityID := uuid.New()

	if err := svc.Log(ctx, tc, "billing.update", "subscription", entityID, nil); err != nil {
		t.Fatalf("Log: %v", err)
	}

	test.TenantContext(t, db, center.ID)
	rows, err := generated.New(db).ListAuditLogsByEntity(ctx, generated.ListAuditLogsByEntityParams{
		CenterID:   center.ID,
		EntityType: "subscription",
		EntityID:   pgtype.UUID{Bytes: entityID, Valid: true},
	})
	if err != nil {
		t.Fatalf("ListAuditLogsByEntity: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("expected 1 audit row, got %d", len(rows))
	}
	if rows[0].IpAddress.Valid {
		t.Errorf("expected NULL ip_address, got %q", rows[0].IpAddress.String)
	}
}

// Typed-nil pointer in `changes any` must be coalesced to `{}` JSONB, not "null".
func TestAuditService_Log_TypedNilChanges(t *testing.T) {
	db := test.SetupDB(t)
	ctx := context.Background()

	center := test.CreateCenterWithID(t, db, test.TenantAID, "Center A", "center-a")
	user := test.CreateUser(t, db, "alice@example.com", "Alice")

	test.TenantContext(t, db, center.ID)
	test.CreateCenterMember(t, db, user.ID, center.ID, "owner")

	tc := model.TenantContext{
		CenterID: test.UUIDString(center.ID),
		UserID:   test.UUIDString(user.ID),
		Role:     "owner",
	}

	svc := service.NewAuditService(db)
	entityID := uuid.New()

	var typedNil *service.Changes // typed nil — passes `c == nil` is false
	if err := svc.Log(ctx, tc, "role.update", "center_member", entityID, typedNil); err != nil {
		t.Fatalf("Log: %v", err)
	}

	test.TenantContext(t, db, center.ID)
	rows, err := generated.New(db).ListAuditLogsByEntity(ctx, generated.ListAuditLogsByEntityParams{
		CenterID:   center.ID,
		EntityType: "center_member",
		EntityID:   pgtype.UUID{Bytes: entityID, Valid: true},
	})
	if err != nil {
		t.Fatalf("ListAuditLogsByEntity: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("expected 1 audit row, got %d", len(rows))
	}
	// Stored JSONB must be an object, not the literal "null".
	got := string(rows[0].Changes)
	if got == "null" {
		t.Errorf("typed-nil changes persisted as literal null; want JSON object")
	}
}

func TestAuditService_Log_RejectsMissingAction(t *testing.T) {
	svc := service.NewAuditService(nopBeginner{})
	tc := model.TenantContext{CenterID: uuid.New().String(), UserID: uuid.New().String(), Role: "owner"}
	err := svc.Log(context.Background(), tc, "", "subscription", uuid.New(), nil)
	assertValidationError(t, err, "action")
}

func TestAuditService_Log_RejectsMissingEntityType(t *testing.T) {
	svc := service.NewAuditService(nopBeginner{})
	tc := model.TenantContext{CenterID: uuid.New().String(), UserID: uuid.New().String(), Role: "owner"}
	err := svc.Log(context.Background(), tc, "update", "", uuid.New(), nil)
	assertValidationError(t, err, "entity_type")
}

func TestAuditService_Log_RejectsMissingUserID(t *testing.T) {
	svc := service.NewAuditService(nopBeginner{})
	tc := model.TenantContext{CenterID: uuid.New().String(), UserID: "", Role: "owner"}
	err := svc.Log(context.Background(), tc, "update", "subscription", uuid.New(), nil)
	assertValidationError(t, err, "user_id")
}

func TestAuditService_Log_RejectsInvalidCenterID(t *testing.T) {
	svc := service.NewAuditService(nopBeginner{})
	tc := model.TenantContext{CenterID: "not-a-uuid", UserID: uuid.New().String(), Role: "owner"}
	err := svc.Log(context.Background(), tc, "update", "subscription", uuid.New(), nil)
	assertValidationError(t, err, "center_id")
}

// assertValidationError requires that err is a model.ValidationError (GO-2)
// carrying at least one FieldError for the named field.
func assertValidationError(t *testing.T, err error, field string) {
	t.Helper()
	if err == nil {
		t.Fatalf("expected validation error for field %q, got nil", field)
	}
	var ve model.ValidationError
	if !errors.As(err, &ve) {
		t.Fatalf("expected model.ValidationError, got %T: %v", err, err)
	}
	for _, fe := range ve.Fields {
		if fe.Field == field {
			return
		}
	}
	t.Errorf("ValidationError did not include field %q (fields: %+v)", field, ve.Fields)
}
