package model

import "testing"

func TestIsValidRole(t *testing.T) {
	cases := []struct {
		role string
		want bool
	}{
		{"owner", true},
		{"admin", true},
		{"teacher", true},
		{"student", true},
		{"Owner", false}, // case-sensitive — DB CHECK is too
		{"root", false},
		{"", false},
		{"owner ", false}, // no whitespace tolerance
	}
	for _, tc := range cases {
		t.Run(tc.role, func(t *testing.T) {
			if got := IsValidRole(tc.role); got != tc.want {
				t.Fatalf("IsValidRole(%q) = %v, want %v", tc.role, got, tc.want)
			}
		})
	}
}

func TestOutranksOwner(t *testing.T) {
	// Rejection matrix — the true rows are the ONLY promotions the guard
	// must block. Every other combination must pass the guard and defer
	// to downstream checks (middleware RequireRole for teacher callers,
	// duplicate-invite check for repeat submissions, etc.).
	cases := []struct {
		name    string
		inviter string
		target  string
		want    bool
	}{
		{"admin_invites_owner_BLOCKED", RoleAdmin, RoleOwner, true},
		{"teacher_invites_owner_BLOCKED", RoleTeacher, RoleOwner, true},
		{"student_invites_owner_BLOCKED", RoleStudent, RoleOwner, true},
		{"owner_invites_owner_allowed", RoleOwner, RoleOwner, false},
		{"owner_invites_admin_allowed", RoleOwner, RoleAdmin, false},
		{"owner_invites_teacher_allowed", RoleOwner, RoleTeacher, false},
		{"admin_invites_admin_allowed", RoleAdmin, RoleAdmin, false},
		{"admin_invites_teacher_allowed", RoleAdmin, RoleTeacher, false},
		{"empty_inviter_target_owner_BLOCKED", "", RoleOwner, true},
		{"empty_target_allowed", RoleAdmin, "", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := OutranksOwner(tc.inviter, tc.target); got != tc.want {
				t.Fatalf("OutranksOwner(%q, %q) = %v, want %v",
					tc.inviter, tc.target, got, tc.want)
			}
		})
	}
}
