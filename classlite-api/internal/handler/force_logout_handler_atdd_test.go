//go:build atdd_red_phase

// force_logout_handler_atdd_test.go — Story 1.6 ATDD red-phase
// scaffolds for the admin force-logout HTTP layer.
//
// ACCEPTANCE CRITERIA COVERED
//   AC-1.6-06  POST /api/admin/users/{userId}/force-logout
//              → 200 { data: { forcedLogout: true, sessionsRevoked: <N> } }
//   AC-1.6-06  Malformed UUID in path → 422 envelope
//   AC-1.6-07  Cross-tenant target → 404 USER_NOT_FOUND (full envelope)
//   AC-1.6-06  Caller role mismatch (Teacher JWT) → 403 INSUFFICIENT_ROLE
//   AC-1.6-06  Missing JWT → 401 AUTH_REQUIRED
//
// These tests exercise the FULL middleware chain (ExtractTenant →
// RequireRole → ErrorMapper → ForceLogoutHandler) so they're true
// integration tests, not isolated handler unit tests.

package handler_test

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// TestForceLogout_AC06_HappyPath_200Envelope proves the success
// envelope: `{ "data": { "forcedLogout": true, "sessionsRevoked": <N> } }`
// — exact shape per GFW-5.
func TestForceLogout_AC06_HappyPath_200Envelope(t *testing.T) {
	t.Skip("ATDD red phase — wire AdminHandler + RequireRole + ExtractTenant; then remove this skip")

	// Expected:
	//   rec.Code == 200
	//   resp.data.forcedLogout == true
	//   resp.data.sessionsRevoked == <count of seeded refresh tokens>
	//   resp.error == nil
	_ = httptest.NewRequest
	_ = http.MethodPost
}

// TestForceLogout_AC06_MalformedUUID_Returns422 proves the path
// validation: garbage in {userId} short-circuits with a 422
// ValidationError envelope, never reaches the service layer.
func TestForceLogout_AC06_MalformedUUID_Returns422(t *testing.T) {
	t.Skip("ATDD red phase — implement AdminHandler.ForceLogout UUID parse + ValidationError")

	// req := authedRequest("POST", "/api/admin/users/not-a-uuid/force-logout", ownerJWT)
	// ...
	// assert rec.Code == 422
	// assert error.code == "VALIDATION_FAILED"
}

// TestForceLogout_AC06_TeacherCaller_Returns403 proves the
// RequireRole("owner") middleware rejects non-Owner callers with
// 403 INSUFFICIENT_ROLE before the handler runs.
func TestForceLogout_AC06_TeacherCaller_Returns403(t *testing.T) {
	t.Skip("ATDD red phase — implement middleware.RequireRole + wire it in main.go")

	// Mint a JWT for a teacher in the same tenant; assert 403.
	//
	// IMPORTANT — assert the response body shape too:
	//   error.code == "INSUFFICIENT_ROLE"
	//   error.requestId is non-empty (RequestID middleware ran)
	//   error.details is null (per GO-5)
}

// TestForceLogout_AC06_MissingJWT_Returns401 proves the ExtractTenant
// middleware rejects unauthenticated requests with 401 AUTH_REQUIRED.
func TestForceLogout_AC06_MissingJWT_Returns401(t *testing.T) {
	t.Skip("ATDD red phase — ensure ExtractTenant is on the route chain")

	// req := httptest.NewRequest("POST", "/api/admin/users/<uuid>/force-logout", nil)
	// // no Authorization header
	// ...
	// assert rec.Code == 401
	// assert error.code == "AUTH_REQUIRED"
}

// TestForceLogout_AC07_CrossTenant_Returns404_NotForbidden is the
// handler-level R1 invariant test. The service-layer scaffolds cover
// the no-modification + audit invariants; this one nails down that
// the HTTP edge response is identical shape to a genuinely
// non-existent UUID.
//
// THE WORDING OF THIS TEST MATTERS: a passing-but-misimplemented
// system might respond 403 because RLS blocked the row read.
// Asserting NOT 403 is the substantive contract.
func TestForceLogout_AC07_CrossTenant_Returns404_NotForbidden(t *testing.T) {
	t.Skip("ATDD red phase — implement AdminHandler.ForceLogout + service cross-tenant 404 mapping")

	// Setup two centers, Owner-of-A targets user-in-B.
	// Expected:
	//   rec.Code == 404 (NOT 403)
	//   error.code == "USER_NOT_FOUND"
	//   resp.data == null (envelope error path)
}
