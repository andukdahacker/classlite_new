// Story 4.4a — confirm hardening (AC4 idempotency, AC9 delete-on-mismatch +
// fail-closed + orphan telemetry, AC9a prefix-mismatch audit). Real handler +
// service + DB (TEST-BE-3) with the R2 storage MOCK injected (the one backend
// integration mock).
package handler_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/ducdo/classlite-api/internal/logging"
	"github.com/ducdo/classlite-api/internal/service"
	testpkg "github.com/ducdo/classlite-api/internal/test"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

var (
	errTransport    = errors.New("simulated head object transport failure")
	errDeleteFailed = errors.New("simulated r2 delete failure")
)

type confirmEnv struct {
	srv      http.Handler
	mock     *service.MockStorageService
	centerID pgtype.UUID
	ownerID  pgtype.UUID
	token    string
}

func setupConfirmTest(t *testing.T) confirmEnv {
	t.Helper()
	pool := testpkg.SetupRawPool(t)
	sfx := uuid.NewString()[:8]
	owner := testpkg.CreateUserOnPool(t, pool, "kh-owner-"+sfx+"@example.com", "KH Owner")
	testpkg.MarkUserEmailVerifiedOnPool(t, pool, owner.ID)
	centerPg := testpkg.CreateCenterForOwner(t, pool, owner.ID)
	t.Cleanup(func() { testpkg.CleanupKnowledgeHub(t, centerPg, owner.ID) })

	mock := service.NewMockStorageService()
	return confirmEnv{
		srv:      testpkg.NewKnowledgeHubTestServerBareMux(t, pool, mock),
		mock:     mock,
		centerID: centerPg,
		ownerID:  owner.ID,
		token:    testpkg.SignAccessTokenForRole(t, owner.ID, testpkg.UUIDString(centerPg), "owner"),
	}
}

func (e confirmEnv) key(name string) string {
	return testpkg.UUIDString(e.centerID) + "/knowledge/" + name
}

func (e confirmEnv) confirm(t *testing.T, key string, size int64) *httptest.ResponseRecorder {
	t.Helper()
	body := `{"key":"` + key + `","name":"doc.pdf","folderId":null,"sizeBytes":` + strconv.FormatInt(size, 10) + `}`
	req := httptest.NewRequest(http.MethodPost, "/api/uploads/confirm", bytes.NewBufferString(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+e.token)
	rec := httptest.NewRecorder()
	e.srv.ServeHTTP(rec, req)
	return rec
}

// AC4 — confirm is idempotent by (center_id, object_key): a retry returns the
// same file, writes exactly one row, counts once, never 500s.
func TestConfirm_Idempotent_DoubleConfirmOneRow(t *testing.T) {
	env := setupConfirmTest(t)
	key := env.key("doc.pdf")
	env.mock.Objects[key] = &service.ObjectMeta{Key: key, ContentType: "application/pdf", Size: oneMB}

	first := env.confirm(t, key, oneMB)
	if first.Code != http.StatusCreated && first.Code != http.StatusOK {
		t.Fatalf("first confirm: expected 200/201, got %d: %s", first.Code, first.Body.String())
	}
	firstID := decodeDataID(t, first)

	second := env.confirm(t, key, oneMB)
	if second.Code == http.StatusInternalServerError {
		t.Fatalf("retry confirm 500'd on the duplicate — idempotency broken: %s", second.Body.String())
	}
	if second.Code != http.StatusCreated && second.Code != http.StatusOK {
		t.Fatalf("retry confirm: expected 200/201, got %d: %s", second.Code, second.Body.String())
	}
	if got := decodeDataID(t, second); got != firstID {
		t.Errorf("retry returned a different file id: first %s, retry %s", firstID, got)
	}
	if n := testpkg.CountLiveFiles(t, env.centerID); n != 1 {
		t.Errorf("expected exactly 1 files row after double-confirm, got %d", n)
	}
}

// AC9 — delete-on-mismatch matrix.
func TestConfirm_DeleteOnMismatch_Matrix(t *testing.T) {
	cases := []struct {
		name           string
		storedSize     int64
		storedType     string
		headObjectErr  error
		deleteErr      error
		wantStatus     int
		wantObjDeleted bool
		wantOrphanLog  bool
	}{
		{
			name:       "stored size over cap -> deleted, no row, 413",
			storedSize: 60 * oneMB, storedType: "application/pdf",
			wantStatus: http.StatusRequestEntityTooLarge, wantObjDeleted: true,
		},
		{
			name:       "wrong content-type -> deleted, no row, 422",
			storedSize: oneMB, storedType: "application/x-msdownload",
			wantStatus: http.StatusUnprocessableEntity, wantObjDeleted: true,
		},
		{
			name:          "HeadObject transport error -> FAIL CLOSED: no row, NO phantom delete",
			headObjectErr: errTransport,
			wantStatus:    http.StatusBadGateway, wantObjDeleted: false,
		},
		{
			name:       "mismatch AND delete fails -> no row, orphan telemetry emitted",
			storedSize: 60 * oneMB, storedType: "application/pdf", deleteErr: errDeleteFailed,
			wantStatus: http.StatusRequestEntityTooLarge, wantObjDeleted: false, wantOrphanLog: true,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			env := setupConfirmTest(t)
			key := env.key("doc.pdf")
			if tc.headObjectErr != nil {
				env.mock.HeadObjectError = tc.headObjectErr
			} else {
				env.mock.Objects[key] = &service.ObjectMeta{Key: key, ContentType: tc.storedType, Size: tc.storedSize}
			}
			env.mock.DeleteError = tc.deleteErr

			var logs bytes.Buffer
			prev := slog.Default()
			slog.SetDefault(slog.New(logging.NewRedactingJSONHandler(&logs, &slog.HandlerOptions{Level: slog.LevelDebug})))
			t.Cleanup(func() { slog.SetDefault(prev) })

			rec := env.confirm(t, key, oneMB)
			if rec.Code != tc.wantStatus {
				t.Errorf("status: want %d, got %d: %s", tc.wantStatus, rec.Code, rec.Body.String())
			}
			deleted := containsStr(env.mock.Deleted, key)
			if deleted != tc.wantObjDeleted {
				t.Errorf("object deleted: want %v, got %v (Deleted=%v)", tc.wantObjDeleted, deleted, env.mock.Deleted)
			}
			if tc.wantOrphanLog && !strings.Contains(logs.String(), "orphaned_object") {
				t.Errorf("expected orphaned_object telemetry counter in logs, got: %s", logs.String())
			}
			if n := testpkg.CountLiveFiles(t, env.centerID); n != 0 {
				t.Errorf("no files row should exist on a rejected confirm, got %d", n)
			}
		})
	}
}

// AC9a — confirm with a key whose prefix != the JWT tenant → 403 + audit
// R2_KEY_PREFIX_MISMATCH, without touching storage.
func TestConfirm_PrefixMismatch_403AndAudit(t *testing.T) {
	env := setupConfirmTest(t)
	foreignKey := "00000000-0000-0000-0000-0000000000ff/knowledge/x.pdf"
	env.mock.Objects[foreignKey] = &service.ObjectMeta{Key: foreignKey, ContentType: "application/pdf", Size: oneMB}

	rec := env.confirm(t, foreignKey, oneMB)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403 for a foreign-prefix key, got %d: %s", rec.Code, rec.Body.String())
	}
	if len(env.mock.Deleted) != 0 {
		t.Error("foreign-prefix confirm must not touch storage delete")
	}
	// The audit row is scoped to the caller's own center (RLS), written via the
	// superuser pool read here.
	sp := testpkg.SuperuserPool(t)
	var n int
	if err := sp.QueryRow(context.Background(),
		`SELECT count(*) FROM audit_logs WHERE center_id = $1 AND action = 'R2_KEY_PREFIX_MISMATCH'`, env.centerID,
	).Scan(&n); err != nil {
		t.Fatalf("count audit rows: %v", err)
	}
	if n != 1 {
		t.Errorf("expected exactly 1 R2_KEY_PREFIX_MISMATCH audit row, got %d", n)
	}
}

// --- helpers ---

func containsStr(ss []string, want string) bool {
	for _, s := range ss {
		if s == want {
			return true
		}
	}
	return false
}

func decodeDataID(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	var resp struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("decode file envelope: %v", err)
	}
	return resp.Data.ID
}
