// Story 9-1a — green-phase coverage of the Owner-only read envelope shapes (AC15/AC17/
// AC27). A genesis-Free center reads isFree=true / creditsApplicable=false / available=0
// (D24) with Free limits; the plan catalog carries all three tiers with the round-half-up
// VAT split (D25). Owner-only authz + the 403 grid live in billing_authz_atdd_test.go.
package handler_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/ducdo/classlite-api/internal/test"
)

type billingSummaryEnvelope struct {
	Data struct {
		Plan              string `json:"plan"`
		Status            string `json:"status"`
		IsFree            bool   `json:"isFree"`
		CreditsApplicable bool   `json:"creditsApplicable"`
		Limits            struct {
			Teachers         *int  `json:"teachers"`
			Classes          *int  `json:"classes"`
			StudentsPerClass *int  `json:"studentsPerClass"`
			StorageBytes     int64 `json:"storageBytes"`
		} `json:"limits"`
		Usage struct {
			AICredits struct {
				Available int `json:"available"`
			} `json:"aiCredits"`
			Storage struct {
				LimitBytes int64 `json:"limitBytes"`
			} `json:"storage"`
		} `json:"usage"`
	} `json:"data"`
}

func TestBillingHandler_GetSummary_GenesisFreeShape(t *testing.T) {
	db := test.SetupDB(t)
	centerA := test.CreateCenterWithID(t, db, test.TenantAID, "Center A", "center-a")
	test.TenantContext(t, db, centerA.ID)
	owner := test.CreateUser(t, db, "owner-read@example.com", "Owner Read")
	test.CreateCenterMember(t, db, owner.ID, centerA.ID, "owner")
	srv := test.NewBillingTestServerForRole(t, db, owner.ID, test.TenantAID, "owner")

	req := newReqWithRequestID(http.MethodGet, "/api/billing", "")
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /api/billing owner: want 200, got %d (body=%q)", rec.Code, rec.Body.String())
	}
	var env billingSummaryEnvelope
	if err := json.NewDecoder(rec.Body).Decode(&env); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if env.Data.Plan != "free" || !env.Data.IsFree {
		t.Errorf("genesis center: want plan=free isFree=true, got plan=%q isFree=%v", env.Data.Plan, env.Data.IsFree)
	}
	if env.Data.CreditsApplicable {
		t.Error("Free: creditsApplicable should be false (D24)")
	}
	if env.Data.Usage.AICredits.Available != 0 {
		t.Errorf("Free available credits = %d, want 0", env.Data.Usage.AICredits.Available)
	}
	// Free limits: teachers 1, classes 1, studentsPerClass 5, storage 500 MiB.
	if env.Data.Limits.StudentsPerClass == nil || *env.Data.Limits.StudentsPerClass != 5 {
		t.Errorf("Free studentsPerClass = %v, want 5", env.Data.Limits.StudentsPerClass)
	}
	if env.Data.Limits.Teachers == nil || *env.Data.Limits.Teachers != 1 {
		t.Errorf("Free teachers = %v, want 1", env.Data.Limits.Teachers)
	}
	if env.Data.Limits.StorageBytes != 524288000 {
		t.Errorf("Free storageBytes = %d, want 524288000", env.Data.Limits.StorageBytes)
	}
}

func TestBillingHandler_GetPlans_CatalogWithVAT(t *testing.T) {
	db := test.SetupDB(t)
	centerA := test.CreateCenterWithID(t, db, test.TenantAID, "Center A", "center-a")
	test.TenantContext(t, db, centerA.ID)
	owner := test.CreateUser(t, db, "owner-plans@example.com", "Owner Plans")
	test.CreateCenterMember(t, db, owner.ID, centerA.ID, "owner")
	srv := test.NewBillingTestServerForRole(t, db, owner.ID, test.TenantAID, "owner")

	req := newReqWithRequestID(http.MethodGet, "/api/billing/plans", "")
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET /api/billing/plans: want 200, got %d", rec.Code)
	}
	var env struct {
		Data struct {
			Plans []struct {
				Plan            string `json:"plan"`
				PriceMonthlyVnd int    `json:"priceMonthlyVnd"`
				VAT             struct {
					MonthlySubtotal int `json:"monthlySubtotal"`
					MonthlyVat      int `json:"monthlyVat"`
				} `json:"vat"`
			} `json:"plans"`
		} `json:"data"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&env); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(env.Data.Plans) != 3 {
		t.Fatalf("catalog: want 3 tiers, got %d", len(env.Data.Plans))
	}
	var pro *struct {
		Plan            string `json:"plan"`
		PriceMonthlyVnd int    `json:"priceMonthlyVnd"`
		VAT             struct {
			MonthlySubtotal int `json:"monthlySubtotal"`
			MonthlyVat      int `json:"monthlyVat"`
		} `json:"vat"`
	}
	for i := range env.Data.Plans {
		if env.Data.Plans[i].Plan == "pro" {
			pro = &env.Data.Plans[i]
		}
	}
	if pro == nil {
		t.Fatal("catalog missing the pro tier")
	}
	if pro.PriceMonthlyVnd != 399000 {
		t.Errorf("pro monthly = %d, want 399000", pro.PriceMonthlyVnd)
	}
	if pro.VAT.MonthlySubtotal != 362727 || pro.VAT.MonthlyVat != 36273 {
		t.Errorf("pro VAT split = %d + %d, want 362727 + 36273", pro.VAT.MonthlySubtotal, pro.VAT.MonthlyVat)
	}
}
