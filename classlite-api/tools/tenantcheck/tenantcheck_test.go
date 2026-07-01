package tenantcheck_test

import (
	"testing"

	"github.com/ducdo/classlite-api/tools/tenantcheck"
	"golang.org/x/tools/go/analysis/analysistest"
)

// TestAnalyzer is the "teeth check" — it runs the analyzer against
// two synthetic packages under testdata/ and asserts that every
// expected diagnostic fires (via `// want "..."` comments in the
// fixtures) and no unexpected diagnostics fire.
//
// If this test regresses, the analyzer has lost its ability to catch
// GO-1 violations — which is the whole point of R1 mitigation A.
func TestAnalyzer(t *testing.T) {
	analysistest.Run(t, analysistest.TestData(), tenantcheck.Analyzer, "badstore", "goodstore")
}
