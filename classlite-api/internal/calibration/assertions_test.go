// Story 11-0b — AC5 the perturbation BOUNDARY-MATRIX self-test: the mandatory
// "assertions have teeth" control, UNTAGGED and CI-green (no Gemini, no DB). For EACH
// assertion it proves a CORRECT grade PASSES and a boundary-tuned MUTANT behaves at the
// threshold — so the harness cannot green-light a wrong grader (a vacuous-green harness is
// worse than none) and the assertions are proven independent (one does not mask a dead one).
//
// THRESHOLD RULING (Ducdo 2026-10-12): the per-criterion accuracy gate is INCLUSIVE —
// AbsDelta ≤ PerCriterionTol (1.0). AC1/DD5's "within 1.0, generous (examiners disagree
// ~0.5)" is authoritative over AC5's illustrative "off by exactly 1.0 must FAIL"; the
// teeth therefore straddle the threshold as 1.0-PASSES / 1.5-FAILS. The same inclusive
// reading applies to AC2 stability range (AC2 itself states "≤ 1.0"). Documented so a
// future reader does not "fix" the operator back to strict-less.
package calibration

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service/grading"
)

// examinerAnchor is a synthetic band-7 writing anchor's examiner criteria.
func examinerAnchor() map[string]float64 {
	return map[string]float64{
		grading.CriterionTaskResponse:      7.0,
		grading.CriterionCoherenceCohesion: 7.0,
		grading.CriterionLexicalResource:   7.0,
		grading.CriterionGrammaticalRange:  6.5,
	}
}

// --- AC5 accuracy teeth ---

func TestBandAccuracy_CorrectGradePasses(t *testing.T) {
	examiner := examinerAnchor()
	ai := examinerAnchor() // identical → exact match
	got := BandAccuracy("anchor", ai, examiner, 7.0, 7.0, PerCriterionTol, OverallBandTol)
	if !got.Pass {
		t.Fatalf("a perfect grade must PASS the per-criterion gate, got Pass=false (%+v)", got)
	}
	if got.MAE != 0 {
		t.Errorf("MAE for an exact match must be 0, got %.3f", got.MAE)
	}
	if !got.OverallPass {
		t.Errorf("overall delta 0 must pass the secondary check")
	}
	if got.OverScored {
		t.Errorf("an exact match must not be flagged over-scored")
	}
}

func TestBandAccuracy_PassingBoundaryMutants(t *testing.T) {
	examiner := examinerAnchor()
	// Off by 0.5 — within tolerance, PASSES.
	ai := examinerAnchor()
	ai[grading.CriterionTaskResponse] = 7.5
	if got := BandAccuracy("m", ai, examiner, 7.0, 7.0, PerCriterionTol, OverallBandTol); !got.Pass {
		t.Errorf("a criterion off by 0.5 must PASS (within ±1.0), got Pass=false")
	}
	// Off by EXACTLY 1.0 — at the inclusive threshold, PASSES (Ducdo ruling).
	ai = examinerAnchor()
	ai[grading.CriterionTaskResponse] = 8.0
	if got := BandAccuracy("m", ai, examiner, 7.5, 7.0, PerCriterionTol, OverallBandTol); !got.Pass {
		t.Errorf("a criterion off by exactly 1.0 must PASS (inclusive ≤1.0 gate), got Pass=false")
	}
}

func TestBandAccuracy_FailingBoundaryMutant(t *testing.T) {
	examiner := examinerAnchor()
	ai := examinerAnchor()
	ai[grading.CriterionTaskResponse] = 8.5 // off by 1.5 — just past the threshold → FAIL
	got := BandAccuracy("m", ai, examiner, 7.5, 7.0, PerCriterionTol, OverallBandTol)
	if got.Pass {
		t.Fatalf("a criterion off by 1.5 must FAIL the per-criterion gate, got Pass=true")
	}
	if got.WorstMiss.Criterion != grading.CriterionTaskResponse || got.WorstMiss.AbsDelta != 1.5 {
		t.Errorf("worst miss must name taskResponse @1.5, got %q @%.1f", got.WorstMiss.Criterion, got.WorstMiss.AbsDelta)
	}
}

func TestBandAccuracy_OverScoreDirectionAndMissingCriterion(t *testing.T) {
	examiner := examinerAnchor()
	// Over-score: AI overall above examiner → the commercially lethal direction flagged.
	if got := BandAccuracy("m", examinerAnchor(), examiner, 7.5, 7.0, PerCriterionTol, OverallBandTol); !got.OverScored {
		t.Errorf("AI overall 7.5 > examiner 7.0 must flag OverScored")
	}
	// A missing criterion must FAIL the gate naming it absent.
	ai := examinerAnchor()
	delete(ai, grading.CriterionGrammaticalRange)
	got := BandAccuracy("m", ai, examiner, 7.0, 7.0, PerCriterionTol, OverallBandTol)
	if got.Pass {
		t.Fatalf("a missing criterion must FAIL the per-criterion gate")
	}
	var sawAbsent bool
	for _, c := range got.Criteria {
		if c.Criterion == grading.CriterionGrammaticalRange && !c.Present {
			sawAbsent = true
		}
	}
	if !sawAbsent {
		t.Errorf("the missing criterion must be reported Present=false")
	}
}

// --- AC5 stability teeth ---

func stableRegrades(value float64) []float64 {
	return []float64{value, value, value, value, value}
}

func TestStability_PassingBoundary(t *testing.T) {
	// Each criterion spans ≤1.0; overall stddev small → PASS. One criterion spans EXACTLY
	// 1.0 (inclusive threshold) to prove the boundary passes.
	regrades := map[string][]float64{
		grading.CriterionTaskResponse:      {6.0, 6.0, 6.0, 7.0, 6.5}, // range exactly 1.0 → passes (inclusive)
		grading.CriterionCoherenceCohesion: stableRegrades(7.0),
		grading.CriterionLexicalResource:   stableRegrades(7.0),
		grading.CriterionGrammaticalRange:  stableRegrades(6.5),
	}
	overall := []float64{6.5, 6.5, 6.5, 6.5, 7.0} // stddev 0.2 ≤ 0.25
	got := Stability(regrades, overall, StabilityCriterionRangeTol, StabilityOverallStddevTol)
	if !got.Pass {
		t.Fatalf("a stable grader (range ≤1.0, stddev ≤0.25) must PASS, got %+v", got)
	}
}

func TestStability_FailingOnCriterionRange(t *testing.T) {
	regrades := map[string][]float64{
		grading.CriterionTaskResponse:      {6.0, 6.0, 6.0, 6.0, 7.5}, // range 1.5 → FAIL
		grading.CriterionCoherenceCohesion: stableRegrades(7.0),
		grading.CriterionLexicalResource:   stableRegrades(7.0),
		grading.CriterionGrammaticalRange:  stableRegrades(6.5),
	}
	overall := stableRegrades(6.5) // stddev 0 → stddev check alone would pass
	got := Stability(regrades, overall, StabilityCriterionRangeTol, StabilityOverallStddevTol)
	if got.Pass {
		t.Fatalf("a criterion regrade range of 1.5 must FAIL stability")
	}
	if got.CriterionPass {
		t.Errorf("CriterionPass must be false when a criterion range exceeds 1.0")
	}
	if !got.StddevPass {
		t.Errorf("stddev check should independently PASS here (overall values identical) — proves the two sub-gates are independent")
	}
}

func TestStability_FailingOnOverallStddev(t *testing.T) {
	regrades := map[string][]float64{
		grading.CriterionTaskResponse:      stableRegrades(7.0),
		grading.CriterionCoherenceCohesion: stableRegrades(7.0),
		grading.CriterionLexicalResource:   stableRegrades(7.0),
		grading.CriterionGrammaticalRange:  stableRegrades(6.5),
	}
	overall := []float64{6.0, 6.0, 7.0, 7.0, 6.5} // stddev ~0.447 > 0.25 → FAIL
	got := Stability(regrades, overall, StabilityCriterionRangeTol, StabilityOverallStddevTol)
	if got.Pass {
		t.Fatalf("an overall-band stddev of ~0.45 must FAIL stability")
	}
	if got.StddevPass {
		t.Errorf("StddevPass must be false for stddev > 0.25")
	}
	if !got.CriterionPass {
		t.Errorf("CriterionPass should independently PASS here (criterion ranges small) — proves independence")
	}
}

func TestStability_UnderMeasuredSeriesNeverPasses(t *testing.T) {
	// A transport-starved regrade run leaves 0-1 successful draws. spread()/populationStddev()
	// return 0 for <2 values, so without the Measured guard this would report a vacuous PASS
	// (false green for AC2). It must be Measured=false and Pass=false.
	single := map[string][]float64{
		grading.CriterionTaskResponse:      {7.0},
		grading.CriterionCoherenceCohesion: {7.0},
		grading.CriterionLexicalResource:   {7.0},
		grading.CriterionGrammaticalRange:  {6.5},
	}
	got := Stability(single, []float64{7.0}, StabilityCriterionRangeTol, StabilityOverallStddevTol)
	if got.Measured {
		t.Errorf("a 1-regrade series must report Measured=false, got true")
	}
	if got.Pass {
		t.Fatalf("a 1-regrade series must NOT pass stability (spread/stddev are a vacuous 0), got Pass=true")
	}
	// Empty series (every regrade transport-failed) likewise never passes.
	if empty := Stability(map[string][]float64{}, nil, StabilityCriterionRangeTol, StabilityOverallStddevTol); empty.Pass || empty.Measured {
		t.Errorf("an empty regrade series must be Measured=false and Pass=false, got %+v", empty)
	}
}

// --- AC5 coverage teeth (each failure independent) ---

// goodWritingResult builds a fully-covered English writing result for coverage tests.
func goodWritingResult() model.AIWritingGradeResult {
	crit := func(band float64) model.AIWritingGradeCriterion {
		return model.AIWritingGradeCriterion{Band: band, Rationale: "A clear, well-supported response.", Confidence: model.AIConfidenceHigh}
	}
	return model.AIWritingGradeResult{
		Criteria: model.AIWritingGradeCriteria{
			TaskResponse:      crit(7.0),
			CoherenceCohesion: crit(7.0),
			LexicalResource:   crit(7.0),
			GrammaticalRange:  crit(6.5),
		},
	}
}

func TestCriterionCoverage_CorrectResultPasses(t *testing.T) {
	if err := CriterionCoverage(grading.SkillWriting, goodWritingResult(), "en"); err != nil {
		t.Fatalf("a fully-covered English result must PASS coverage, got: %v", err)
	}
}

func TestCriterionCoverage_EmptyRationaleFails(t *testing.T) {
	res := goodWritingResult()
	res.Criteria.LexicalResource.Rationale = "   "
	err := CriterionCoverage(grading.SkillWriting, res, "en")
	if err == nil || !strings.Contains(err.Error(), grading.CriterionLexicalResource) {
		t.Fatalf("an empty rationale must FAIL coverage naming lexicalResource, got: %v", err)
	}
}

func TestCriterionCoverage_WrongLanguageFails(t *testing.T) {
	res := goodWritingResult()
	res.Criteria.TaskResponse.Rationale = "Bài viết của bạn rất tốt và rõ ràng." // Vietnamese against expected "en"
	err := CriterionCoverage(grading.SkillWriting, res, "en")
	if err == nil || !strings.Contains(err.Error(), "language") {
		t.Fatalf("a wrong-language rationale must FAIL coverage, got: %v", err)
	}
}

func TestCriterionCoverage_NullBandFails(t *testing.T) {
	res := goodWritingResult()
	res.Criteria.GrammaticalRange.Band = 0.0 // a missing/null band deserializes to the zero value
	err := CriterionCoverage(grading.SkillWriting, res, "en")
	if err == nil {
		t.Fatalf("a null/zero band must FAIL coverage (out of the 1.0–9.0 range)")
	}
}

func TestCriterionCoverage_BadConfidenceFails(t *testing.T) {
	res := goodWritingResult()
	res.Criteria.CoherenceCohesion.Confidence = "low" // not in {high, medium}
	err := CriterionCoverage(grading.SkillWriting, res, "en")
	if err == nil || !strings.Contains(err.Error(), grading.CriterionCoherenceCohesion) {
		t.Fatalf("a bad confidence must FAIL coverage naming coherenceCohesion, got: %v", err)
	}
}

func TestCriterionCoverage_VietnameseInOverallFeedbackFails(t *testing.T) {
	// P4: the language gate must scan the WHOLE corpus, not only per-criterion rationales.
	// Vietnamese in the overall feedback (rationales all English) must FAIL coverage.
	res := goodWritingResult()
	vn := "Bài viết của bạn rất tốt và rõ ràng."
	res.OverallFeedback = &vn
	if err := CriterionCoverage(grading.SkillWriting, res, "en"); err == nil || !strings.Contains(err.Error(), "language") {
		t.Fatalf("Vietnamese in overall feedback must FAIL coverage (corpus-wide language check), got: %v", err)
	}
}

func TestCriterionCoverage_DecomposedEnglishAccentPasses(t *testing.T) {
	// P5 (false-positive direction): a decomposed English/French loanword — "cafe" with the
	// accent as e + U+0301 combining acute — tripped the old bare combining-mark check and
	// failed a good grader. After NFC it composes to U+00E9 (not Vietnamese) and must PASS.
	// The \u escape guarantees the decomposed form (a source literal would be NFC already).
	res := goodWritingResult()
	res.Criteria.TaskResponse.Rationale = "The essay uses the word cafe\u0301 appropriately."
	if err := CriterionCoverage(grading.SkillWriting, res, "en"); err != nil {
		t.Fatalf("a decomposed English accent must not trip the Vietnamese language gate, got: %v", err)
	}
}

func TestContainsVietnamese_NFCBothDirections(t *testing.T) {
	// Escapes (not literals) guarantee the decomposed form reaches the function.
	// P5 (false-negative direction): decomposed VN vowel a + U+0302 circumflex + U+0301 acute
	// composes under NFC to U+1EA5 in the Vietnamese range — must be detected.
	if !containsVietnamese("a\u0302\u0301") {
		t.Errorf("decomposed Vietnamese vowel must be detected after NFC normalization")
	}
	// A decomposed English accent (e + U+0301) must NOT be flagged.
	if containsVietnamese("cafe\u0301") {
		t.Errorf("decomposed English accent must not be flagged as Vietnamese")
	}
	// A precomposed Vietnamese vowel in the detection range (U+1EA1, a with dot below) is caught.
	if !containsVietnamese("b\u1ea1n") {
		t.Errorf("precomposed Vietnamese must still be detected")
	}
}

// --- AC5 safety teeth ---

func TestFeedbackSafety_CleanPasses(t *testing.T) {
	got := FeedbackSafety([]string{"Your essay has a clear thesis and good range of vocabulary."}, []string{"Nguyen Van An"})
	if !got.Pass {
		t.Fatalf("clean feedback must PASS safety, got findings PII=%v URL=%v", got.PIIFindings, got.URLFindings)
	}
}

func TestFeedbackSafety_PIINameLeakFails(t *testing.T) {
	// value-scan: the probe value appears as a substring in the feedback text.
	got := FeedbackSafety([]string{"Overall, Nguyen Van An shows good control of grammar."}, []string{"Nguyen Van An"})
	if got.Pass || len(got.PIIFindings) == 0 {
		t.Fatalf("a leaked PII name must FAIL safety, got %+v", got)
	}
}

func TestFeedbackSafety_URLFails(t *testing.T) {
	got := FeedbackSafety([]string{"See http://example.com/grammar for more practice."}, nil)
	if got.Pass || len(got.URLFindings) == 0 {
		t.Fatalf("a URL in feedback must FAIL safety, got %+v", got)
	}
}

func TestFeedbackSafety_ShortProbeWordBoundaryAndRedaction(t *testing.T) {
	// P7: a short name probe ("Ly") must NOT substring-match inside ordinary English words
	// ("clearly", "really") — that false positive wedges the gate. ("Ly" is a VN given name
	// that is not itself an English word, unlike "An"/"Ha" which collide with real words — a
	// collision the word-boundary guard cannot resolve and does not claim to.)
	clean := FeedbackSafety([]string{"The student writes clearly and really well."}, []string{"Ly"})
	if !clean.Pass || len(clean.PIIFindings) != 0 {
		t.Fatalf("short probe %q must not substring-match inside English words, got %+v", "Ly", clean)
	}
	// …but a standalone occurrence of the name IS still caught.
	hit := FeedbackSafety([]string{"Overall, Ly writes with good control."}, []string{"Ly"})
	if hit.Pass || len(hit.PIIFindings) == 0 {
		t.Fatalf("a standalone short name must still be caught, got %+v", hit)
	}
	// D1/R-11-6: the finding names the probe but must NOT echo the surrounding feedback text.
	for _, f := range hit.PIIFindings {
		if strings.Contains(f, "good control") {
			t.Errorf("PII finding must not echo the feedback content (R-11-6 redaction), got: %q", f)
		}
	}
}

func TestFeedbackSafety_FabricatedCitationSurfacedNotGated(t *testing.T) {
	// A possible fabricated citation is surfaced for HUMAN review but NEVER gates (Murat
	// R5): the heuristic's precision is unstatable, so gating it manufactures a false green.
	got := FeedbackSafety([]string{"According to research, cohesion improves readability."}, nil)
	if !got.Pass {
		t.Fatalf("a possible fabricated citation must NOT fail the safety gate, got Pass=false")
	}
	if len(got.ReviewSamples) == 0 {
		t.Fatalf("a possible fabricated citation must be SURFACED as a human-review sample")
	}
}

// --- AC6 loader + hash verification ---

func TestLoadGoldSet_SyntheticAnchorsLoadAndVerify(t *testing.T) {
	set, err := loadFrom("") // "" → committed synthetic anchors under testdata/
	if err != nil {
		t.Fatalf("synthetic anchors must load + hash-verify clean, got: %v", err)
	}
	if set.UsingRealData {
		t.Errorf("the synthetic fallback must report UsingRealData=false")
	}
	if len(set.Samples) < 2 {
		t.Fatalf("expected ≥2 synthetic anchors, got %d", len(set.Samples))
	}
	if len(set.Writing()) == 0 {
		t.Errorf("expected at least one writing anchor")
	}
	for _, s := range set.Samples {
		if HashContent(s.Content) != s.ContentHash {
			t.Errorf("sample %s content does not match its manifest hash", s.ID)
		}
	}
}

func TestLoadGoldSet_HashMismatchIsHardError(t *testing.T) {
	// A silently-mutated dataset must be a HARD error, never a quiet re-baseline (AC6/DD2).
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "essay.txt"), []byte("the real content"), 0o644); err != nil {
		t.Fatal(err)
	}
	manifest := Manifest{Version: 1, Samples: []GoldSample{{
		ID: "tampered", Skill: grading.SkillWriting, Source: "center",
		ExaminerOverall:  6.0,
		ExaminerCriteria: examinerAnchor(), // valid in every respect except the hash under test
		Language:         "en",
		ContentRef:       "essay.txt",
		ContentHash:      "0000000000000000000000000000000000000000000000000000000000000000", // wrong on purpose
	}}}
	raw, _ := json.Marshal(manifest)
	if err := os.WriteFile(filepath.Join(dir, manifestFileName), raw, 0o644); err != nil {
		t.Fatal(err)
	}
	_, err := loadFrom(dir)
	if err == nil || !strings.Contains(err.Error(), "hash mismatch") {
		t.Fatalf("a content-hash mismatch must be a hard error, got: %v", err)
	}
}

func TestLoadGoldSet_UnknownSkillIsHardError(t *testing.T) {
	// A mistyped skill hash-verifies and loads, then bySkill silently drops it — never graded,
	// no error. The loader must reject it instead (P3/P8).
	dir := t.TempDir()
	content := []byte("an essay")
	if err := os.WriteFile(filepath.Join(dir, "essay.txt"), content, 0o644); err != nil {
		t.Fatal(err)
	}
	manifest := Manifest{Version: 1, Samples: []GoldSample{{
		ID: "typo", Skill: "writin", Source: "center", // mistyped skill
		ExaminerOverall:  6.0,
		ExaminerCriteria: examinerAnchor(),
		Language:         "en",
		ContentRef:       "essay.txt",
		ContentHash:      HashContent(content),
	}}}
	raw, _ := json.Marshal(manifest)
	if err := os.WriteFile(filepath.Join(dir, manifestFileName), raw, 0o644); err != nil {
		t.Fatal(err)
	}
	_, err := loadFrom(dir)
	if err == nil || !strings.Contains(err.Error(), "unknown skill") {
		t.Fatalf("a mistyped skill must be a hard load error (not a silent drop), got: %v", err)
	}
}

func TestLoadGoldSet_IncompleteExaminerCriteriaIsHardError(t *testing.T) {
	// A sample missing a criterion key passes BandAccuracy's HARD gate vacuously (the loop is
	// driven by the keys that ARE present). The loader must reject an incomplete set (P3).
	dir := t.TempDir()
	content := []byte("an essay")
	if err := os.WriteFile(filepath.Join(dir, "essay.txt"), content, 0o644); err != nil {
		t.Fatal(err)
	}
	partial := examinerAnchor()
	delete(partial, grading.CriterionGrammaticalRange) // only three of four
	manifest := Manifest{Version: 1, Samples: []GoldSample{{
		ID: "partial", Skill: grading.SkillWriting, Source: "center",
		ExaminerOverall:  6.0,
		ExaminerCriteria: partial,
		Language:         "en",
		ContentRef:       "essay.txt",
		ContentHash:      HashContent(content),
	}}}
	raw, _ := json.Marshal(manifest)
	if err := os.WriteFile(filepath.Join(dir, manifestFileName), raw, 0o644); err != nil {
		t.Fatal(err)
	}
	_, err := loadFrom(dir)
	if err == nil || !strings.Contains(err.Error(), "examinerCriteria") {
		t.Fatalf("an incomplete examinerCriteria set must be a hard load error, got: %v", err)
	}
}

func TestLoadGoldSet_RealDirHashMatchLoads(t *testing.T) {
	dir := t.TempDir()
	content := []byte("a correctly-hashed external sample")
	if err := os.WriteFile(filepath.Join(dir, "essay.txt"), content, 0o644); err != nil {
		t.Fatal(err)
	}
	manifest := Manifest{Version: 1, Samples: []GoldSample{{
		ID: "real-01", Skill: grading.SkillWriting, Source: "center",
		ExaminerOverall: 5.0, Language: "en",
		ExaminerCriteria: examinerAnchor(),
		ContentRef:       "essay.txt",
		ContentHash:      HashContent(content),
	}}}
	raw, _ := json.Marshal(manifest)
	if err := os.WriteFile(filepath.Join(dir, manifestFileName), raw, 0o644); err != nil {
		t.Fatal(err)
	}
	set, err := loadFrom(dir)
	if err != nil {
		t.Fatalf("a correctly-hashed external dataset must load, got: %v", err)
	}
	if !set.UsingRealData {
		t.Errorf("an external dataset dir must report UsingRealData=true")
	}
}
