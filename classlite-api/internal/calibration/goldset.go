// Package calibration is the Story 11-0b AI-grading calibration harness: product
// evidence, not QA. It MEASURES the shipped 6-2a writing / 6-3b speaking grader
// against a frozen gold set of examiner-banded IELTS samples — it never reimplements
// the prompt, the parse, or the scorer (DD1). The grader is driven through its real
// worker handler + the real gemini.Client; this package only loads the gold set,
// computes the four R5 machine assertions over a graded result, and renders a report.
//
// IMPORT DISCIPLINE (Winston): the pure files in this package — goldset.go,
// assertions.go, report.go — depend on internal/model + internal/service/grading +
// stdlib ONLY. They MUST NOT import internal/test, internal/test/workers, or
// internal/worker. Those test-flavoured imports (the worker handler, SetupWorkerHarness,
// the real gemini.NewClient) live EXCLUSIVELY in the //go:build calibration run file
// (run_calibration_test.go) and in _test.go files. Keeping the split means the pure
// assertions stay untagged-unit-testable (AC5) and honest about production-vs-harness
// shape.
//
// R-11-6 / EDGE-4: raw student essays and copyrighted published samples are NEVER
// committed to the repo and NEVER logged. The committed synthetic anchor set carries
// no PII and no copyright; the real data lives ONLY under CALIBRATION_DATASET_DIR
// (gitignored) and the committed manifest carries examiner bands + metadata + per-sample
// content HASHES — never the raw content.
package calibration

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/ducdo/classlite-api/internal/service/grading"
)

// DatasetDirEnv names the env var pointing at the external (gitignored) real gold-set
// directory. When unset, the loader falls back to the committed synthetic anchors under
// testdata/ — which exercise the loader + hash mechanism in CI without any real data
// (DD2). The real-data run (Task 5) additionally requires this to be set (DD7).
const DatasetDirEnv = "CALIBRATION_DATASET_DIR"

// anchorsDir / manifestFileName / anchorsFileName locate the two manifest sources. The
// synthetic fallback manifest is testdata/goldset-anchors.json (resolved from the package
// dir, the house os.ReadFile/testdata idiom — there is no //go:embed anywhere in the
// repo). The real dataset's manifest is <CALIBRATION_DATASET_DIR>/manifest.json.
const (
	anchorsDir       = "testdata"
	anchorsFileName  = "goldset-anchors.json"
	manifestFileName = "manifest.json"
)

// GoldSample is one examiner-banded IELTS sample in the gold set. The examiner bands
// come from the manifest (DD2) — never from a grades row — so the harness is
// self-contained. ContentRef points at the sample's content file RELATIVE to the dataset
// root (never the content itself); ContentHash is the sha256 hex of that file's bytes,
// the "frozen" guarantee the loader verifies at run start (AC6). PIIProbes are the known
// name/email/phone strings that FeedbackSafety asserts never surface in the grader's
// feedback (AC4) — present on real samples, empty on synthetic anchors.
type GoldSample struct {
	ID               string             `json:"id"`
	Skill            string             `json:"skill"`    // grading.SkillWriting | grading.SkillSpeaking
	TaskType         string             `json:"taskType"` // e.g. "task2" — reported, not gated
	Source           string             `json:"source"`   // cambridge | idp | center
	ExaminerOverall  float64            `json:"examinerOverall"`
	ExaminerCriteria map[string]float64 `json:"examinerCriteria"` // keyed by the grading criterion-key constants
	Language         string             `json:"language"`         // the language the feedback is expected in (today: "en", DD6)
	ContentRef       string             `json:"contentRef"`       // essay-text file (writing) / audio key (speaking), relative to the dataset root
	ContentHash      string             `json:"contentHash"`      // sha256 hex of the content file — the frozen guarantee
	PIIProbes        []string           `json:"piiProbes"`        // known name/email/phone that must not appear in feedback (AC4)
}

// Manifest is the committed (or external) gold-set index: a version plus the samples.
// It carries examiner bands + hashes + metadata, NEVER raw content (DD2).
type Manifest struct {
	Version int          `json:"version"`
	Samples []GoldSample `json:"samples"`
}

// LoadedSample is a GoldSample paired with its (hash-verified) content bytes read from
// the dataset root. Content is the raw essay text (writing); for a real sample it is
// student PII-bearing work and MUST NOT be logged or committed (R-11-6).
type LoadedSample struct {
	GoldSample
	Content []byte
}

// LoadedSet is the outcome of a successful load: the samples with verified content, and
// whether the real external dataset (vs the synthetic fallback) was used.
type LoadedSet struct {
	UsingRealData bool
	Samples       []LoadedSample
}

// Writing returns only the writing samples (DD4 — the first real run covers writing;
// speaking is schema-ready but its dataset is deferred).
func (s LoadedSet) Writing() []LoadedSample { return s.bySkill(grading.SkillWriting) }

// Speaking returns only the speaking samples (schema-ready; dataset deferred, DD4).
func (s LoadedSet) Speaking() []LoadedSample { return s.bySkill(grading.SkillSpeaking) }

func (s LoadedSet) bySkill(skill string) []LoadedSample {
	out := make([]LoadedSample, 0, len(s.Samples))
	for _, sample := range s.Samples {
		if sample.Skill == skill {
			out = append(out, sample)
		}
	}
	return out
}

// criteriaForSkill returns the exact set of examiner criterion keys a sample of the given
// skill must carry (the shipped grader's four criteria). The second return is false for an
// unrecognised skill.
func criteriaForSkill(skill string) ([]string, bool) {
	switch skill {
	case grading.SkillWriting:
		return []string{
			grading.CriterionTaskResponse,
			grading.CriterionCoherenceCohesion,
			grading.CriterionLexicalResource,
			grading.CriterionGrammaticalRange,
		}, true
	case grading.SkillSpeaking:
		return []string{
			grading.CriterionFluencyCoherence,
			grading.CriterionLexicalResource,
			grading.CriterionGrammaticalRange,
			grading.CriterionPronunciation,
		}, true
	default:
		return nil, false
	}
}

// validateSampleCriteria rejects a sample whose skill is unrecognised or whose
// examinerCriteria is not EXACTLY the four keys for that skill. Without this a mistyped skill
// ("writin") hash-verifies and loads but is then silently dropped by bySkill — never graded,
// no error — and a sample missing a criterion key passes BandAccuracy's HARD gate vacuously
// (the loop is driven by the examiner keys that ARE present). Both are false greens on the
// DONE evidence; this turns them into a hard load error (AC1/AC6/DD2).
func validateSampleCriteria(sample GoldSample) error {
	expected, known := criteriaForSkill(sample.Skill)
	if !known {
		return fmt.Errorf("gold sample %s: unknown skill %q (want %q or %q)",
			sample.ID, sample.Skill, grading.SkillWriting, grading.SkillSpeaking)
	}
	if len(sample.ExaminerCriteria) != len(expected) {
		return fmt.Errorf("gold sample %s: examinerCriteria has %d keys, want exactly %d for skill %s",
			sample.ID, len(sample.ExaminerCriteria), len(expected), sample.Skill)
	}
	for _, key := range expected {
		if _, ok := sample.ExaminerCriteria[key]; !ok {
			return fmt.Errorf("gold sample %s: examinerCriteria missing %q (skill %s requires all four criteria)",
				sample.ID, key, sample.Skill)
		}
	}
	return nil
}

// LoadGoldSet loads the gold set and VERIFIES every sample's content hash against the
// manifest before returning (AC6 — a silently-mutated local dataset is a HARD ERROR,
// never a quiet re-baseline, Murat/DD2). When CALIBRATION_DATASET_DIR is set it loads
// the real dataset from <dir>/manifest.json; otherwise it loads the committed synthetic
// anchors from testdata/goldset-anchors.json (which lets the loader + hash mechanism run
// green in CI with no real data).
//
// The returned bool on LoadedSet is true iff the real external dataset was used — the
// run harness (Task 5) uses it to distinguish a real-data pass from a mechanism-only
// synthetic run.
func LoadGoldSet() (LoadedSet, error) {
	return loadFrom(os.Getenv(DatasetDirEnv))
}

// loadFrom is the testable core of LoadGoldSet: datasetDir == "" selects the synthetic
// fallback; a non-empty datasetDir loads the real dataset from that directory.
func loadFrom(datasetDir string) (LoadedSet, error) {
	var root, manifestPath string
	usingReal := datasetDir != ""
	if usingReal {
		root = datasetDir
		manifestPath = filepath.Join(datasetDir, manifestFileName)
	} else {
		root = anchorsDir
		manifestPath = filepath.Join(anchorsDir, anchorsFileName)
	}

	rawManifest, err := os.ReadFile(manifestPath)
	if err != nil {
		return LoadedSet{}, fmt.Errorf("read gold-set manifest %s: %w", manifestPath, err)
	}
	var manifest Manifest
	if err := json.Unmarshal(rawManifest, &manifest); err != nil {
		return LoadedSet{}, fmt.Errorf("parse gold-set manifest %s: %w", manifestPath, err)
	}
	if len(manifest.Samples) == 0 {
		return LoadedSet{}, fmt.Errorf("gold-set manifest %s has no samples", manifestPath)
	}

	out := make([]LoadedSample, 0, len(manifest.Samples))
	for _, sample := range manifest.Samples {
		if sample.ContentRef == "" {
			return LoadedSet{}, fmt.Errorf("gold sample %s: empty contentRef", sample.ID)
		}
		if err := validateSampleCriteria(sample); err != nil {
			return LoadedSet{}, err
		}
		content, err := os.ReadFile(filepath.Join(root, sample.ContentRef))
		if err != nil {
			return LoadedSet{}, fmt.Errorf("gold sample %s: read content %s: %w", sample.ID, sample.ContentRef, err)
		}
		got := hashContent(content)
		if got != sample.ContentHash {
			// AC6: the frozen guarantee failed. Refuse to grade a mutated dataset — a
			// silent re-baseline would quietly erase the "this is the same set the
			// examiner banded" invariant (Murat/DD2). The raw content is NEVER echoed.
			return LoadedSet{}, fmt.Errorf(
				"gold sample %s: content hash mismatch (manifest %s, file %s) — refusing to run against a mutated dataset",
				sample.ID, sample.ContentHash, got)
		}
		out = append(out, LoadedSample{GoldSample: sample, Content: content})
	}
	return LoadedSet{UsingRealData: usingReal, Samples: out}, nil
}

// hashContent returns the sha256 hex digest of content — the frozen-sample fingerprint
// stored in the manifest and re-verified at load.
func hashContent(content []byte) string {
	sum := sha256.Sum256(content)
	return hex.EncodeToString(sum[:])
}

// HashContent is the exported digest helper so dataset authors (and the manual-setup
// doc's instructions) compute manifest hashes exactly the way the loader verifies them.
func HashContent(content []byte) string { return hashContent(content) }
