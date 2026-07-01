package goodstore

import "context"

type TenantContext struct{ CenterID string }

type CenterStore struct{}

func (s *CenterStore) GetByID(ctx context.Context, tc TenantContext, id string) (string, error) {
	_ = ctx
	_ = tc
	_ = id
	return "", nil
}

func (s *CenterStore) Update(ctx context.Context, tc TenantContext, id, name string) error {
	_ = ctx
	_ = tc
	_ = id
	_ = name
	return nil
}

// Ping is allowlisted: health probe runs before RLS context is available.
//
// tenantcheck:allow
func (s *CenterStore) Ping(ctx context.Context) error {
	_ = ctx
	return nil
}

type Helper struct{}

func (h *Helper) DoStuff(id string) error {
	_ = id
	return nil
}
