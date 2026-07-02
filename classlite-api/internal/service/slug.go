// Package service — Story 2.1 slug generator.
//
// Slugify turns a center name into a URL-safe short_code. Vietnamese input
// is ~90% of real traffic (project-context UX-2), so the pipeline is:
//
//   NFKC → NFD → strip combining marks → hard-map non-decomposing chars
//        → lowercase → replace whitespace with '-' → strip non-[a-z0-9-]
//        → collapse repeated '-' → trim '-' → truncate to 30 → trim '-' again
//
// Naïve strings.Map(unicode.IsLower)-style pipelines produce garbage like
// `trung-t-m-anh-ng-...` for `Trung tâm Anh ngữ Sài Gòn`. The AC5b canonical
// test set (slug_atdd_test.go) is the authoritative contract for this file.
//
// Fallback: Slugify returns "" when the input is empty-after-strip (e.g.
// `!!!`). The caller (CenterService.CreateCenter step 5) falls back to
// `"center-" + RandomSuffix(6)`.
package service

import (
	"crypto/rand"
	"math/big"
	"strings"
	"unicode"

	"golang.org/x/text/unicode/norm"
)

const slugMaxLen = 30

// nonDecomposingDiacritics maps characters that do NOT decompose via NFD.
// Vietnamese `đ`/`Đ` are the load-bearing entries — every other Vietnamese
// tone is a combining mark that NFD strips.
var nonDecomposingDiacritics = map[rune]string{
	'đ': "d",
	'Đ': "D",
	'ø': "o",
	'Ø': "O",
	'æ': "ae",
	'Æ': "AE",
}

// Slugify converts a display name into a lowercase, hyphen-separated,
// ASCII-only slug capped at slugMaxLen characters. See package doc for the
// pipeline.
func Slugify(name string) string {
	// 1. NFKC first — collapse compat forms like fullwidth ASCII.
	s := norm.NFKC.String(name)
	// 2. NFD decomposes base + combining marks; strip the marks.
	s = norm.NFD.String(s)
	var b strings.Builder
	b.Grow(len(s))
	for _, r := range s {
		if unicode.IsMark(r) {
			continue
		}
		if mapped, ok := nonDecomposingDiacritics[r]; ok {
			b.WriteString(mapped)
			continue
		}
		b.WriteRune(r)
	}
	s = strings.ToLower(b.String())

	// 3. Replace anything not [a-z0-9] with '-'.
	var out strings.Builder
	out.Grow(len(s))
	for _, r := range s {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			out.WriteRune(r)
		default:
			out.WriteRune('-')
		}
	}
	s = out.String()

	// 4. Collapse `--+` to single `-` and trim.
	for strings.Contains(s, "--") {
		s = strings.ReplaceAll(s, "--", "-")
	}
	s = strings.Trim(s, "-")

	// 5. Truncate to slugMaxLen and trim any trailing hyphen exposed by the cut.
	if len(s) > slugMaxLen {
		s = s[:slugMaxLen]
	}
	s = strings.TrimRight(s, "-")

	return s
}

// randomSuffixAlphabet is Crockford base32 (lowercased) — 10 digits + 22
// letters (a-z minus i, l, o, u). AC5's "4-char base32" contract resolves to
// this alphabet.
const randomSuffixAlphabet = "0123456789abcdefghjkmnpqrstvwxyz"

// randomSuffixAlphabetLen is the 32-character length of the Crockford
// alphabet used by RandomSuffix. Named constant so the rejection-sampling
// upper bound is explicit and can be checked at compile time via
// len(randomSuffixAlphabet).
const randomSuffixAlphabetLen = 32

// RandomSuffix returns a random n-char string drawn from randomSuffixAlphabet
// using crypto/rand + rejection sampling (via big.Int) so every alphabet slot
// is equiprobable — a naive `byte % 32` would waste every 8th draw but stay
// unbiased against a 32-slot alphabet; big.Int is used for future-proofing if
// the alphabet size changes to a non-power-of-two.
func RandomSuffix(n int) string {
	if n <= 0 {
		return ""
	}
	buf := make([]byte, n)
	max := big.NewInt(int64(randomSuffixAlphabetLen))
	for i := range buf {
		idx, err := rand.Int(rand.Reader, max)
		if err != nil {
			// crypto/rand backs io.ReadFull(/dev/urandom) on unix; an error
			// here means the OS's RNG is unusable and there's no meaningful
			// fallback.
			panic("service.RandomSuffix: crypto/rand failed: " + err.Error())
		}
		buf[i] = randomSuffixAlphabet[idx.Int64()]
	}
	return string(buf)
}
