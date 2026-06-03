package service_test

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
)

// nopBeginner satisfies the txBeginner interface for tests that exercise
// validation paths before any transaction is opened. Begin always errors so
// reaching it indicates a missing validation guard.
type nopBeginner struct{}

func (nopBeginner) Begin(_ context.Context) (pgx.Tx, error) {
	return nil, errors.New("nopBeginner.Begin should not be called")
}
