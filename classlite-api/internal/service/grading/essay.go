package grading

import "encoding/json"

// EssayText extracts the plain-text writing body from a submission's content blob
// (content.text — Story 5.3 plain-text D1). Returns "" when the content is absent
// or has no text field.
//
// Relocated from package service (Story 6.2a D7) into this leaf package so the
// ai_grade_writing worker (package worker) can read the essay without importing
// package service (which would be a worker→service import cycle). Both the grade
// write (service) and the AI grade worker resolve the essay through this single
// pure accessor, so their notion of "the essay text" — and therefore the UTF-16
// anchor space NormalizeComments validates against — can never drift.
func EssayText(content []byte) string {
	var probe struct {
		Text string `json:"text"`
	}
	if err := json.Unmarshal(content, &probe); err != nil {
		return ""
	}
	return probe.Text
}
