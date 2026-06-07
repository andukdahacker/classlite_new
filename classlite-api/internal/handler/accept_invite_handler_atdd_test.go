//go:build atdd_red_phase

// accept_invite_handler_atdd_test.go — Story 1.6 ATDD red-phase
// scaffolds for POST /api/auth/accept-invite.
//
// ACCEPTANCE CRITERIA COVERED
//   AC-1.6-04  200 envelope { data: { accessToken, user, center, role } }
//   AC-1.6-04  refresh_token cookie set (parity with Login per AC10 from Story 1.5)
//   AC-1.6-04  404 INVITE_NOT_FOUND for unknown token
//   AC-1.6-04  410 INVITE_EXPIRED with details: { centerName, inviterEmail }
//   AC-1.6-04  409 INVITE_ALREADY_ACCEPTED with details: { centerName }
//   AC-1.6-04  422 VALIDATION_FAILED when new-user branch missing fullName/password

package handler_test

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

// TestAcceptInvite_AC04_HappyPath_200Envelope_NewUser proves the
// envelope shape for the new-user branch.
func TestAcceptInvite_AC04_HappyPath_200Envelope_NewUser(t *testing.T) {
	t.Skip("ATDD red phase — implement AuthHandler.AcceptInvite + AcceptInviteInput service method")

	// Expected:
	//   rec.Code == 200
	//   resp.data.accessToken non-empty
	//   resp.data.user.email == "newteacher@example.com"
	//   resp.data.user.emailVerified == true
	//   resp.data.center.id == "<tenant-A-uuid>"
	//   resp.data.center.name == "Tenant A"
	//   resp.data.role == "teacher"
	//   Set-Cookie: refresh_token=...; HttpOnly; Secure; SameSite=Lax; Domain=.classlite.app
	_ = httptest.NewRequest
	_ = http.MethodPost
}

// TestAcceptInvite_AC04_UnknownToken_Returns404 proves the
// InviteNotFoundError → 404 mapping via the canonical error_mapper.
func TestAcceptInvite_AC04_UnknownToken_Returns404(t *testing.T) {
	t.Skip("ATDD red phase — implement error mapping for *InviteNotFoundError")

	// Body: { "inviteToken": "totally-random-string" }
	// Expected: rec.Code == 404, error.code == "INVITE_NOT_FOUND"
}

// TestAcceptInvite_AC04_ExpiredToken_Returns410WithDetails proves the
// 410 surface carries `details: { centerName, inviterEmail }` so the
// frontend can render UX recovery ("Ask <inviter> to send a new one"
// per UX line 580).
func TestAcceptInvite_AC04_ExpiredToken_Returns410WithDetails(t *testing.T) {
	t.Skip("ATDD red phase — implement *InviteExpiredError → 410 + details payload")

	// Expected:
	//   rec.Code == 410
	//   error.code == "INVITE_EXPIRED"
	//   error.details.centerName == "Tenant A"
	//   error.details.inviterEmail == "owner@example.com"
}

// TestAcceptInvite_AC04_AlreadyAccepted_Returns409WithCenter proves
// the 409 surface carries `details: { centerName }` so the frontend
// can redirect to login per UX line 581.
func TestAcceptInvite_AC04_AlreadyAccepted_Returns409WithCenter(t *testing.T) {
	t.Skip("ATDD red phase — implement *InviteAlreadyAcceptedError → 409 + details payload")

	// Expected:
	//   rec.Code == 409
	//   error.code == "INVITE_ALREADY_ACCEPTED"
	//   error.details.centerName == "Tenant A"
}

// TestAcceptInvite_AC04_NewUserMissingFullName_Returns422 proves the
// new-user branch requires both fullName AND password — the service
// validation surfaces ValidationError with field-level details.
func TestAcceptInvite_AC04_NewUserMissingFullName_Returns422(t *testing.T) {
	t.Skip("ATDD red phase — implement new-user-branch validation in AcceptInvite service")

	// Body: { "inviteToken": "<valid-token>", "password": "Pass123!" }
	//   (note: no fullName)
	// Expected:
	//   rec.Code == 422
	//   error.code == "VALIDATION_FAILED"
	//   error.details.fields[*].field includes "fullName"
}
