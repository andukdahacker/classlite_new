package model

import "github.com/google/uuid"

// NewID returns a v4 UUID. Use this instead of pgx.UUID{} + gen_random_uuid()
// SQL defaults when a tx needs the ID before the INSERT (e.g. SET LOCAL runs
// against the new tenant ID before the row exists).
func NewID() uuid.UUID { return uuid.New() }
