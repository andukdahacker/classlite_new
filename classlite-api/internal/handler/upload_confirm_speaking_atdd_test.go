// Story 5.4 Task 1 (AC16 layer-4, D3) — ATDD RED. The speaking-audio confirm
// re-check on the NON-knowledge confirm branch (imports/speaking/avatars).
//
// Speaking confirm creates no `files` row (unlike knowledge), so it flows through
// the "verify + echo metadata" branch that historically did ZERO size re-check.
// This test adds the A9 layer-4 stored-size gate there, with the same hardening
// matrix the knowledge branch already enforces:
//   - stored size over the 25 MB speaking cap → best-effort Delete + 413
//   - HeadObject transport error → FAIL CLOSED 502, NO phantom delete
//
// This is best-effort/defense-in-depth: confirm is skippable for speaking, so the
// AUTHORITATIVE over-cap gate lives on the mandatory /progress path (see the
// submission-service tests). Reuses setupConfirmTest from
// upload_confirm_hardening_atdd_test.go.
package handler_test

import (
	"net/http"
	"strings"
	"testing"

	"github.com/ducdo/classlite-api/internal/service"
)

func (e confirmEnv) speakingKey(name string) string {
	return strings.TrimSuffix(keyCenter(e), "/") + "/speaking/" + name
}

func keyCenter(e confirmEnv) string {
	// env.key("x") == "{center}/knowledge/x" — strip the trailing segment to get
	// the "{center}/" prefix without importing the test-pkg UUID helper twice.
	full := e.key("x")
	return strings.TrimSuffix(full, "knowledge/x")
}

func TestConfirmSpeaking_OverCap_DeletesAnd413(t *testing.T) {
	env := setupConfirmTest(t)
	key := env.speakingKey("take.webm")
	// Stored object is 26 MB — over the 25 MB speaking cap.
	env.mock.Objects[key] = &service.ObjectMeta{Key: key, ContentType: "audio/webm", Size: 26 * oneMB}

	rec := env.confirm(t, key, oneMB) // client-claimed sizeBytes is ignored; HeadObject is authoritative

	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("expected 413 for a 26 MB speaking take (25 MB cap), got %d: %s", rec.Code, rec.Body.String())
	}
	if !containsStr(env.mock.Deleted, key) {
		t.Errorf("over-cap speaking object must be best-effort deleted, Deleted=%v", env.mock.Deleted)
	}
}

func TestConfirmSpeaking_HeadError_FailsClosed502NoDelete(t *testing.T) {
	env := setupConfirmTest(t)
	key := env.speakingKey("take.webm")
	env.mock.HeadObjectError = errTransport

	rec := env.confirm(t, key, oneMB)

	if rec.Code != http.StatusBadGateway {
		t.Fatalf("HeadObject transport error must FAIL CLOSED with 502, got %d: %s", rec.Code, rec.Body.String())
	}
	if len(env.mock.Deleted) != 0 {
		t.Errorf("must never phantom-delete an object it could not verify, Deleted=%v", env.mock.Deleted)
	}
}

func TestConfirmSpeaking_UnderCap_200(t *testing.T) {
	env := setupConfirmTest(t)
	key := env.speakingKey("take.m4a")
	env.mock.Objects[key] = &service.ObjectMeta{Key: key, ContentType: "audio/mp4", Size: 10 * oneMB}

	rec := env.confirm(t, key, oneMB)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 for a 10 MB speaking take, got %d: %s", rec.Code, rec.Body.String())
	}
	if len(env.mock.Deleted) != 0 {
		t.Errorf("under-cap object must not be deleted, Deleted=%v", env.mock.Deleted)
	}
}
