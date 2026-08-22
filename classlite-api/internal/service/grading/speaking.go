// Story 6.3a — the Speaking grading domain twin (D3/D4). A TWIN of the Writing
// scorer/validation (scorer.go, validation.go), NOT a parameterization: the writing
// CriterionScores struct's four NAMED fields cannot be reused for a different key set,
// so Speaking gets its own struct + validator + criterion set. The overall-band core
// IS shared (OverallBandFromFour, D1). Timestamp-pinned comments are a distinct shape
// from writing's text-offset AnchoredComment.
package grading

import (
	"encoding/json"
	"math"
	"strings"

	"github.com/ducdo/classlite-api/internal/model"
)

// The Speaking criterion keys (camelCase — mirror the criterion_scores JSONB + the
// api.yaml SpeakingCriterionScores schema). fluencyCoherence + pronunciation are
// net-new; lexicalResource + grammaticalRange SHARE their spelling with the Writing
// keys (CriterionLexicalResource / CriterionGrammaticalRange in scorer.go), so they
// are not redeclared here. CQ-3: named, not inlined.
const (
	CriterionFluencyCoherence = "fluencyCoherence"
	CriterionPronunciation    = "pronunciation"
)

// Exercise skill values the grade path branches on (story 6.3a — SEC-7, resolved from
// the submission's DB exercise, never a client field).
const (
	SkillWriting  = "writing"
	SkillSpeaking = "speaking"
)

// SpeakingCriterionScores holds the four IELTS Speaking criterion bands (D3). Each is
// a half-band in [1.0, 9.0]; validate with ValidateSpeakingCriterionScores before
// scoring. Field order matches the positional literal SpeakingCriterionScores{fc, lr,
// gr, pr} the tests use.
type SpeakingCriterionScores struct {
	FluencyCoherence float64
	LexicalResource  float64
	GrammaticalRange float64
	Pronunciation    float64
}

// all returns the four bands in criterion order for OverallBandFromFour (D1).
func (c SpeakingCriterionScores) all() [4]float64 {
	return [4]float64{c.FluencyCoherence, c.LexicalResource, c.GrammaticalRange, c.Pronunciation}
}

// Band computes the server-authoritative overall Speaking band via the shared
// OverallBandFromFour core (D1 — never the writing struct).
func (c SpeakingCriterionScores) Band() Band {
	return OverallBandFromFour(c.all())
}

var validSpeakingCriteria = map[string]bool{
	CriterionFluencyCoherence: true, CriterionLexicalResource: true,
	CriterionGrammaticalRange: true, CriterionPronunciation: true,
}

// ValidateSpeakingCriterionScores enforces AC5 for the four Speaking criteria: each a
// number in [1.0, 9.0] on a 0.5 grid. Returns a model.ValidationError (→ 422) listing
// every offending field. The twin of ValidateCriterionScores.
func ValidateSpeakingCriterionScores(cs SpeakingCriterionScores) error {
	var fields []model.FieldError
	check := func(key string, v float64) {
		if v < MinBand || v > MaxBand || !isHalfGrid(v) {
			fields = append(fields, model.FieldError{
				Field:   "criterionScores." + key,
				Code:    "INVALID_BAND",
				Message: "criterion band must be between 1.0 and 9.0 on a 0.5 grid",
			})
		}
	}
	check(CriterionFluencyCoherence, cs.FluencyCoherence)
	check(CriterionLexicalResource, cs.LexicalResource)
	check(CriterionGrammaticalRange, cs.GrammaticalRange)
	check(CriterionPronunciation, cs.Pronunciation)
	if len(fields) > 0 {
		return model.ValidationError{Fields: fields}
	}
	return nil
}

// TimestampedComment is one Speaking comment pinned to a moment on the recording (or a
// general/unpinned note). TimestampMs is milliseconds into the audio, or nil for a
// general comment (D4 — the analog of writing's whole-essay null anchor). JSON tags
// mirror the api.yaml TimestampedComment + the comments JSONB. Text is stored raw
// (escaped on render, AC14 — never trusted as HTML). A DISTINCT shape from the writing
// text-offset Comment.
type TimestampedComment struct {
	Type        string `json:"type"`
	Criterion   string `json:"criterion"`
	TimestampMs *int   `json:"timestampMs"`
	Text        string `json:"text"`
}

// maxCommentTimestampMs is the lenient ceiling a pin is bounded against when the
// persisted duration is unknown/degenerate (D4): the effective bound is
// max(persistedDurationMs, maxCommentTimestampMs) + timestampSlackMs. It is generous
// on purpose — the philosophy is demote-not-drop, and a legitimate pin must never be
// demoted just because the BE only knows a rounded-down (or absent) persist. 60 min
// dwarfs any real IELTS speaking answer while still rejecting an absurd/garbage pin.
const (
	maxCommentTimestampMs = 60 * 60 * 1000 // 60 minutes, in ms
	timestampSlackMs      = 1000           // 1s slack for the FE-decoded-vs-BE-persisted divergence (D4)
)

// NormalizeTimestampComments bounds each pin leniently and DEMOTES-NOT-DROPS (D4):
//   - a negative, or a > max(durationMs, maxCommentTimestampMs)+1s pin → TimestampMs
//     becomes nil (general), and the comment is KEPT (never dropped).
//   - a plausible pin PAST a rounded-down persisted duration is KEPT (59s pin, 58s
//     persist) — the FE composed it against the decoded AudioBuffer, the BE only knows
//     the rounded persist (Murat's divergence).
//   - a degenerate durationMs (≤0) falls back to maxCommentTimestampMs so real pins
//     survive, rather than all-demoting.
//
// It ALSO validates the comment taxonomy server-side — the twin of the writing
// NormalizeComments (validation.go): an invalid type, a criterion outside the four
// Speaking keys, or blank text is a model.ValidationError (→ 422). OpenAPI enums are
// not enforced by the Go decoder and the closed FE enum is not a server guarantee, so
// the taxonomy is checked here before it reaches the comments JSONB (6-3c keys off
// criterion). The output slice preserves order + length.
func NormalizeTimestampComments(in []TimestampedComment, durationMs int) ([]TimestampedComment, error) {
	bound := durationMs
	if bound < maxCommentTimestampMs {
		bound = maxCommentTimestampMs
	}
	bound += timestampSlackMs

	var fields []model.FieldError
	out := make([]TimestampedComment, 0, len(in))
	for i, c := range in {
		field := func(sub, code, msg string) {
			fields = append(fields, model.FieldError{
				Field:   "comments[" + itoa(i) + "]." + sub,
				Code:    code,
				Message: msg,
			})
		}
		if !validCommentTypes[c.Type] {
			field("type", "INVALID_COMMENT_TYPE", "type must be error, praise, or suggestion")
			continue
		}
		if !validSpeakingCriteria[c.Criterion] {
			field("criterion", "INVALID_CRITERION", "criterion must be one of the four IELTS speaking keys")
			continue
		}
		if strings.TrimSpace(c.Text) == "" {
			field("text", "EMPTY_COMMENT_TEXT", "comment text must not be blank")
			continue
		}
		nc := TimestampedComment{Type: c.Type, Criterion: c.Criterion, Text: c.Text}
		if c.TimestampMs != nil {
			ms := *c.TimestampMs
			if ms >= 0 && ms <= bound {
				kept := ms
				nc.TimestampMs = &kept
			}
			// else: demote to general (nil), KEEP the comment.
		}
		out = append(out, nc)
	}
	if len(fields) > 0 {
		return nil, model.ValidationError{Fields: fields}
	}
	return out, nil
}

// SpeakingDurationMsFromContent parses submission.content.durationSec (seconds, 5.4)
// into milliseconds (D4). Absent / 0 / negative → 0; a fractional durationSec ROUNDS
// (never truncates-to-error). The BE has no other durationSec parser today.
//
// durationSec is student-authored (written on the submission attempt path, unclamped),
// so the result is CAPPED at maxCommentTimestampMs: an absurd value (e.g. 1e18) would
// otherwise overflow the int conversion / the downstream bound arithmetic and wrap
// negative, silently demoting EVERY pin. The cap is harmless for real recordings —
// maxCommentTimestampMs (60 min) is already the lenient floor NormalizeTimestampComments
// applies, so a legitimate durationSec never reaches it.
func SpeakingDurationMsFromContent(content []byte) int {
	var c struct {
		DurationSec *float64 `json:"durationSec"`
	}
	if err := json.Unmarshal(content, &c); err != nil || c.DurationSec == nil {
		return 0
	}
	if *c.DurationSec <= 0 {
		return 0
	}
	ms := math.Round(*c.DurationSec * 1000)
	if ms >= maxCommentTimestampMs {
		return maxCommentTimestampMs
	}
	return int(ms)
}
