package store_test

import (
	"context"
	"testing"

	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/store"
)

func TestNewPool_EmptyURL(t *testing.T) {
	_, err := store.NewPool(context.Background(), "")
	if err == nil {
		t.Error("expected error for empty database URL")
	}
}

func TestSetTenantContext_EmptyCenterID(t *testing.T) {
	tc := model.TenantContext{CenterID: "", UserID: "user-1", Role: "owner"}
	err := store.SetTenantContext(context.Background(), nil, tc)
	if err == nil {
		t.Error("expected error for empty center_id")
	}
}
