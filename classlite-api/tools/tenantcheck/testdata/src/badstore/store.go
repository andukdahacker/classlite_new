package badstore

import "context"

type TenantContext struct{ CenterID string }

type StudentStore struct{}

func (s *StudentStore) GetByID(ctx context.Context, id string) (string, error) { // want "Store method GetByID must accept model.TenantContext"
	_ = ctx
	_ = id
	return "", nil
}

func (s *StudentStore) List(ctx context.Context, limit int, tc TenantContext) ([]string, error) { // want "Store method List must accept model.TenantContext"
	_ = ctx
	_ = limit
	_ = tc
	return nil, nil
}

func (s *StudentStore) NoParams() error { // want "Store method NoParams must accept context.Context"
	return nil
}

func (s *StudentStore) FirstParamNotContext(id string, tc TenantContext) error { // want "Store method FirstParamNotContext must accept context.Context"
	_ = id
	_ = tc
	return nil
}
