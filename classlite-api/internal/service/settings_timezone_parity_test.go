// Story 2-5a — cross-package parity test.
//
// The IANA timezone whitelist is duplicated across two languages:
//   - Go:  internal/service/settings_timezone.go
//   - TS:  classlite-web/src/features/settings/lib/timezoneWhitelist.ts
//
// This test reads the TS file at runtime, regex-extracts the string
// literals, and asserts the set matches Go's SupportedTimezones. Drift is
// caught at CI time BEFORE it can produce mismatched 422 UNSUPPORTED_TIMEZONE
// vs UI-selectable options (Winston-S8 fold).
package service_test

import (
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"testing"

	"github.com/ducdo/classlite-api/internal/service"
)

func TestSupportedTimezones_ParityWithFrontendWhitelist(t *testing.T) {
	tsPath := filepath.Join("..", "..", "..", "classlite-web", "src", "features", "settings", "lib", "timezoneWhitelist.ts")
	data, err := os.ReadFile(tsPath)
	if err != nil {
		t.Fatalf("read TS whitelist %s: %v", tsPath, err)
	}

	// Extract every quoted IANA-shaped string ("Region/City"). The whitelist
	// file may include headers, comments, or type annotations — pinning on
	// the shape "Word/Word" reliably picks up the entries and skips noise.
	re := regexp.MustCompile(`"([A-Z][a-zA-Z_]+/[A-Z][a-zA-Z_]+)"`)
	matches := re.FindAllStringSubmatch(string(data), -1)
	if len(matches) == 0 {
		t.Fatalf("no IANA-shaped strings found in %s", tsPath)
	}

	tsSet := map[string]struct{}{}
	for _, m := range matches {
		tsSet[m[1]] = struct{}{}
	}

	goSet := map[string]struct{}{}
	for _, tz := range service.SupportedTimezones {
		goSet[tz] = struct{}{}
	}

	assertSetsEqual(t, "Go SupportedTimezones", goSet, "TS timezoneWhitelist", tsSet)

	if len(service.SupportedTimezones) != 30 {
		t.Errorf("Go SupportedTimezones expected 30 entries per story Dev Notes, got %d", len(service.SupportedTimezones))
	}
	if len(tsSet) != 30 {
		t.Errorf("TS timezoneWhitelist expected 30 entries per story Dev Notes, got %d", len(tsSet))
	}
}

func assertSetsEqual(t *testing.T, aLabel string, a map[string]struct{}, bLabel string, b map[string]struct{}) {
	t.Helper()
	var missingInA, missingInB []string
	for k := range b {
		if _, ok := a[k]; !ok {
			missingInA = append(missingInA, k)
		}
	}
	for k := range a {
		if _, ok := b[k]; !ok {
			missingInB = append(missingInB, k)
		}
	}
	sort.Strings(missingInA)
	sort.Strings(missingInB)
	if len(missingInA) > 0 {
		t.Errorf("%s missing entries present in %s: %v", aLabel, bLabel, missingInA)
	}
	if len(missingInB) > 0 {
		t.Errorf("%s missing entries present in %s: %v", bLabel, aLabel, missingInB)
	}
}
