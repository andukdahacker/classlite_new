// Story 6.1 — the teacher Writing grading endpoints (grade, revise, grading read,
// grading queue). Thin HTTP binding over GradingService: role is gated at the route
// (RequireRole → INSUFFICIENT_ROLE); teacher-of-class narrowing + all business rules
// live in the service. Typed errors flow through middleware.ErrorMapper.
package handler

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
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

// --- speaking request bodies (api.yaml SpeakingGradeInput / ReviseSpeakingGradeInput) ---

type speakingCriterionScoresBody struct {
	FluencyCoherence float64 `json:"fluencyCoherence"`
	LexicalResource  float64 `json:"lexicalResource"`
	GrammaticalRange float64 `json:"grammaticalRange"`
	Pronunciation    float64 `json:"pronunciation"`
}

type timestampedCommentBody struct {
	Type        string `json:"type"`
	Criterion   string `json:"criterion"`
	TimestampMs *int   `json:"timestampMs"`
	Text        string `json:"text"`
}

type speakingGradeRequestBody struct {
	CriterionScores speakingCriterionScoresBody `json:"criterionScores"`
	Comments        []timestampedCommentBody    `json:"comments"`
	Feedback        *string                     `json:"feedback"`
}

type reviseSpeakingGradeRequestBody struct {
	CriterionScores speakingCriterionScoresBody `json:"criterionScores"`
	Comments        []timestampedCommentBody    `json:"comments"`
	Feedback        *string                     `json:"feedback"`
	Reason          string                      `json:"reason"`
}

func toSpeakingGradeWriteInput(
	scores speakingCriterionScoresBody, comments []timestampedCommentBody, feedback *string, reason string,
) service.SpeakingGradeWriteInput {
	cm := make([]grading.TimestampedComment, 0, len(comments))
	for _, c := range comments {
		cm = append(cm, grading.TimestampedComment{
			Type: c.Type, Criterion: c.Criterion, TimestampMs: c.TimestampMs, Text: c.Text,
		})
	}
	return service.SpeakingGradeWriteInput{
		Scores: grading.SpeakingCriterionScores{
			FluencyCoherence: scores.FluencyCoherence,
			LexicalResource:  scores.LexicalResource,
			GrammaticalRange: scores.GrammaticalRange,
			Pronunciation:    scores.Pronunciation,
		},
		Comments: cm,
		Feedback: feedback,
		Reason:   reason,
	}
}

// strictDecode strict-decodes raw JSON into dst (DisallowUnknownFields) — the
// from-bytes probe used to classify a skill mismatch (D2): a body that cleanly matches
// the OTHER skill's shape after the resolved-skill decode failed is a 409 mismatch, not
// a 422 malformed body (preserving the shipped writing 422-on-unknown-field contract).
func strictDecode(raw []byte, dst any) bool {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		return false
	}
	return !dec.More()
}

func skillMismatchConflict(submissionID uuid.UUID) error {
	return model.ConflictError{
		Resource: "submission", ID: submissionID.String(),
		Code:    "SUBMISSION_SKILL_MISMATCH",
		Message: "grade body shape does not match the submission's skill",
	}
}

// readGradeBody caps + reads the raw grade body (413 on overflow) so the handler can
// resolve the submission's skill BEFORE strict-decoding into the matching shape (D2).
func readGradeBody(w http.ResponseWriter, r *http.Request) ([]byte, error) {
	r.Body = http.MaxBytesReader(w, r.Body, maxGradeBodyBytes)
	raw, err := io.ReadAll(r.Body)
	if err != nil {
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			return nil, &service.PayloadTooLargeError{LimitBytes: maxBytesErr.Limit}
		}
		return nil, model.ValidationError{Fields: []model.FieldError{{Field: "body", Message: "invalid request body"}}}
	}
	return raw, nil
}

// --- response shapes (api.yaml Grade / TeacherGradingView / GradingQueueRow) ---

// criterionScoresResponse is the writing criterion_scores wire (shared with the
// student result view — attempt_handler.go). The teacher grade response passes the
// raw JSONB through instead (skill-agnostic, story 6.3a).
type criterionScoresResponse struct {
	TaskResponse      float64 `json:"taskResponse"`
	CoherenceCohesion float64 `json:"coherenceCohesion"`
	LexicalResource   float64 `json:"lexicalResource"`
	GrammaticalRange  float64 `json:"grammaticalRange"`
}

func criterionScoresToResponse(cs grading.CriterionScores) criterionScoresResponse {
	return criterionScoresResponse{
		TaskResponse:      cs.TaskResponse,
		CoherenceCohesion: cs.CoherenceCohesion,
		LexicalResource:   cs.LexicalResource,
		GrammaticalRange:  cs.GrammaticalRange,
	}
}

// gradeResponse is skill-agnostic: criterionScores + comments are the stored JSONB
// passed through VERBATIM (story 6.3a) — a Writing grade emits the four writing keys +
// text-anchored comments, a Speaking grade the four speaking keys + timestamp-pinned
// comments — so ONE response shape serves both grade paths.
type gradeResponse struct {
	ID              string          `json:"id"`
	SubmissionID    string          `json:"submissionId"`
	Version         int             `json:"version"`
	CriterionScores json.RawMessage `json:"criterionScores"`
	OverallBand     float64         `json:"overallBand"`
	Comments        json.RawMessage `json:"comments"`
	Feedback        *string         `json:"feedback"`
	GradedBy        string          `json:"gradedBy"`
	ReleasedAt      *string         `json:"releasedAt"`
	CreatedAt       string          `json:"createdAt"`
}

type gradingStudentResponse struct {
	ID       string `json:"id"`
	FullName string `json:"fullName"`
}

type teacherGradingViewResponse struct {
	Submission   submissionResponse          `json:"submission"`
	Assignment   studentAssignmentView       `json:"assignment"`
	Student      gradingStudentResponse      `json:"student"`
	Exercise     service.AttemptExercise     `json:"exercise"`
	Grade        *gradeResponse              `json:"grade"`
	AiSuggestion *model.AIWritingGradeResult `json:"aiSuggestion"`
	AudioUrl     *string                     `json:"audioUrl"`
	AudioStatus  string                      `json:"audioStatus"`
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

func gradeToResponse(g service.GradeView) gradeResponse {
	scores := g.ScoresRaw
	if len(scores) == 0 {
		scores = json.RawMessage("{}")
	}
	comments := g.CommentsRaw
	if len(comments) == 0 {
		comments = json.RawMessage("[]")
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
		CriterionScores: scores,
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
		Submission:   submissionToResponse(v.Submission),
		Assignment:   studentAssignmentViewFromRow(v.Assignment),
		Student:      gradingStudentResponse{ID: v.Student.ID, FullName: v.Student.FullName},
		Exercise:     v.Exercise,
		AiSuggestion: v.AiSuggestion,
		AudioUrl:     v.AudioUrl,
		AudioStatus:  v.AudioStatus,
	}
	if v.Grade != nil {
		g := gradeToResponse(*v.Grade)
		out.Grade = &g
	}
	return out
}

// --- handlers ---

// Grade — POST /api/submissions/{submissionId}/grade (AC4 writing / AC8 speaking).
// D2: the body is read RAW, the submission's skill resolved (SEC-7 — never a client
// field), then strict-decoded into the matching skill shape and dispatched. A body
// whose shape does not match the resolved skill → 409 SUBMISSION_SKILL_MISMATCH.
func (h *GradingHandler) Grade(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireOwnerTenant(r)
	if err != nil {
		return err
	}
	submissionID, err := parseSettingsPathID(r, "submissionId", "SUBMISSION_NOT_FOUND", "submission")
	if err != nil {
		return err
	}
	raw, err := readGradeBody(w, r)
	if err != nil {
		return err
	}
	skill, err := h.svc.ResolveSubmissionSkill(r.Context(), tc, submissionID)
	if err != nil {
		return err
	}
	switch skill {
	case grading.SkillSpeaking:
		var body speakingGradeRequestBody
		if derr := decodeClassJSONBody(bytes.NewReader(raw), &body); derr != nil {
			if strictDecode(raw, &gradeRequestBody{}) {
				return skillMismatchConflict(submissionID) // a clean WRITING body on a speaking submission
			}
			return derr
		}
		in := toSpeakingGradeWriteInput(body.CriterionScores, body.Comments, body.Feedback, "")
		grade, gerr := h.svc.GradeSpeaking(r.Context(), tc, submissionID, in)
		if gerr != nil {
			return gerr
		}
		WriteEnvelope(w, http.StatusCreated, h.clk, gradeToResponse(grade))
		return nil
	default: // writing (the shipped path) + any future skill routed here
		var body gradeRequestBody
		if derr := decodeClassJSONBody(bytes.NewReader(raw), &body); derr != nil {
			if strictDecode(raw, &speakingGradeRequestBody{}) {
				return skillMismatchConflict(submissionID) // a clean SPEAKING body on a writing submission
			}
			return derr
		}
		in := toGradeWriteInput(body.CriterionScores, body.Comments, body.Feedback, "")
		grade, gerr := h.svc.GradeWriting(r.Context(), tc, submissionID, in)
		if gerr != nil {
			return gerr
		}
		WriteEnvelope(w, http.StatusCreated, h.clk, gradeToResponse(grade))
		return nil
	}
}

// Revise — POST /api/submissions/{submissionId}/grade/revise (AC6 writing / AC8
// speaking). Same skill-branch decode as Grade.
func (h *GradingHandler) Revise(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireOwnerTenant(r)
	if err != nil {
		return err
	}
	submissionID, err := parseSettingsPathID(r, "submissionId", "SUBMISSION_NOT_FOUND", "submission")
	if err != nil {
		return err
	}
	raw, err := readGradeBody(w, r)
	if err != nil {
		return err
	}
	skill, err := h.svc.ResolveSubmissionSkill(r.Context(), tc, submissionID)
	if err != nil {
		return err
	}
	switch skill {
	case grading.SkillSpeaking:
		var body reviseSpeakingGradeRequestBody
		if derr := decodeClassJSONBody(bytes.NewReader(raw), &body); derr != nil {
			if strictDecode(raw, &reviseGradeRequestBody{}) {
				return skillMismatchConflict(submissionID)
			}
			return derr
		}
		in := toSpeakingGradeWriteInput(body.CriterionScores, body.Comments, body.Feedback, body.Reason)
		grade, gerr := h.svc.ReviseSpeakingGrade(r.Context(), tc, submissionID, in)
		if gerr != nil {
			return gerr
		}
		WriteEnvelope(w, http.StatusCreated, h.clk, gradeToResponse(grade))
		return nil
	default:
		var body reviseGradeRequestBody
		if derr := decodeClassJSONBody(bytes.NewReader(raw), &body); derr != nil {
			if strictDecode(raw, &reviseSpeakingGradeRequestBody{}) {
				return skillMismatchConflict(submissionID)
			}
			return derr
		}
		in := toGradeWriteInput(body.CriterionScores, body.Comments, body.Feedback, body.Reason)
		grade, gerr := h.svc.ReviseGrade(r.Context(), tc, submissionID, in)
		if gerr != nil {
			return gerr
		}
		WriteEnvelope(w, http.StatusCreated, h.clk, gradeToResponse(grade))
		return nil
	}
}

// GetTeacherAudio — GET /api/classes/{classId}/grading/{assignmentId}/{submissionId}/audio
// (story 6.3a — AC2/D5). Teacher-of-class-scoped fresh 5-min presigned GET; a gated
// failure mints nothing.
func (h *GradingHandler) GetTeacherAudio(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireOwnerTenant(r)
	if err != nil {
		return err
	}
	classID, err := parseSettingsPathID(r, "classId", "CLASS_NOT_FOUND", "class")
	if err != nil {
		return err
	}
	assignmentID, err := parseSettingsPathID(r, "assignmentId", "ASSIGNMENT_NOT_FOUND", "assignment")
	if err != nil {
		return err
	}
	submissionID, err := parseSettingsPathID(r, "submissionId", "SUBMISSION_NOT_FOUND", "submission")
	if err != nil {
		return err
	}
	url, err := h.svc.GetTeacherSubmissionAudioURL(r.Context(), tc, classID, assignmentID, submissionID)
	if err != nil {
		return err
	}
	WriteEnvelope(w, http.StatusOK, h.clk, audioURLResponse{URL: url})
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
