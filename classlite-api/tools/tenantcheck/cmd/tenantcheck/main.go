// Command tenantcheck runs the tenantcheck analyzer as a standalone
// binary via singlechecker.Main. Invoke it in CI with:
//
//	go run ./tools/tenantcheck/cmd/tenantcheck ./internal/store/...
//
// Non-zero exit if any GO-1 violation is found.
package main

import (
	"github.com/ducdo/classlite-api/tools/tenantcheck"
	"golang.org/x/tools/go/analysis/singlechecker"
)

func main() {
	singlechecker.Main(tenantcheck.Analyzer)
}
