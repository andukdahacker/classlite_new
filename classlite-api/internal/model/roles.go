// Package model — Story 2.6 shared role vocabulary.
//
// The four canonical roles carried by center_members.role and invites.role.
// A DB CHECK constraint (migration 20260717120000_add_role_check_center_members)
// enforces the same set at the write side; IsValidRole is the application-side
// suspenders and OutranksOwner is the FR-11 promotion guard.
//
// Existing code that hard-codes the raw strings (e.g. auth_admin.go,
// require_role.go call sites) is not swept — new code should prefer the
// constants; a rename would be a mechanical bulk change with zero behavior
// delta and non-trivial merge risk against in-flight stories.
package model

// Role names center_members.role / invites.role values. The type alias
// is a nominal string, so untyped string literals still assign into it
// (the shipped code passes "owner" etc. directly), but new code can use
// the constants below for grep-ability.
type Role = string

// Canonical roles. See docs/project-context.md#FR-9 for the ladder.
const (
	RoleOwner   Role = "owner"
	RoleAdmin   Role = "admin"
	RoleTeacher Role = "teacher"
	RoleStudent Role = "student"
)

// IsValidRole reports whether r is one of the four canonical roles.
// It is the application-layer belt available to any write path that
// persists a role, turning an invalid value into a 422 rather than a 500
// from the DB CHECK constraint's SQLSTATE 23514 suspenders. Note: today
// no production write path calls it — AdminInviteStaff does its own
// inline allowlist because it must reject `student` (which IsValidRole
// accepts), and login/register don't take caller-supplied roles. Kept
// per AC1 as the shared, table-tested helper for future role-writing
// endpoints (Epic 7 invite-accept, staff role edits) to adopt.
func IsValidRole(r string) bool {
	switch r {
	case RoleOwner, RoleAdmin, RoleTeacher, RoleStudent:
		return true
	}
	return false
}

// OutranksOwner is the FR-11 rejection predicate. Returns true iff the
// target-role promotion should be BLOCKED — i.e., an Owner-target
// requires an Owner-caller. An Admin caller trying to assign the Owner
// role is the case this guards; every other combination returns false.
//
// Call site pattern:
//
//	if model.OutranksOwner(caller.DBRole, req.Role) {
//	    return &service.RoleAssignmentForbiddenError{}
//	}
//
// Name kept over the party-mode-suggested rename per Amelia REJECT
// (2026-07-17); the polarity is documented rather than encoded in the
// name so the call site reads as an if-guard, not a boolean set-op.
func OutranksOwner(inviter, target string) bool {
	return target == RoleOwner && inviter != RoleOwner
}
