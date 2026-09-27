// Package service — Story 8.4a SearchService: the role-scoped GET /api/search read
// model (FR-67). ONE endpoint on the ungated dashboardChain; every authenticated
// role reaches it and the service returns ITS OWN scoped, grouped payload — never a
// 403 for role (D5). Results are grouped by category (classes/students/exercises/
// assignments/files), each capped at 5 with a hasMore flag, accent-insensitive, and
// scoped by a single audited scope-param function.
//
// Seams honored:
//   - ONE tx per request with SET LOCAL app.current_tenant_id, so RLS tenant-scopes
//     every searched table (GO-1 / PERF-1). Reads only.
//   - Scope (D5) via searchScope: owner/admin ⇒ (NULL,NULL) center-wide; teacher ⇒
//     (caller,NULL) own resources; student ⇒ (NULL,caller). A student is NEVER sent
//     (NULL,NULL) — that would leak the whole center past RLS (R-2). A student runs
//     ONLY the classes + assignments queries; students/exercises/files return empty.
//   - Query handling (D7): trim + min-length-3-RUNES short-circuit BEFORE opening the
//     tx (zero category business queries, AC2); LIKE metacharacters escaped (R-3).
//   - Accent-insensitivity (D9) lives in SQL (immutable_unaccent on both sides); the
//     service passes the RAW trimmed query — never pre-unaccents it.
//   - One set-based query per category (PERF-2/R-5); the ≤5+hasMore slice comes from
//     a LIMIT 6 fetch, no second COUNT (D6).
package service

import (
	"context"
	"fmt"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/store"
	"github.com/ducdo/classlite-api/internal/store/generated"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// Search tuning constants (CQ-3 — no magic values).
const (
	// SearchMinQueryLength is the minimum trimmed RUNE length (D7/Winston #1). A
	// 2-char '%q%' extracts zero trigrams → the gin_trgm_ops index is unusable →
	// Seq Scan (contradicts AC15). Below this the endpoint short-circuits to
	// all-empty with ZERO category business queries (AC2) — the palette polls per
	// keystroke, so a "type more" state must be cheap, not a 422.
	SearchMinQueryLength = 3
	// SearchMaxQueryLength caps the trimmed query (RUNES). Without a ceiling an
	// unbounded '%q%' is escaped (~2x alloc) and shipped to five trigram queries per
	// keystroke on the ungated chain — a cheap amplification vector. The searched
	// labels are short (names/titles/codes); 128 runes is far above any real query.
	SearchMaxQueryLength = 128
	// SearchCategoryLimit is the max items returned per category (AC1/AC4).
	SearchCategoryLimit = 5
	// searchCategoryFetch = SearchCategoryLimit + 1: fetch one extra row so hasMore
	// is derived from the slice length without a second COUNT query (D6/Sally C1).
	searchCategoryFetch = SearchCategoryLimit + 1
)

// SearchResultItem type discriminators (D6). The value-scan matrix asserts each
// category's items carry the matching type (Murat C6).
const (
	searchTypeClass      = "class"
	searchTypeStudent    = "student"
	searchTypeExercise   = "exercise"
	searchTypeAssignment = "assignment"
	searchTypeFile       = "file"
)

// ---------------- Response DTOs (PROVISIONAL — 8-4b co-finalizes, D6/D10) ----------------

// SearchResultItem is one match. Subtitle/Slug/ClassID are GO-5 explicit nulls (no
// omitempty). Slug is non-null ONLY for a file (its route key); ClassID is non-null
// ONLY for an assignment (its parent class → the FE deep-link, D10). There is NO
// backend href — navigation is a React-Router concern owned by 8-4b (D6/GO-3).
type SearchResultItem struct {
	ID       string  `json:"id"`
	Type     string  `json:"type"`
	Title    string  `json:"title"`
	Subtitle *string `json:"subtitle"`
	Slug     *string `json:"slug"`
	ClassID  *string `json:"classId"`
}

// SearchCategory is one grouped result set. Items is always non-null (>= empty slice,
// AC2); HasMore is true when the underlying query matched more than SearchCategoryLimit.
type SearchCategory struct {
	Items   []SearchResultItem `json:"items"`
	HasMore bool               `json:"hasMore"`
}

// SearchResults is the grouped payload; every category is always present (AC1).
type SearchResults struct {
	Classes     SearchCategory `json:"classes"`
	Students    SearchCategory `json:"students"`
	Exercises   SearchCategory `json:"exercises"`
	Assignments SearchCategory `json:"assignments"`
	Files       SearchCategory `json:"files"`
}

// SearchService serves the role-scoped grouped search read.
type SearchService struct {
	db  AuthDB
	clk clock.Clock
}

// NewSearchService constructs a SearchService. clk is injected for parity with the
// other 8.x read services (unused by search today, kept for a stable seam signature).
func NewSearchService(db AuthDB, clk clock.Clock) *SearchService {
	if clk == nil {
		clk = clock.RealClock{}
	}
	return &SearchService{db: db, clk: clk}
}

// searchScope derives the two scope nargs from the caller's role (D5, the R-1/R-2
// guard). The student case is EXPLICIT: a student is NEVER sent (NULL,NULL), which
// would silently return the whole center past the RLS floor (R-2). owner/admin ⇒
// (NULL,NULL) center-wide; teacher ⇒ (caller,NULL); student ⇒ (NULL,caller).
func searchScope(role string, callerUUID uuid.UUID) (teacherNarg, studentUserNarg pgtype.UUID) {
	switch role {
	case model.RoleTeacher:
		return pgUUID(callerUUID), pgtype.UUID{Valid: false}
	case model.RoleStudent:
		return pgtype.UUID{Valid: false}, pgUUID(callerUUID)
	case model.RoleOwner, model.RoleAdmin:
		return pgtype.UUID{Valid: false}, pgtype.UUID{Valid: false}
	default:
		// Unreachable on the current path — Search validates tc.Role before calling.
		// Fail CLOSED, not open: a VALID nil teacher narg matches NO resource (nothing
		// has teacher_id = 00000000-…), so an unknown role that ever reached here
		// returns EMPTY rather than the whole center past RLS (R-2 defense in depth).
		return pgUUID(uuid.Nil), pgUUID(uuid.Nil)
	}
}

// unaccentedRuneLen counts the runes of q that survive immutable_unaccent — it drops
// the nonspacing/enclosing combining marks (Unicode Mn/Me) the unaccent dictionary
// collapses to empty. This is the D9 "min-length applies to the unaccented query"
// gate: a query of bare combining diacritics has effective length 0 and must be
// treated as too-short, never passed through to a '%%' pattern. Precomposed accented
// letters (é, à) are single non-mark runes and still count 1 — matching unaccent,
// which maps them to a single base letter.
func unaccentedRuneLen(q string) int {
	n := 0
	for _, r := range q {
		if unicode.Is(unicode.Mn, r) || unicode.Is(unicode.Me, r) {
			continue
		}
		n++
	}
	return n
}

// escapeLikePattern neutralizes LIKE metacharacters in the raw query so a literal
// '%'/'_'/'\' cannot wildcard-match or error the ILIKE (R-3/Murat B6). The backslash
// is escaped FIRST — escaping it after '%'/'_' would double-escape the backslashes
// just added. The caller wraps the result as '%<escaped>%'.
func escapeLikePattern(q string) string {
	q = strings.ReplaceAll(q, `\`, `\\`)
	q = strings.ReplaceAll(q, `%`, `\%`)
	q = strings.ReplaceAll(q, `_`, `\_`)
	return q
}

// emptySearchCategory is a non-null empty category (AC2 — never a null items array).
func emptySearchCategory() SearchCategory {
	return SearchCategory{Items: []SearchResultItem{}, HasMore: false}
}

// emptySearchResults is the all-empty grouped payload returned for a too-short query
// (AC2) and the base every branch fills in.
func emptySearchResults() SearchResults {
	return SearchResults{
		Classes:     emptySearchCategory(),
		Students:    emptySearchCategory(),
		Exercises:   emptySearchCategory(),
		Assignments: emptySearchCategory(),
		Files:       emptySearchCategory(),
	}
}

// Search returns the role-scoped grouped results for rawQuery (AC1-AC11). A trimmed
// query shorter than SearchMinQueryLength runes short-circuits to all-empty WITHOUT
// opening a tx or issuing any category query (AC2/D7).
func (s *SearchService) Search(ctx context.Context, tc model.TenantContext, rawQuery string) (*SearchResults, error) {
	centerUUID, err := uuid.Parse(tc.CenterID)
	if err != nil {
		return nil, &ForbiddenError{Reason: "invalid tenant context"}
	}
	callerUUID, err := uuid.Parse(tc.UserID)
	if err != nil {
		return nil, &ForbiddenError{Reason: "invalid tenant context"}
	}
	switch tc.Role {
	case model.RoleOwner, model.RoleAdmin, model.RoleTeacher, model.RoleStudent:
		// valid — searchScope handles each explicitly (R-2)
	default:
		return nil, &ForbiddenError{Reason: "unknown role"}
	}

	// Trim + validate + length-gate BEFORE any DB work (AC2 zero category queries).
	// The floor is the UNACCENTED length (D9): immutable_unaccent strips combining
	// marks in SQL, so a query of bare combining diacritics (e.g. U+0301) unaccents to
	// empty → the '%q%' pattern degenerates to '%%' → a Seq Scan across every table + an
	// arbitrary over-match, the exact index-death the floor exists to prevent.
	// unaccentedRuneLen mirrors that collapse. Invalid UTF-8 short-circuits too (pgx
	// rejects non-UTF-8 text params → a 500 instead of the contract's empty result), as
	// does an over-long query (amplification guard on this per-keystroke endpoint).
	q := strings.TrimSpace(rawQuery)
	if !utf8.ValidString(q) ||
		utf8.RuneCountInString(q) > SearchMaxQueryLength ||
		unaccentedRuneLen(q) < SearchMinQueryLength {
		empty := emptySearchResults()
		return &empty, nil
	}

	teacherNarg, studentUserNarg := searchScope(tc.Role, callerUUID)
	pattern := "%" + escapeLikePattern(q) + "%"
	isStudent := tc.Role == model.RoleStudent

	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("search: begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()
	if err := store.SetTenantContext(ctx, tx, tc); err != nil {
		return nil, fmt.Errorf("search: %w", err)
	}
	qgen := generated.New(tx)
	centerPg := pgUUID(centerUUID)

	results := emptySearchResults()

	// Classes — every role (student scoped to active enrollments via studentUserNarg).
	classRows, err := qgen.SearchClasses(ctx, generated.SearchClassesParams{
		CenterID:    centerPg,
		Pattern:     pattern,
		TeacherNarg: teacherNarg,
		StudentUser: studentUserNarg,
		Q:           q,
		ResultLimit: searchCategoryFetch,
	})
	if err != nil {
		return nil, fmt.Errorf("search classes: %w", err)
	}
	results.Classes = buildClassCategory(classRows)

	// Assignments — every role (student scoped to enrolled classes via studentUserNarg).
	asgRows, err := qgen.SearchAssignments(ctx, generated.SearchAssignmentsParams{
		CenterID:    centerPg,
		Pattern:     pattern,
		TeacherNarg: teacherNarg,
		StudentUser: studentUserNarg,
		Q:           q,
		ResultLimit: searchCategoryFetch,
	})
	if err != nil {
		return nil, fmt.Errorf("search assignments: %w", err)
	}
	results.Assignments = buildAssignmentCategory(asgRows)

	// Students / Exercises / Files — NOT for a student (D5 hard scope guarantee: the
	// student branch never RUNS these three queries, so a scope-param refactor that
	// mis-derived NULL/NULL cannot leak them).
	if !isStudent {
		studentRows, err := qgen.SearchStudents(ctx, generated.SearchStudentsParams{
			CenterID:    centerPg,
			Pattern:     pattern,
			TeacherNarg: teacherNarg,
			Q:           q,
			ResultLimit: searchCategoryFetch,
		})
		if err != nil {
			return nil, fmt.Errorf("search students: %w", err)
		}
		results.Students = buildStudentCategory(studentRows)

		exerciseRows, err := qgen.SearchExercises(ctx, generated.SearchExercisesParams{
			CenterID:    centerPg,
			Pattern:     pattern,
			TeacherNarg: teacherNarg,
			Q:           q,
			ResultLimit: searchCategoryFetch,
		})
		if err != nil {
			return nil, fmt.Errorf("search exercises: %w", err)
		}
		results.Exercises = buildExerciseCategory(exerciseRows)

		fileRows, err := qgen.SearchFiles(ctx, generated.SearchFilesParams{
			CenterID:    centerPg,
			Pattern:     pattern,
			TeacherNarg: teacherNarg,
			Q:           q,
			ResultLimit: searchCategoryFetch,
		})
		if err != nil {
			return nil, fmt.Errorf("search files: %w", err)
		}
		results.Files = buildFileCategory(fileRows)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("search: commit: %w", err)
	}
	return &results, nil
}

// ---------------- category builders (slice-5 + hasMore, D6) ----------------

// classSubtitle is the class's primary skill, falling back to its lifecycle status
// (D6 "primary skill/status").
func classSubtitle(r generated.SearchClassesRow) *string {
	if r.PrimarySkill.Valid && r.PrimarySkill.String != "" {
		v := r.PrimarySkill.String
		return &v
	}
	v := r.Status
	return &v
}

func buildClassCategory(rows []generated.SearchClassesRow) SearchCategory {
	hasMore := len(rows) > SearchCategoryLimit
	if hasMore {
		rows = rows[:SearchCategoryLimit]
	}
	items := make([]SearchResultItem, 0, len(rows))
	for i := range rows {
		items = append(items, SearchResultItem{
			ID:       uuidFromPg(rows[i].ID).String(),
			Type:     searchTypeClass,
			Title:    rows[i].Title,
			Subtitle: classSubtitle(rows[i]),
			Slug:     nil,
			ClassID:  nil,
		})
	}
	return SearchCategory{Items: items, HasMore: hasMore}
}

func buildStudentCategory(rows []generated.SearchStudentsRow) SearchCategory {
	hasMore := len(rows) > SearchCategoryLimit
	if hasMore {
		rows = rows[:SearchCategoryLimit]
	}
	items := make([]SearchResultItem, 0, len(rows))
	for i := range rows {
		items = append(items, SearchResultItem{
			ID:       uuidFromPg(rows[i].ID).String(),
			Type:     searchTypeStudent,
			Title:    rows[i].Title,
			Subtitle: bytesToStringPtr(rows[i].Subtitle),
			Slug:     nil,
			ClassID:  nil,
		})
	}
	return SearchCategory{Items: items, HasMore: hasMore}
}

func buildExerciseCategory(rows []generated.SearchExercisesRow) SearchCategory {
	hasMore := len(rows) > SearchCategoryLimit
	if hasMore {
		rows = rows[:SearchCategoryLimit]
	}
	items := make([]SearchResultItem, 0, len(rows))
	for i := range rows {
		skill := rows[i].Skill
		items = append(items, SearchResultItem{
			ID:       uuidFromPg(rows[i].ID).String(),
			Type:     searchTypeExercise,
			Title:    rows[i].Title,
			Subtitle: &skill,
			Slug:     nil,
			ClassID:  nil,
		})
	}
	return SearchCategory{Items: items, HasMore: hasMore}
}

func buildAssignmentCategory(rows []generated.SearchAssignmentsRow) SearchCategory {
	hasMore := len(rows) > SearchCategoryLimit
	if hasMore {
		rows = rows[:SearchCategoryLimit]
	}
	items := make([]SearchResultItem, 0, len(rows))
	for i := range rows {
		// subtitle = exercise skill + class name (AC11); title is the exercise title.
		subtitle := rows[i].ExerciseSkill + " · " + rows[i].ClassName
		classID := uuidFromPg(rows[i].ClassID).String()
		items = append(items, SearchResultItem{
			ID:       uuidFromPg(rows[i].ID).String(),
			Type:     searchTypeAssignment,
			Title:    rows[i].Title,
			Subtitle: &subtitle,
			Slug:     nil,
			ClassID:  &classID,
		})
	}
	return SearchCategory{Items: items, HasMore: hasMore}
}

// fileSubtitle is the file's folder name, falling back to its content type (D6
// "folder name/content type").
func fileSubtitle(r generated.SearchFilesRow) *string {
	if r.FolderName.Valid && r.FolderName.String != "" {
		v := r.FolderName.String
		return &v
	}
	v := r.ContentType
	return &v
}

func buildFileCategory(rows []generated.SearchFilesRow) SearchCategory {
	hasMore := len(rows) > SearchCategoryLimit
	if hasMore {
		rows = rows[:SearchCategoryLimit]
	}
	items := make([]SearchResultItem, 0, len(rows))
	for i := range rows {
		slug := rows[i].Slug
		items = append(items, SearchResultItem{
			ID:       uuidFromPg(rows[i].ID).String(),
			Type:     searchTypeFile,
			Title:    rows[i].Title,
			Subtitle: fileSubtitle(rows[i]),
			Slug:     &slug,
			ClassID:  nil,
		})
	}
	return SearchCategory{Items: items, HasMore: hasMore}
}

// bytesToStringPtr maps a nil-safe []byte (an uncast string_agg — NULL when the
// student has no scoped active enrollment) to a *string (GO-5 explicit null).
func bytesToStringPtr(b []byte) *string {
	if b == nil {
		return nil
	}
	v := string(b)
	return &v
}
