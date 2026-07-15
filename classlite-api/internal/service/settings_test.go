// Story 2-5a — SettingsService unit tests (real-DB variant per Story 2.1
// convention). Coverage per story Task 3.5 service tests bullet:
//   - GetCenter happy path
//   - UpdateCenter partial: name-only, contactEmail-only, timezone-only
//   - Timezone-whitelist rejection → UnsupportedTimezoneError
//   - contactEmail parseability rejection → ValidationError
//   - Name length rejection → ValidationError
//   - Audit-row shape (before/after) written atomically
package service_test

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/ducdo/classlite-api/internal/test"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// seedOwnerCenter creates a verified Owner + a center via CenterService,
// returning the resolved TenantContext ready for SettingsService calls.
func seedOwnerCenter(t *testing.T, db *test.TxDB, name string) (model.TenantContext, uuid.UUID) {
	t.Helper()
	user := test.CreateUser(t, db, name+"@example.com", name)
	test.MarkUserEmailVerified(t, db, user.ID)
	uid, _ := uuid.Parse(test.UUIDString(user.ID))

	auditSvc := service.NewAuditService(db)
	centerSvc := service.NewCenterService(db, auditSvc, test.MockAccessTokenIssuer{}, clock.RealClock{})
	res, err := centerSvc.CreateCenter(context.Background(), uid, service.CreateCenterInput{Name: name})
	if err != nil {
		t.Fatalf("seed center: %v", err)
	}
	return model.TenantContext{
		UserID:   uid.String(),
		CenterID: res.ID.String(),
		Role:     "owner",
	}, res.ID
}

func TestSettingsService_GetCenter_ReturnsProfile(t *testing.T) {
	db := test.SetupDB(t)
	tc, centerID := seedOwnerCenter(t, db, "Getty Center")

	svc := service.NewSettingsService(db, service.NewAuditService(db), clock.RealClock{})
	profile, err := svc.GetCenter(context.Background(), tc)
	if err != nil {
		t.Fatalf("GetCenter: %v", err)
	}
	if profile.ID != centerID {
		t.Errorf("profile.ID = %s, want %s", profile.ID, centerID)
	}
	if profile.Name != "Getty Center" {
		t.Errorf("profile.Name = %q, want Getty Center", profile.Name)
	}
	if profile.Timezone != "Asia/Ho_Chi_Minh" {
		t.Errorf("profile.Timezone = %q, want Asia/Ho_Chi_Minh (default)", profile.Timezone)
	}
	if profile.ContactEmail != nil {
		t.Errorf("profile.ContactEmail should be nil at creation, got %q", *profile.ContactEmail)
	}
}

func TestSettingsService_UpdateCenter_NameOnly_LeavesOtherFieldsUnchanged(t *testing.T) {
	db := test.SetupDB(t)
	tc, _ := seedOwnerCenter(t, db, "Old Name")

	svc := service.NewSettingsService(db, service.NewAuditService(db), clock.RealClock{})
	newName := "New Name"
	updated, err := svc.UpdateCenter(context.Background(), tc, service.UpdateCenterInput{Name: &newName})
	if err != nil {
		t.Fatalf("UpdateCenter name-only: %v", err)
	}
	if updated.Name != newName {
		t.Errorf("Name = %q, want %q", updated.Name, newName)
	}
	if updated.Timezone != "Asia/Ho_Chi_Minh" {
		t.Errorf("Timezone changed unexpectedly: %q", updated.Timezone)
	}
	if updated.ContactEmail != nil {
		t.Errorf("ContactEmail changed unexpectedly: %v", updated.ContactEmail)
	}
}

func TestSettingsService_UpdateCenter_ContactEmailOnly_Persists(t *testing.T) {
	db := test.SetupDB(t)
	tc, _ := seedOwnerCenter(t, db, "Email Test Center")

	svc := service.NewSettingsService(db, service.NewAuditService(db), clock.RealClock{})
	email := "hello@example.com"
	updated, err := svc.UpdateCenter(context.Background(), tc, service.UpdateCenterInput{ContactEmail: &email})
	if err != nil {
		t.Fatalf("UpdateCenter contact-email-only: %v", err)
	}
	if updated.ContactEmail == nil || *updated.ContactEmail != email {
		t.Errorf("ContactEmail = %v, want %q", updated.ContactEmail, email)
	}
	if updated.Name != "Email Test Center" {
		t.Errorf("Name changed unexpectedly: %q", updated.Name)
	}
}

func TestSettingsService_UpdateCenter_TimezoneInWhitelist_Persists(t *testing.T) {
	db := test.SetupDB(t)
	tc, _ := seedOwnerCenter(t, db, "TZ Center")

	svc := service.NewSettingsService(db, service.NewAuditService(db), clock.RealClock{})
	tz := "Europe/London"
	updated, err := svc.UpdateCenter(context.Background(), tc, service.UpdateCenterInput{Timezone: &tz})
	if err != nil {
		t.Fatalf("UpdateCenter timezone-only: %v", err)
	}
	if updated.Timezone != tz {
		t.Errorf("Timezone = %q, want %q", updated.Timezone, tz)
	}
}

func TestSettingsService_UpdateCenter_TimezoneNotInWhitelist_ReturnsUnsupportedTimezoneError(t *testing.T) {
	db := test.SetupDB(t)
	tc, _ := seedOwnerCenter(t, db, "Bad TZ Center")

	svc := service.NewSettingsService(db, service.NewAuditService(db), clock.RealClock{})
	tz := "Antarctica/Vostok"
	_, err := svc.UpdateCenter(context.Background(), tc, service.UpdateCenterInput{Timezone: &tz})

	var utErr *service.UnsupportedTimezoneError
	if !errors.As(err, &utErr) {
		t.Fatalf("want *UnsupportedTimezoneError, got %T (%v)", err, err)
	}
	if utErr.Timezone != tz {
		t.Errorf("Timezone = %q, want %q", utErr.Timezone, tz)
	}
}

func TestSettingsService_UpdateCenter_InvalidContactEmail_ReturnsValidationError(t *testing.T) {
	db := test.SetupDB(t)
	tc, _ := seedOwnerCenter(t, db, "Bad Email Center")

	svc := service.NewSettingsService(db, service.NewAuditService(db), clock.RealClock{})
	badEmail := "not-an-email"
	_, err := svc.UpdateCenter(context.Background(), tc, service.UpdateCenterInput{ContactEmail: &badEmail})

	var vErr model.ValidationError
	if !errors.As(err, &vErr) {
		t.Fatalf("want ValidationError, got %T (%v)", err, err)
	}
	if len(vErr.Fields) == 0 || vErr.Fields[0].Field != "contactEmail" {
		t.Errorf("expected contactEmail field error, got %+v", vErr.Fields)
	}
}

func TestSettingsService_UpdateCenter_NameTooLong_ReturnsValidationError(t *testing.T) {
	db := test.SetupDB(t)
	tc, _ := seedOwnerCenter(t, db, "Long Name Center")

	svc := service.NewSettingsService(db, service.NewAuditService(db), clock.RealClock{})
	long := strings.Repeat("A", 121)
	_, err := svc.UpdateCenter(context.Background(), tc, service.UpdateCenterInput{Name: &long})

	var vErr model.ValidationError
	if !errors.As(err, &vErr) {
		t.Fatalf("want ValidationError, got %T (%v)", err, err)
	}
	if len(vErr.Fields) == 0 || vErr.Fields[0].Field != "name" {
		t.Errorf("expected name field error, got %+v", vErr.Fields)
	}
}

func TestSettingsService_UpdateCenter_EmptyNameTrimmed_ReturnsValidationError(t *testing.T) {
	db := test.SetupDB(t)
	tc, _ := seedOwnerCenter(t, db, "Space Center")

	svc := service.NewSettingsService(db, service.NewAuditService(db), clock.RealClock{})
	empty := "   "
	_, err := svc.UpdateCenter(context.Background(), tc, service.UpdateCenterInput{Name: &empty})

	var vErr model.ValidationError
	if !errors.As(err, &vErr) {
		t.Fatalf("want ValidationError, got %T (%v)", err, err)
	}
}

func TestSettingsService_UpdateCenter_WritesAuditRow_WithBeforeAndAfterShape(t *testing.T) {
	db := test.SetupDB(t)
	tc, centerID := seedOwnerCenter(t, db, "Audit Test Center")

	svc := service.NewSettingsService(db, service.NewAuditService(db), clock.RealClock{})
	newName := "Audit Test Center Renamed"
	newEmail := "audit@example.com"
	if _, err := svc.UpdateCenter(context.Background(), tc, service.UpdateCenterInput{
		Name:         &newName,
		ContactEmail: &newEmail,
	}); err != nil {
		t.Fatalf("UpdateCenter: %v", err)
	}

	// Read back the most recent center.updated audit row for this center.
	// We must set tenant context on the tx to satisfy audit_logs RLS.
	centerPg := mustPgUUID(t, tc.CenterID)
	tenantCtx := test.TenantContext(t, db, centerPg)
	var action, entityType string
	var entityID [16]byte
	var changesJSON []byte
	err := db.QueryRow(tenantCtx,
		`SELECT action, entity_type, entity_id, changes
		   FROM audit_logs
		  WHERE center_id = $1 AND action = 'center.updated'
		  ORDER BY created_at DESC LIMIT 1`,
		centerPg,
	).Scan(&action, &entityType, &entityID, &changesJSON)
	if err != nil {
		t.Fatalf("read audit row: %v", err)
	}
	if action != "center.updated" {
		t.Errorf("action = %q, want center.updated", action)
	}
	if entityType != "center" {
		t.Errorf("entity_type = %q, want center", entityType)
	}
	if uuid.UUID(entityID) != centerID {
		t.Errorf("entity_id = %s, want %s", uuid.UUID(entityID), centerID)
	}

	var parsed struct {
		Before map[string]any `json:"before"`
		After  map[string]any `json:"after"`
	}
	if err := json.Unmarshal(changesJSON, &parsed); err != nil {
		t.Fatalf("unmarshal changes: %v", err)
	}
	if parsed.Before["name"] != "Audit Test Center" {
		t.Errorf("before.name = %v, want Audit Test Center", parsed.Before["name"])
	}
	if parsed.After["name"] != newName {
		t.Errorf("after.name = %v, want %q", parsed.After["name"], newName)
	}
	if parsed.After["contact_email"] != newEmail {
		t.Errorf("after.contact_email = %v, want %q", parsed.After["contact_email"], newEmail)
	}
	if parsed.Before["contact_email"] != nil {
		t.Errorf("before.contact_email = %v, want nil", parsed.Before["contact_email"])
	}
}

func mustPgUUID(t *testing.T, s string) pgtype.UUID {
	t.Helper()
	u, err := uuid.Parse(s)
	if err != nil {
		t.Fatalf("parse uuid %q: %v", s, err)
	}
	return pgtype.UUID{Bytes: u, Valid: true}
}
