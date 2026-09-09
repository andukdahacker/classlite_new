// Story 7.3a (AC1 · R15 · risk=7 · WF-8 HARD GATE) — the unified enrollment
// action endpoint (POST /api/enrollments with an action body) must re-validate
// the caller's role from center_members on the transfer AND withdraw transitions,
// not only on the legacy Add case (3.4.5 already proved Add). R15 is the risk
// driver: a Teacher/Student caller — or a demoted admin still holding a stale
// owner-claim JWT (EDGE-2, up to 15 min) — must be 403 INSUFFICIENT_ROLE on
// EVERY mutating action, because the JWT role claim cannot be trusted.
//
// De-tagged at green (7-3a shipped the action body + TransferEnrollment /
// WithdrawEnrollment with the SEC-1 DB role re-fetch); now part of the permanent suite.
//
// GREEN SEAMS (Task 4 service + Task 6 handler):
//
//	POST /api/enrollments accepts the action body
//	  { action:'add'|'transfer'|'withdraw', studentId, toClassId?, fromClassId?,
//	    effectiveDate?, note? } and normalizes the legacy {studentId, classId} to
//	    action='add'. EnrollmentService.TransferEnrollment / WithdrawEnrollment
//	    re-fetch member.Role from center_members inside the tx (SEC-1) and gate on
//	    {owner, admin}; a Teacher/Student/demoted-admin caller → 403 INSUFFICIENT_ROLE.
package handler_test

import (
	"net/http"
	"testing"

	"github.com/ducdo/classlite-api/internal/test"
)

// transferBody builds a transfer action payload (student moves fromClass → toClass).
func transferBody(env enrollmentTestEnv, studentID, fromClassID, toClassID string) map[string]any {
	return map[string]any{
		"action":      "transfer",
		"studentId":   studentID,
		"fromClassId": fromClassID,
		"toClassId":   toClassID,
	}
}

// withdrawBody builds a withdraw action payload (student leaves fromClass).
func withdrawBody(env enrollmentTestEnv, studentID, fromClassID string) map[string]any {
	return map[string]any{
		"action":      "withdraw",
		"studentId":   studentID,
		"fromClassId": fromClassID,
	}
}

// -----------------------------------------------------------------------------
// AC1/R15 — Teacher/Student callers are 403 on transfer AND withdraw (role
// re-validated from center_members, mirroring the shipped Add-case 403 tests).
// -----------------------------------------------------------------------------

func TestEnrollmentAction_Transfer_TeacherForbidden_403(t *testing.T) {
	env := setupEnrollmentHandlerTest(t)
	rec := classReq(t, env.srv, http.MethodPost, "/api/enrollments", env.teacherATok,
		transferBody(env, test.UUIDString(env.student1ID), env.classAID.String(), env.classBID.String()))
	if rec.Code != http.StatusForbidden {
		t.Fatalf("teacher transfer → %d, want 403 (body: %s)", rec.Code, rec.Body.String())
	}
	if code := errCodeOf(t, rec.Body.Bytes()); code != "INSUFFICIENT_ROLE" {
		t.Errorf("error code = %q, want INSUFFICIENT_ROLE", code)
	}
}

func TestEnrollmentAction_Withdraw_TeacherForbidden_403(t *testing.T) {
	env := setupEnrollmentHandlerTest(t)
	rec := classReq(t, env.srv, http.MethodPost, "/api/enrollments", env.teacherATok,
		withdrawBody(env, test.UUIDString(env.student1ID), env.classAID.String()))
	if rec.Code != http.StatusForbidden {
		t.Fatalf("teacher withdraw → %d, want 403 (body: %s)", rec.Code, rec.Body.String())
	}
	if code := errCodeOf(t, rec.Body.Bytes()); code != "INSUFFICIENT_ROLE" {
		t.Errorf("error code = %q, want INSUFFICIENT_ROLE", code)
	}
}

func TestEnrollmentAction_Transfer_StudentForbidden_403(t *testing.T) {
	env := setupEnrollmentHandlerTest(t)
	rec := classReq(t, env.srv, http.MethodPost, "/api/enrollments", env.studentTok,
		transferBody(env, test.UUIDString(env.student1ID), env.classAID.String(), env.classBID.String()))
	if rec.Code != http.StatusForbidden {
		t.Fatalf("student transfer → %d, want 403 (body: %s)", rec.Code, rec.Body.String())
	}
	if code := errCodeOf(t, rec.Body.Bytes()); code != "INSUFFICIENT_ROLE" {
		t.Errorf("error code = %q, want INSUFFICIENT_ROLE", code)
	}
}

// -----------------------------------------------------------------------------
// AC1/R15/EDGE-2 — the demoted-admin stale-JWT case. teacherB is a `teacher`
// member in center_members but is handed an `owner`-role token; the DB role
// re-fetch must still 403 on transfer AND withdraw. This is the scenario the DB
// re-validation exists for — only this test proves the center_members read is the
// deciding factor rather than the JWT claim (the plain-teacher tests above sign
// tokens whose JWT role matches the DB role).
// -----------------------------------------------------------------------------

func TestEnrollmentAction_Transfer_StaleOwnerJWTForTeacher_403(t *testing.T) {
	env := setupEnrollmentHandlerTest(t)
	forgedOwnerTok := test.SignAccessTokenForRole(t, env.teacherBID, env.centerID, "owner")
	rec := classReq(t, env.srv, http.MethodPost, "/api/enrollments", forgedOwnerTok,
		transferBody(env, test.UUIDString(env.student1ID), env.classAID.String(), env.classBID.String()))
	if rec.Code != http.StatusForbidden {
		t.Fatalf("owner-claim JWT for a DB teacher (transfer) → %d, want 403 (body: %s)", rec.Code, rec.Body.String())
	}
	if code := errCodeOf(t, rec.Body.Bytes()); code != "INSUFFICIENT_ROLE" {
		t.Errorf("error code = %q, want INSUFFICIENT_ROLE (role re-validated from center_members, not the JWT)", code)
	}
}

func TestEnrollmentAction_Withdraw_StaleOwnerJWTForTeacher_403(t *testing.T) {
	env := setupEnrollmentHandlerTest(t)
	forgedOwnerTok := test.SignAccessTokenForRole(t, env.teacherBID, env.centerID, "owner")
	rec := classReq(t, env.srv, http.MethodPost, "/api/enrollments", forgedOwnerTok,
		withdrawBody(env, test.UUIDString(env.student1ID), env.classAID.String()))
	if rec.Code != http.StatusForbidden {
		t.Fatalf("owner-claim JWT for a DB teacher (withdraw) → %d, want 403 (body: %s)", rec.Code, rec.Body.String())
	}
	if code := errCodeOf(t, rec.Body.Bytes()); code != "INSUFFICIENT_ROLE" {
		t.Errorf("error code = %q, want INSUFFICIENT_ROLE (role re-validated from center_members, not the JWT)", code)
	}
}
