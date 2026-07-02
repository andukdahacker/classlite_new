// ATDD specimen for Story 2.1 — Slugify (Vietnamese-aware).
//
// Expected to FAIL against current codebase:
//   - service.Slugify does not exist yet
//   - service.RandomSuffix does not exist yet
//
// Coverage: AC5b canonical Vietnamese test set (Sally-S2 amendment) pinned
// as literal-string assertions. This test IS the acceptance contract —
// deviations from the Required Output column below are AC5b violations,
// not cosmetic differences.

package service_test

import (
	"testing"

	"github.com/ducdo/classlite-api/internal/service"
)

// -----------------------------------------------------------------------------
// AC5b — canonical Vietnamese slugify test set.
// -----------------------------------------------------------------------------

func TestSlugify_AC05b_CanonicalVietnameseSet(t *testing.T) {
	cases := []struct {
		name  string
		input string
		want  string
	}{
		// Realistic Vietnamese center names — the AC5b table verbatim.
		{"sai_gon_english_center", "Trung tâm Anh ngữ Sài Gòn", "trung-tam-anh-ngu-sai-gon"},
		{"vus_vietmy", "Anh Văn Hội Việt Mỹ", "anh-van-hoi-viet-my"},
		{"fpt_university", "Trường Đại học FPT", "truong-dai-hoc-fpt"},
		{"dh_foreign_lang", "ĐH Ngoại Ngữ", "dh-ngoai-ngu"},

		// Ampersand + English mix.
		{"english_beyond", "English & Beyond", "english-beyond"},

		// Whitespace collapsing.
		{"multi_space", "   Multi   space   ", "multi-space"},

		// All-punctuation edge case — caller MUST fall back to a random slug
		// (Task 7.2 step 5 says: `if Slugify(input) == "" { fallback = "center-" + RandomSuffix(6) }`).
		{"all_punctuation", "!!!", ""},

		// Additional realistic inputs used by the slug generator's diacritic map.
		// đ / Đ do NOT decompose in NFD — must be handled by the ~4-entry table
		// (Amelia-S2 fix). If Amelia forgets, these fail.
		{"leading_dai_hoc", "đại học", "dai-hoc"},
		{"leading_dai_hoc_upper", "ĐẠI HỌC", "dai-hoc"},

		// Tones that DO decompose in NFD — norm.NFD + unicode.IsMark strips these.
		{"cong_hoa", "Cộng Hòa", "cong-hoa"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := service.Slugify(tc.input)
			if got != tc.want {
				t.Errorf("Slugify(%q) = %q, want %q\n  (AC5b: canonical VN input pinned in story file — see FU-2-1-C for post-launch expansion)",
					tc.input, got, tc.want)
			}
		})
	}
}

func TestSlugify_AC05b_LengthCap30(t *testing.T) {
	// Truncate to 30 chars max, trim trailing hyphen after truncation.
	long := "Trung Tâm Anh Ngữ Chuyên Nghiệp Sài Gòn Việt Nam" // 47 chars
	got := service.Slugify(long)
	if len(got) > 30 {
		t.Errorf("Slugify length cap: got %d chars, max is 30 — %q", len(got), got)
	}
	// Trailing hyphen from truncation MUST be trimmed.
	if len(got) > 0 && got[len(got)-1] == '-' {
		t.Errorf("Slugify: truncated result MUST NOT end with '-', got %q", got)
	}
}

func TestRandomSuffix_AC05_LengthAndAlphabet(t *testing.T) {
	// RandomSuffix(4) = base32-lower, 4 chars, no confusables (per Task 7.2 step 5).
	seen := map[string]bool{}
	for i := 0; i < 100; i++ {
		s := service.RandomSuffix(4)
		if len(s) != 4 {
			t.Errorf("RandomSuffix(4) = %q, want 4 chars", s)
		}
		for _, r := range s {
			isLowerAlpha := r >= 'a' && r <= 'z'
			isDigit := r >= '0' && r <= '9'
			if !isLowerAlpha && !isDigit {
				t.Errorf("RandomSuffix charset: %q contains %q — must be [a-z0-9]", s, r)
			}
		}
		seen[s] = true
	}
	// Not a cryptographic test — just guard against a constant-return regression.
	if len(seen) < 30 {
		t.Errorf("RandomSuffix determinism smell: 100 calls produced %d unique values (< 30 = suspicious)", len(seen))
	}
}
