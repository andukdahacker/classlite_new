// Package handler — Story 7.4a QuestionHandler.
//
// Endpoints (anchored Q&A):
//
//	POST  /api/questions                student asks (class/exercise derived server-side)
//	GET   /api/questions                role-scoped list (owner/admin → empty)
//	GET   /api/questions/{id}           one thread + reader-scoped replies
//	POST  /api/questions/{id}/replies   teacher reply (personal|shared, optional resolve)
//	PATCH /api/questions/{id}           resolve (status → resolved)
//	POST  /api/questions/batch-reply    teacher reply to many (all-or-nothing)
//
// ALL roles reach these handlers — Owner/Admin are NOT gated out at the edge, so
// the empty-list contract (R25/R26) is served from the service, not a 403. Role
// scoping + the SEC-1 DB-role re-validation live in the service. Responses use
// the {data,meta} envelope with explicit nulls (GO-5).
package handler

import (
	"net/http"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/google/uuid"
)

const maxQuestionBodyBytes = 16 * 1024

const (
	questionStatusOpen     = "open"
	questionStatusResolved = "resolved"
)

type QuestionHandler struct {
	svc *service.QuestionService
	clk clock.Clock
}

func NewQuestionHandler(svc *service.QuestionService, clk clock.Clock) *QuestionHandler {
	return &QuestionHandler{svc: svc, clk: clk}
}

// requireQuestionTenant extracts the authenticated tenant WITHOUT a role gate —
// every role reaches the Q&A handlers (owner/admin get an empty list from the
// service, not a 403).
func requireQuestionTenant(r *http.Request) (model.TenantContext, error) {
	tc, ok := model.TenantFromContext(r.Context())
	if !ok || tc.UserID == "" || tc.CenterID == "" {
		return model.TenantContext{}, ErrTenantContextMissing
	}
	return tc, nil
}

// --- response shapes (read shapes co-finalized by 7-4b: enriched with the
// denormalized display name + avatar of the asker/author, D5, GO-5 explicit nulls) ---

type questionAnchorResponse struct {
	SchemaVersion      int  `json:"schemaVersion"`
	SectionIndex       int  `json:"sectionIndex"`
	QuestionGroupIndex *int `json:"questionGroupIndex"`
	QuestionIndex      *int `json:"questionIndex"`
	CharStart          *int `json:"charStart"`
	CharEnd            *int `json:"charEnd"`
}

type questionResponse struct {
	ID               string                  `json:"id"`
	ExerciseID       string                  `json:"exerciseId"`
	ClassID          string                  `json:"classId"`
	StudentID        string                  `json:"studentId"`
	StudentName      *string                 `json:"studentName"`
	StudentAvatarURL *string                 `json:"studentAvatarUrl"`
	AnchorType       string                  `json:"anchorType"`
	AnchorRef        *questionAnchorResponse `json:"anchorRef"`
	AnchorExcerpt    *string                 `json:"anchorExcerpt"`
	Content          string                  `json:"content"`
	Status           string                  `json:"status"`
	CreatedAt        string                  `json:"createdAt"`
}

type questionReplyResponse struct {
	ID              string  `json:"id"`
	QuestionID      string  `json:"questionId"`
	AuthorID        string  `json:"authorId"`
	AuthorName      *string `json:"authorName"`
	AuthorAvatarURL *string `json:"authorAvatarUrl"`
	Content         string  `json:"content"`
	Visibility      string  `json:"visibility"`
	CreatedAt       string  `json:"createdAt"`
}

type questionThreadResponse struct {
	Question questionResponse        `json:"question"`
	Replies  []questionReplyResponse `json:"replies"`
}

func anchorToResponse(a *service.QuestionAnchor) *questionAnchorResponse {
	if a == nil {
		return nil
	}
	return &questionAnchorResponse{
		SchemaVersion:      a.SchemaVersion,
		SectionIndex:       a.SectionIndex,
		QuestionGroupIndex: a.QuestionGroupIndex,
		QuestionIndex:      a.QuestionIndex,
		CharStart:          a.CharStart,
		CharEnd:            a.CharEnd,
	}
}

func (h *QuestionHandler) questionToResponse(q service.Question) questionResponse {
	return questionResponse{
		ID:               q.ID,
		ExerciseID:       q.ExerciseID,
		ClassID:          q.ClassID,
		StudentID:        q.StudentID,
		StudentName:      q.StudentName,
		StudentAvatarURL: q.StudentAvatarURL,
		AnchorType:       q.AnchorType,
		AnchorRef:        anchorToResponse(q.AnchorRef),
		AnchorExcerpt:    q.AnchorExcerpt,
		Content:          q.Content,
		Status:           q.Status,
		CreatedAt:        wireTime(q.CreatedAt),
	}
}

func (h *QuestionHandler) replyToResponse(r service.QuestionReply) questionReplyResponse {
	return questionReplyResponse{
		ID:              r.ID,
		QuestionID:      r.QuestionID,
		AuthorID:        r.AuthorID,
		AuthorName:      r.AuthorName,
		AuthorAvatarURL: r.AuthorAvatarURL,
		Content:         r.Content,
		Visibility:      r.Visibility,
		CreatedAt:       wireTime(r.CreatedAt),
	}
}

// --- request bodies ---

type questionAnchorBody struct {
	SectionIndex       int  `json:"sectionIndex"`
	QuestionGroupIndex *int `json:"questionGroupIndex"`
	QuestionIndex      *int `json:"questionIndex"`
	CharStart          *int `json:"charStart"`
	CharEnd            *int `json:"charEnd"`
}

func (b *questionAnchorBody) toAnchor() *service.QuestionAnchor {
	if b == nil {
		return nil
	}
	return &service.QuestionAnchor{
		SectionIndex:       b.SectionIndex,
		QuestionGroupIndex: b.QuestionGroupIndex,
		QuestionIndex:      b.QuestionIndex,
		CharStart:          b.CharStart,
		CharEnd:            b.CharEnd,
	}
}

type askQuestionRequestBody struct {
	AssignmentID  string              `json:"assignmentId"`
	AnchorType    string              `json:"anchorType"`
	AnchorRef     *questionAnchorBody `json:"anchorRef"`
	AnchorExcerpt *string             `json:"anchorExcerpt"`
	Content       string              `json:"content"`
}

type replyRequestBody struct {
	Content    string `json:"content"`
	Visibility string `json:"visibility"`
	Resolve    bool   `json:"resolve"`
}

type patchQuestionRequestBody struct {
	Status string `json:"status"`
}

type batchReplyRequestBody struct {
	QuestionIDs []string `json:"questionIds"`
	Content     string   `json:"content"`
	Visibility  string   `json:"visibility"`
	Resolve     bool     `json:"resolve"`
}

// --- handlers ---

// Ask — POST /api/questions (AC4). Student-only (enforced in-service).
func (h *QuestionHandler) Ask(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireQuestionTenant(r)
	if err != nil {
		return err
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxQuestionBodyBytes)
	var body askQuestionRequestBody
	if err := decodeClassJSONBody(r.Body, &body); err != nil {
		return err
	}
	assignmentID, verr := uuid.Parse(body.AssignmentID)
	if verr != nil {
		return model.ValidationError{Fields: []model.FieldError{{Field: "assignmentId", Message: "expected a UUID"}}}
	}
	created, err := h.svc.Ask(r.Context(), tc, service.AskInput{
		AssignmentID:  assignmentID,
		AnchorType:    body.AnchorType,
		AnchorRef:     body.AnchorRef.toAnchor(),
		AnchorExcerpt: body.AnchorExcerpt,
		Content:       body.Content,
	})
	if err != nil {
		return err
	}
	WriteEnvelope(w, http.StatusCreated, h.clk, h.questionToResponse(*created))
	return nil
}

// List — GET /api/questions (AC6). Role-scoped in the service.
func (h *QuestionHandler) List(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireQuestionTenant(r)
	if err != nil {
		return err
	}
	page, pageSize := parseSnakePageParams(r)
	exerciseID, verr := parseOptionalQueryUUID(r, "exercise_id")
	if verr != nil {
		return verr
	}
	classID, verr := parseOptionalQueryUUID(r, "class_id")
	if verr != nil {
		return verr
	}
	var status *string
	if s := r.URL.Query().Get("status"); s != "" {
		if s != questionStatusOpen && s != questionStatusResolved {
			return model.ValidationError{Fields: []model.FieldError{{Field: "status", Message: "must be open or resolved"}}}
		}
		status = &s
	}
	unanswered := false
	if u := r.URL.Query().Get("unanswered"); u != "" {
		switch u {
		case "true":
			unanswered = true
		case "false":
			unanswered = false
		default:
			return model.ValidationError{Fields: []model.FieldError{{Field: "unanswered", Message: "must be true or false"}}}
		}
	}

	rows, pageMeta, err := h.svc.List(r.Context(), tc, service.QuestionListFilter{
		ExerciseID: exerciseID,
		ClassID:    classID,
		Status:     status,
		Unanswered: unanswered,
		Page:       page,
		PageSize:   pageSize,
	})
	if err != nil {
		return err
	}
	out := make([]questionResponse, len(rows))
	for i, q := range rows {
		out[i] = h.questionToResponse(q)
	}
	writePaginatedEnvelope(w, h.clk, out, pageMeta)
	return nil
}

// GetThread — GET /api/questions/{id} (AC6). 404 QUESTION_NOT_FOUND if the caller
// cannot see it (non-disclosure).
func (h *QuestionHandler) GetThread(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireQuestionTenant(r)
	if err != nil {
		return err
	}
	questionID, err := parseSettingsPathID(r, "id", "QUESTION_NOT_FOUND", "question")
	if err != nil {
		return err
	}
	thread, err := h.svc.GetThread(r.Context(), tc, questionID)
	if err != nil {
		return err
	}
	replies := make([]questionReplyResponse, len(thread.Replies))
	for i, rep := range thread.Replies {
		replies[i] = h.replyToResponse(rep)
	}
	WriteEnvelope(w, http.StatusOK, h.clk, questionThreadResponse{
		Question: h.questionToResponse(thread.Question),
		Replies:  replies,
	})
	return nil
}

// Reply — POST /api/questions/{id}/replies (AC8/AC11). Teacher-of-class only.
func (h *QuestionHandler) Reply(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireQuestionTenant(r)
	if err != nil {
		return err
	}
	questionID, err := parseSettingsPathID(r, "id", "QUESTION_NOT_FOUND", "question")
	if err != nil {
		return err
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxQuestionBodyBytes)
	var body replyRequestBody
	if err := decodeClassJSONBody(r.Body, &body); err != nil {
		return err
	}
	reply, err := h.svc.Reply(r.Context(), tc, questionID, service.ReplyInput{
		Content:    body.Content,
		Visibility: body.Visibility,
		Resolve:    body.Resolve,
	})
	if err != nil {
		return err
	}
	WriteEnvelope(w, http.StatusCreated, h.clk, h.replyToResponse(*reply))
	return nil
}

// Resolve — PATCH /api/questions/{id} (AC11). Only status:'resolved' is accepted
// (reopen deferred, FU-7-4-D). Teacher-of-class only.
func (h *QuestionHandler) Resolve(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireQuestionTenant(r)
	if err != nil {
		return err
	}
	questionID, err := parseSettingsPathID(r, "id", "QUESTION_NOT_FOUND", "question")
	if err != nil {
		return err
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxQuestionBodyBytes)
	var body patchQuestionRequestBody
	if err := decodeClassJSONBody(r.Body, &body); err != nil {
		return err
	}
	if body.Status != questionStatusResolved {
		return model.ValidationError{Fields: []model.FieldError{{Field: "status", Message: "only 'resolved' is supported"}}}
	}
	if err := h.svc.Resolve(r.Context(), tc, questionID); err != nil {
		return err
	}
	WriteEnvelope(w, http.StatusOK, h.clk, map[string]string{"id": questionID.String(), "status": questionStatusResolved})
	return nil
}

// BatchReply — POST /api/questions/batch-reply (AC12). All-or-nothing.
func (h *QuestionHandler) BatchReply(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireQuestionTenant(r)
	if err != nil {
		return err
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxQuestionBodyBytes)
	var body batchReplyRequestBody
	if err := decodeClassJSONBody(r.Body, &body); err != nil {
		return err
	}
	ids := make([]uuid.UUID, 0, len(body.QuestionIDs))
	for _, raw := range body.QuestionIDs {
		id, verr := uuid.Parse(raw)
		if verr != nil {
			return model.ValidationError{Fields: []model.FieldError{{Field: "questionIds", Message: "each id must be a UUID"}}}
		}
		ids = append(ids, id)
	}
	replies, err := h.svc.BatchReply(r.Context(), tc, ids, service.ReplyInput{
		Content:    body.Content,
		Visibility: body.Visibility,
		Resolve:    body.Resolve,
	})
	if err != nil {
		return err
	}
	out := make([]questionReplyResponse, len(replies))
	for i, rep := range replies {
		out[i] = h.replyToResponse(rep)
	}
	WriteEnvelope(w, http.StatusCreated, h.clk, out)
	return nil
}
