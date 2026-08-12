// Story 5.4 Task 1 (AC16, D12) — the AUTHORITATIVE speaking over-cap gate on the
// mandatory /progress path, at the service layer against a real DB with the R2
// storage MOCK injected. Confirm is skippable for speaking (no `files` row), so
// this is the one path a client cannot avoid: a lied `sizeBytes` at presign + a
// skipped confirm is still caught here before the audioKey can persist.
package test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/google/uuid"
)

const speakingCapMiB = 1024 * 1024

func speakingContent(key string) []byte {
	return []byte(`{"schemaVersion":1,"audioKey":"` + key + `","contentType":"audio/webm","durationSec":30}`)
}

func TestProgress_SpeakingOverCap_Rejected(t *testing.T) {
	clk := clock.NewMockClock(mockBase)
	e := setupSubEnv(t, clk, 0) // untimed
	aid := e.insertAssignment(t, mockBase.Add(24*time.Hour), nil, 0, "open")
	sub := e.startAttempt(t, aid)

	key := e.centerID.String() + "/speaking/" + uuid.NewString() + ".webm"
	// A client that lied sizeBytes=1 at presign then PUT a 26 MB take (25 MB cap).
	e.storage.Objects[key] = &service.ObjectMeta{Key: key, ContentType: "audio/webm", Size: 26 * speakingCapMiB}

	_, err := e.submissionSvc.SaveProgress(context.Background(), e.studentTC, uuid.UUID(sub.Row.ID.Bytes), speakingContent(key))
	if err == nil {
		t.Fatal("expected the over-cap audioKey to be rejected on /progress, got nil")
	}
	if !errors.As(err, &service.FileTooLargeError{}) {
		t.Fatalf("expected FileTooLargeError, got %T: %v", err, err)
	}
}

func TestProgress_SpeakingUnderCap_Persists(t *testing.T) {
	clk := clock.NewMockClock(mockBase)
	e := setupSubEnv(t, clk, 0)
	aid := e.insertAssignment(t, mockBase.Add(24*time.Hour), nil, 0, "open")
	sub := e.startAttempt(t, aid)

	key := e.centerID.String() + "/speaking/" + uuid.NewString() + ".webm"
	e.storage.Objects[key] = &service.ObjectMeta{Key: key, ContentType: "audio/webm", Size: 10 * speakingCapMiB}

	if _, err := e.submissionSvc.SaveProgress(context.Background(), e.studentTC, uuid.UUID(sub.Row.ID.Bytes), speakingContent(key)); err != nil {
		t.Fatalf("a 10 MB take must persist, got: %v", err)
	}
}

func TestProgress_SpeakingForeignCenterKey_403(t *testing.T) {
	clk := clock.NewMockClock(mockBase)
	e := setupSubEnv(t, clk, 0)
	aid := e.insertAssignment(t, mockBase.Add(24*time.Hour), nil, 0, "open")
	sub := e.startAttempt(t, aid)

	// SEC-8 — a key under ANOTHER center's prefix is a cross-tenant injection.
	foreignKey := uuid.NewString() + "/speaking/" + uuid.NewString() + ".webm"
	e.storage.Objects[foreignKey] = &service.ObjectMeta{Key: foreignKey, ContentType: "audio/webm", Size: 5 * speakingCapMiB}

	_, err := e.submissionSvc.SaveProgress(context.Background(), e.studentTC, uuid.UUID(sub.Row.ID.Bytes), speakingContent(foreignKey))
	if !errors.As(err, &service.KeyPrefixMismatchError{}) {
		t.Fatalf("expected KeyPrefixMismatchError for a foreign-center audioKey, got %T: %v", err, err)
	}
}

func TestProgress_SpeakingNonSpeakingFeatureKey_Rejected(t *testing.T) {
	clk := clock.NewMockClock(mockBase)
	e := setupSubEnv(t, clk, 0)
	aid := e.insertAssignment(t, mockBase.Add(24*time.Hour), nil, 0, "open")
	sub := e.startAttempt(t, aid)

	// A client stashing a knowledge key (100 MB cap) as audioKey to borrow the
	// laxer cap must be rejected on the FEATURE guard alone. Size it UNDER the
	// 25 MB speaking cap so the over-cap size re-check cannot mask a broken guard —
	// only `feature != speaking` can reject a 5 MB object here.
	knowledgeKey := e.centerID.String() + "/knowledge/" + uuid.NewString() + ".webm"
	e.storage.Objects[knowledgeKey] = &service.ObjectMeta{Key: knowledgeKey, ContentType: "audio/webm", Size: 5 * speakingCapMiB}

	_, err := e.submissionSvc.SaveProgress(context.Background(), e.studentTC, uuid.UUID(sub.Row.ID.Bytes), speakingContent(knowledgeKey))
	if !errors.As(err, &model.ValidationError{}) {
		t.Fatalf("expected a non-speaking audioKey to be rejected with ValidationError, got %T: %v", err, err)
	}
}

// A non-speaking submission (no audioKey) must be entirely unaffected by the gate.
func TestProgress_NoAudioKey_Unaffected(t *testing.T) {
	clk := clock.NewMockClock(mockBase)
	e := setupSubEnv(t, clk, 0)
	aid := e.insertAssignment(t, mockBase.Add(24*time.Hour), nil, 0, "open")
	sub := e.startAttempt(t, aid)

	if _, err := e.submissionSvc.SaveProgress(context.Background(), e.studentTC, uuid.UUID(sub.Row.ID.Bytes), []byte(`{"answer":"x"}`)); err != nil {
		t.Fatalf("a keyless submission must save cleanly, got: %v", err)
	}
}
