// dashboard_query_count_evidence_test.go — Story 8-1a P0 evidence emitter (D7).
// Measures the business-query count per role for GET /api/dashboard (via the
// reusable CountingDBTX keystone) and writes evidence/query-count.json. The counts
// are deterministic, so the artifact is idempotent across runs. This is the P0
// evidence the story requires (R31/PERF-2 — proves O(1)-in-rows, not O(rows)).
package test

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
)

type queryCountEvidence struct {
	Story    string                         `json:"story"`
	Endpoint string                         `json:"endpoint"`
	Note     string                         `json:"note"`
	PerRole  map[string]queryCountRoleRecord `json:"perRole"`
}

type queryCountRoleRecord struct {
	Measured int `json:"measured"`
	Ceiling  int `json:"ceiling"`
}

func TestDashboard_QueryCount_Evidence(t *testing.T) {
	db := SetupDB(t)
	seed := dashSeedFullCenter(t, db)

	cases := []struct {
		role    string
		userID  string
		ceiling int
	}{
		{"teacher", seed.teacherID, maxDashboardQueriesTeacher},
		{"owner", seed.ownerID, maxDashboardQueriesOwner},
		{"student", seed.studentID, maxDashboardQueriesStudent},
	}

	evidence := queryCountEvidence{
		Story:    "8-1a",
		Endpoint: "GET /api/dashboard",
		Note: "Business queries per invocation (SET LOCAL + BEGIN/SAVEPOINT/RELEASE/COMMIT " +
			"filtered by CountingDBTX). Counting boundary = the tx the service runs on, NOT the " +
			"pool (D7(1)). O(1) in rows — proven to fail on a synthetic N+1 " +
			"(TestDashboard_QueryCount_DetectsSyntheticNPlus1_ATDD).",
		PerRole: map[string]queryCountRoleRecord{},
	}

	for _, c := range cases {
		counter := NewCountingDBTX(db)
		svc := service.NewDashboardService(counter, clock.RealClock{})
		tc := model.TenantContext{CenterID: seed.centerID, UserID: c.userID, Role: c.role, EmailVerified: true}
		counter.Reset()
		if _, err := svc.GetDashboard(context.Background(), tc); err != nil {
			t.Fatalf("%s: GetDashboard: %v", c.role, err)
		}
		evidence.PerRole[c.role] = queryCountRoleRecord{Measured: counter.Count(), Ceiling: c.ceiling}
	}

	// evidence/ lives at the classlite-api root (../../ from internal/test).
	dir := filepath.Join("..", "..", "evidence")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatalf("mkdir evidence: %v", err)
	}
	payload, err := json.MarshalIndent(evidence, "", "  ")
	if err != nil {
		t.Fatalf("marshal evidence: %v", err)
	}
	payload = append(payload, '\n')
	if err := os.WriteFile(filepath.Join(dir, "query-count.json"), payload, 0o644); err != nil {
		t.Fatalf("write evidence: %v", err)
	}
	t.Logf("wrote evidence/query-count.json: %s", string(payload))
}
