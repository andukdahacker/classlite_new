// Story 4.4a — ATDD RED scaffold (BUILD-EXCLUDED, `_`-prefixed).
//
// AC10 — slog must MASK presigned-URL values and X-Amz-Signature params so a
// signed URL can never appear in logs. AC11 — a replay (confirm on an
// already-confirmed key) emits a structured Info counter. Mirrors the capture
// technique in internal/worker/secret_logging_atdd_test.go.
//
// UN-PREFIX -> `upload_slog_redaction_atdd_test.go` AFTER T6 exposes a testable
// redacting handler constructor (this is what makes the test compile+fail):
//
//	// internal/logging/redact.go
//	func NewRedactingJSONHandler(w io.Writer, opts *slog.HandlerOptions) slog.Handler
//	// installs ReplaceAttr masking values/URLs matching
//	//   s3.amazonaws.com | r2.cloudflarestorage.com  and  X-Amz-Signature
//
// WHY BUILD-EXCLUDED (not the active canary): a redaction test can only be
// simultaneously "compiles today" AND "fails today" if it drives T6's redactor
// symbol — which does not exist yet. Driving today's handler would pass
// vacuously (nothing logs the URL yet), which is a false green. The active red
// canary is upload_presign_size_atdd_test.go instead.
package handler_test

import (
	"bytes"
	"log/slog"
	"net/http"
	"strings"
	"testing"

	"github.com/ducdo/classlite-api/internal/logging"
	"github.com/ducdo/classlite-api/internal/service"
	testpkg "github.com/ducdo/classlite-api/internal/test"
)

const (
	sampleSignedURL = "https://acct.r2.cloudflarestorage.com/center-123/knowledge/abc.pdf" +
		"?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=deadbeefdeadbeefdeadbeefdeadbeef"
	forbiddenSignature = "X-Amz-Signature=deadbeefdeadbeefdeadbeefdeadbeef"
	forbiddenHost      = "r2.cloudflarestorage.com"
)

// AC10 — the redacting handler masks a presigned URL logged as an attribute
// value, and masks the signature param, while keeping request_id (proves
// logging ran — a non-vacuous negative assertion, per the Test Meta-Rules).
func TestSlog_RedactsPresignedURLAndSignature(t *testing.T) {
	var buf bytes.Buffer
	h := logging.NewRedactingJSONHandler(&buf, &slog.HandlerOptions{Level: slog.LevelDebug})
	log := slog.New(h)

	// A call site logs the signed URL under an attribute — exactly what T4 might
	// do at debug level around presign/confirm.
	log.Info("generated presigned url",
		slog.String("request_id", "req-abc-123"),
		slog.String("presigned_url", sampleSignedURL),
	)

	out := buf.String()
	if strings.Contains(out, forbiddenSignature) {
		t.Errorf("AC10 VIOLATION: X-Amz-Signature leaked into logs.\n---LOGS---\n%s", out)
	}
	if strings.Contains(out, forbiddenHost) {
		t.Errorf("AC10 VIOLATION: R2 host/URL leaked into logs.\n---LOGS---\n%s", out)
	}
	// Non-vacuous control: request_id MUST survive (redaction is surgical).
	if !strings.Contains(out, "req-abc-123") {
		t.Error("expected request_id to survive redaction; its absence would make the negative assertion vacuous")
	}
}

// AC11 — replay detection emits a structured Info counter when confirm runs
// against a key already confirmed. Policy-note only in v1 (no dedup table).
func TestConfirm_ReplayEmitsCounter(t *testing.T) {
	env := setupConfirmTest(t)
	key := env.key("replay.pdf")
	env.mock.Objects[key] = &service.ObjectMeta{Key: key, ContentType: "application/pdf", Size: oneMB}

	if rec := env.confirm(t, key, oneMB); rec.Code != http.StatusCreated && rec.Code != http.StatusOK {
		t.Fatalf("first confirm: %d %s", rec.Code, rec.Body.String())
	}

	var logs bytes.Buffer
	prev := slog.Default()
	slog.SetDefault(slog.New(logging.NewRedactingJSONHandler(&logs, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() { slog.SetDefault(prev) })

	if rec := env.confirm(t, key, oneMB); rec.Code != http.StatusCreated && rec.Code != http.StatusOK {
		t.Fatalf("replay confirm: %d %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(logs.String(), "upload confirm replay") {
		t.Errorf("expected the replay counter Info line, got: %s", logs.String())
	}
	if n := testpkg.CountLiveFiles(t, env.centerID); n != 1 {
		t.Errorf("a replay must not write a second files row, got %d", n)
	}
}
