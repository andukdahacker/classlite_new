// Package handler — Story 7.2a StudentHandler (AC1–AC14). PROVISIONAL read wire
// shapes (D14) — 7-2b is the sole consumer and co-finalizes them; the notes
// mutation shapes are STABLE.
//
// Routes (mounted in cmd/api/main.go on the RequireRole("owner","admin",
// "teacher") read chain; note writes additionally re-validate role + visibility
// in-service):
//
//	GET    /api/students                          role-scoped roster (paginated)
//	GET    /api/students/{id}                      detail (404 non-disclosure)
//	GET    /api/students/{id}/notes                notes (chronological)
//	POST   /api/students/{id}/notes                create note
//	PATCH  /api/students/{id}/notes/{noteId}       flag toggle
//	DELETE /api/students/{id}/notes/{noteId}       soft-delete (author-or-owner)
//
// HTTP status mapping is the handler's job (GO-3); the service returns typed
// errors and ErrorMapper renders the envelope.
package handler

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/google/uuid"
)

const maxStudentNoteBodyBytes = 16 * 1024

// StudentHandler wires StudentService to HTTP.
type StudentHandler struct {
	svc *service.StudentService
	clk clock.Clock
}

// NewStudentHandler constructs a StudentHandler.
func NewStudentHandler(svc *service.StudentService, clk clock.Clock) *StudentHandler {
	return &StudentHandler{svc: svc, clk: clk}
}

// ---- wire shapes (GO-5: no omitempty; explicit null via pointers) ----

type studentEnrolledClassLiteResponse struct {
	ClassID     string  `json:"classId"`
	ClassName   string  `json:"className"`
	TeacherName *string `json:"teacherName"`
}

type studentListItemResponse struct {
	StudentID             string                             `json:"studentId"`
	Name                  string                             `json:"name"`
	Email                 string                             `json:"email"`
	AvatarURL             *string                            `json:"avatarUrl"`
	EnrolledClasses       []studentEnrolledClassLiteResponse `json:"enrolledClasses"`
	Teachers              []string                           `json:"teachers"`
	OverallBand           *float64                           `json:"overallBand"`
	AtRiskStatus          string                             `json:"atRiskStatus"`
	AtRiskReasons         []string                           `json:"atRiskReasons"`
	ActiveEnrollmentCount int                                `json:"activeEnrollmentCount"`
	ArchivedAt            *string                            `json:"archivedAt"`
	JoinedAt              string                             `json:"joinedAt"`
}

type paginationMetaResponse struct {
	Page       int `json:"page"`
	PageSize   int `json:"pageSize"`
	Total      int `json:"total"`
	TotalPages int `json:"totalPages"`
}

type paginatedListMeta struct {
	ServerTime string                 `json:"serverTime"`
	Pagination paginationMetaResponse `json:"pagination"`
}

type studentProfileResponse struct {
	StudentID    string  `json:"studentId"`
	Name         string  `json:"name"`
	Email        string  `json:"email"`
	AvatarURL    *string `json:"avatarUrl"`
	LanguagePref string  `json:"languagePref"`
	JoinedAt     string  `json:"joinedAt"`
}

type studentDetailClassResponse struct {
	ClassID     string   `json:"classId"`
	ClassName   string   `json:"className"`
	TeacherName *string  `json:"teacherName"`
	TargetBand  *float64 `json:"targetBand"`
}

type studentPerSkillResponse struct {
	Reading   *float64 `json:"reading"`
	Listening *float64 `json:"listening"`
	Writing   *float64 `json:"writing"`
	Speaking  *float64 `json:"speaking"`
}

type studentPerformanceSummaryResponse struct {
	OverallBand         *float64                `json:"overallBand"`
	PerSkill            studentPerSkillResponse `json:"perSkill"`
	AttendanceRate      *float64                `json:"attendanceRate"`
	PendingCount        int                     `json:"pendingCount"`
	MissingCount        int                     `json:"missingCount"`
	OnTimeRate          *float64                `json:"onTimeRate"`
	CurrentVsFirstDelta *float64                `json:"currentVsFirstDelta"`
}

type studentAtRiskResponse struct {
	Status  string   `json:"status"`
	Reasons []string `json:"reasons"`
}

type studentNoteResponse struct {
	NoteID     string `json:"noteId"`
	AuthorName string `json:"authorName"`
	Content    string `json:"content"`
	Flagged    bool   `json:"flagged"`
	CreatedAt  string `json:"createdAt"`
}

type studentDetailResponse struct {
	Profile            studentProfileResponse            `json:"profile"`
	EnrolledClasses    []studentDetailClassResponse      `json:"enrolledClasses"`
	PerformanceSummary studentPerformanceSummaryResponse `json:"performanceSummary"`
	AtRisk             studentAtRiskResponse             `json:"atRisk"`
	Notes              []studentNoteResponse             `json:"notes"`
}

type createStudentNoteRequestBody struct {
	Content string `json:"content"`
	Flagged bool   `json:"flagged"`
}

type setStudentNoteFlagRequestBody struct {
	// Pointer so an omitted `flagged` is distinguishable from an explicit false —
	// a missing field is a 422, not a silent unflag.
	Flagged *bool `json:"flagged"`
}

// ---- handlers ----

// List handles GET /api/students.
func (h *StudentHandler) List(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireStudentTenant(r)
	if err != nil {
		return err
	}
	filter, err := parseListStudentsFilter(r)
	if err != nil {
		return err
	}
	items, page, err := h.svc.ListStudents(r.Context(), tc, filter)
	if err != nil {
		return err
	}
	out := make([]studentListItemResponse, 0, len(items))
	for _, it := range items {
		out = append(out, studentListItemToResponse(it))
	}
	WriteEnvelopeWithMeta(w, http.StatusOK, out, paginatedListMeta{
		ServerTime: wireTime(h.clk.Now()),
		Pagination: paginationMetaResponse{
			Page:       page.Page,
			PageSize:   page.PageSize,
			Total:      page.Total,
			TotalPages: page.TotalPages,
		},
	})
	return nil
}

// GetDetail handles GET /api/students/{id}.
func (h *StudentHandler) GetDetail(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireStudentTenant(r)
	if err != nil {
		return err
	}
	studentID, ok := parseStudentPathID(r, "id")
	if !ok {
		return model.NotFoundError{Resource: "student", Code: "STUDENT_NOT_FOUND"}
	}
	detail, err := h.svc.GetStudentDetail(r.Context(), tc, studentID)
	if err != nil {
		return err
	}
	WriteEnvelope(w, http.StatusOK, h.clk, studentDetailToResponse(detail))
	return nil
}

// ListNotes handles GET /api/students/{id}/notes.
func (h *StudentHandler) ListNotes(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireStudentTenant(r)
	if err != nil {
		return err
	}
	studentID, ok := parseStudentPathID(r, "id")
	if !ok {
		return model.NotFoundError{Resource: "student", Code: "STUDENT_NOT_FOUND"}
	}
	notes, err := h.svc.ListNotes(r.Context(), tc, studentID)
	if err != nil {
		return err
	}
	out := make([]studentNoteResponse, 0, len(notes))
	for _, n := range notes {
		out = append(out, studentNoteToResponse(n))
	}
	WriteEnvelope(w, http.StatusOK, h.clk, out)
	return nil
}

// CreateNote handles POST /api/students/{id}/notes.
func (h *StudentHandler) CreateNote(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireStudentTenant(r)
	if err != nil {
		return err
	}
	studentID, ok := parseStudentPathID(r, "id")
	if !ok {
		return model.NotFoundError{Resource: "student", Code: "STUDENT_NOT_FOUND"}
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxStudentNoteBodyBytes)
	body, decodeErr := decodeCreateStudentNoteBody(r.Body)
	if decodeErr != nil {
		return decodeErr
	}
	note, err := h.svc.CreateNote(r.Context(), tc, studentID, body.Content, body.Flagged)
	if err != nil {
		return err
	}
	WriteEnvelope(w, http.StatusCreated, h.clk, studentNoteToResponse(*note))
	return nil
}

// SetNoteFlag handles PATCH /api/students/{id}/notes/{noteId}.
func (h *StudentHandler) SetNoteFlag(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireStudentTenant(r)
	if err != nil {
		return err
	}
	studentID, ok := parseStudentPathID(r, "id")
	if !ok {
		return model.NotFoundError{Resource: "student", Code: "STUDENT_NOT_FOUND"}
	}
	noteID, ok := parseStudentPathID(r, "noteId")
	if !ok {
		return model.NotFoundError{Resource: "note", Code: "NOTE_NOT_FOUND"}
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxStudentNoteBodyBytes)
	body, decodeErr := decodeSetStudentNoteFlagBody(r.Body)
	if decodeErr != nil {
		return decodeErr
	}
	if body.Flagged == nil {
		return model.ValidationError{Fields: []model.FieldError{{Field: "flagged", Message: "flagged is required"}}}
	}
	note, err := h.svc.SetNoteFlag(r.Context(), tc, studentID, noteID, *body.Flagged)
	if err != nil {
		return err
	}
	WriteEnvelope(w, http.StatusOK, h.clk, studentNoteToResponse(*note))
	return nil
}

// DeleteNote handles DELETE /api/students/{id}/notes/{noteId}.
func (h *StudentHandler) DeleteNote(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireStudentTenant(r)
	if err != nil {
		return err
	}
	studentID, ok := parseStudentPathID(r, "id")
	if !ok {
		return model.NotFoundError{Resource: "student", Code: "STUDENT_NOT_FOUND"}
	}
	noteID, ok := parseStudentPathID(r, "noteId")
	if !ok {
		return model.NotFoundError{Resource: "note", Code: "NOTE_NOT_FOUND"}
	}
	if err := h.svc.DeleteNote(r.Context(), tc, studentID, noteID); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

// ---- helpers ----

func requireStudentTenant(r *http.Request) (model.TenantContext, error) {
	tc, ok := model.TenantFromContext(r.Context())
	if !ok || tc.UserID == "" || tc.CenterID == "" {
		return model.TenantContext{}, ErrTenantContextMissing
	}
	return tc, nil
}

func parseStudentPathID(r *http.Request, name string) (uuid.UUID, bool) {
	raw := r.PathValue(name)
	if raw == "" {
		return uuid.Nil, false
	}
	id, err := uuid.Parse(raw)
	if err != nil {
		return uuid.Nil, false
	}
	return id, true
}

// parseListStudentsFilter reads page/page_size/class_id/teacher_id. Clamping to
// [1, MaxPageSize] happens in the service; the handler only parses. A malformed
// class_id/teacher_id is ignored (treated as absent) rather than 400 — the roster
// stays a forgiving read.
func parseListStudentsFilter(r *http.Request) (service.ListStudentsFilter, error) {
	q := r.URL.Query()
	filter := service.ListStudentsFilter{Page: 1, PageSize: service.DefaultPageSize}
	if v := q.Get("page"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			filter.Page = n
		}
	}
	if v := q.Get("page_size"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			filter.PageSize = n
		}
	}
	if v := q.Get("class_id"); v != "" {
		if id, err := uuid.Parse(v); err == nil {
			filter.ClassID = &id
		}
	}
	if v := q.Get("teacher_id"); v != "" {
		if id, err := uuid.Parse(v); err == nil {
			filter.TeacherID = &id
		}
	}
	return filter, nil
}

func decodeCreateStudentNoteBody(rc io.Reader) (createStudentNoteRequestBody, error) {
	dec := json.NewDecoder(rc)
	dec.DisallowUnknownFields()
	var out createStudentNoteRequestBody
	if err := dec.Decode(&out); err != nil {
		var maxBytes *http.MaxBytesError
		if errors.As(err, &maxBytes) {
			return createStudentNoteRequestBody{}, &service.PayloadTooLargeError{LimitBytes: maxBytes.Limit}
		}
		return createStudentNoteRequestBody{}, model.ValidationError{Fields: []model.FieldError{{Field: "body", Message: "invalid JSON"}}}
	}
	return out, nil
}

func decodeSetStudentNoteFlagBody(rc io.Reader) (setStudentNoteFlagRequestBody, error) {
	dec := json.NewDecoder(rc)
	dec.DisallowUnknownFields()
	var out setStudentNoteFlagRequestBody
	if err := dec.Decode(&out); err != nil {
		var maxBytes *http.MaxBytesError
		if errors.As(err, &maxBytes) {
			return setStudentNoteFlagRequestBody{}, &service.PayloadTooLargeError{LimitBytes: maxBytes.Limit}
		}
		return setStudentNoteFlagRequestBody{}, model.ValidationError{Fields: []model.FieldError{{Field: "body", Message: "invalid JSON"}}}
	}
	return out, nil
}

func studentListItemToResponse(it service.StudentListItem) studentListItemResponse {
	classes := make([]studentEnrolledClassLiteResponse, 0, len(it.EnrolledClasses))
	for _, c := range it.EnrolledClasses {
		classes = append(classes, studentEnrolledClassLiteResponse{
			ClassID:     c.ClassID.String(),
			ClassName:   c.ClassName,
			TeacherName: c.TeacherName,
		})
	}
	teachers := it.Teachers
	if teachers == nil {
		teachers = []string{}
	}
	reasons := it.AtRiskReasons
	if reasons == nil {
		reasons = []string{}
	}
	return studentListItemResponse{
		StudentID:             it.StudentID.String(),
		Name:                  it.Name,
		Email:                 it.Email,
		AvatarURL:             it.AvatarURL,
		EnrolledClasses:       classes,
		Teachers:              teachers,
		OverallBand:           it.OverallBand,
		AtRiskStatus:          it.AtRiskStatus,
		AtRiskReasons:         reasons,
		ActiveEnrollmentCount: it.ActiveEnrollmentCount,
		ArchivedAt:            wireTimePtr(it.ArchivedAt),
		JoinedAt:              wireTime(it.JoinedAt),
	}
}

func studentDetailToResponse(d *service.StudentDetail) studentDetailResponse {
	classes := make([]studentDetailClassResponse, 0, len(d.EnrolledClasses))
	for _, c := range d.EnrolledClasses {
		classes = append(classes, studentDetailClassResponse{
			ClassID:     c.ClassID.String(),
			ClassName:   c.ClassName,
			TeacherName: c.TeacherName,
			TargetBand:  c.TargetBand,
		})
	}
	notes := make([]studentNoteResponse, 0, len(d.Notes))
	for _, n := range d.Notes {
		notes = append(notes, studentNoteToResponse(n))
	}
	reasons := d.AtRisk.Reasons
	if reasons == nil {
		reasons = []string{}
	}
	return studentDetailResponse{
		Profile: studentProfileResponse{
			StudentID:    d.Profile.StudentID.String(),
			Name:         d.Profile.Name,
			Email:        d.Profile.Email,
			AvatarURL:    d.Profile.AvatarURL,
			LanguagePref: d.Profile.LanguagePref,
			JoinedAt:     wireTime(d.Profile.JoinedAt),
		},
		EnrolledClasses: classes,
		PerformanceSummary: studentPerformanceSummaryResponse{
			OverallBand: d.PerformanceSummary.OverallBand,
			PerSkill: studentPerSkillResponse{
				Reading:   d.PerformanceSummary.PerSkill.Reading,
				Listening: d.PerformanceSummary.PerSkill.Listening,
				Writing:   d.PerformanceSummary.PerSkill.Writing,
				Speaking:  d.PerformanceSummary.PerSkill.Speaking,
			},
			AttendanceRate:      d.PerformanceSummary.AttendanceRate,
			PendingCount:        d.PerformanceSummary.PendingCount,
			MissingCount:        d.PerformanceSummary.MissingCount,
			OnTimeRate:          d.PerformanceSummary.OnTimeRate,
			CurrentVsFirstDelta: d.PerformanceSummary.CurrentVsFirstDelta,
		},
		AtRisk: studentAtRiskResponse{Status: d.AtRisk.Status, Reasons: reasons},
		Notes:  notes,
	}
}

func studentNoteToResponse(n service.StudentNoteView) studentNoteResponse {
	return studentNoteResponse{
		NoteID:     n.NoteID.String(),
		AuthorName: n.AuthorName,
		Content:    n.Content,
		Flagged:    n.Flagged,
		CreatedAt:  wireTime(n.CreatedAt),
	}
}
