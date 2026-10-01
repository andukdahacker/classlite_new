// Story 9-2a — AC22 / AC39 / D28 (FU-9-CONTRACT-402). 9-1b built its billing dialogs +
// classlite-web/src/features/billing/lib/typeGuards.ts + MSW fixtures against an ASSUMED
// 409/402/403 `details` contract while enforcement was dark-OFF (zero e2e reachability).
// This is the provider-side lock: with the gate ARMED (BILLING_ENFORCEMENT_ENABLED=true) drive
// a REAL rejection through a test server and assert the EMITTED JSON `details` match, EXACTLY,
// what the FE assumed:
//   · 409 PLAN_LIMIT_EXCEEDED.details = { limit:<UPPER_SNAKE enum string>, current:<int>, max:<int>, canManageBilling:<bool> }
//       — assert the typed `canManageBilling` VALUE on BOTH an owner (true) and a teacher (false)
//         path (value-scan, GO-5). NOTE (D28): `max:null` is SCHEMA-reachable (an Unlimited tier
//         column) but rejection-UNreachable — an Unlimited tier never 409s — so 9-1b's null branch
//         is not exercisable here; documented, not asserted.
//   · 402 INSUFFICIENT_CREDITS.details = { available:<int>, required:<int> } — assert `required` present.
//   · 403 ADDON_NOT_AVAILABLE for a Free-tier add-on attempt (service.AddonNotAvailableError → 403).
//
// GREEN-PHASE SEAMS (RED compile-fails on these):
//   · NewBillingTestServerWithWrites(t, db storyDB, userID pgtype.UUID, centerID, role string) http.Handler
//       — the FU-9-CONTRACT-402 armed-gate probe harness. Mounts POST /api/billing/contract-probe on
//         the production billingChain (ExtractTenant→verified→center→ErrorMapper) MINUS the owner-only
//         RequireRole edge gate, so BOTH an owner and a teacher reach the plan/credit/addon gate and the
//         emitted `canManageBilling` reflects the caller's REAL role (tc.Role==owner). Body:
//         {"gate":"studentsPerClass"|"aiCredits"|"addon","classId":<uuid?>}. The gate runs the SAME
//         9-1a Check* / CreateCheckout path the real endpoints run — this only removes the edge RBAC so
//         the wire contract is reachable for both roles (no new emitter — D14).
//   · service.AddonNotAvailableError (→403) — the Free add-on eligibility error the addon gate returns.
//
// RED: compile-fails on NewBillingTestServerWithWrites.

package test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// contractProbe POSTs the armed-gate probe body and returns the recorder.
func contractProbe(t *testing.T, srv http.Handler, gate string, classID *uuid.UUID) *httptest.ResponseRecorder {
	t.Helper()
	payload := map[string]any{"gate": gate}
	if classID != nil {
		payload["classId"] = classID.String()
	}
	req := httptest.NewRequest(http.MethodPost, "/api/billing/contract-probe", bytes.NewReader(mustJSON(payload)))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)
	return rec
}

// planLimitDetails is the exact 409 shape typeGuards.ts consumes (AC22/D28). `max` is an int
// here (the reachable rejection carries a concrete cap — never the Unlimited sentinel).
type planLimitDetails struct {
	Error struct {
		Code    string `json:"code"`
		Details struct {
			Limit            string `json:"limit"`
			Current          int    `json:"current"`
			Max              int    `json:"max"`
			CanManageBilling bool   `json:"canManageBilling"`
		} `json:"details"`
	} `json:"error"`
}

// seedTeacherForContract adds a committed teacher member to centerID (superuser/raw) and
// returns its user id, cleaning up the user row at test end (cleanupBillingCenter removes the
// center_members row via center_id but leaves the global users row).
func seedTeacherForContract(t *testing.T, centerID pgtype.UUID) pgtype.UUID {
	t.Helper()
	ctx := context.Background()
	sp := SuperuserPool(t)
	teacherID := uuid.New()
	if _, err := sp.Exec(ctx,
		`INSERT INTO users (id, email, full_name, password_hash, email_verified) VALUES ($1, $2, 'Teacher', 'x', true)`,
		teacherID, "teacher-"+uuid.NewString()[:8]+"@example.com",
	); err != nil {
		t.Fatalf("seed teacher user: %v", err)
	}
	if _, err := sp.Exec(ctx,
		`INSERT INTO center_members (center_id, user_id, role) VALUES ($1, $2, 'teacher')`,
		centerID, teacherID,
	); err != nil {
		t.Fatalf("seed teacher member: %v", err)
	}
	t.Cleanup(func() {
		ctx := context.Background()
		_, _ = sp.Exec(ctx, `DELETE FROM center_members WHERE user_id = $1`, teacherID)
		_, _ = sp.Exec(ctx, `DELETE FROM users WHERE id = $1`, teacherID)
	})
	return NewPGUUIDFromString(teacherID.String())
}

// TestBillingContract_PlanLimit409_CanManageBilling_OwnerAndTeacher proves the armed 409 carries
// the exact PLAN_LIMIT_EXCEEDED details, and that `canManageBilling` tracks the caller's role:
// true for an owner, false for a teacher (D23/D28 value-scan on both paths).
func TestBillingContract_PlanLimit409_CanManageBilling_OwnerAndTeacher(t *testing.T) {
	t.Setenv("BILLING_ENFORCEMENT_ENABLED", "true") // arm the dark-launched gate (D3)
	pool := SetupRawPool(t)

	t.Run("owner → canManageBilling true", func(t *testing.T) {
		centerID, tc := newBillingCenter(t, "free", 0, 0, 0, billingEpoch.AddDate(0, 1, 0)) // Free/5
		classID, _ := seedFreeClass(t, pool, tc, 5 /*at cap*/, 0)
		srv := NewBillingTestServerWithWrites(t, pool, NewPGUUIDFromString(tc.UserID), tc.CenterID, "owner")

		rec := contractProbe(t, srv, "studentsPerClass", &classID)
		if rec.Code != http.StatusConflict {
			t.Fatalf("owner over-cap probe = %d, want 409: %s", rec.Code, rec.Body.String())
		}
		var d planLimitDetails
		if err := json.Unmarshal(rec.Body.Bytes(), &d); err != nil {
			t.Fatalf("decode 409: %v", err)
		}
		if d.Error.Code != "PLAN_LIMIT_EXCEEDED" {
			t.Errorf("code = %q, want PLAN_LIMIT_EXCEEDED", d.Error.Code)
		}
		if d.Error.Details.Limit == "" {
			t.Error("details.limit missing — the FE enum key must be present (a non-empty UPPER_SNAKE string)")
		}
		if d.Error.Details.Max != 5 || d.Error.Details.Current < d.Error.Details.Max {
			t.Errorf("details current/max = %d/%d, want current>=max and max=5", d.Error.Details.Current, d.Error.Details.Max)
		}
		if !d.Error.Details.CanManageBilling {
			t.Error("details.canManageBilling = false, want TRUE for an owner (value-scan, GO-5)")
		}
		_ = centerID
	})

	t.Run("teacher → canManageBilling false", func(t *testing.T) {
		centerID, tc := newBillingCenter(t, "free", 0, 0, 0, billingEpoch.AddDate(0, 1, 0))
		classID, _ := seedFreeClass(t, pool, tc, 5, 0)
		teacherID := seedTeacherForContract(t, centerID)
		srv := NewBillingTestServerWithWrites(t, pool, teacherID, tc.CenterID, "teacher")

		rec := contractProbe(t, srv, "studentsPerClass", &classID)
		if rec.Code != http.StatusConflict {
			t.Fatalf("teacher over-cap probe = %d, want 409: %s", rec.Code, rec.Body.String())
		}
		var d planLimitDetails
		if err := json.Unmarshal(rec.Body.Bytes(), &d); err != nil {
			t.Fatalf("decode 409: %v", err)
		}
		if d.Error.Code != "PLAN_LIMIT_EXCEEDED" {
			t.Errorf("code = %q, want PLAN_LIMIT_EXCEEDED", d.Error.Code)
		}
		if d.Error.Details.CanManageBilling {
			t.Error("details.canManageBilling = true, want FALSE for a teacher (value-scan, GO-5)")
		}
	})
}

// TestBillingContract_InsufficientCredits402_RequiredPresent proves the armed 402 carries the
// { available, required } shape and that `required` is present (D28 — the FE reads it to say
// "you have N, this needs M").
func TestBillingContract_InsufficientCredits402_RequiredPresent(t *testing.T) {
	t.Setenv("BILLING_ENFORCEMENT_ENABLED", "true")
	pool := SetupRawPool(t)

	// Pro tier (AI-eligible) but zero available balance → the pre-enqueue credit gate 402s.
	_, tc := newBillingCenter(t, "pro", 0, 0, 0, billingEpoch.AddDate(0, 1, 0))
	srv := NewBillingTestServerWithWrites(t, pool, NewPGUUIDFromString(tc.UserID), tc.CenterID, "owner")

	rec := contractProbe(t, srv, "aiCredits", nil)
	if rec.Code != http.StatusPaymentRequired {
		t.Fatalf("zero-credit probe = %d, want 402: %s", rec.Code, rec.Body.String())
	}
	var resp struct {
		Error struct {
			Code    string `json:"code"`
			Details struct {
				Available int  `json:"available"`
				Required  *int `json:"required"` // pointer → distinguishes "absent" from 0
			} `json:"details"`
		} `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode 402: %v", err)
	}
	if resp.Error.Code != "INSUFFICIENT_CREDITS" {
		t.Errorf("code = %q, want INSUFFICIENT_CREDITS", resp.Error.Code)
	}
	if resp.Error.Details.Required == nil {
		t.Error("details.required missing — the FE contract requires it be present")
	}
}

// TestBillingContract_AddonNotAvailable403_OnFree proves a Free-tier add-on attempt is a
// 403 ADDON_NOT_AVAILABLE (plan-eligibility, not a payment problem — D7) with an upgrade hint,
// NOT a 402. Backed by service.AddonNotAvailableError.
func TestBillingContract_AddonNotAvailable403_OnFree(t *testing.T) {
	t.Setenv("BILLING_ENFORCEMENT_ENABLED", "true")
	pool := SetupRawPool(t)

	_, tc := newBillingCenter(t, "free", 0, 0, 0, billingEpoch.AddDate(0, 1, 0))
	srv := NewBillingTestServerWithWrites(t, pool, NewPGUUIDFromString(tc.UserID), tc.CenterID, "owner")

	rec := contractProbe(t, srv, "addon", nil)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("Free add-on probe = %d, want 403 (eligibility, not payment): %s", rec.Code, rec.Body.String())
	}
	var resp struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode 403: %v", err)
	}
	if resp.Error.Code != "ADDON_NOT_AVAILABLE" {
		t.Errorf("code = %q, want ADDON_NOT_AVAILABLE", resp.Error.Code)
	}
}
