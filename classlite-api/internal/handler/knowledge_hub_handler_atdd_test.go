// Story 4.4a — Knowledge Hub handler tests: folder cycle/depth guard (AC2), file
// soft-delete + list exclusion + storage accounting (AC3/AC12), file detail +
// linked locations with soft-deleted exclusion and NO view-rate (AC13), and
// GET /storage/usage (AC12). Real handler + service + DB, storage MOCK injected.
package handler_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/ducdo/classlite-api/internal/service"
	testpkg "github.com/ducdo/classlite-api/internal/test"
)

// --- kh request helpers ---

func khReq(t *testing.T, env confirmEnv, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	var r *http.Request
	if body == "" {
		r = httptest.NewRequest(method, path, nil)
	} else {
		r = httptest.NewRequest(method, path, bytes.NewBufferString(body))
		r.Header.Set("Content-Type", "application/json")
	}
	r.Header.Set("Authorization", "Bearer "+env.token)
	rec := httptest.NewRecorder()
	env.srv.ServeHTTP(rec, r)
	return rec
}

func createFolderKH(t *testing.T, env confirmEnv, name string, parentID *string) string {
	t.Helper()
	parent := "null"
	if parentID != nil {
		parent = `"` + *parentID + `"`
	}
	rec := khReq(t, env, http.MethodPost, "/api/knowledge-hub/folders",
		`{"name":"`+name+`","parentFolderId":`+parent+`}`)
	if rec.Code != http.StatusCreated {
		t.Fatalf("create folder %q → %d: %s", name, rec.Code, rec.Body.String())
	}
	return decodeDataID(t, rec)
}

// confirmFileKH seeds a knowledge object of the given size and confirms it,
// returning the created file's id + slug.
func confirmFileKH(t *testing.T, env confirmEnv, name string, size int64) (id, slug string) {
	t.Helper()
	key := env.key(name)
	env.mock.Objects[key] = &service.ObjectMeta{Key: key, ContentType: "application/pdf", Size: size}
	rec := env.confirm(t, key, size)
	if rec.Code != http.StatusCreated && rec.Code != http.StatusOK {
		t.Fatalf("confirm %q → %d: %s", name, rec.Code, rec.Body.String())
	}
	var resp struct {
		Data struct {
			ID   string `json:"id"`
			Slug string `json:"slug"`
		} `json:"data"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("decode file: %v", err)
	}
	return resp.Data.ID, resp.Data.Slug
}

func assertErrCode(t *testing.T, rec *httptest.ResponseRecorder, want string) {
	t.Helper()
	var resp struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	_ = json.NewDecoder(rec.Body).Decode(&resp)
	if resp.Error.Code != want {
		t.Errorf("error code = %q, want %q", resp.Error.Code, want)
	}
}

// AC2 — moving a folder into its own descendant → typed 422 FOLDER_CYCLE (the
// 4.4b tree render must terminate).
func TestFolders_MoveIntoOwnDescendant_Returns422(t *testing.T) {
	env := setupConfirmTest(t)
	parent := createFolderKH(t, env, "parent", nil)
	child := createFolderKH(t, env, "child", &parent)

	rec := khReq(t, env, http.MethodPatch, "/api/knowledge-hub/folders/"+parent,
		`{"parentFolderId":"`+child+`"}`)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("move into own descendant → %d, want 422: %s", rec.Code, rec.Body.String())
	}
	assertErrCode(t, rec, "FOLDER_CYCLE")
}

// AC2 — nesting beyond maxFolderDepth (10) → 422 FOLDER_MAX_DEPTH. Build a chain
// of 10, then a create at depth 11 must fail.
func TestFolders_ExceedMaxDepth_Returns422(t *testing.T) {
	env := setupConfirmTest(t)
	var parent *string
	for i := 0; i < 10; i++ { // depths 1..10 all allowed
		id := createFolderKH(t, env, "d", parent)
		parent = &id
	}
	// The 11th (child of the depth-10 folder) must be rejected.
	rec := khReq(t, env, http.MethodPost, "/api/knowledge-hub/folders",
		`{"name":"too-deep","parentFolderId":"`+*parent+`"}`)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("create at depth 11 → %d, want 422: %s", rec.Code, rec.Body.String())
	}
	assertErrCode(t, rec, "FOLDER_MAX_DEPTH")
}

// AC3/AC12 — soft-delete removes a file from the list, retains the row, and
// frees storage accounting.
func TestFiles_SoftDelete_ExcludedFromListAndFreesStorage(t *testing.T) {
	env := setupConfirmTest(t)
	id, _ := confirmFileKH(t, env, "doomed.pdf", 3*oneMB)

	if used := storageUsed(t, env); used != 3*oneMB {
		t.Errorf("usage after upload = %d, want %d", used, 3*oneMB)
	}
	if list := listFileIDs(t, env); len(list) != 1 || list[0] != id {
		t.Errorf("list = %v, want [%s]", list, id)
	}

	if rec := khReq(t, env, http.MethodDelete, "/api/knowledge-hub/files/"+id, ""); rec.Code != http.StatusNoContent {
		t.Fatalf("delete file → %d, want 204: %s", rec.Code, rec.Body.String())
	}

	if list := listFileIDs(t, env); len(list) != 0 {
		t.Errorf("soft-deleted file still listed: %v", list)
	}
	if used := storageUsed(t, env); used != 0 {
		t.Errorf("usage after soft-delete = %d, want 0 (freed)", used)
	}
	// The row is retained (deleted_at set) — count includes soft-deleted.
	sp := testpkg.SuperuserPool(t)
	var total int
	_ = sp.QueryRow(context.Background(), `SELECT count(*) FROM files WHERE center_id = $1`, env.centerID).Scan(&total)
	if total != 1 {
		t.Errorf("soft-delete must retain the row, total files = %d, want 1", total)
	}
}

// AC12 — GET /storage/usage returns { usedBytes, limitBytes }.
func TestStorageUsage_ReturnsUsedAndLimit(t *testing.T) {
	env := setupConfirmTest(t)
	testpkg.SetCenterStorageLimit(t, env.centerID, 42*oneMB)
	confirmFileKH(t, env, "a.pdf", 5*oneMB)

	rec := khReq(t, env, http.MethodGet, "/api/storage/usage", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("usage → %d: %s", rec.Code, rec.Body.String())
	}
	var resp struct {
		Data struct {
			UsedBytes  int64 `json:"usedBytes"`
			LimitBytes int64 `json:"limitBytes"`
		} `json:"data"`
	}
	_ = json.NewDecoder(rec.Body).Decode(&resp)
	if resp.Data.UsedBytes != 5*oneMB {
		t.Errorf("usedBytes = %d, want %d", resp.Data.UsedBytes, 5*oneMB)
	}
	if resp.Data.LimitBytes != 42*oneMB {
		t.Errorf("limitBytes = %d, want %d", resp.Data.LimitBytes, 42*oneMB)
	}
}

// AC13 — file detail returns type-tagged metadata + linked locations (session
// via FK, exercise via GIN JSONB). A soft-deleted host is excluded. No view-rate.
func TestFileDetail_LinkedLocations_ExcludeSoftDeleted(t *testing.T) {
	env := setupConfirmTest(t)
	fileID, slug := confirmFileKH(t, env, "linked.pdf", oneMB)

	sp := testpkg.SuperuserPool(t)
	ctx := context.Background()

	// Session link (indexed FK): class → session → session_material(file_id).
	var classID, sessionID string
	if err := sp.QueryRow(ctx,
		`INSERT INTO classes (center_id, name) VALUES ($1, 'C1') RETURNING id`, env.centerID,
	).Scan(&classID); err != nil {
		t.Fatalf("seed class: %v", err)
	}
	if err := sp.QueryRow(ctx,
		`INSERT INTO sessions (center_id, class_id, topic, starts_at, ends_at)
		 VALUES ($1, $2, 'Lesson 1', now(), now() + interval '1 hour') RETURNING id`,
		env.centerID, classID,
	).Scan(&sessionID); err != nil {
		t.Fatalf("seed session: %v", err)
	}
	if _, err := sp.Exec(ctx,
		`INSERT INTO session_materials (center_id, session_id, title, url, kind, file_id)
		 VALUES ($1, $2, 'Material', '', 'file', $3)`,
		env.centerID, sessionID, fileID,
	); err != nil {
		t.Fatalf("seed session_material: %v", err)
	}

	// Exercise link (GIN JSONB @> {"sections":[{"knowledgeFileId": fileID}]}).
	var exerciseID string
	if err := sp.QueryRow(ctx,
		`INSERT INTO exercises (center_id, created_by, code, title, skill, content)
		 VALUES ($1, $2, 'EX-KH001', 'Listening', 'listening',
		         jsonb_build_object('sections', jsonb_build_array(jsonb_build_object('knowledgeFileId', $3::text))))
		 RETURNING id`,
		env.centerID, env.ownerID, fileID,
	).Scan(&exerciseID); err != nil {
		t.Fatalf("seed exercise: %v", err)
	}

	// Both links present.
	types := detailLinkTypes(t, env, slug)
	if types["session"] != 1 || types["exercise"] != 1 {
		t.Fatalf("expected 1 session + 1 exercise link, got %v", types)
	}
	// No view-rate field (deferred).
	assertNoViewRate(t, env, slug)

	// Soft-delete the exercise → only the session link remains.
	if _, err := sp.Exec(ctx, `UPDATE exercises SET deleted_at = now() WHERE id = $1`, exerciseID); err != nil {
		t.Fatalf("soft-delete exercise: %v", err)
	}
	types = detailLinkTypes(t, env, slug)
	if types["session"] != 1 || types["exercise"] != 0 {
		t.Errorf("after soft-deleting the exercise, expected only the session link, got %v", types)
	}
}

// --- small readers ---

func storageUsed(t *testing.T, env confirmEnv) int64 {
	t.Helper()
	rec := khReq(t, env, http.MethodGet, "/api/storage/usage", "")
	var resp struct {
		Data struct {
			UsedBytes int64 `json:"usedBytes"`
		} `json:"data"`
	}
	_ = json.NewDecoder(rec.Body).Decode(&resp)
	return resp.Data.UsedBytes
}

func listFileIDs(t *testing.T, env confirmEnv) []string {
	t.Helper()
	rec := khReq(t, env, http.MethodGet, "/api/knowledge-hub/files", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("list files → %d: %s", rec.Code, rec.Body.String())
	}
	var resp struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	_ = json.NewDecoder(rec.Body).Decode(&resp)
	out := make([]string, len(resp.Data))
	for i, f := range resp.Data {
		out[i] = f.ID
	}
	return out
}

func detailLinkTypes(t *testing.T, env confirmEnv, slug string) map[string]int {
	t.Helper()
	rec := khReq(t, env, http.MethodGet, "/api/knowledge-hub/files/"+slug, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("file detail → %d: %s", rec.Code, rec.Body.String())
	}
	var resp struct {
		Data struct {
			LinkedLocations []struct {
				Type string `json:"type"`
			} `json:"linkedLocations"`
		} `json:"data"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("decode detail: %v", err)
	}
	types := map[string]int{}
	for _, l := range resp.Data.LinkedLocations {
		types[l.Type]++
	}
	return types
}

func assertNoViewRate(t *testing.T, env confirmEnv, slug string) {
	t.Helper()
	rec := khReq(t, env, http.MethodGet, "/api/knowledge-hub/files/"+slug, "")
	var raw map[string]json.RawMessage
	_ = json.NewDecoder(rec.Body).Decode(&raw)
	var data map[string]json.RawMessage
	_ = json.Unmarshal(raw["data"], &data)
	for _, banned := range []string{"viewRate", "viewCount", "viewsOf", "viewedBy", "viewedCount"} {
		if _, present := data[banned]; present {
			t.Errorf("file detail must NOT include a view-rate field (%q is deferred)", banned)
		}
	}
}
