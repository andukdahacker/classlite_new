package model

type contextKey struct{ name string }

// Context keys — typed constants, never string literals (GFW-4).
var (
	RequestID = contextKey{"request_id"}
	TenantID  = contextKey{"tenant_id"}
	UserID    = contextKey{"user_id"}
	Role      = contextKey{"role"}
	IPAddress = contextKey{"ip_address"}
)
