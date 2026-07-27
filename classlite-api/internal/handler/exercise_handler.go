// Package handler — Story 4.1 ExerciseHandler.
//
// Six endpoints on the exerciseChain (extractTenant → requireVerified →
// requireCenter → ErrorMapper — NOT owner-gated, so teachers reach it). Role
// (owner/admin/teacher; student → 403) + teacher-scope (cross-teacher → 404)
// are enforced in the service (SEC-1). The list endpoint validates page ≥ 1 +
// clamps pageSize to [1, maxExercisePageSize] and returns meta.pagination +
// meta.skillCounts. All responses use the {data,meta} envelope with explicit
// nulls (GO-5). Timestamps use RFC3339Nano (UTC) so the updatedAt precondition
// round-trips at microsecond precision (a truncated echo would false-409).
package handler

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/ducdo/classlite-api/internal/store"
	"github.com/ducdo/classlite-api/internal/store/generated"
)

const (
	// maxExerciseBodyBytes bounds the whole request body. The content-specific
	// store.MaxContentBytes (256 KiB) is the tighter per-blob guard; the body
	// cap is a touch larger to leave room for the metadata envelope.
	maxExerciseBodyBytes    = store.MaxContentBytes + 16*1024
	defaultExercisePageSize = 20
	maxExercisePageSize     = 100
	minExercisePage         = 1
	// maxExercisePage bounds page so (page-1)*pageSize cannot overflow the int32
	// SQL OFFSET (CR-4-1-2). 100k pages × the 100-row max ceiling = 10M rows,
	// far beyond any real library, and well under the int32 limit.
	maxExercisePage    = 100_000
	exerciseBandMin    = 0.0
	exerciseBandMax    = 9.0
	exerciseTimeFormat = time.RFC3339Nano
)

type ExerciseHandler struct {
	svc *service.ExerciseService
	clk clock.Clock
}

func NewExerciseHandler(svc *service.ExerciseService, clk clock.Clock) *ExerciseHandler {
	return &ExerciseHandler{svc: svc, clk: clk}
}

// --- wire shapes ---

// exerciseResponse is the api.yaml Exercise wire shape (detail/create/update/
// duplicate). content is emitted as the raw JSONB object (json.RawMessage).
type exerciseResponse struct {
	ID            string          `json:"id"`
	CenterID      string          `json:"centerId"`
	CreatedBy     string          `json:"createdBy"`
	Code          string          `json:"code"`
	Title         string          `json:"title"`
	Description   *string         `json:"description"`
	Skill         string          `json:"skill"`
	Tags          []string        `json:"tags"`
	TargetBand    *float64        `json:"targetBand"`
	SchemaVersion int32           `json:"schemaVersion"`
	SectionCount  int             `json:"sectionCount"`
	QuestionCount int             `json:"questionCount"`
	Content       json.RawMessage `json:"content"`
	CreatedAt     string          `json:"createdAt"`
	UpdatedAt     string          `json:"updatedAt"`
}

// exerciseListItemResponse is the api.yaml ExerciseListItem shape — no content
// blob (never transferred on the list path), SQL-computed counts.
type exerciseListItemResponse struct {
	ID            string   `json:"id"`
	CenterID      string   `json:"centerId"`
	CreatedBy     string   `json:"createdBy"`
	Code          string   `json:"code"`
	Title         string   `json:"title"`
	Description   *string  `json:"description"`
	Skill         string   `json:"skill"`
	Tags          []string `json:"tags"`
	TargetBand    *float64 `json:"targetBand"`
	SchemaVersion int32    `json:"schemaVersion"`
	SectionCount  int32    `json:"sectionCount"`
	QuestionCount int32    `json:"questionCount"`
	CreatedAt     string   `json:"createdAt"`
	UpdatedAt     string   `json:"updatedAt"`
}

type skillCountResponse struct {
	Skill string `json:"skill"`
	Count int64  `json:"count"`
}

// exerciseListMeta is the paginated list meta: serverTime + pagination +
// skillCounts (the count-tab strip).
type exerciseListMeta struct {
	ServerTime  string               `json:"serverTime"`
	Pagination  PaginationMeta       `json:"pagination"`
	SkillCounts []skillCountResponse `json:"skillCounts"`
}

func libraryExerciseToResponse(x service.ExerciseWithCounts) exerciseResponse {
	row := x.Row
	content := json.RawMessage(row.Content)
	if len(content) == 0 {
		content = json.RawMessage(`{"sections":[]}`)
	}
	return exerciseResponse{
		ID:            uuidPgToString(row.ID),
		CenterID:      uuidPgToString(row.CenterID),
		CreatedBy:     uuidPgToString(row.CreatedBy),
		Code:          row.Code,
		Title:         row.Title,
		Description:   textPgToPtr(row.Description),
		Skill:         row.Skill,
		Tags:          tagsOrEmpty(row.Tags),
		TargetBand:    numericPgToPtr(row.TargetBand),
		SchemaVersion: row.SchemaVersion,
		SectionCount:  x.SectionCount,
		QuestionCount: x.QuestionCount,
		Content:       content,
		CreatedAt:     row.CreatedAt.Time.UTC().Format(exerciseTimeFormat),
		UpdatedAt:     row.UpdatedAt.Time.UTC().Format(exerciseTimeFormat),
	}
}

func exerciseListItemToResponse(row generated.ListExercisesRow) exerciseListItemResponse {
	return exerciseListItemResponse{
		ID:            uuidPgToString(row.ID),
		CenterID:      uuidPgToString(row.CenterID),
		CreatedBy:     uuidPgToString(row.CreatedBy),
		Code:          row.Code,
		Title:         row.Title,
		Description:   textPgToPtr(row.Description),
		Skill:         row.Skill,
		Tags:          tagsOrEmpty(row.Tags),
		TargetBand:    numericPgToPtr(row.TargetBand),
		SchemaVersion: row.SchemaVersion,
		SectionCount:  row.SectionCount,
		QuestionCount: row.QuestionCount,
		CreatedAt:     row.CreatedAt.Time.UTC().Format(exerciseTimeFormat),
		UpdatedAt:     row.UpdatedAt.Time.UTC().Format(exerciseTimeFormat),
	}
}

// tagsOrEmpty guarantees a non-nil slice so `tags` serializes as [] not null.
func tagsOrEmpty(tags []string) []string {
	if tags == nil {
		return []string{}
	}
	return tags
}

// --- handlers ---

// List validates page/pageSize + skill/tag/band filters and returns the
// role-scoped, paginated page plus meta.pagination + meta.skillCounts.
func (h *ExerciseHandler) List(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireOwnerTenant(r)
	if err != nil {
		return err
	}
	filter, err := parseExerciseListQuery(r)
	if err != nil {
		return err
	}
	result, err := h.svc.List(r.Context(), tc, filter)
	if err != nil {
		return err
	}

	items := make([]exerciseListItemResponse, len(result.Items))
	for i, row := range result.Items {
		items[i] = exerciseListItemToResponse(row)
	}
	skillCounts := make([]skillCountResponse, len(result.SkillCounts))
	for i, sc := range result.SkillCounts {
		skillCounts[i] = skillCountResponse{Skill: sc.Skill, Count: sc.Count}
	}
	meta := exerciseListMeta{
		ServerTime: h.clk.Now().UTC().Format(exerciseTimeFormat),
		Pagination: PaginationMeta{
			Page:       result.Page,
			PageSize:   result.PageSize,
			Total:      int(result.Total),
			TotalPages: result.TotalPages,
		},
		SkillCounts: skillCounts,
	}
	WriteEnvelopeWithMeta(w, http.StatusOK, items, meta)
	return nil
}

func (h *ExerciseHandler) Create(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireOwnerTenant(r)
	if err != nil {
		return err
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxExerciseBodyBytes)
	var body createExerciseRequestBody
	if err := decodeExerciseJSONBody(r.Body, &body); err != nil {
		return err
	}
	created, err := h.svc.Create(r.Context(), tc, service.CreateExerciseInput{
		Title:       body.Title,
		Skill:       body.Skill,
		Tags:        body.Tags,
		Description: body.Description,
		TargetBand:  body.TargetBand,
	})
	if err != nil {
		return err
	}
	WriteEnvelope(w, http.StatusCreated, h.clk, libraryExerciseToResponse(created))
	return nil
}

func (h *ExerciseHandler) Get(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireOwnerTenant(r)
	if err != nil {
		return err
	}
	id, err := parseSettingsPathID(r, "id", "EXERCISE_NOT_FOUND", "exercise")
	if err != nil {
		return err
	}
	row, err := h.svc.Get(r.Context(), tc, id)
	if err != nil {
		return err
	}
	WriteEnvelope(w, http.StatusOK, h.clk, libraryExerciseToResponse(row))
	return nil
}

func (h *ExerciseHandler) Update(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireOwnerTenant(r)
	if err != nil {
		return err
	}
	id, err := parseSettingsPathID(r, "id", "EXERCISE_NOT_FOUND", "exercise")
	if err != nil {
		return err
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxExerciseBodyBytes)
	var body updateExerciseRequestBody
	if err := decodeExerciseJSONBody(r.Body, &body); err != nil {
		return err
	}
	in, verr := body.toUpdateInput(r.Header.Get("If-Match"))
	if verr != nil {
		return verr
	}
	updated, err := h.svc.Update(r.Context(), tc, id, in)
	if err != nil {
		return err
	}
	WriteEnvelope(w, http.StatusOK, h.clk, libraryExerciseToResponse(updated))
	return nil
}

func (h *ExerciseHandler) Delete(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireOwnerTenant(r)
	if err != nil {
		return err
	}
	id, err := parseSettingsPathID(r, "id", "EXERCISE_NOT_FOUND", "exercise")
	if err != nil {
		return err
	}
	if err := h.svc.SoftDelete(r.Context(), tc, id); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (h *ExerciseHandler) Duplicate(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireOwnerTenant(r)
	if err != nil {
		return err
	}
	id, err := parseSettingsPathID(r, "id", "EXERCISE_NOT_FOUND", "exercise")
	if err != nil {
		return err
	}
	dup, err := h.svc.Duplicate(r.Context(), tc, id)
	if err != nil {
		return err
	}
	WriteEnvelope(w, http.StatusCreated, h.clk, libraryExerciseToResponse(dup))
	return nil
}

// --- request bodies ---

type createExerciseRequestBody struct {
	Title       string   `json:"title"`
	Skill       string   `json:"skill"`
	Tags        []string `json:"tags"`
	Description *string  `json:"description"`
	TargetBand  *float64 `json:"targetBand"`
}

type updateExerciseRequestBody struct {
	Title       *string          `json:"title"`
	Skill       *string          `json:"skill"`
	Tags        []string         `json:"tags"`
	Description optionalString   `json:"description"`
	TargetBand  optionalFloat    `json:"targetBand"`
	Content     *json.RawMessage `json:"content"`
	UpdatedAt   *string          `json:"updatedAt"`
}

// optionalString / optionalFloat capture PATCH tri-state for the nullable
// description/targetBand fields: UnmarshalJSON runs only when the key is present
// (set = true), and an explicit JSON null leaves value == nil (clear). An absent
// key never calls UnmarshalJSON, so set stays false (unchanged). This is what
// lets `"description": null` clear a stored value (CR-4-1-9).
type optionalString struct {
	set   bool
	value *string
}

func (o *optionalString) UnmarshalJSON(b []byte) error {
	o.set = true
	if string(b) == "null" {
		o.value = nil
		return nil
	}
	var s string
	if err := json.Unmarshal(b, &s); err != nil {
		return err
	}
	o.value = &s
	return nil
}

type optionalFloat struct {
	set   bool
	value *float64
}

func (o *optionalFloat) UnmarshalJSON(b []byte) error {
	o.set = true
	if string(b) == "null" {
		o.value = nil
		return nil
	}
	var f float64
	if err := json.Unmarshal(b, &f); err != nil {
		return err
	}
	o.value = &f
	return nil
}

func (b updateExerciseRequestBody) toUpdateInput(ifMatch string) (service.UpdateExerciseInput, error) {
	in := service.UpdateExerciseInput{
		Title:       b.Title,
		Skill:       b.Skill,
		Tags:        b.Tags,
		Description: service.TriString{Set: b.Description.set, Value: b.Description.value},
		TargetBand:  service.TriFloat{Set: b.TargetBand.set, Value: b.TargetBand.value},
	}

	// Precondition: If-Match header wins; body updatedAt is the fallback.
	// Absent from BOTH → nil (the service returns 428).
	rawPrecondition := strings.TrimSpace(ifMatch)
	if rawPrecondition == "" && b.UpdatedAt != nil {
		rawPrecondition = strings.TrimSpace(*b.UpdatedAt)
	}
	if rawPrecondition != "" {
		t, err := time.Parse(time.RFC3339Nano, rawPrecondition)
		if err != nil {
			return service.UpdateExerciseInput{}, model.ValidationError{Fields: []model.FieldError{{
				Field: "updatedAt", Code: "INVALID_PRECONDITION", Message: "expected an RFC3339 timestamp",
			}}}
		}
		in.Precondition = &t
	}

	// content full-replace: decode the opaque object into the typed v1 struct.
	if b.Content != nil {
		content, err := store.UnmarshalExerciseContent(*b.Content, store.CurrentExerciseSchemaVersion)
		if err != nil {
			return service.UpdateExerciseInput{}, model.ValidationError{Fields: []model.FieldError{{
				Field: "content", Code: "INVALID_CONTENT", Message: "content is not a valid v1 exercise body",
			}}}
		}
		in.Content = &content
	}
	return in, nil
}

// --- query parsing ---

func parseExerciseListQuery(r *http.Request) (service.ListExerciseFilter, error) {
	q := r.URL.Query()

	page := minExercisePage
	if raw := strings.TrimSpace(q.Get("page")); raw != "" {
		v, err := strconv.Atoi(raw)
		if err != nil || v < minExercisePage || v > maxExercisePage {
			return service.ListExerciseFilter{}, model.ValidationError{Fields: []model.FieldError{{
				Field: "page", Code: "INVALID_PAGE",
				Message: fmt.Sprintf("page must be an integer between %d and %d", minExercisePage, maxExercisePage),
			}}}
		}
		page = v
	}

	pageSize := defaultExercisePageSize
	if raw := strings.TrimSpace(q.Get("pageSize")); raw != "" {
		v, err := strconv.Atoi(raw)
		if err != nil || v < 1 {
			return service.ListExerciseFilter{}, model.ValidationError{Fields: []model.FieldError{{
				Field: "pageSize", Code: "INVALID_PAGE_SIZE", Message: "pageSize must be an integer ≥ 1",
			}}}
		}
		if v > maxExercisePageSize {
			v = maxExercisePageSize // clamp, not reject
		}
		pageSize = v
	}

	filter := service.ListExerciseFilter{Page: page, PageSize: pageSize}

	if raw := strings.TrimSpace(q.Get("skill")); raw != "" {
		filter.Skill = &raw
	}
	if raw := strings.TrimSpace(q.Get("tag")); raw != "" {
		filter.Tag = &raw
	}
	if raw := strings.TrimSpace(q.Get("band")); raw != "" {
		v, err := strconv.ParseFloat(raw, 64)
		// Range/finite-guard the filter so a malformed value (band=-3, NaN, Inf)
		// is a clean 422, never a downstream numeric-conversion 500 (CR-4-1-3).
		if err != nil || math.IsNaN(v) || math.IsInf(v, 0) || v < exerciseBandMin || v > exerciseBandMax {
			return service.ListExerciseFilter{}, model.ValidationError{Fields: []model.FieldError{{
				Field: "band", Code: "INVALID_BAND",
				Message: fmt.Sprintf("band must be a number between %g and %g", exerciseBandMin, exerciseBandMax),
			}}}
		}
		filter.Band = &v
	}
	return filter, nil
}

// --- decode helper ---

func decodeExerciseJSONBody(r io.Reader, dst any) error {
	dec := json.NewDecoder(r)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			return &service.PayloadTooLargeError{LimitBytes: maxBytesErr.Limit}
		}
		if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
			return model.ValidationError{Fields: []model.FieldError{{Field: "body", Message: "request body is required"}}}
		}
		return model.ValidationError{Fields: []model.FieldError{{Field: "body", Message: "invalid JSON"}}}
	}
	return nil
}
