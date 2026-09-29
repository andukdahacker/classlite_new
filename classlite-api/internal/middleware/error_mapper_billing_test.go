// Story 9-1a, AC26 (D23) — the wire error contract for the billing gates. The 409
// PLAN_LIMIT_EXCEEDED details carry a STABLE UPPER_SNAKE `limit` enum (distinct from the
// display message) + current/max + the `canManageBilling` actor hint; the 402
// INSUFFICIENT_CREDITS details name the gap with `available` + `required`.
package middleware_test

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/ducdo/classlite-api/internal/service"
)

func TestErrorMapper_PlanLimitExceeded_409_Details(t *testing.T) {
	rec := runHandler(t, service.PlanLimitExceededError{
		Limit: "studentsPerClass", Current: 5, Max: 5, CanManageBilling: false,
	})
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409", rec.Code)
	}
	var resp struct {
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
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.Error.Code != "PLAN_LIMIT_EXCEEDED" {
		t.Errorf("code = %q, want PLAN_LIMIT_EXCEEDED", resp.Error.Code)
	}
	// The camelCase service key maps to the stable UPPER_SNAKE wire enum (AC26).
	if resp.Error.Details.Limit != "STUDENTS_PER_CLASS" {
		t.Errorf("details.limit = %q, want STUDENTS_PER_CLASS", resp.Error.Details.Limit)
	}
	if resp.Error.Details.Current != 5 || resp.Error.Details.Max != 5 {
		t.Errorf("details current/max = %d/%d, want 5/5", resp.Error.Details.Current, resp.Error.Details.Max)
	}
	if resp.Error.Details.CanManageBilling {
		t.Error("details.canManageBilling = true, want false for a non-owner")
	}
}

func TestErrorMapper_InsufficientCredits_402_Details(t *testing.T) {
	rec := runHandler(t, service.InsufficientCreditsError{Available: 0, Required: 1})
	if rec.Code != http.StatusPaymentRequired {
		t.Fatalf("status = %d, want 402", rec.Code)
	}
	var resp struct {
		Error struct {
			Code    string `json:"code"`
			Details struct {
				Available int `json:"available"`
				Required  int `json:"required"`
			} `json:"details"`
		} `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp.Error.Code != "INSUFFICIENT_CREDITS" {
		t.Errorf("code = %q, want INSUFFICIENT_CREDITS", resp.Error.Code)
	}
	if resp.Error.Details.Available != 0 || resp.Error.Details.Required != 1 {
		t.Errorf("details available/required = %d/%d, want 0/1", resp.Error.Details.Available, resp.Error.Details.Required)
	}
}
