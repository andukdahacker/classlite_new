// Package tenantcheck implements a go/analysis Analyzer that enforces
// project-context.md GO-1: every method on a *Store type must accept
// context.Context as its first parameter and TenantContext as its second.
//
// Missing TenantContext means SET LOCAL app.current_tenant_id never runs,
// which causes silent RLS bypass and cross-tenant data leakage. Highest-
// severity trap in the stack per project-context.md — this analyzer's job
// is to make that trap uncompilable rather than only catchable at review.
//
// Allowlist a method by placing "tenantcheck:allow" anywhere in its Godoc
// comment (e.g. a health check, or a hand-rolled tenant-independent utility).
package tenantcheck

import (
	"go/ast"
	"go/types"
	"strings"

	"golang.org/x/tools/go/analysis"
)

const allowDirective = "tenantcheck:allow"

var Analyzer = &analysis.Analyzer{
	Name: "tenantcheck",
	Doc:  "checks that methods on types whose name ends in Store accept context.Context + TenantContext as their first two parameters (project-context GO-1)",
	Run:  run,
}

func run(pass *analysis.Pass) (interface{}, error) {
	for _, file := range pass.Files {
		for _, decl := range file.Decls {
			fn, ok := decl.(*ast.FuncDecl)
			if !ok || fn.Recv == nil || len(fn.Recv.List) == 0 {
				continue
			}
			if !strings.HasSuffix(receiverTypeName(fn.Recv.List[0].Type), "Store") {
				continue
			}
			if hasAllowDirective(fn.Doc) {
				continue
			}
			checkSignature(pass, fn)
		}
	}
	return nil, nil
}

func receiverTypeName(expr ast.Expr) string {
	switch t := expr.(type) {
	case *ast.StarExpr:
		return receiverTypeName(t.X)
	case *ast.Ident:
		return t.Name
	}
	return ""
}

func hasAllowDirective(doc *ast.CommentGroup) bool {
	if doc == nil {
		return false
	}
	for _, c := range doc.List {
		if strings.Contains(c.Text, allowDirective) {
			return true
		}
	}
	return false
}

func checkSignature(pass *analysis.Pass, fn *ast.FuncDecl) {
	flat := flattenParams(fn.Type.Params)

	if len(flat) == 0 || !isContextContext(pass, flat[0]) {
		pass.Reportf(fn.Pos(),
			"Store method %s must accept context.Context as its first parameter (project-context GO-1); allowlist with // tenantcheck:allow if genuinely tenant-independent",
			fn.Name.Name)
		return
	}
	if len(flat) < 2 || !isTenantContext(pass, flat[1]) {
		pass.Reportf(fn.Pos(),
			"Store method %s must accept model.TenantContext as its second parameter (after context.Context) — see project-context GO-1; missing TenantContext causes silent cross-tenant RLS bypass. Allowlist with // tenantcheck:allow if genuinely tenant-independent.",
			fn.Name.Name)
	}
}

// flattenParams turns *ast.FieldList into a positional slice of type exprs,
// expanding grouped params ("a, b int" → two entries) so we can address
// positions 0 and 1 regardless of grouping.
func flattenParams(list *ast.FieldList) []ast.Expr {
	if list == nil {
		return nil
	}
	var out []ast.Expr
	for _, field := range list.List {
		n := len(field.Names)
		if n == 0 {
			n = 1
		}
		for i := 0; i < n; i++ {
			out = append(out, field.Type)
		}
	}
	return out
}

func isContextContext(pass *analysis.Pass, expr ast.Expr) bool {
	t := pass.TypesInfo.TypeOf(expr)
	if t == nil {
		return false
	}
	named, ok := t.(*types.Named)
	if !ok {
		return false
	}
	obj := named.Obj()
	return obj != nil && obj.Name() == "Context" && obj.Pkg() != nil && obj.Pkg().Path() == "context"
}

// isTenantContext matches any named type called "TenantContext". We match
// on the name (not the exact package path) so the analyzer works against
// analysistest fixtures that define their own TenantContext type and
// against the real classlite-api/internal/model.TenantContext identically.
// The receiver-type-name suffix "Store" already scopes this narrowly
// enough that a false positive on some unrelated "TenantContext" type in
// a Store method is unlikely — and if it happened, it would still be a
// signature worth reviewing.
func isTenantContext(pass *analysis.Pass, expr ast.Expr) bool {
	t := pass.TypesInfo.TypeOf(expr)
	if t == nil {
		return false
	}
	named, ok := t.(*types.Named)
	if !ok {
		return false
	}
	obj := named.Obj()
	return obj != nil && obj.Name() == "TenantContext"
}
