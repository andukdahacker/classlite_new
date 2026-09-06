// Story 3.5b — green-phase happy-path handler integration (TEST-BE-3). The
// red-phase suite (attendance_handler_atdd_test.go) proves the authz + bulk
// atomicity contract (404/403/422/cancelled/zero-writes); this suite proves the
// success envelopes the checklist deferred to green: the {data:{roster},meta}
// shape, roster null-vs-marked semantics, UPSERT-through-HTTP idempotency, and
// the two "Mark all" bulk directions. Reuses setupAttendanceHandlerTest +
// classReq from the same package.
package handler_test

import (
	"encoding/json"
	"net/http"
	"testing"
)

type attendanceEntryJSON struct {
	StudentID string  `json:"studentId"`
	Name      string  `json:"name"`
	Email     string  `json:"email"`
	Status    *string `json:"status"`
	MarkedAt  *string `json:"markedAt"`
}

type attendanceRosterEnvelopeJSON struct {
	Data struct {
		Roster []attendanceEntryJSON `json:"roster"`
	} `json:"data"`
	Meta struct {
		ServerTime string `json:"serverTime"`
	} `json:"meta"`
}

type attendanceEntryEnvelopeJSON struct {
	Data attendanceEntryJSON `json:"data"`
	Meta struct {
		ServerTime string `json:"serverTime"`
	} `json:"meta"`
}

func decodeRoster(t *testing.T, body []byte) attendanceRosterEnvelopeJSON {
	t.Helper()
	var env attendanceRosterEnvelopeJSON
	if err := json.Unmarshal(body, &env); err != nil {
		t.Fatalf("decode roster envelope: %v (body=%s)", err, body)
	}
	if env.Meta.ServerTime == "" {
		t.Errorf("missing meta.serverTime in envelope: %s", body)
	}
	return env
}

// AC4 — GET returns {data:{roster:[…]}} with one entry per active enrollment;
// an unmarked student surfaces with null status/markedAt.
func TestAttendance_GetRoster_Envelope(t *testing.T) {
	env := setupAttendanceHandlerTest(t)
	rec := classReq(t, env.srv, http.MethodGet, attendancePath(env.sessionAID), env.teacherATok, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("GET roster: got %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	got := decodeRoster(t, rec.Body.Bytes())
	if len(got.Data.Roster) != 1 {
		t.Fatalf("roster length: got %d, want 1 (the single active enrollment)", len(got.Data.Roster))
	}
	entry := got.Data.Roster[0]
	if entry.StudentID != env.enrolledSID.String() {
		t.Errorf("roster studentId: got %s, want %s", entry.StudentID, env.enrolledSID)
	}
	if entry.Status != nil {
		t.Errorf("unmarked student status: got %v, want null", *entry.Status)
	}
	if entry.MarkedAt != nil {
		t.Errorf("unmarked student markedAt: got %v, want null", *entry.MarkedAt)
	}
}

// AC6 — PUT INSERTs then UPDATEs the same (session,student); the response is the
// full updated entry, and a re-mark does not duplicate (verified via GET).
func TestAttendance_SetOne_UpsertThroughHTTP(t *testing.T) {
	env := setupAttendanceHandlerTest(t)

	first := classReq(t, env.srv, http.MethodPut, attendanceStudentPath(env.sessionAID, env.enrolledSID),
		env.teacherATok, map[string]any{"status": "present"})
	if first.Code != http.StatusOK {
		t.Fatalf("first PUT: got %d, want 200 (body=%s)", first.Code, first.Body.String())
	}
	var firstEnv attendanceEntryEnvelopeJSON
	if err := json.Unmarshal(first.Body.Bytes(), &firstEnv); err != nil {
		t.Fatalf("decode entry: %v", err)
	}
	if firstEnv.Data.Status == nil || *firstEnv.Data.Status != "present" {
		t.Errorf("first PUT status: got %v, want present", firstEnv.Data.Status)
	}
	if firstEnv.Data.MarkedAt == nil {
		t.Errorf("first PUT markedAt: got null, want a timestamp")
	}

	// Re-mark → UPDATE (not a second row).
	second := classReq(t, env.srv, http.MethodPut, attendanceStudentPath(env.sessionAID, env.enrolledSID),
		env.teacherATok, map[string]any{"status": "absent"})
	if second.Code != http.StatusOK {
		t.Fatalf("second PUT: got %d, want 200", second.Code)
	}

	got := decodeRoster(t, classReq(t, env.srv, http.MethodGet, attendancePath(env.sessionAID), env.teacherATok, nil).Body.Bytes())
	if len(got.Data.Roster) != 1 {
		t.Fatalf("roster length after re-mark: got %d, want 1 (UPSERT, no duplicate)", len(got.Data.Roster))
	}
	if got.Data.Roster[0].Status == nil || *got.Data.Roster[0].Status != "absent" {
		t.Errorf("re-marked status: got %v, want absent", got.Data.Roster[0].Status)
	}
}

// AC8 — "Mark all Present" with no studentIds upserts every active student and
// returns the full refreshed roster.
func TestAttendance_BulkMarkAllPresent_Envelope(t *testing.T) {
	env := setupAttendanceHandlerTest(t)
	rec := classReq(t, env.srv, http.MethodPost, attendanceBulkPath(env.sessionAID),
		env.teacherATok, map[string]any{"status": "present"})
	if rec.Code != http.StatusOK {
		t.Fatalf("bulk mark all: got %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	got := decodeRoster(t, rec.Body.Bytes())
	if len(got.Data.Roster) != 1 {
		t.Fatalf("bulk roster length: got %d, want 1", len(got.Data.Roster))
	}
	if got.Data.Roster[0].Status == nil || *got.Data.Roster[0].Status != "present" {
		t.Errorf("bulk-marked status: got %v, want present", got.Data.Roster[0].Status)
	}
}

// AC9 — the forward-compat studentIds path: only the listed (valid) students are
// marked, atomically.
func TestAttendance_BulkWithValidIds(t *testing.T) {
	env := setupAttendanceHandlerTest(t)
	rec := classReq(t, env.srv, http.MethodPost, attendanceBulkPath(env.sessionAID),
		env.teacherATok, map[string]any{"status": "late", "studentIds": []string{env.enrolledSID.String()}})
	if rec.Code != http.StatusOK {
		t.Fatalf("bulk with ids: got %d, want 200 (body=%s)", rec.Code, rec.Body.String())
	}
	got := decodeRoster(t, rec.Body.Bytes())
	if got.Data.Roster[0].Status == nil || *got.Data.Roster[0].Status != "late" {
		t.Errorf("bulk-with-ids status: got %v, want late", got.Data.Roster[0].Status)
	}
}
