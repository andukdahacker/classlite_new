package model

import "fmt"

// NotFoundError indicates a resource was not found.
// Code overrides the default "NOT_FOUND" error envelope code when set.
type NotFoundError struct {
	Resource string
	ID       string
	Code     string
}

func (e NotFoundError) Error() string {
	return fmt.Sprintf("%s %s not found", e.Resource, e.ID)
}

// ForbiddenError indicates an authorization failure.
type ForbiddenError struct {
	Reason string
}

func (e ForbiddenError) Error() string {
	return e.Reason
}

// ValidationError indicates one or more field validation failures.
type ValidationError struct {
	Fields []FieldError
}

// FieldError represents a single field validation failure.
// Code is optional — Story 2.2 introduced per-field UPPER_SNAKE_CASE codes
// (INVALID_TEACHER_EMAIL, SELF_INVITE_BLOCKED) so wizard UIs can route on
// stable identifiers instead of prose messages. Leaving Code empty stays
// backward-compatible with Story 1.4–2.1 handlers.
type FieldError struct {
	Field   string `json:"field"`
	Code    string `json:"code"`
	Message string `json:"message"`
}

func (e ValidationError) Error() string {
	return "validation failed"
}

// ConflictError indicates a resource conflict (e.g., duplicate).
// Code and Message override the default envelope when set.
type ConflictError struct {
	Resource string
	ID       string
	Code     string
	Message  string
}

func (e ConflictError) Error() string {
	if e.Message != "" {
		return e.Message
	}
	return fmt.Sprintf("%s %s already exists", e.Resource, e.ID)
}

// GoneError indicates a resource that once existed is no longer available
// (e.g., expired verification token). Maps to HTTP 410.
// Code is required — callers always set it explicitly.
type GoneError struct {
	Code   string
	Reason string
}

func (e GoneError) Error() string {
	return e.Reason
}
