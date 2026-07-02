// Story 2.1 Task 12.2 — CenterService unit tests.
//
// Per the "AuthDB reuse" acknowledgment in Dev Notes §2, these tests use
// test.SetupDB rather than a mocked store interface. The tx atomicity /
// slug retry / one-center-per-user invariants are already covered by the
// concurrent integration tests (adversarial_test.go + centers_slug_collision_race_test.go)
// and the handler ATDD suite. This file adds focused coverage of two
// pieces that are cheaper to prove in isolation than through handlers:
//   - validation (empty name → ValidationError before any DB touch)
//   - fallback slug when Slugify returns "" (all-punctuation input)
package service_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/ducdo/classlite-api/internal/test"
	"github.com/google/uuid"
)

func TestCenterService_CreateCenter_EmptyName_ReturnsValidationError(t *testing.T) {
	db := test.SetupDB(t)
	user := test.CreateUser(t, db, "empty-name@example.com", "E")
	test.MarkUserEmailVerified(t, db, user.ID)
	uid, _ := uuid.Parse(test.UUIDString(user.ID))

	auditSvc := service.NewAuditService(db)
	svc := service.NewCenterService(db, auditSvc, test.MockAccessTokenIssuer{}, clock.RealClock{})

	_, err := svc.CreateCenter(context.Background(), uid, service.CreateCenterInput{Name: "   "})
	var vErr model.ValidationError
	if !errors.As(err, &vErr) {
		t.Errorf("whitespace-only name → want ValidationError, got %T (%v)", err, err)
	}
}

func TestCenterService_CreateCenter_AllPunctuationName_UsesFallbackSlug(t *testing.T) {
	db := test.SetupDB(t)
	user := test.CreateUser(t, db, "all-punct@example.com", "P")
	test.MarkUserEmailVerified(t, db, user.ID)
	uid, _ := uuid.Parse(test.UUIDString(user.ID))

	auditSvc := service.NewAuditService(db)
	svc := service.NewCenterService(db, auditSvc, test.MockAccessTokenIssuer{}, clock.RealClock{})

	result, err := svc.CreateCenter(context.Background(), uid, service.CreateCenterInput{Name: "!!!"})
	if err != nil {
		t.Fatalf("CreateCenter with all-punct name: %v", err)
	}
	// Fallback slug is `center-<random 6-char>` — no meaningful prefix
	// derives from `!!!`, so the slug MUST begin with `center-`.
	if !strings.HasPrefix(result.ShortCode, "center-") {
		t.Errorf("fallback slug missing `center-` prefix: %q", result.ShortCode)
	}
	if len(result.ShortCode) < len("center-")+1 {
		t.Errorf("fallback slug too short: %q", result.ShortCode)
	}
	if result.Role != "owner" {
		t.Errorf("role = %q, want owner", result.Role)
	}
}

func TestCenterService_CreateCenter_ZeroUUID_ReturnsValidationError(t *testing.T) {
	db := test.SetupDB(t)
	auditSvc := service.NewAuditService(db)
	svc := service.NewCenterService(db, auditSvc, test.MockAccessTokenIssuer{}, clock.RealClock{})

	_, err := svc.CreateCenter(context.Background(), uuid.Nil, service.CreateCenterInput{Name: "Valid Name"})
	var vErr model.ValidationError
	if !errors.As(err, &vErr) {
		t.Errorf("zero UUID → want ValidationError, got %T (%v)", err, err)
	}
}
