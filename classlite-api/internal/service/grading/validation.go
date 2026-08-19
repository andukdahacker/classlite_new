package grading

import (
	"math"
	"strings"
	"unicode"
	"unicode/utf16"

	"github.com/ducdo/classlite-api/internal/model"
)

// Comment taxonomy (AC5). Mirrors the api.yaml AnchoredComment enums.
const (
	CommentTypeError      = "error"
	CommentTypePraise     = "praise"
	CommentTypeSuggestion = "suggestion"
)

// Comment is one anchored teacher comment. AnchorStart/AnchorEnd are UTF-16
// code-unit offsets into submission.content.text (D3), or BOTH nil for a
// whole-essay comment. JSON tags mirror the api.yaml AnchoredComment + the
// comments JSONB. Text is stored raw (escaped on render, AC13 — never trusted as
// HTML).
type Comment struct {
	Type        string `json:"type"`
	Criterion   string `json:"criterion"`
	AnchorStart *int   `json:"anchorStart"`
	AnchorEnd   *int   `json:"anchorEnd"`
	Text        string `json:"text"`
}

// GradeInput is the validated grade write payload (grade + revise). OverallBand is
// NEVER carried — the server computes it (AC7).
type GradeInput struct {
	Scores   CriterionScores
	Comments []Comment
	Feedback *string
}

var validCommentTypes = map[string]bool{
	CommentTypeError: true, CommentTypePraise: true, CommentTypeSuggestion: true,
}

var validCriteria = map[string]bool{
	CriterionTaskResponse: true, CriterionCoherenceCohesion: true,
	CriterionLexicalResource: true, CriterionGrammaticalRange: true,
}

// ValidateCriterionScores enforces AC5: all four keys present (the struct
// guarantees presence), each a number in [1.0, 9.0] on a 0.5 grid. Returns a
// model.ValidationError (→ 422) listing every offending field.
func ValidateCriterionScores(cs CriterionScores) error {
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
	check(CriterionTaskResponse, cs.TaskResponse)
	check(CriterionCoherenceCohesion, cs.CoherenceCohesion)
	check(CriterionLexicalResource, cs.LexicalResource)
	check(CriterionGrammaticalRange, cs.GrammaticalRange)
	if len(fields) > 0 {
		return model.ValidationError{Fields: fields}
	}
	return nil
}

// isHalfGrid reports whether v lands on the 0.5 grid (v*2 is an integer). Uses
// exact float comparison — half-band values have power-of-two denominators, so
// v*2 is represented exactly.
func isHalfGrid(v float64) bool {
	x := v * 2
	return x == math.Trunc(x)
}

// NormalizeComments validates + normalizes the comment list against the essay
// text (AC5 / D3). Per comment:
//   - type ∈ {error, praise, suggestion} and criterion ∈ the four keys, else 422.
//   - blank text is rejected (422).
//   - a span comment requires 0 <= start < end <= utf16Len(trimTrailing(text)),
//     AND neither boundary may split a surrogate pair; an out-of-range,
//     surrogate-splitting, OR partially-null anchor is DEMOTED to whole-essay
//     (null/null), never dropped (mirrors the 6.2 orphan rule). A whole-essay
//     comment has both anchors null.
//
// Offsets are UTF-16 code units into content.text (matches the browser). The max
// is computed against the text with trailing whitespace/newlines trimmed, so an
// anchor into trimmed-away trailing space is demoted. A boundary landing between
// the high and low half of a surrogate pair (e.g. mid-emoji) would slice a lone
// surrogate → replacement char / mojibake, so it is demoted too.
func NormalizeComments(in []Comment, essayText string) ([]Comment, error) {
	units := utf16.Encode([]rune(trimTrailingSpace(essayText)))
	maxLen := len(units)
	var fields []model.FieldError
	out := make([]Comment, 0, len(in))
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
		if !validCriteria[c.Criterion] {
			field("criterion", "INVALID_CRITERION", "criterion must be one of the four IELTS keys")
			continue
		}
		if strings.TrimSpace(c.Text) == "" {
			field("text", "EMPTY_COMMENT_TEXT", "comment text must not be blank")
			continue
		}
		nc := Comment{Type: c.Type, Criterion: c.Criterion, Text: c.Text}
		if c.AnchorStart != nil && c.AnchorEnd != nil &&
			*c.AnchorStart >= 0 && *c.AnchorStart < *c.AnchorEnd && *c.AnchorEnd <= maxLen &&
			!splitsSurrogatePair(units, *c.AnchorStart) && !splitsSurrogatePair(units, *c.AnchorEnd) {
			start, end := *c.AnchorStart, *c.AnchorEnd
			nc.AnchorStart = &start
			nc.AnchorEnd = &end
		}
		// else: demote to whole-essay (anchors stay nil).
		out = append(out, nc)
	}
	if len(fields) > 0 {
		return nil, model.ValidationError{Fields: fields}
	}
	return out, nil
}

// utf16Len returns the number of UTF-16 code units in s (D3 — the unit the browser
// produces and consumes for anchor offsets).
func utf16Len(s string) int {
	return len(utf16.Encode([]rune(s)))
}

// splitsSurrogatePair reports whether the boundary at code-unit offset p falls
// between the high and low half of a surrogate pair in units. Slicing on such a
// boundary would yield a lone surrogate (D3), so an anchor there is demoted. The
// endpoints (p == 0 or p == len) never split.
func splitsSurrogatePair(units []uint16, p int) bool {
	if p <= 0 || p >= len(units) {
		return false
	}
	const highStart, highEnd = 0xD800, 0xDBFF
	const lowStart, lowEnd = 0xDC00, 0xDFFF
	prevHigh := units[p-1] >= highStart && units[p-1] <= highEnd
	nextLow := units[p] >= lowStart && units[p] <= lowEnd
	return prevHigh && nextLow
}

// trimTrailingSpace strips trailing Unicode whitespace (spaces, tabs, newlines).
func trimTrailingSpace(s string) string {
	return strings.TrimRightFunc(s, unicode.IsSpace)
}

// itoa is a tiny int→string for field paths (avoids importing strconv just here).
func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}
