package model

type contextKey struct{ name string }

// RequestID is the context key for the request ID value.
// Typed constant — never use string literals for context keys (GFW-4).
var RequestID = contextKey{"request_id"}
