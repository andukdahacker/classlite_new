package model

type contextKey struct{ name string }

// Context keys — typed constants, never string literals (GFW-4).
//
// Role is intentionally absent: TenantContext.Role carries the DB-resolved
// role and is the canonical reader; a duplicate ctxkey would create a
// second source of truth. (The prior `Role = contextKey{"role"}` var was
// unused and removed by Story 2.6 when the shared roles vocabulary was
// added under the same identifier — see roles.go.)
var (
	RequestID = contextKey{"request_id"}
	TenantID  = contextKey{"tenant_id"}
	UserID    = contextKey{"user_id"}
	IPAddress = contextKey{"ip_address"}
)
