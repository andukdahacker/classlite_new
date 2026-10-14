// Story 11-0b — the four R5 machine assertions as PURE functions over a graded
// sample. They depend on internal/model + internal/service/grading + stdlib ONLY (no
// internal/test / internal/worker) so they are untagged-unit-testable (the AC5
// perturbation teeth self-test drives them directly) and honest about the shipped
// result shape they measure.
//
// DD5 — tolerances: the PER-CRITERION band is the HARD accuracy gate (the overall band
// averages four criteria, so compensating per-criterion errors cancel; the per-criterion
// band is the number a teacher reads). The overall ±0.5 is a SECONDARY check. Stability
// is 5 regrades gated on per-criterion range AND overall stddev (range-of-3 is a biased
// spread estimator that passes while the grader is visibly unstable). All thresholds are
// named consts (CQ-3); override only with a written reason.
package calibration

import (
	"fmt"
	"math"
	"regexp"
	"sort"
	"strings"

	"golang.org/x/text/unicode/norm"

	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service/grading"
)

// Calibration tolerances + sampling (DD5). PerCriterionTol is the hard accuracy gate;
// OverallBandTol is secondary. MaxAcceptableMAE is the ABSOLUTE examiner-truth quality
// floor (the DONE gate) — NOT derived from our own first run; a run-to-run MAE delta is a
// separate drift warning, not a green/red gate. StabilityReGrades is 5 (not 3). The
// stability gate is per-criterion range AND overall stddev.
const (
	PerCriterionTol            = 1.0
	OverallBandTol             = 0.5
	MaxAcceptableMAE           = 0.5
	StabilityReGrades          = 5
	StabilityCriterionRangeTol = 1.0
	StabilityOverallStddevTol  = 0.25
	// MinStratifiedPerHalfBand is the minimum N a real run should hold in each half-band
	// bucket across the range students sit (AC1). It is REPORTED by the run harness as a
	// stratification warning — the gold-set dataset size is Ducdo's Phase-2 assembly toil,
	// not something dev-story can satisfy.
	MinStratifiedPerHalfBand = 3
	// minStabilityRegradesForVerdict is the floor below which a stability result is NOT
	// conclusive. spread() and populationStddev() both return 0 for <2 values, so a run where
	// transport failures leave 0-1 successful regrades would otherwise report a vacuous PASS
	// (a false green for AC2 under Gemini rate-limiting). Below this floor Measured is false
	// and the result never passes — the operator must re-run until the grader actually
	// produced enough draws to measure.
	minStabilityRegradesForVerdict = 2
)

// --- AC1: band accuracy (per-criterion hard gate) ---

// CriterionDelta is one criterion's AI-vs-examiner comparison. Delta is SIGNED
// (AI − examiner) so the over-score direction is visible (Mary — over-scoring a weak
// student is commercially lethal in a way under-scoring is not).
type CriterionDelta struct {
	Criterion string
	AI        float64
	Examiner  float64
	Delta     float64 // AI − examiner (signed)
	AbsDelta  float64
	Present   bool // the AI result carried this criterion
	Pass      bool // Present && AbsDelta ≤ perCriterionTol
}

// SampleAccuracy is the accuracy outcome for one graded sample. Pass is the HARD gate
// (every criterion present and within perCriterionTol); OverallPass is the SECONDARY
// overall-band check.
type SampleAccuracy struct {
	SampleID        string
	Criteria        []CriterionDelta
	WorstMiss       CriterionDelta
	MAE             float64 // mean AbsDelta over present criteria
	OverallAI       float64
	OverallExaminer float64
	OverallDelta    float64 // signed (AI − examiner)
	OverallPass     bool    // |OverallDelta| ≤ overallTol (secondary)
	OverScored      bool    // OverallAI > OverallExaminer (the lethal direction)
	Pass            bool    // HARD gate: every criterion present and within perCriterionTol
}

// BandAccuracy compares one sample's AI criterion bands + overall against the examiner's.
// The hard gate (SampleAccuracy.Pass) is per-criterion: every examiner criterion must be
// present in the AI result and within perCriterionTol. The overall ±overallTol check is
// recorded as SECONDARY (OverallPass) — averaging four criteria hides compensating
// errors, so it never gates on its own (DD5). Criterion order is sorted for determinism.
func BandAccuracy(sampleID string, aiCriteria, examinerCriteria map[string]float64, aiOverall, examinerOverall, perCriterionTol, overallTol float64) SampleAccuracy {
	keys := sortedKeys(examinerCriteria)
	out := SampleAccuracy{
		SampleID:        sampleID,
		OverallAI:       aiOverall,
		OverallExaminer: examinerOverall,
		OverallDelta:    aiOverall - examinerOverall,
		Pass:            true,
	}
	if len(keys) == 0 {
		// A sample with no examiner criteria cannot pass the HARD per-criterion gate — the
		// loop below would otherwise run zero times and leave Pass=true with MAE=0, a vacuous
		// green that hides a bad grader. The loader rejects incomplete samples upstream; this
		// is the defensive backstop.
		out.Pass = false
	}
	var sumAbs float64
	var present int
	for _, key := range keys {
		examiner := examinerCriteria[key]
		ai, ok := aiCriteria[key]
		cd := CriterionDelta{Criterion: key, Examiner: examiner, Present: ok}
		if ok {
			cd.AI = ai
			cd.Delta = ai - examiner
			cd.AbsDelta = math.Abs(cd.Delta)
			cd.Pass = cd.AbsDelta <= perCriterionTol
			sumAbs += cd.AbsDelta
			present++
		}
		if !cd.Present || !cd.Pass {
			out.Pass = false
		}
		if cd.AbsDelta > out.WorstMiss.AbsDelta {
			out.WorstMiss = cd
		}
		out.Criteria = append(out.Criteria, cd)
	}
	if present > 0 {
		out.MAE = sumAbs / float64(present)
	}
	out.OverallPass = math.Abs(out.OverallDelta) <= overallTol
	out.OverScored = aiOverall > examinerOverall
	return out
}

// --- AC2: re-grade stability ---

// CriterionStability is one criterion's spread across N regrades. Range is max − min.
type CriterionStability struct {
	Criterion string
	Values    []float64
	Range     float64
	Pass      bool // Range ≤ criterionRangeTol
}

// StabilityResult is the re-grade stability outcome. Pass requires BOTH every criterion's
// regrade range ≤ criterionRangeTol AND the overall-band population stddev ≤
// overallStddevTol (DD5 — a max pairwise spread over 3 draws passes while the grader is
// visibly unstable).
type StabilityResult struct {
	ReGrades      int
	Measured      bool // at least minStabilityRegradesForVerdict successful regrades — else the verdict is vacuous
	Criteria      []CriterionStability
	OverallValues []float64
	OverallStddev float64
	CriterionPass bool
	StddevPass    bool
	Pass          bool
}

// Stability measures N re-grades of a single sample. regradesByCriterion maps each
// criterion key to its N band values; overallRegrades is the N overall bands. The gate is
// per-criterion range ≤ criterionRangeTol AND overall stddev ≤ overallStddevTol.
func Stability(regradesByCriterion map[string][]float64, overallRegrades []float64, criterionRangeTol, overallStddevTol float64) StabilityResult {
	out := StabilityResult{
		ReGrades:      len(overallRegrades),
		Measured:      len(overallRegrades) >= minStabilityRegradesForVerdict,
		OverallValues: overallRegrades,
		OverallStddev: populationStddev(overallRegrades),
		CriterionPass: true,
	}
	for _, key := range sortedSliceKeys(regradesByCriterion) {
		values := regradesByCriterion[key]
		cs := CriterionStability{Criterion: key, Values: values, Range: spread(values)}
		cs.Pass = cs.Range <= criterionRangeTol
		if !cs.Pass {
			out.CriterionPass = false
		}
		out.Criteria = append(out.Criteria, cs)
	}
	out.StddevPass = out.OverallStddev <= overallStddevTol
	// Measured gates the whole verdict: spread/stddev are 0 on a <2-draw series, so without
	// this a transport-starved regrade run would report PASS over a single data point (DD5 —
	// 5 regrades; a vacuous-green stability check is exactly what AC2 exists to prevent).
	out.Pass = out.Measured && out.CriterionPass && out.StddevPass
	return out
}

// --- AC3: rubric-criteria coverage ---

// CriterionCoverage asserts, for a graded result (writing or speaking), that every
// criterion key for that skill is present with a band that passes grading's validator
// (1.0–9.0 on the 0.5 grid), a non-empty rationale, a confidence ∈ {high, medium}, in the
// requested language. It reuses grading.Validate{,Speaking}CriterionScores verbatim for
// the band check. Returns a non-nil error naming the offending criterion on the first
// failure (AC3); nil on full coverage.
//
// Language note (DD6): the shipped grader is English-only. matchesLanguage is a pragmatic,
// low-false-positive detector tuned for the English-only product — it flags Vietnamese
// output against an expected "en", not a general-purpose language identifier.
func CriterionCoverage(skill string, result any, wantLanguage string) error {
	switch skill {
	case grading.SkillWriting:
		res, ok := result.(model.AIWritingGradeResult)
		if !ok {
			return fmt.Errorf("coverage: expected AIWritingGradeResult for writing, got %T", result)
		}
		if err := grading.ValidateCriterionScores(grading.CriterionScores{
			TaskResponse:      res.Criteria.TaskResponse.Band,
			CoherenceCohesion: res.Criteria.CoherenceCohesion.Band,
			LexicalResource:   res.Criteria.LexicalResource.Band,
			GrammaticalRange:  res.Criteria.GrammaticalRange.Band,
		}); err != nil {
			return fmt.Errorf("coverage: writing band out of range/off-grid: %w", err)
		}
		for _, c := range []struct {
			key string
			cr  model.AIWritingGradeCriterion
		}{
			{grading.CriterionTaskResponse, res.Criteria.TaskResponse},
			{grading.CriterionCoherenceCohesion, res.Criteria.CoherenceCohesion},
			{grading.CriterionLexicalResource, res.Criteria.LexicalResource},
			{grading.CriterionGrammaticalRange, res.Criteria.GrammaticalRange},
		} {
			if err := checkCriterionMeta(c.key, c.cr.Rationale, c.cr.Confidence, wantLanguage); err != nil {
				return err
			}
		}
		return checkCorpusLanguage(WritingFeedbackTexts(res), wantLanguage)
	case grading.SkillSpeaking:
		res, ok := result.(model.AISpeakingGradeResult)
		if !ok {
			return fmt.Errorf("coverage: expected AISpeakingGradeResult for speaking, got %T", result)
		}
		if err := grading.ValidateSpeakingCriterionScores(grading.SpeakingCriterionScores{
			FluencyCoherence: res.Criteria.FluencyCoherence.Band,
			LexicalResource:  res.Criteria.LexicalResource.Band,
			GrammaticalRange: res.Criteria.GrammaticalRange.Band,
			Pronunciation:    res.Criteria.Pronunciation.Band,
		}); err != nil {
			return fmt.Errorf("coverage: speaking band out of range/off-grid: %w", err)
		}
		for _, c := range []struct {
			key string
			cr  model.AISpeakingGradeCriterion
		}{
			{grading.CriterionFluencyCoherence, res.Criteria.FluencyCoherence},
			{grading.CriterionLexicalResource, res.Criteria.LexicalResource},
			{grading.CriterionGrammaticalRange, res.Criteria.GrammaticalRange},
			{grading.CriterionPronunciation, res.Criteria.Pronunciation},
		} {
			if err := checkCriterionMeta(c.key, c.cr.Rationale, c.cr.Confidence, wantLanguage); err != nil {
				return err
			}
		}
		return checkCorpusLanguage(SpeakingFeedbackTexts(res), wantLanguage)
	default:
		return fmt.Errorf("coverage: unknown skill %q", skill)
	}
}

// checkCorpusLanguage enforces the English-only (DD6) output rule across the WHOLE feedback
// corpus — not only the per-criterion rationales. Comments / moments / transcript / overall
// feedback are user-facing output too, so Vietnamese leaking into any of them is a coverage
// failure (AC3/DD6). Empty strings are skipped.
func checkCorpusLanguage(texts []string, wantLanguage string) error {
	for _, text := range texts {
		if strings.TrimSpace(text) == "" {
			continue
		}
		if !matchesLanguage(text, wantLanguage) {
			return fmt.Errorf("coverage: feedback text is not in the expected language %q", wantLanguage)
		}
	}
	return nil
}

// checkCriterionMeta enforces the non-band coverage rules for one criterion: a non-empty
// rationale, a confidence ∈ {high, medium}, in the requested language.
func checkCriterionMeta(key, rationale, confidence, wantLanguage string) error {
	if strings.TrimSpace(rationale) == "" {
		return fmt.Errorf("coverage: criterion %s has an empty rationale", key)
	}
	if confidence != model.AIConfidenceHigh && confidence != model.AIConfidenceMedium {
		return fmt.Errorf("coverage: criterion %s confidence %q not in {high, medium}", key, confidence)
	}
	if !matchesLanguage(rationale, wantLanguage) {
		return fmt.Errorf("coverage: criterion %s rationale is not in the expected language %q", key, wantLanguage)
	}
	return nil
}

// --- AC4: feedback safety ---

// SafetyResult is the feedback-safety outcome. PIIFindings + URLFindings are HARD gates
// (Pass is false if either is non-empty). ReviewSamples are possible fabricated citations
// surfaced for HUMAN review — NEVER a machine gate (the heuristic has unstatable
// precision; gating it manufactures a false green, Murat R5).
type SafetyResult struct {
	PIIFindings   []string
	URLFindings   []string
	ReviewSamples []string
	Pass          bool
}

var (
	// urlPattern matches an explicit scheme/www link or a crisp bare domain in a small
	// TLD allow-set — low false-positive on English IELTS feedback, which should contain
	// no links at all (AC4).
	urlPattern = regexp.MustCompile(`(?i)(https?://|www\.)\S+|\b[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.(?:com|net|org|edu|io|vn|ai|co\.uk)\b`)
	// citationPattern surfaces phrases that often precede a fabricated external citation.
	// NOT a gate — surfaced for human review only (a grader quoting the student's own
	// sentence legitimately uses "according to", so a regex here flags good feedback).
	citationPattern = regexp.MustCompile(`(?i)\b(according to|research shows|studies show|a study by|et al\.?|as cited in)\b`)
)

// FeedbackSafety scans every feedback/rationale/comment string for the sample's known PII
// probes (value-scan, case-insensitive substring — never key-scan) and for any URL/domain,
// both HARD gates; it additionally surfaces possible fabricated citations as human-review
// samples (NOT a gate). texts is the flattened feedback corpus for one graded sample.
func FeedbackSafety(texts, piiProbes []string) SafetyResult {
	out := SafetyResult{}
	for _, text := range texts {
		for _, probe := range piiProbes {
			probe = strings.TrimSpace(probe)
			if probe == "" {
				continue
			}
			if piiProbeMatches(text, probe) {
				// R-11-6: the finding names the matched probe but does NOT echo the surrounding
				// feedback — the report is persisted to disk, so re-leaking the student text the
				// gate exists to protect is self-defeating. The probe value is already known.
				out.PIIFindings = append(out.PIIFindings, fmt.Sprintf("PII probe %q appears in feedback (content redacted — R-11-6)", probe))
			}
		}
		for _, match := range urlPattern.FindAllString(text, -1) {
			out.URLFindings = append(out.URLFindings, fmt.Sprintf("URL/domain %q in feedback (content redacted — R-11-6)", match))
		}
		if citationPattern.MatchString(text) {
			// A possible fabricated citation is a HUMAN-review aid (not a gate) and needs the
			// surrounding phrase to action — it is citation wording, not a PII probe hit.
			out.ReviewSamples = append(out.ReviewSamples, fmt.Sprintf("possible fabricated citation (HUMAN review, not a gate): %q", snippet(text)))
		}
	}
	out.Pass = len(out.PIIFindings) == 0 && len(out.URLFindings) == 0
	return out
}

// shortProbeMaxRunes is the length at or below which an ASCII-alphabetic PII probe is matched
// on WORD boundaries rather than as a bare substring — a one/two-syllable Vietnamese given
// name ("An", "Le", "Ha") otherwise substring-matches inside ordinary English words ("an
// essay", "example"), manufacturing a false PII finding that wedges the gate (AC4).
const shortProbeMaxRunes = 3

// piiProbeMatches reports whether probe appears in text as leaked PII. Short all-ASCII-letter
// probes match only on word boundaries (false-positive guard); everything else — multi-word
// names, emails, phone numbers, any probe with non-ASCII runes — uses a case-insensitive
// substring value-scan (the project convention: scan the VALUE, never the key).
func piiProbeMatches(text, probe string) bool {
	if isASCIIAlpha(probe) && len([]rune(probe)) <= shortProbeMaxRunes {
		return regexp.MustCompile(`(?i)\b` + regexp.QuoteMeta(probe) + `\b`).MatchString(text)
	}
	return strings.Contains(strings.ToLower(text), strings.ToLower(probe))
}

// isASCIIAlpha reports whether s is non-empty and every rune is an ASCII letter.
func isASCIIAlpha(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		if (r < 'a' || r > 'z') && (r < 'A' || r > 'Z') {
			return false
		}
	}
	return true
}

// --- result → map/overall/text extractors (pure; model + grading only) ---

// WritingCriteriaMap extracts the four writing criterion bands keyed by the grading
// criterion-key constants (the shape BandAccuracy + the manifest's examinerCriteria use).
func WritingCriteriaMap(res model.AIWritingGradeResult) map[string]float64 {
	return map[string]float64{
		grading.CriterionTaskResponse:      res.Criteria.TaskResponse.Band,
		grading.CriterionCoherenceCohesion: res.Criteria.CoherenceCohesion.Band,
		grading.CriterionLexicalResource:   res.Criteria.LexicalResource.Band,
		grading.CriterionGrammaticalRange:  res.Criteria.GrammaticalRange.Band,
	}
}

// SpeakingCriteriaMap extracts the four speaking criterion bands keyed by the grading
// criterion-key constants.
func SpeakingCriteriaMap(res model.AISpeakingGradeResult) map[string]float64 {
	return map[string]float64{
		grading.CriterionFluencyCoherence: res.Criteria.FluencyCoherence.Band,
		grading.CriterionLexicalResource:  res.Criteria.LexicalResource.Band,
		grading.CriterionGrammaticalRange: res.Criteria.GrammaticalRange.Band,
		grading.CriterionPronunciation:    res.Criteria.Pronunciation.Band,
	}
}

// WritingOverall computes the server-authoritative overall writing band from the four
// criteria via the SHIPPED scorer (grading.OverallBandFromFour) in the SHIPPED criterion
// order — the value compared to the examiner's overall. The harness NEVER re-implements
// the rounding rule (DD1).
func WritingOverall(res model.AIWritingGradeResult) float64 {
	return grading.OverallBandFromFour([4]float64{
		res.Criteria.TaskResponse.Band,
		res.Criteria.CoherenceCohesion.Band,
		res.Criteria.LexicalResource.Band,
		res.Criteria.GrammaticalRange.Band,
	}).Float()
}

// SpeakingOverall computes the overall speaking band via the shipped scorer in the
// shipped speaking criterion order (DD1).
func SpeakingOverall(res model.AISpeakingGradeResult) float64 {
	return grading.OverallBandFromFour([4]float64{
		res.Criteria.FluencyCoherence.Band,
		res.Criteria.LexicalResource.Band,
		res.Criteria.GrammaticalRange.Band,
		res.Criteria.Pronunciation.Band,
	}).Float()
}

// WritingFeedbackTexts flattens a writing result's feedback corpus (per-criterion
// rationales + comment texts + overall feedback) for FeedbackSafety + the language check.
func WritingFeedbackTexts(res model.AIWritingGradeResult) []string {
	texts := []string{
		res.Criteria.TaskResponse.Rationale,
		res.Criteria.CoherenceCohesion.Rationale,
		res.Criteria.LexicalResource.Rationale,
		res.Criteria.GrammaticalRange.Rationale,
	}
	for _, c := range res.Comments {
		texts = append(texts, c.Text)
	}
	if res.OverallFeedback != nil {
		texts = append(texts, *res.OverallFeedback)
	}
	return texts
}

// SpeakingFeedbackTexts flattens a speaking result's feedback corpus (per-criterion
// rationales + moment texts + transcript + overall feedback).
func SpeakingFeedbackTexts(res model.AISpeakingGradeResult) []string {
	texts := []string{
		res.Criteria.FluencyCoherence.Rationale,
		res.Criteria.LexicalResource.Rationale,
		res.Criteria.GrammaticalRange.Rationale,
		res.Criteria.Pronunciation.Rationale,
	}
	for _, m := range res.Moments {
		texts = append(texts, m.Text)
	}
	if res.Transcript != nil {
		texts = append(texts, *res.Transcript)
	}
	if res.OverallFeedback != nil {
		texts = append(texts, *res.OverallFeedback)
	}
	return texts
}

// --- small pure helpers ---

// sortedKeys returns m's keys sorted — for deterministic criterion iteration (Go map
// order is randomised).
func sortedKeys(m map[string]float64) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

func sortedSliceKeys(m map[string][]float64) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

// spread returns max − min of values (0 for <2 values).
func spread(values []float64) float64 {
	if len(values) < 2 {
		return 0
	}
	min, max := values[0], values[0]
	for _, v := range values[1:] {
		if v < min {
			min = v
		}
		if v > max {
			max = v
		}
	}
	return max - min
}

// populationStddev returns the population standard deviation of values (0 for <2 values).
func populationStddev(values []float64) float64 {
	n := len(values)
	if n < 2 {
		return 0
	}
	var sum float64
	for _, v := range values {
		sum += v
	}
	mean := sum / float64(n)
	var sqSum float64
	for _, v := range values {
		d := v - mean
		sqSum += d * d
	}
	return math.Sqrt(sqSum / float64(n))
}

// snippet trims a feedback string to a short, log-safe excerpt for findings. It is only
// ever used on the FINDING path (a probe already leaked or a URL already appeared), so the
// excerpt reveals nothing the gate hasn't already flagged.
func snippet(s string) string {
	const maxRunes = 80
	s = strings.TrimSpace(s)
	r := []rune(s)
	if len(r) <= maxRunes {
		return s
	}
	// Truncate on a rune boundary — a byte slice at maxRunes would split a multi-byte rune
	// (Vietnamese feedback is the likely content on this path) and emit invalid UTF-8.
	return string(r[:maxRunes]) + "…"
}

// matchesLanguage reports whether text is plausibly in lang. For "en" it returns false iff
// text contains Vietnamese-specific letters/diacritics; for "vi" it returns true iff it
// does. Any other lang is not gated (returns true) to avoid false positives. DD6: the
// product is English-only, so the only check that fires today is "English output contains
// no Vietnamese markers".
func matchesLanguage(text, lang string) bool {
	switch strings.ToLower(strings.TrimSpace(lang)) {
	case "", "en", "english":
		return !containsVietnamese(text)
	case "vi", "vn", "vietnamese":
		return containsVietnamese(text)
	default:
		return true
	}
}

// containsVietnamese reports whether s contains a Vietnamese-specific rune: the Latin
// Extended Additional block (U+1EA0–U+1EF9, almost entirely Vietnamese precomposed
// vowels), đ/Đ, ă/Ă, ơ/Ơ, ư/Ư, or a combining tone mark. English IELTS feedback contains
// none of these — a low-false-positive detector for the English-only product (DD6).
//
// s is normalized to NFC first. Without it the gate was wrong in BOTH directions: decomposed
// Vietnamese (base vowel + combining circumflex/breve/horn, U+0302/0306/031B) was MISSED
// because only the precomposed ranges are scanned, and decomposed English/French accents
// (café, résumé — base + combining acute/grave) FALSE-POSITIVED on the shared combining-mark
// cases below, failing a good grader. NFC composes both forms to their precomposed code
// points: Vietnamese vowels land in the ranges below; a plain accented Latin letter composes
// to U+00E9/U+00F4/etc., which are deliberately NOT flagged. Gemini output is NFC in practice.
func containsVietnamese(s string) bool {
	for _, r := range norm.NFC.String(s) {
		switch {
		case r >= 0x1EA0 && r <= 0x1EF9:
			return true
		case r == 0x0110 || r == 0x0111: // Đ đ
			return true
		case r == 0x0102 || r == 0x0103: // Ă ă
			return true
		case r == 0x01A0 || r == 0x01A1: // Ơ ơ
			return true
		case r == 0x01AF || r == 0x01B0: // Ư ư
			return true
		case r == 0x0300 || r == 0x0301 || r == 0x0303 || r == 0x0309 || r == 0x0323: // combining grave/acute/tilde/hook-above/dot-below
			return true
		}
	}
	return false
}
