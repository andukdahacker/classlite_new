// Story 6.1 — the teacher Writing grading endpoints (grade, revise, grading read,
// grading queue). Thin HTTP binding over GradingService: role is gated at the route
// (RequireRole → INSUFFICIENT_ROLE); teacher-of-class narrowing + all business rules
// live in the service. Typed errors flow through middleware.ErrorMapper.
package handler

import (
	"net/http"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/ducdo/classlite-api/internal/service/grading"
	"github.com/google/uuid"
)

// maxGradeBodyBytes caps the grade/revise JSON body (comments + feedback) pre-decode
// → 413 (mirrors MaxSubmissionContentBytes).
const maxGradeBodyBytes = 256 * 1024

// GradingHandler serves the four Story 6.1 grading routes.
type GradingHandler struct {
	svc *service.GradingService
	clk clock.Clock
}

// NewGradingHandler constructs a GradingHandler.
func NewGradingHandler(svc *service.GradingService, clk clock.Clock) *GradingHandler {
	return &GradingHandler{svc: svc, clk: clk}
}

// --- request bodies (api.yaml GradeInput / ReviseGradeInput) ---

type criterionScoresBody struct {
	TaskResponse      float64 `json:"taskResponse"`
	CoherenceCohesion float64 `json:"coherenceCohesion"`
	LexicalResource   float64 `json:"lexicalResource"`
	GrammaticalRange  float64 `json:"grammaticalRange"`
}

type anchoredCommentBody struct {
	Type        string `json:"type"`
	Criterion   string `json:"criterion"`
	AnchorStart *int   `json:"anchorStart"`
	AnchorEnd   *int   `json:"anchorEnd"`
	Text        string `json:"text"`
}

type gradeRequestBody struct {
	CriterionScores criterionScoresBody   `json:"criterionScores"`
	Comments        []anchoredCommentBody `json:"comments"`
	Feedback        *string               `json:"feedback"`
}

type reviseGradeRequestBody struct {
	CriterionScores criterionScoresBody   `json:"criterionScores"`
	Comments        []anchoredCommentBody `json:"comments"`
	Feedback        *string               `json:"feedback"`
	Reason          string                `json:"reason"`
}

func toGradeWriteInput(
	scores criterionScoresBody, comments []anchoredCommentBody, feedback *string, reason string,
) service.GradeWriteInput {
	cm := make([]grading.Comment, 0, len(comments))
	for _, c := range comments {
		cm = append(cm, grading.Comment{
			Type: c.Type, Criterion: c.Criterion,
			AnchorStart: c.AnchorStart, AnchorEnd: c.AnchorEnd, Text: c.Text,
		})
	}
	return service.GradeWriteInput{
		Scores: grading.CriterionScores{
			TaskResponse:      scores.TaskResponse,
			CoherenceCohesion: scores.CoherenceCohesion,
			LexicalResource:   scores.LexicalResource,
			GrammaticalRange:  scores.GrammaticalRange,
		},
		Comments: cm,
		Feedback: feedback,
		Reason:   reason,
	}
}

// --- response shapes (api.yaml Grade / TeacherGradingView / GradingQueueRow) ---

type criterionScoresResponse struct {
	TaskResponse      float64 `json:"taskResponse"`
	CoherenceCohesion float64 `json:"coherenceCohesion"`
	LexicalResource   float64 `json:"lexicalResource"`
	GrammaticalRange  float64 `json:"grammaticalRange"`
}

type gradeResponse struct {
	ID              string                  `json:"id"`
	SubmissionID    string                  `json:"submissionId"`
	Version         int                     `json:"version"`
	CriterionScores criterionScoresResponse `json:"criterionScores"`
	OverallBand     float64                 `json:"overallBand"`
	Comments        []grading.Comment       `json:"comments"`
	Feedback        *string                 `json:"feedback"`
	GradedBy        string                  `json:"gradedBy"`
	ReleasedAt      *string                 `json:"releasedAt"`
	CreatedAt       string                  `json:"createdAt"`
}

type gradingStudentResponse struct {
	ID       string `json:"id"`
	FullName string `json:"fullName"`
}

type teacherGradingViewResponse struct {
	Submission submissionResponse      `json:"submission"`
	Assignment studentAssignmentView   `json:"assignment"`
	Student    gradingStudentResponse  `json:"student"`
	Exercise   service.AttemptExercise `json:"exercise"`
	Grade      *gradeResponse          `json:"grade"`
}

type gradingQueueRowResponse struct {
	SubmissionID    string   `json:"submissionId"`
	StudentName     string   `json:"studentName"`
	AssignmentTitle string   `json:"assignmentTitle"`
	ClassName       string   `json:"className"`
	Status          string   `json:"status"`
	IsOverdue       bool     `json:"isOverdue"`
	Released        bool     `json:"released"`
	OverallBand     *float64 `json:"overallBand"`
}

func criterionScoresToResponse(cs grading.CriterionScores) criterionScoresResponse {
	return criterionScoresResponse{
		TaskResponse:      cs.TaskResponse,
		CoherenceCohesion: cs.CoherenceCohesion,
		LexicalResource:   cs.LexicalResource,
		GrammaticalRange:  cs.GrammaticalRange,
	}
}

func gradeToResponse(g service.GradeView) gradeResponse {
	comments := g.Comments
	if comments == nil {
		comments = []grading.Comment{}
	}
	var releasedAt *string
	if g.ReleasedAt != nil {
		s := g.ReleasedAt.UTC().Format(time.RFC3339Nano)
		releasedAt = &s
	}
	return gradeResponse{
		ID:              g.ID,
		SubmissionID:    g.SubmissionID,
		Version:         g.Version,
		CriterionScores: criterionScoresToResponse(g.Scores),
		OverallBand:     g.OverallBand,
		Comments:        comments,
		Feedback:        g.Feedback,
		GradedBy:        g.GradedBy,
		ReleasedAt:      releasedAt,
		CreatedAt:       g.CreatedAt.UTC().Format(time.RFC3339Nano),
	}
}

func teacherGradingViewToResponse(v service.TeacherGradingView) teacherGradingViewResponse {
	out := teacherGradingViewResponse{
		Submission: submissionToResponse(v.Submission),
		Assignment: studentAssignmentViewFromRow(v.Assignment),
		Student:    gradingStudentResponse{ID: v.Student.ID, FullName: v.Student.FullName},
		Exercise:   v.Exercise,
	}
	if v.Grade != nil {
		g := gradeToResponse(*v.Grade)
		out.Grade = &g
	}
	return out
}

// --- handlers ---

// Grade — POST /api/submissions/{submissionId}/grade (AC4).
func (h *GradingHandler) Grade(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireOwnerTenant(r)
	if err != nil {
		return err
	}
	submissionID, err := parseSettingsPathID(r, "submissionId", "SUBMISSION_NOT_FOUND", "submission")
	if err != nil {
		return err
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxGradeBodyBytes)
	var body gradeRequestBody
	if err := decodeClassJSONBody(r.Body, &body); err != nil {
		return err
	}
	in := toGradeWriteInput(body.CriterionScores, body.Comments, body.Feedback, "")
	grade, err := h.svc.GradeWriting(r.Context(), tc, submissionID, in)
	if err != nil {
		return err
	}
	WriteEnvelope(w, http.StatusCreated, h.clk, gradeToResponse(grade))
	return nil
}

// Revise — POST /api/submissions/{submissionId}/grade/revise (AC6).
func (h *GradingHandler) Revise(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireOwnerTenant(r)
	if err != nil {
		return err
	}
	submissionID, err := parseSettingsPathID(r, "submissionId", "SUBMISSION_NOT_FOUND", "submission")
	if err != nil {
		return err
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxGradeBodyBytes)
	var body reviseGradeRequestBody
	if err := decodeClassJSONBody(r.Body, &body); err != nil {
		return err
	}
	in := toGradeWriteInput(body.CriterionScores, body.Comments, body.Feedback, body.Reason)
	grade, err := h.svc.ReviseGrade(r.Context(), tc, submissionID, in)
	if err != nil {
		return err
	}
	WriteEnvelope(w, http.StatusCreated, h.clk, gradeToResponse(grade))
	return nil
}

// GetGrading — GET /api/submissions/{submissionId}/grading (AC8).
func (h *GradingHandler) GetGrading(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireOwnerTenant(r)
	if err != nil {
		return err
	}
	submissionID, err := parseSettingsPathID(r, "submissionId", "SUBMISSION_NOT_FOUND", "submission")
	if err != nil {
		return err
	}
	view, err := h.svc.GetSubmissionForGrading(r.Context(), tc, submissionID)
	if err != nil {
		return err
	}
	WriteEnvelope(w, http.StatusOK, h.clk, teacherGradingViewToResponse(view))
	return nil
}

// GetQueue — GET /api/classes/{classId}/grading-queue?assignmentId=… (AC17).
func (h *GradingHandler) GetQueue(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireOwnerTenant(r)
	if err != nil {
		return err
	}
	classID, err := parseSettingsPathID(r, "classId", "CLASS_NOT_FOUND", "class")
	if err != nil {
		return err
	}
	rawAssignment := r.URL.Query().Get("assignmentId")
	if rawAssignment == "" {
		return model.ValidationError{Fields: []model.FieldError{{
			Field: "assignmentId", Code: "REQUIRED", Message: "assignmentId query parameter is required",
		}}}
	}
	assignmentID, err := uuid.Parse(rawAssignment)
	if err != nil {
		return model.ValidationError{Fields: []model.FieldError{{
			Field: "assignmentId", Code: "INVALID", Message: "assignmentId must be a UUID",
		}}}
	}
	rows, err := h.svc.ListGradingQueue(r.Context(), tc, classID, assignmentID)
	if err != nil {
		return err
	}
	out := make([]gradingQueueRowResponse, 0, len(rows))
	for _, row := range rows {
		out = append(out, gradingQueueRowResponse{
			SubmissionID:    row.SubmissionID,
			StudentName:     row.StudentName,
			AssignmentTitle: row.AssignmentTitle,
			ClassName:       row.ClassName,
			Status:          row.Status,
			IsOverdue:       row.IsOverdue,
			Released:        row.Released,
			OverallBand:     row.OverallBand,
		})
	}
	WriteEnvelope(w, http.StatusOK, h.clk, out)
	return nil
}
