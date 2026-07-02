package model

import "context"

// TenantContext carries tenant identity for every store method.
// Every store method MUST accept TenantContext — missing it compiles clean
// but leaks data across tenants via RLS bypass.
//
// EmailVerified mirrors users.email_verified at the moment ExtractTenant ran.
// It powers RequireVerifiedEmail without a second GetUserByID call — the
// middleware becomes a pure context check (Story 2.1 Task 5.0 / Task 5.1).
type TenantContext struct {
	CenterID      string
	UserID        string
	Role          string
	EmailVerified bool
}

// tenantCtxKey is the typed context key used by middleware.ExtractTenant
// and read by both middleware.RequireRole and handler.AdminHandler.
// Exported via WithTenantContext / TenantFromContext to keep the key
// itself unreachable from outside this file.
type tenantCtxKey struct{}

// WithTenantContext writes a TenantContext into ctx under the canonical
// model-level key. Use this from middleware to inject the tenant; use
// TenantFromContext to read it from handlers / service code.
func WithTenantContext(ctx context.Context, tc TenantContext) context.Context {
	return context.WithValue(ctx, tenantCtxKey{}, tc)
}

// TenantFromContext returns the TenantContext written by middleware,
// and (zero, false) if no middleware ran. Handlers should treat the
// "false" case as a programming bug (the route is wired without
// ExtractTenant); the canonical response is 500, not 401.
func TenantFromContext(ctx context.Context) (TenantContext, bool) {
	tc, ok := ctx.Value(tenantCtxKey{}).(TenantContext)
	return tc, ok
}
