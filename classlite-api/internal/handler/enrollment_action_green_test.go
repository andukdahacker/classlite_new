// Story 7.3a — green-phase handler integration for the unified action endpoint +
// the two console reads (TEST-BE-3: real middleware, real service, real DB via the
// committed raw pool). Complements the de-tagged ATDD reds (immutability grid,
// coupling CHECK, action authz, atomicity) with the happy paths + the D3/AC3-4
// 422s + the AC11/AC12 read envelopes and their role negatives. Drives the bare
// mux (setupEnrollmentHandlerTest) so the SERVICE authz is what's exercised.
package handler_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/ducdo/classlite-api/internal/test"
	"github.com/google/uuid"
)

// --- decode helpers ---

type historyListEnvelope struct {
	Data []map[string]any `json:"data"`
	Meta struct {
		Pagination map[string]any `json:"pagination"`
	} `json:"meta"`
}

func decodeHistoryList(t *testing.T, rec *httptest.ResponseRecorder) historyListEnvelope {
	t.Helper()
	var out historyListEnvelope
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode history envelope: %v (body: %s)", err, rec.Body.String())
	}
	return out
}

type attentionPaginationMeta struct {
	Page       int `json:"page"`
	PageSize   int `json:"pageSize"`
	Total      int `json:"total"`
	TotalPages int `json:"totalPages"`
}

type attentionEnvelope struct {
	Data struct {
		Unassigned struct {
			Items      []map[string]any        `json:"items"`
			Pagination attentionPaginationMeta `json:"pagination"`
		} `json:"unassigned"`
		OverCapacity struct {
			Items      []map[string]any        `json:"items"`
			Pagination attentionPaginationMeta `json:"pagination"`
		} `json:"overCapacity"`
	} `json:"data"`
	Meta map[string]any `json:"meta"`
}

func decodeAttention(t *testing.T, rec *httptest.ResponseRecorder) attentionEnvelope {
	t.Helper()
	var out attentionEnvelope
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode attention envelope: %v (body: %s)", err, rec.Body.String())
	}
	return out
}

func addActionBody(studentID string, toClassID uuid.UUID) map[string]any {
	return map[string]any{"action": "add", "studentId": studentID, "toClassId": toClassID.String()}
}

// =============================================================================
// AC2 — Add via the new action body → 201 + a single 'add' history row.
// =============================================================================
func TestEnrollmentAction_Add_ActionBody_201_WritesHistory(t *testing.T) {
	env := setupEnrollmentHandlerTest(t)
	rec := classReq(t, env.srv, http.MethodPost, "/api/enrollments", env.ownerTok,
		addActionBody(test.UUIDString(env.student1ID), env.classAID))
	if rec.Code != http.StatusCreated {
		t.Fatalf("add (action body) → %d, want 201 (body: %s)", rec.Code, rec.Body.String())
	}
	got := decodeClassEnvelope(t, rec)
	if got.Data["status"] != "active" {
		t.Errorf("status = %v, want active", got.Data["status"])
	}

	hist := classReq(t, env.srv, http.MethodGet,
		"/api/enrollments/history?student_id="+test.UUIDString(env.student1ID), env.ownerTok, nil)
	if hist.Code != http.StatusOK {
		t.Fatalf("history → %d, want 200 (body: %s)", hist.Code, hist.Body.String())
	}
	list := decodeHistoryList(t, hist)
	if len(list.Data) != 1 {
		t.Fatalf("history rows = %d, want exactly 1 'add' (R17 one-row-per-op)", len(list.Data))
	}
	if list.Data[0]["action"] != "add" {
		t.Errorf("history action = %v, want add", list.Data[0]["action"])
	}
	if list.Data[0]["studentName"] != "Alice Student" {
		t.Errorf("history studentName = %v, want Alice Student (denormalized)", list.Data[0]["studentName"])
	}
	if v, ok := list.Data[0]["fromClassId"]; !ok || v != nil {
		t.Errorf("history fromClassId = %v, want explicit null on an add (GO-5)", v)
	}
}

// =============================================================================
// AC3 — Transfer happy path → 200; source becomes transferred, target active.
// =============================================================================
func TestEnrollmentAction_Transfer_200(t *testing.T) {
	env := setupEnrollmentHandlerTest(t)
	// Arrange: student1 active in class A.
	if rec := classReq(t, env.srv, http.MethodPost, "/api/enrollments", env.ownerTok,
		addActionBody(test.UUIDString(env.student1ID), env.classAID)); rec.Code != http.StatusCreated {
		t.Fatalf("arrange add → %d (body: %s)", rec.Code, rec.Body.String())
	}
	rec := classReq(t, env.srv, http.MethodPost, "/api/enrollments", env.ownerTok, map[string]any{
		"action":      "transfer",
		"studentId":   test.UUIDString(env.student1ID),
		"fromClassId": env.classAID.String(),
		"toClassId":   env.classBID.String(),
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("transfer → %d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}
	got := decodeClassEnvelope(t, rec)
	if got.Data["classId"] != env.classBID.String() {
		t.Errorf("transfer result classId = %v, want target %s", got.Data["classId"], env.classBID)
	}
	if got.Data["status"] != "active" {
		t.Errorf("transfer result status = %v, want active (new target enrollment)", got.Data["status"])
	}

	sp := test.SuperuserPool(t)
	studentUUID := uuid.MustParse(test.UUIDString(env.student1ID))
	var srcStatus, tgtStatus string
	if err := sp.QueryRow(context.Background(),
		`SELECT status FROM enrollments WHERE student_id=$1 AND class_id=$2`, studentUUID, env.classAID).Scan(&srcStatus); err != nil {
		t.Fatalf("read source status: %v", err)
	}
	if srcStatus != "transferred" {
		t.Errorf("source status = %q, want transferred", srcStatus)
	}
	if err := sp.QueryRow(context.Background(),
		`SELECT status FROM enrollments WHERE student_id=$1 AND class_id=$2 AND status='active'`, studentUUID, env.classBID).Scan(&tgtStatus); err != nil {
		t.Fatalf("read target status: %v", err)
	}
	if tgtStatus != "active" {
		t.Errorf("target status = %q, want active", tgtStatus)
	}
}

// =============================================================================
// AC4 — Withdraw happy path → 200, status withdrawn.
// =============================================================================
func TestEnrollmentAction_Withdraw_200(t *testing.T) {
	env := setupEnrollmentHandlerTest(t)
	if rec := classReq(t, env.srv, http.MethodPost, "/api/enrollments", env.ownerTok,
		addActionBody(test.UUIDString(env.student1ID), env.classAID)); rec.Code != http.StatusCreated {
		t.Fatalf("arrange add → %d (body: %s)", rec.Code, rec.Body.String())
	}
	rec := classReq(t, env.srv, http.MethodPost, "/api/enrollments", env.ownerTok, map[string]any{
		"action":      "withdraw",
		"studentId":   test.UUIDString(env.student1ID),
		"fromClassId": env.classAID.String(),
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("withdraw → %d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}
	got := decodeClassEnvelope(t, rec)
	if got.Data["status"] != "withdrawn" {
		t.Errorf("withdraw result status = %v, want withdrawn", got.Data["status"])
	}
	if got.Data["withdrawnAt"] == nil {
		t.Error("withdrawnAt = null, want a timestamp on a withdrawn enrollment")
	}
}

// =============================================================================
// D3 (CR-3-4-5-2) — Add to a paused class → 422 CLASS_NOT_ENROLLABLE.
// =============================================================================
func TestEnrollmentAction_Add_PausedClass_422(t *testing.T) {
	env := setupEnrollmentHandlerTest(t)
	pausedID := test.SeedClass(t, env.centerID, "Paused Class", "paused", nil, nil)
	t.Cleanup(func() {
		_, _ = test.SuperuserPool(t).Exec(context.Background(), `DELETE FROM classes WHERE id=$1`, pausedID)
	})
	rec := classReq(t, env.srv, http.MethodPost, "/api/enrollments", env.ownerTok,
		addActionBody(test.UUIDString(env.student1ID), pausedID))
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("add to paused class → %d, want 422 (body: %s)", rec.Code, rec.Body.String())
	}
	if code := errCodeOf(t, rec.Body.Bytes()); code != "CLASS_NOT_ENROLLABLE" {
		t.Errorf("error code = %q, want CLASS_NOT_ENROLLABLE", code)
	}
}

// =============================================================================
// Review P1 — Transfer with fromClassId == toClassId → 422 (no self-transfer;
// a same-class transfer would corrupt the audit trail with a from=to no-op).
// =============================================================================
func TestEnrollmentAction_Transfer_SameClass_422(t *testing.T) {
	env := setupEnrollmentHandlerTest(t)
	// Arrange: student1 active in class A.
	if rec := classReq(t, env.srv, http.MethodPost, "/api/enrollments", env.ownerTok,
		addActionBody(test.UUIDString(env.student1ID), env.classAID)); rec.Code != http.StatusCreated {
		t.Fatalf("arrange add → %d (body: %s)", rec.Code, rec.Body.String())
	}
	rec := classReq(t, env.srv, http.MethodPost, "/api/enrollments", env.ownerTok, map[string]any{
		"action":      "transfer",
		"studentId":   test.UUIDString(env.student1ID),
		"fromClassId": env.classAID.String(),
		"toClassId":   env.classAID.String(),
	})
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("same-class transfer → %d, want 422 (body: %s)", rec.Code, rec.Body.String())
	}
	if code := errCodeOf(t, rec.Body.Bytes()); code != "VALIDATION_ERROR" {
		t.Errorf("error code = %q, want VALIDATION_ERROR", code)
	}
	// No mutation: the source enrollment must still be the single active row in A.
	sp := test.SuperuserPool(t)
	studentUUID := uuid.MustParse(test.UUIDString(env.student1ID))
	var activeCount int
	if err := sp.QueryRow(context.Background(),
		`SELECT count(*) FROM enrollments WHERE student_id=$1 AND class_id=$2 AND status='active'`,
		studentUUID, env.classAID).Scan(&activeCount); err != nil {
		t.Fatalf("count active: %v", err)
	}
	if activeCount != 1 {
		t.Errorf("active enrollments in class A = %d, want 1 (rejected transfer must not write)", activeCount)
	}
}

// =============================================================================
// Review P3 (DN1) — a future effectiveDate → 422; state must not flip while
// withdrawn_at would be stamped in the future.
// =============================================================================
func TestEnrollmentAction_Withdraw_FutureEffectiveDate_422(t *testing.T) {
	env := setupEnrollmentHandlerTest(t)
	if rec := classReq(t, env.srv, http.MethodPost, "/api/enrollments", env.ownerTok,
		addActionBody(test.UUIDString(env.student1ID), env.classAID)); rec.Code != http.StatusCreated {
		t.Fatalf("arrange add → %d (body: %s)", rec.Code, rec.Body.String())
	}
	rec := classReq(t, env.srv, http.MethodPost, "/api/enrollments", env.ownerTok, map[string]any{
		"action":        "withdraw",
		"studentId":     test.UUIDString(env.student1ID),
		"fromClassId":   env.classAID.String(),
		"effectiveDate": "2999-01-01",
	})
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("future-dated withdraw → %d, want 422 (body: %s)", rec.Code, rec.Body.String())
	}
	if code := errCodeOf(t, rec.Body.Bytes()); code != "VALIDATION_ERROR" {
		t.Errorf("error code = %q, want VALIDATION_ERROR", code)
	}
	// The enrollment must remain active — no status flip on a rejected future date.
	sp := test.SuperuserPool(t)
	studentUUID := uuid.MustParse(test.UUIDString(env.student1ID))
	var status string
	if err := sp.QueryRow(context.Background(),
		`SELECT status FROM enrollments WHERE student_id=$1 AND class_id=$2`,
		studentUUID, env.classAID).Scan(&status); err != nil {
		t.Fatalf("read status: %v", err)
	}
	if status != "active" {
		t.Errorf("status = %q, want active (future-dated withdraw must be rejected before any write)", status)
	}
}

// =============================================================================
// Review P3 (DN1) — a backdated effectiveDate is still allowed (200).
// =============================================================================
func TestEnrollmentAction_Withdraw_BackdatedEffectiveDate_200(t *testing.T) {
	env := setupEnrollmentHandlerTest(t)
	if rec := classReq(t, env.srv, http.MethodPost, "/api/enrollments", env.ownerTok,
		addActionBody(test.UUIDString(env.student1ID), env.classAID)); rec.Code != http.StatusCreated {
		t.Fatalf("arrange add → %d (body: %s)", rec.Code, rec.Body.String())
	}
	rec := classReq(t, env.srv, http.MethodPost, "/api/enrollments", env.ownerTok, map[string]any{
		"action":        "withdraw",
		"studentId":     test.UUIDString(env.student1ID),
		"fromClassId":   env.classAID.String(),
		"effectiveDate": "2020-01-01",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("backdated withdraw → %d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}
}

// =============================================================================
// AC4 — Withdraw with no active source enrollment → 422 NOT_ENROLLED_IN_SOURCE.
// =============================================================================
func TestEnrollmentAction_Withdraw_NoActiveSource_422(t *testing.T) {
	env := setupEnrollmentHandlerTest(t)
	rec := classReq(t, env.srv, http.MethodPost, "/api/enrollments", env.ownerTok, map[string]any{
		"action":      "withdraw",
		"studentId":   test.UUIDString(env.student1ID),
		"fromClassId": env.classAID.String(),
	})
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("withdraw with no active source → %d, want 422 (body: %s)", rec.Code, rec.Body.String())
	}
	if code := errCodeOf(t, rec.Body.Bytes()); code != "NOT_ENROLLED_IN_SOURCE" {
		t.Errorf("error code = %q, want NOT_ENROLLED_IN_SOURCE", code)
	}
}

// =============================================================================
// AC3 — Transfer with no active source enrollment → 422 NOT_ENROLLED_IN_SOURCE.
// =============================================================================
func TestEnrollmentAction_Transfer_NoActiveSource_422(t *testing.T) {
	env := setupEnrollmentHandlerTest(t)
	rec := classReq(t, env.srv, http.MethodPost, "/api/enrollments", env.ownerTok, map[string]any{
		"action":      "transfer",
		"studentId":   test.UUIDString(env.student1ID),
		"fromClassId": env.classAID.String(),
		"toClassId":   env.classBID.String(),
	})
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("transfer with no active source → %d, want 422 (body: %s)", rec.Code, rec.Body.String())
	}
	if code := errCodeOf(t, rec.Body.Bytes()); code != "NOT_ENROLLED_IN_SOURCE" {
		t.Errorf("error code = %q, want NOT_ENROLLED_IN_SOURCE", code)
	}
}

// =============================================================================
// AC11 — history read: owner sees the {data,meta} envelope; teacher → 403.
// =============================================================================
func TestEnrollmentHistory_List_OwnerEnvelope_200(t *testing.T) {
	env := setupEnrollmentHandlerTest(t)
	if rec := classReq(t, env.srv, http.MethodPost, "/api/enrollments", env.ownerTok,
		addActionBody(test.UUIDString(env.student1ID), env.classAID)); rec.Code != http.StatusCreated {
		t.Fatalf("arrange add → %d (body: %s)", rec.Code, rec.Body.String())
	}
	rec := classReq(t, env.srv, http.MethodGet, "/api/enrollments/history", env.ownerTok, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("history → %d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}
	list := decodeHistoryList(t, rec)
	if len(list.Data) < 1 {
		t.Fatalf("history data length = %d, want >= 1", len(list.Data))
	}
	if list.Meta.Pagination["total"] == nil {
		t.Error("history envelope missing meta.pagination.total")
	}
}

func TestEnrollmentHistory_List_TeacherForbidden_403(t *testing.T) {
	env := setupEnrollmentHandlerTest(t)
	rec := classReq(t, env.srv, http.MethodGet, "/api/enrollments/history", env.teacherATok, nil)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("teacher history → %d, want 403 (body: %s)", rec.Code, rec.Body.String())
	}
	if code := errCodeOf(t, rec.Body.Bytes()); code != "INSUFFICIENT_ROLE" {
		t.Errorf("error code = %q, want INSUFFICIENT_ROLE", code)
	}
}

// =============================================================================
// AC12 — attention read: unassigned students; over-capacity classes; teacher → 403.
// =============================================================================
func TestEnrollmentAttention_Unassigned_200(t *testing.T) {
	env := setupEnrollmentHandlerTest(t)
	// Fresh env: student1 + student2 are `student` members with zero enrollments.
	rec := classReq(t, env.srv, http.MethodGet, "/api/enrollments/attention", env.ownerTok, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("attention → %d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}
	att := decodeAttention(t, rec)
	if len(att.Data.Unassigned.Items) != 2 {
		t.Errorf("unassigned = %d, want 2 (both student members are classless)", len(att.Data.Unassigned.Items))
	}
	if att.Data.Unassigned.Pagination.Total != 2 {
		t.Errorf("unassigned pagination total = %d, want 2", att.Data.Unassigned.Pagination.Total)
	}
	if len(att.Data.OverCapacity.Items) != 0 {
		t.Errorf("overCapacity = %d, want 0 (no class has capacity set)", len(att.Data.OverCapacity.Items))
	}
}

func TestEnrollmentAttention_OverCapacity_200(t *testing.T) {
	env := setupEnrollmentHandlerTest(t)
	// Set class A capacity to 1, then enroll BOTH students → active count 2 > 1.
	if _, err := test.SuperuserPool(t).Exec(context.Background(),
		`UPDATE classes SET capacity = 1 WHERE id = $1`, env.classAID); err != nil {
		t.Fatalf("set capacity: %v", err)
	}
	for _, sid := range []string{test.UUIDString(env.student1ID), test.UUIDString(env.student2ID)} {
		if rec := classReq(t, env.srv, http.MethodPost, "/api/enrollments", env.ownerTok,
			addActionBody(sid, env.classAID)); rec.Code != http.StatusCreated {
			t.Fatalf("arrange add → %d (body: %s)", rec.Code, rec.Body.String())
		}
	}
	rec := classReq(t, env.srv, http.MethodGet, "/api/enrollments/attention", env.ownerTok, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("attention → %d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}
	att := decodeAttention(t, rec)
	found := false
	for _, c := range att.Data.OverCapacity.Items {
		if c["classId"] == env.classAID.String() {
			found = true
			if c["activeCount"].(float64) != 2 {
				t.Errorf("activeCount = %v, want 2", c["activeCount"])
			}
			if c["capacity"].(float64) != 1 {
				t.Errorf("capacity = %v, want 1", c["capacity"])
			}
		}
	}
	if !found {
		t.Errorf("class A not reported over-capacity (overCapacity: %v)", att.Data.OverCapacity.Items)
	}
}

func TestEnrollmentAttention_TeacherForbidden_403(t *testing.T) {
	env := setupEnrollmentHandlerTest(t)
	rec := classReq(t, env.srv, http.MethodGet, "/api/enrollments/attention", env.teacherATok, nil)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("teacher attention → %d, want 403 (body: %s)", rec.Code, rec.Body.String())
	}
	if code := errCodeOf(t, rec.Body.Bytes()); code != "INSUFFICIENT_ROLE" {
		t.Errorf("error code = %q, want INSUFFICIENT_ROLE", code)
	}
}
