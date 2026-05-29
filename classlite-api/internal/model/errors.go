package model

import "fmt"

// NotFoundError indicates a resource was not found.
type NotFoundError struct {
	Resource string
	ID       string
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
type FieldError struct {
	Field   string `json:"field"`
	Message string `json:"message"`
}

func (e ValidationError) Error() string {
	return "validation failed"
}
