// Package handler — Story 3.4.5 + 7.3a EnrollmentHandler.
//
// Endpoints:
//
//	POST /api/enrollments                     unified add/transfer/withdraw action
//	GET  /api/classes/{classId}/enrollments   active roster (paginated)
//	GET  /api/enrollments/history             immutable history (paginated, Admin/Owner)
//	GET  /api/enrollments/attention           needs-attention data (Admin/Owner)
//
// The action endpoint + the two reads are Admin/Owner only (DB-revalidated in the
// service; RequireRole is the edge defence-in-depth in main.go). The roster read
// stays teacher-reachable (teacher-scoped → 404 off own classes). Responses use the
// {data,meta} envelope with explicit nulls (GO-5).
package handler

import (
	"net/http"
	"strconv"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/ducdo/classlite-api/internal/store/generated"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

const maxEnrollmentBodyBytes = 16 * 1024

// effectiveDateLayout is the date-only wire format for effectiveDate / effective_date.
const effectiveDateLayout = "2006-01-02"

type EnrollmentHandler struct {
	svc *service.EnrollmentService
	clk clock.Clock
}

func NewEnrollmentHandler(svc *service.EnrollmentService, clk clock.Clock) *EnrollmentHandler {
	return &EnrollmentHandler{svc: svc, clk: clk}
}

// enrollmentResponse is the api.yaml Enrollment wire shape — every field
// explicit, nullables as pointers (GO-5).
type enrollmentResponse struct {
	ID           string  `json:"id"`
	CenterID     string  `json:"centerId"`
	StudentID    string  `json:"studentId"`
	ClassID      string  `json:"classId"`
	StudentName  string  `json:"studentName"`
	StudentEmail string  `json:"studentEmail"`
	EnrolledAt   string  `json:"enrolledAt"`
	WithdrawnAt  *string `json:"withdrawnAt"`
	Status       string  `json:"status"`
}

func enrolledStudentToResponse(e service.EnrolledStudent) enrollmentResponse {
	return enrollmentResponse{
		ID:           uuidPgToString(e.Enrollment.ID),
		CenterID:     uuidPgToString(e.Enrollment.CenterID),
		StudentID:    uuidPgToString(e.Enrollment.StudentID),
		ClassID:      uuidPgToString(e.Enrollment.ClassID),
		StudentName:  e.StudentName,
		StudentEmail: e.StudentEmail,
		EnrolledAt:   tstzToString(e.Enrollment.EnrolledAt),
		WithdrawnAt:  tstzPgToPtr(e.Enrollment.WithdrawnAt),
		Status:       e.Enrollment.Status,
	}
}

func rosterRowToResponse(r generated.ListEnrolledStudentsByClassPagedRow) enrollmentResponse {
	return enrollmentResponse{
		ID:           uuidPgToString(r.ID),
		CenterID:     uuidPgToString(r.CenterID),
		StudentID:    uuidPgToString(r.StudentID),
		ClassID:      uuidPgToString(r.ClassID),
		StudentName:  r.StudentName,
		StudentEmail: r.StudentEmail,
		EnrolledAt:   tstzToString(r.EnrolledAt),
		WithdrawnAt:  tstzPgToPtr(r.WithdrawnAt),
		Status:       r.Status,
	}
}

// Action — POST /api/enrollments (story 7.3a AC1). Unified add/transfer/withdraw;
// the legacy 3.4.5 Add body {studentId, classId} is normalized to action='add'.
// Admin/Owner only (DB-revalidated in the service).
func (h *EnrollmentHandler) Action(w http.ResponseWriter, r *http.Request) error {
	// requireOwnerTenant only extracts/validates the tenant context — the real
	// Admin/Owner gate is the DB re-fetch in the service (SEC-1).
	tc, err := requireOwnerTenant(r)
	if err != nil {
		return err
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxEnrollmentBodyBytes)
	var body enrollmentActionRequestBody
	if err := decodeClassJSONBody(r.Body, &body); err != nil {
		return err
	}
	action, verr := body.action()
	if verr != nil {
		return verr
	}
	studentID, verr := body.studentUUID()
	if verr != nil {
		return verr
	}
	effectiveDate, verr := body.effectiveDate(h.clk)
	if verr != nil {
		return verr
	}

	switch action {
	case service.EnrollmentActionAdd:
		toClassID, verr := body.toClassUUID()
		if verr != nil {
			return verr
		}
		result, err := h.svc.AddEnrollment(r.Context(), tc, studentID, toClassID, effectiveDate, body.Note)
		if err != nil {
			return err
		}
		WriteEnvelope(w, http.StatusCreated, h.clk, enrolledStudentToResponse(result))
		return nil
	case service.EnrollmentActionTransfer:
		fromClassID, verr := body.fromClassUUID()
		if verr != nil {
			return verr
		}
		toClassID, verr := body.toClassUUID()
		if verr != nil {
			return verr
		}
		result, err := h.svc.TransferEnrollment(r.Context(), tc, studentID, fromClassID, toClassID, effectiveDate, body.Note)
		if err != nil {
			return err
		}
		WriteEnvelope(w, http.StatusOK, h.clk, enrolledStudentToResponse(result))
		return nil
	case service.EnrollmentActionWithdraw:
		fromClassID, verr := body.fromClassUUID()
		if verr != nil {
			return verr
		}
		result, err := h.svc.WithdrawEnrollment(r.Context(), tc, studentID, fromClassID, effectiveDate, body.Note)
		if err != nil {
			return err
		}
		WriteEnvelope(w, http.StatusOK, h.clk, enrolledStudentToResponse(result))
		return nil
	default:
		return model.ValidationError{Fields: []model.FieldError{{Field: "action", Message: "must be add, transfer, or withdraw"}}}
	}
}

// ListByClass — GET /api/classes/{classId}/enrollments (story 3.4.5 AC3).
func (h *EnrollmentHandler) ListByClass(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireOwnerTenant(r)
	if err != nil {
		return err
	}
	classID, err := parseSettingsPathID(r, "classId", "CLASS_NOT_FOUND", "class")
	if err != nil {
		return err
	}
	page, pageSize := parseSnakePageParams(r)
	rows, pageMeta, err := h.svc.ListEnrolledStudentsByClass(r.Context(), tc, classID, page, pageSize)
	if err != nil {
		return err
	}
	out := make([]enrollmentResponse, len(rows))
	for i, row := range rows {
		out[i] = rosterRowToResponse(row)
	}
	writePaginatedEnvelope(w, h.clk, out, pageMeta)
	return nil
}

// ListHistory — GET /api/enrollments/history (story 7.3a AC11). Admin/Owner only.
func (h *EnrollmentHandler) ListHistory(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireOwnerTenant(r)
	if err != nil {
		return err
	}
	page, pageSize := parseSnakePageParams(r)
	studentID, verr := parseOptionalQueryUUID(r, "student_id")
	if verr != nil {
		return verr
	}
	classID, verr := parseOptionalQueryUUID(r, "class_id")
	if verr != nil {
		return verr
	}
	rows, pageMeta, err := h.svc.ListEnrollmentHistory(r.Context(), tc, page, pageSize, studentID, classID)
	if err != nil {
		return err
	}
	out := make([]enrollmentHistoryResponse, len(rows))
	for i, row := range rows {
		out[i] = historyRowToResponse(row)
	}
	writePaginatedEnvelope(w, h.clk, out, pageMeta)
	return nil
}

// Attention — GET /api/enrollments/attention (story 7.3a AC12). Admin/Owner only.
func (h *EnrollmentHandler) Attention(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireOwnerTenant(r)
	if err != nil {
		return err
	}
	// Each zone paginates independently (7.3a DN2); clamping happens in the service.
	uPage, uPageSize := parseNamedPageParams(r, "unassigned_page", "unassigned_page_size")
	oPage, oPageSize := parseNamedPageParams(r, "over_capacity_page", "over_capacity_page_size")
	data, err := h.svc.GetNeedsAttention(r.Context(), tc, uPage, uPageSize, oPage, oPageSize)
	if err != nil {
		return err
	}
	WriteEnvelope(w, http.StatusOK, h.clk, needsAttentionToResponse(data))
	return nil
}

// --- history + attention response shapes ---

type enrollmentHistoryResponse struct {
	ID            string  `json:"id"`
	CenterID      string  `json:"centerId"`
	StudentID     string  `json:"studentId"`
	StudentName   string  `json:"studentName"`
	Action        string  `json:"action"`
	FromClassID   *string `json:"fromClassId"`
	FromClassName *string `json:"fromClassName"`
	ToClassID     *string `json:"toClassId"`
	ToClassName   *string `json:"toClassName"`
	EffectiveDate string  `json:"effectiveDate"`
	Note          *string `json:"note"`
	PerformedBy   *string `json:"performedBy"`
	PerformerName *string `json:"performerName"`
	PerformedAt   string  `json:"performedAt"`
}

func historyRowToResponse(r generated.ListEnrollmentHistoryPagedRow) enrollmentHistoryResponse {
	return enrollmentHistoryResponse{
		ID:            uuidPgToString(r.ID),
		CenterID:      uuidPgToString(r.CenterID),
		StudentID:     uuidPgToString(r.StudentID),
		StudentName:   r.StudentName,
		Action:        r.Action,
		FromClassID:   uuidPgToPtr(r.FromClassID),
		FromClassName: textPgToPtr(r.FromClassName),
		ToClassID:     uuidPgToPtr(r.ToClassID),
		ToClassName:   textPgToPtr(r.ToClassName),
		EffectiveDate: dateToString(r.EffectiveDate),
		Note:          textPgToPtr(r.Note),
		PerformedBy:   uuidPgToPtr(r.PerformedBy),
		PerformerName: textPgToPtr(r.PerformerName),
		PerformedAt:   tstzToString(r.PerformedAt),
	}
}

type needsAttentionResponse struct {
	Unassigned   attentionUnassignedPage   `json:"unassigned"`
	OverCapacity attentionOverCapacityPage `json:"overCapacity"`
}

// attentionUnassignedPage / attentionOverCapacityPage — each zone paginates
// independently (7.3a DN2), so every list carries its own pagination block.
type attentionUnassignedPage struct {
	Items      []attentionStudentResponse `json:"items"`
	Pagination paginationMetaResponse     `json:"pagination"`
}

type attentionOverCapacityPage struct {
	Items      []overCapacityClassResponse `json:"items"`
	Pagination paginationMetaResponse      `json:"pagination"`
}

type attentionStudentResponse struct {
	StudentID    string `json:"studentId"`
	StudentName  string `json:"studentName"`
	StudentEmail string `json:"studentEmail"`
}

type overCapacityClassResponse struct {
	ClassID     string `json:"classId"`
	ClassName   string `json:"className"`
	Capacity    int    `json:"capacity"`
	ActiveCount int    `json:"activeCount"`
}

func pageMetaToResponse(p service.PageResult) paginationMetaResponse {
	return paginationMetaResponse{
		Page:       p.Page,
		PageSize:   p.PageSize,
		Total:      p.Total,
		TotalPages: p.TotalPages,
	}
}

func needsAttentionToResponse(n service.NeedsAttention) needsAttentionResponse {
	unassigned := make([]attentionStudentResponse, len(n.Unassigned))
	for i, s := range n.Unassigned {
		unassigned[i] = attentionStudentResponse{
			StudentID:    uuidPgToString(s.StudentID),
			StudentName:  s.StudentName,
			StudentEmail: s.StudentEmail,
		}
	}
	overCapacity := make([]overCapacityClassResponse, len(n.OverCapacity))
	for i, c := range n.OverCapacity {
		capacity := 0
		if c.Capacity.Valid {
			capacity = int(c.Capacity.Int32)
		}
		overCapacity[i] = overCapacityClassResponse{
			ClassID:     uuidPgToString(c.ClassID),
			ClassName:   c.ClassName,
			Capacity:    capacity,
			ActiveCount: int(c.ActiveCount),
		}
	}
	return needsAttentionResponse{
		Unassigned:   attentionUnassignedPage{Items: unassigned, Pagination: pageMetaToResponse(n.UnassignedPage)},
		OverCapacity: attentionOverCapacityPage{Items: overCapacity, Pagination: pageMetaToResponse(n.OverCapacityPage)},
	}
}

// writePaginatedEnvelope renders a {data,meta} list envelope with pagination meta.
func writePaginatedEnvelope(w http.ResponseWriter, clk clock.Clock, data any, pageMeta service.PageResult) {
	WriteEnvelopeWithMeta(w, http.StatusOK, data, paginatedListMeta{
		ServerTime: wireTime(clk.Now()),
		Pagination: paginationMetaResponse{
			Page:       pageMeta.Page,
			PageSize:   pageMeta.PageSize,
			Total:      pageMeta.Total,
			TotalPages: pageMeta.TotalPages,
		},
	})
}

// dateToString formats a pgtype.Date as YYYY-MM-DD (empty when invalid).
func dateToString(d pgtype.Date) string {
	if !d.Valid {
		return ""
	}
	return d.Time.Format(effectiveDateLayout)
}

// parseSnakePageParams reads page / page_size query params (XL-2 snake_case;
// defaults page 1 / service default page size). Clamping happens in the service.
func parseSnakePageParams(r *http.Request) (int, int) {
	return parseNamedPageParams(r, "page", "page_size")
}

// parseNamedPageParams reads a custom-named page / page_size pair (XL-2 snake_case;
// defaults page 1 / service default page size). Used where one endpoint paginates
// multiple independent lists (e.g. /attention's two zones). Clamping is in the service.
func parseNamedPageParams(r *http.Request, pageKey, pageSizeKey string) (int, int) {
	q := r.URL.Query()
	page := 1
	pageSize := service.DefaultPageSize
	if v := q.Get(pageKey); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			page = n
		}
	}
	if v := q.Get(pageSizeKey); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			pageSize = n
		}
	}
	return page, pageSize
}

// parseOptionalQueryUUID reads an optional UUID query param; absent → nil, present
// but malformed → 422 VALIDATION_ERROR.
func parseOptionalQueryUUID(r *http.Request, key string) (*uuid.UUID, error) {
	v := r.URL.Query().Get(key)
	if v == "" {
		return nil, nil
	}
	id, err := uuid.Parse(v)
	if err != nil {
		return nil, model.ValidationError{Fields: []model.FieldError{{Field: key, Message: "expected a UUID"}}}
	}
	return &id, nil
}

// --- request body ---

type enrollmentActionRequestBody struct {
	Action        string  `json:"action"`
	StudentID     string  `json:"studentId"`
	ToClassID     *string `json:"toClassId"`
	FromClassID   *string `json:"fromClassId"`
	ClassID       *string `json:"classId"` // legacy 3.4.5 Add alias for toClassId
	EffectiveDate *string `json:"effectiveDate"`
	Note          *string `json:"note"`
}

// action returns the normalized action. An absent action with a legacy classId is
// normalized to add; an absent action with no classId is a validation error.
func (b enrollmentActionRequestBody) action() (string, error) {
	if b.Action != "" {
		return b.Action, nil
	}
	if b.ClassID != nil {
		return service.EnrollmentActionAdd, nil
	}
	return "", model.ValidationError{Fields: []model.FieldError{{Field: "action", Message: "action is required"}}}
}

func (b enrollmentActionRequestBody) studentUUID() (uuid.UUID, error) {
	id, err := uuid.Parse(b.StudentID)
	if err != nil {
		return uuid.UUID{}, model.ValidationError{Fields: []model.FieldError{{Field: "studentId", Message: "expected a UUID"}}}
	}
	return id, nil
}

// toClassUUID resolves the add/transfer target, accepting the legacy classId alias.
func (b enrollmentActionRequestBody) toClassUUID() (uuid.UUID, error) {
	raw := ""
	if b.ToClassID != nil {
		raw = *b.ToClassID
	} else if b.ClassID != nil {
		raw = *b.ClassID
	}
	id, err := uuid.Parse(raw)
	if err != nil {
		return uuid.UUID{}, model.ValidationError{Fields: []model.FieldError{{Field: "toClassId", Message: "expected a UUID"}}}
	}
	return id, nil
}

func (b enrollmentActionRequestBody) fromClassUUID() (uuid.UUID, error) {
	raw := ""
	if b.FromClassID != nil {
		raw = *b.FromClassID
	}
	id, err := uuid.Parse(raw)
	if err != nil {
		return uuid.UUID{}, model.ValidationError{Fields: []model.FieldError{{Field: "fromClassId", Message: "expected a UUID"}}}
	}
	return id, nil
}

// effectiveDate parses the optional date (YYYY-MM-DD), defaulting to the server's
// current date (UTC) when omitted. A malformed value → 422 VALIDATION_ERROR.
func (b enrollmentActionRequestBody) effectiveDate(clk clock.Clock) (time.Time, error) {
	if b.EffectiveDate == nil || *b.EffectiveDate == "" {
		now := clk.Now().UTC()
		return time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC), nil
	}
	parsed, err := time.Parse(effectiveDateLayout, *b.EffectiveDate)
	if err != nil {
		return time.Time{}, model.ValidationError{Fields: []model.FieldError{{Field: "effectiveDate", Message: "expected a date (YYYY-MM-DD)"}}}
	}
	// No scheduling infra exists — a future effectiveDate would flip status now but
	// stamp withdrawn_at/history in the future (the coupling CHECK only tests NOT
	// NULL). Reject it; backdating stays allowed (Ducdo ruling 2026-09-09, DN1).
	now := clk.Now().UTC()
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	if parsed.After(today) {
		return time.Time{}, model.ValidationError{Fields: []model.FieldError{{Field: "effectiveDate", Message: "must not be in the future"}}}
	}
	return parsed, nil
}
