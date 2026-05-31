package service

import (
	"context"
	"time"
)

// ObjectMeta contains metadata about a stored object.
type ObjectMeta struct {
	Key         string `json:"key"`
	ContentType string `json:"contentType"`
	Size        int64  `json:"size"`
}

// StorageService abstracts object storage operations for presigned uploads.
type StorageService interface {
	// Presign generates a presigned PUT URL for direct browser upload.
	Presign(ctx context.Context, key, contentType string, expiry time.Duration) (string, error)

	// HeadObject checks if an object exists and returns its metadata.
	HeadObject(ctx context.Context, key string) (*ObjectMeta, error)
}
