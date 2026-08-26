package handler

// Story 6.4a — teacher objective auto-grade override + release HTTP surface (AC13/AC16).
// Staff-gated at the route (owner/admin/teacher); all objectivity/ownership/release rules
// live in-service. Wire contract PROVISIONAL (D16) — co-finalized with 6-4b.

import (
	"net/http"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/service"
)

// AutoGradeHandler serves the two provisional objective-grading endpoints.
type AutoGradeHandler struct {
	svc *service.AutoGradeService
	clk clock.Clock
}

// NewAutoGradeHandler constructs an AutoGradeHandler.
func NewAutoGradeHandler(svc *service.AutoGradeService, clk clock.Clock) *AutoGradeHandler {
	return &AutoGradeHandler{svc: svc, clk: clk}
}

// overrideAutoGradeRequest is the provisional override body (D11/D16).
type overrideAutoGradeRequest struct {
	QuestionRef string `json:"questionRef"`
	Mark        string `json:"mark"`
}

type autoGradeAnswerResponse struct {
	QuestionRef      string   `json:"questionRef"`
	QuestionText     string   `json:"questionText"`
	StudentAnswer    string   `json:"studentAnswer"`
	StudentFlagged   bool     `json:"studentFlagged"`
	CorrectAnswer    string   `json:"correctAnswer"`
	AcceptedVariants []string `json:"acceptedVariants"`
	AutoMark         string   `json:"autoMark"`
	OverrideMark     *string  `json:"overrideMark"`
	EffectiveMark    string   `json:"effectiveMark"`
}

type autoGradeViewResponse struct {
	RawScore        int                       `json:"rawScore"`
	MaxScore        int                       `json:"maxScore"`
	Percentage      float64                   `json:"percentage"`
	ProvisionalBand float64                   `json:"provisionalBand"`
	Released        bool                      `json:"released"`
	Answers         []autoGradeAnswerResponse `json:"answers"`
}

// autoGradeViewToResponse maps the service view to the wire shape. This is the teacher
// path — correctAnswer / acceptedVariants are included (D12: teacher-only; the student
// /result path carries no autoGrade block at all, so nothing to strip there).
func autoGradeViewToResponse(v service.AutoGradeView) autoGradeViewResponse {
	answers := make([]autoGradeAnswerResponse, 0, len(v.Answers))
	for _, a := range v.Answers {
		variants := a.AcceptedVariants
		if variants == nil {
			variants = []string{}
		}
		answers = append(answers, autoGradeAnswerResponse{
			QuestionRef:      a.QuestionRef,
			QuestionText:     a.QuestionText,
			StudentAnswer:    a.StudentAnswer,
			StudentFlagged:   a.StudentFlagged,
			CorrectAnswer:    a.CorrectAnswer,
			AcceptedVariants: variants,
			AutoMark:         a.AutoMark,
			OverrideMark:     a.OverrideMark,
			EffectiveMark:    a.EffectiveMark,
		})
	}
	return autoGradeViewResponse{
		RawScore:        v.RawScore,
		MaxScore:        v.MaxScore,
		Percentage:      v.Percentage,
		ProvisionalBand: v.ProvisionalBand,
		Released:        v.Released,
		Answers:         answers,
	}
}

// Override — POST /api/submissions/{submissionId}/auto-grade/overrides (AC13).
func (h *AutoGradeHandler) Override(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireOwnerTenant(r)
	if err != nil {
		return err
	}
	submissionID, err := parseSettingsPathID(r, "submissionId", "SUBMISSION_NOT_FOUND", "submission")
	if err != nil {
		return err
	}
	var body overrideAutoGradeRequest
	if derr := decodeClassJSONBody(r.Body, &body); derr != nil {
		return derr
	}
	view, err := h.svc.Override(r.Context(), tc, submissionID, service.AutoGradeOverrideInput{
		QuestionRef: body.QuestionRef,
		Mark:        body.Mark,
	})
	if err != nil {
		return err
	}
	WriteEnvelope(w, http.StatusOK, h.clk, autoGradeViewToResponse(*view))
	return nil
}

// Release — POST /api/submissions/{submissionId}/release (AC16).
func (h *AutoGradeHandler) Release(w http.ResponseWriter, r *http.Request) error {
	tc, err := requireOwnerTenant(r)
	if err != nil {
		return err
	}
	submissionID, err := parseSettingsPathID(r, "submissionId", "SUBMISSION_NOT_FOUND", "submission")
	if err != nil {
		return err
	}
	grade, err := h.svc.Release(r.Context(), tc, submissionID)
	if err != nil {
		return err
	}
	WriteEnvelope(w, http.StatusOK, h.clk, gradeToResponse(*grade))
	return nil
}
