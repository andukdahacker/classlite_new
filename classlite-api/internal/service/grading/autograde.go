package grading

// Story 6.4a (D6/D7/D15) — the PURE, storeless objective auto-grading engine. Given a
// decoded exercise (the answer key) + the student's AttemptContent blob, it normalizes,
// matches, classifies, scores, and bands — with NO database access. This is the golden-
// table unit seam (fast, table-driven). It NEVER returns an error for bad data (D13):
// malformed / zero-question / no-gradable-group content returns nil so the caller (the
// submit hook) treats the submission as ungraded and still commits.

import (
	"fmt"
	"strings"
	"unicode"

	"github.com/ducdo/classlite-api/internal/store"
	"golang.org/x/text/unicode/norm"
)

// AutoMark is the objective auto-grade verdict for one answer (D6).
type AutoMark string

const (
	// MarkCorrect — the student's answer matches the key (exact after normalization,
	// or a union member). Applies to every question type.
	MarkCorrect AutoMark = "correct"
	// MarkWrong — no match and not a free-text near-miss (or an unanswered / choice-type
	// miss). Choice types (multiple_choice/true_false_not_given/matching) are only ever
	// correct or wrong.
	MarkWrong AutoMark = "wrong"
	// MarkNeedsReview — a free-text near-miss (small edit distance or diacritics-only)
	// that a human should adjudicate. Free-text types only. Excluded from the provisional
	// denominator until resolved (D6); counts as wrong in the definitive released grade (D10).
	MarkNeedsReview AutoMark = "needs_review"
)

// maxNearMissThreshold caps the near-miss edit-distance threshold (D6: 1 ≤ d ≤ min(2, …)).
// It also bounds the DP short-circuit in classify: a length gap beyond this can never be a
// near-miss.
const maxNearMissThreshold = 2

// AttemptContent is the backend accessor for the FE-authoritative student answer blob
// (D5), mirroring classlite-web/src/features/quiz-attempt/lib/attemptContent.ts. Answers
// is keyed by the colon handle "{sectionIndex}:{groupIndex}:{questionIndex}"; each value
// is a single string (MCQ = chosen option text, TFNG = "true"|"false"|"notGiven",
// fill_in_blank/short_answer = free text, matching = the per-row heading). Flagged is the
// student's own "review later" self-flag — informational, never affects marking.
type AttemptContent struct {
	SchemaVersion int               `json:"schemaVersion"`
	Answers       map[string]string `json:"answers"`
	Flagged       []string          `json:"flagged"`
}

// AutoGradeAnswer is one question's engine verdict.
type AutoGradeAnswer struct {
	QuestionRef    string
	StudentAnswer  string
	StudentFlagged bool
	AutoMark       AutoMark
}

// AutoGradeResult is the whole objective grading of one submission. Percentage EXCLUDES
// unresolved needs_review from the denominator (D6); ProvisionalBand is derived from it
// via PercentageToBand (D7, computed-only).
type AutoGradeResult struct {
	Answers         []AutoGradeAnswer
	RawScore        int
	MaxScore        int
	Percentage      float64
	ProvisionalBand float64
}

// hyphenVariants are the dash runes stripped during normalization (FU-4-2-A, always-on):
// hyphen-minus, hyphen, non-breaking hyphen, figure dash, en dash, em dash.
var hyphenVariants = map[rune]bool{
	'-': true, // -  HYPHEN-MINUS
	'‐': true, // ‐  HYPHEN
	'‑': true, // ‑  NON-BREAKING HYPHEN
	'‒': true, // ‒  FIGURE DASH
	'–': true, // –  EN DASH
	'—': true, // —  EM DASH
}

// Normalize applies the D5 answer-normalization pipeline: strip hyphen variants →
// TrimSpace → collapse internal whitespace runs to one space → NFC; then case-fold unless
// caseSensitive. Hyphen + whitespace normalization is ALWAYS-ON; only case is gated.
//
// Hyphens are stripped BEFORE the whitespace collapse: a hyphen surrounded by spaces
// ("well - known") would otherwise leave a double space ("well  known") that never matches
// the compact form — stripping first lets the collapse fold it back to a single space.
func Normalize(s string, caseSensitive bool) string {
	// Strip hyphen variants.
	if strings.ContainsFunc(s, func(r rune) bool { return hyphenVariants[r] }) {
		var b strings.Builder
		b.Grow(len(s))
		for _, r := range s {
			if hyphenVariants[r] {
				continue
			}
			b.WriteRune(r)
		}
		s = b.String()
	}
	// TrimSpace + collapse internal whitespace runs in one pass.
	s = strings.Join(strings.Fields(s), " ")
	s = norm.NFC.String(s)
	if !caseSensitive {
		s = strings.ToLower(s)
	}
	return s
}

// stripDiacritics removes combining marks (NFD → drop general category Mn → NFC), so
// "café" and "cafe" compare equal. Used to detect a diacritics-only difference (D6).
func stripDiacritics(s string) string {
	decomposed := norm.NFD.String(s)
	var b strings.Builder
	b.Grow(len(decomposed))
	for _, r := range decomposed {
		if unicode.Is(unicode.Mn, r) {
			continue
		}
		b.WriteRune(r)
	}
	return norm.NFC.String(b.String())
}

// choiceTypes are the exact-choice question types: correct or wrong, NEVER needs_review.
var choiceTypes = map[string]bool{
	store.QuestionGroupTypeMultipleChoice:    true,
	store.QuestionGroupTypeTrueFalseNotGiven: true,
	store.QuestionGroupTypeMatching:          true,
}

// classify resolves one answer to a mark. Choice types are exact union-match → correct
// or wrong. Free-text (fill_in_blank/short_answer) additionally yield needs_review for a
// near-miss: Levenshtein d over normalized strings with 1 ≤ d ≤ min(2, ceil(L/5)) where L
// is the max rune-length of the min-distance pair, OR a diacritics-only difference. A
// blank/absent student answer is always wrong (unanswered), never needs_review.
func classify(qType, student, correct string, variants []string, caseSensitive bool) AutoMark {
	normStudent := Normalize(student, caseSensitive)

	accepted := make([]string, 0, 1+len(variants))
	accepted = append(accepted, correct)
	accepted = append(accepted, variants...)

	// Normalize the answer key ONCE — reused by both the exact-match and near-miss passes
	// (avoids re-normalizing every variant twice on the synchronous submit path).
	normAccepted := make([]string, 0, len(accepted))
	for _, a := range accepted {
		normAccepted = append(normAccepted, Normalize(a, caseSensitive))
	}

	// Exact union match applies to every type.
	if normStudent != "" {
		for _, a := range normAccepted {
			if normStudent == a {
				return MarkCorrect
			}
		}
	}

	// Choice types never escalate to needs_review.
	if choiceTypes[qType] {
		return MarkWrong
	}

	// Free-text: an unanswered blank is a hard wrong.
	if normStudent == "" {
		return MarkWrong
	}

	studentRunes := []rune(normStudent)
	studentStripped := stripDiacritics(normStudent)
	minDistance := -1
	var pairLen int
	diacriticsOnly := false
	for _, a := range normAccepted {
		if a == "" {
			continue
		}
		acceptedRunes := []rune(a)
		l := len(studentRunes)
		if len(acceptedRunes) > l {
			l = len(acceptedRunes)
		}
		// Edit distance is bounded below by the rune-length gap, so when the gap already
		// exceeds the largest possible near-miss threshold the answer can never be a
		// near-miss — use the gap as the distance and skip the O(L²) DP. This caps the
		// worst case on the synchronous submit path (a pathologically long free-text
		// answer vs a short key would otherwise run millions of DP cells inside the tx).
		lenGap := len(studentRunes) - len(acceptedRunes)
		if lenGap < 0 {
			lenGap = -lenGap
		}
		var d int
		if lenGap > maxNearMissThreshold {
			d = lenGap
		} else {
			d = levenshtein(studentRunes, acceptedRunes)
		}
		if minDistance == -1 || d < minDistance {
			minDistance = d
			pairLen = l
		}
		if !diacriticsOnly && studentStripped == stripDiacritics(a) {
			diacriticsOnly = true
		}
	}
	if diacriticsOnly {
		return MarkNeedsReview
	}
	if minDistance < 1 {
		return MarkWrong
	}
	threshold := ceilDiv(pairLen, 5)
	if threshold > maxNearMissThreshold {
		threshold = maxNearMissThreshold
	}
	if minDistance <= threshold {
		return MarkNeedsReview
	}
	return MarkWrong
}

// ceilDiv returns ceil(a/b) for positive b.
func ceilDiv(a, b int) int {
	if b <= 0 {
		return 0
	}
	return (a + b - 1) / b
}

// levenshtein is the standard two-row edit-distance DP over runes.
func levenshtein(a, b []rune) int {
	if len(a) == 0 {
		return len(b)
	}
	if len(b) == 0 {
		return len(a)
	}
	prev := make([]int, len(b)+1)
	curr := make([]int, len(b)+1)
	for j := range prev {
		prev[j] = j
	}
	for i := 1; i <= len(a); i++ {
		curr[0] = i
		for j := 1; j <= len(b); j++ {
			cost := 1
			if a[i-1] == b[j-1] {
				cost = 0
			}
			del := prev[j] + 1
			ins := curr[j-1] + 1
			sub := prev[j-1] + cost
			curr[j] = min3(del, ins, sub)
		}
		prev, curr = curr, prev
	}
	return prev[len(b)]
}

func min3(a, b, c int) int {
	m := a
	if b < m {
		m = b
	}
	if c < m {
		m = c
	}
	return m
}

// isPromptOnlySection reports whether a section carries no answer key (writing/speaking).
// Such sections are never auto-graded (D3) even if malformed content attached a group.
func isPromptOnlySection(sectionType string) bool {
	return sectionType == store.SectionTypeWriting || sectionType == store.SectionTypeSpeaking
}

// HasGradableGroups reports whether content has at least one gradable question — i.e. a
// non-prompt-only section carrying a question group with questions (D3: objectivity is
// question-group PRESENCE, not the skill/section-type label).
func HasGradableGroups(content store.ExerciseContent) bool {
	for _, section := range content.Sections {
		if isPromptOnlySection(section.Type) {
			continue
		}
		for _, group := range section.QuestionGroups {
			if len(group.Questions) > 0 {
				return true
			}
		}
	}
	return false
}

// questionType returns the effective type for classification: the question's own type,
// falling back to the group type.
func questionType(group store.QuestionGroup, q store.Question) string {
	if q.Type != "" {
		return q.Type
	}
	return group.Type
}

// Grade runs the full objective pipeline. Returns nil (never an error, D13) when the
// content has no gradable question. Percentage = resolvedCorrect / (maxScore −
// unresolvedNeedsReview) × 100 (guard denom ≤ 0 → 0%); ProvisionalBand = PercentageToBand.
func Grade(content store.ExerciseContent, answers AttemptContent, settings store.ExerciseSettings) *AutoGradeResult {
	if !HasGradableGroups(content) {
		return nil
	}
	flagged := make(map[string]bool, len(answers.Flagged))
	for _, ref := range answers.Flagged {
		flagged[ref] = true
	}

	result := &AutoGradeResult{Answers: []AutoGradeAnswer{}}
	resolvedCorrect := 0
	unresolvedNeedsReview := 0
	for sectionIndex, section := range content.Sections {
		if isPromptOnlySection(section.Type) {
			continue
		}
		for groupIndex, group := range section.QuestionGroups {
			for questionIndex, question := range group.Questions {
				ref := fmt.Sprintf("%d:%d:%d", sectionIndex, groupIndex, questionIndex)
				studentAnswer := answers.Answers[ref]
				mark := classify(questionType(group, question), studentAnswer, question.CorrectAnswer, question.AcceptedVariants, settings.CaseSensitive)
				switch mark {
				case MarkCorrect:
					resolvedCorrect++
				case MarkNeedsReview:
					unresolvedNeedsReview++
				}
				result.Answers = append(result.Answers, AutoGradeAnswer{
					QuestionRef:    ref,
					StudentAnswer:  studentAnswer,
					StudentFlagged: flagged[ref],
					AutoMark:       mark,
				})
			}
		}
	}

	result.MaxScore = len(result.Answers)
	if result.MaxScore == 0 {
		return nil
	}
	result.RawScore = resolvedCorrect
	denominator := result.MaxScore - unresolvedNeedsReview
	if denominator <= 0 {
		result.Percentage = 0
	} else {
		result.Percentage = float64(resolvedCorrect) / float64(denominator) * 100
	}
	result.ProvisionalBand = PercentageToBand(result.Percentage)
	return result
}

// bandCutoffs is the documented percentage→band table (D7, computed-only). Monotonic
// non-decreasing; every band fits numeric(2,1). The exact cutoffs are the engine's to
// own (the ATDD asserts only the structural contract: deterministic + monotonic on
// [0,100]); this is a defensible objective-percentage ladder.
var bandCutoffs = []struct {
	MinPct float64
	Band   float64
}{
	{90, 9.0},
	{80, 8.0},
	{70, 7.0},
	{60, 6.5},
	{50, 6.0},
	{40, 5.5},
	{30, 5.0},
	{20, 4.0},
	{10, 3.0},
	{0, 2.0},
}

// PercentageToBand maps an objective percentage [0,100] to a band via bandCutoffs. Values
// are clamped into range so it is total and deterministic (D7).
func PercentageToBand(pct float64) float64 {
	if pct > 100 {
		pct = 100
	}
	if pct < 0 {
		pct = 0
	}
	for _, cutoff := range bandCutoffs {
		if pct >= cutoff.MinPct {
			return cutoff.Band
		}
	}
	return bandCutoffs[len(bandCutoffs)-1].Band
}
