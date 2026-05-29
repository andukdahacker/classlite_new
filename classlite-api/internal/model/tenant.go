package model

// TenantContext carries tenant identity for every store method.
// Every store method MUST accept TenantContext — missing it compiles clean
// but leaks data across tenants via RLS bypass.
type TenantContext struct {
	CenterID string
	UserID   string
	Role     string
}
