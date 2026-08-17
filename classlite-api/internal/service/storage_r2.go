package service

import (
	"context"
	"fmt"
	"io"
	"net/url"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/ducdo/classlite-api/internal/model"
)

// R2StorageService implements StorageService using Cloudflare R2 (S3-compatible).
type R2StorageService struct {
	client        *s3.Client
	presignClient *s3.PresignClient
	bucket        string
}

// NewR2StorageService creates a new R2-backed storage service.
func NewR2StorageService(accountID, accessKeyID, secretAccessKey, bucketName string) *R2StorageService {
	endpoint := fmt.Sprintf("https://%s.r2.cloudflarestorage.com", accountID)

	cfg := aws.Config{
		Region:       "auto",
		Credentials:  credentials.NewStaticCredentialsProvider(accessKeyID, secretAccessKey, ""),
		BaseEndpoint: aws.String(endpoint),
	}

	client := s3.NewFromConfig(cfg)
	presignClient := s3.NewPresignClient(client)

	return &R2StorageService{
		client:        client,
		presignClient: presignClient,
		bucket:        bucketName,
	}
}

// Presign generates a presigned PUT URL for direct browser upload to R2.
// Content-Type is locked in the presigned request (SEC-8).
func (s *R2StorageService) Presign(ctx context.Context, key, contentType string, expiry time.Duration) (string, error) {
	input := &s3.PutObjectInput{
		Bucket:      aws.String(s.bucket),
		Key:         aws.String(key),
		ContentType: aws.String(contentType),
	}

	result, err := s.presignClient.PresignPutObject(ctx, input, s3.WithPresignExpires(expiry))
	if err != nil {
		return "", fmt.Errorf("presign put object: %w", err)
	}
	return result.URL, nil
}

// PresignGet generates a short-lived presigned GET URL for direct browser
// download/preview (Story 4.4b). Bypasses RLS — the caller MUST have already
// enforced the tenant-key prefix guard (SEC-8).
func (s *R2StorageService) PresignGet(ctx context.Context, key string, expiry time.Duration, opts PresignGetOpts) (string, error) {
	input := &s3.GetObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(key),
	}
	if opts.Attachment {
		input.ResponseContentDisposition = aws.String(contentDisposition(opts.Filename))
	}

	result, err := s.presignClient.PresignGetObject(ctx, input, s3.WithPresignExpires(expiry))
	if err != nil {
		return "", fmt.Errorf("presign get object: %w", err)
	}
	return result.URL, nil
}

// PresignGetOwned enforces the SEC-8 owned-key prefix guard, then signs an inline
// GET (Story 5.5a). Delegates to the shared presignGetOwned so the prefix
// invariant is defined once.
func (s *R2StorageService) PresignGetOwned(ctx context.Context, key string, tc model.TenantContext, expiry time.Duration) (string, error) {
	return presignGetOwned(ctx, s, key, tc, expiry)
}

// contentDisposition builds an attachment Content-Disposition header value. The
// filename is carried via RFC 5987 `filename*=UTF-8”…` so Vietnamese (co-primary
// locale) and other non-ASCII names survive — a bare quoted `filename` may not
// legally hold UTF-8 bytes. Empty name → plain `attachment` (browser uses the
// key basename).
func contentDisposition(filename string) string {
	if filename == "" {
		return "attachment"
	}
	return "attachment; filename*=UTF-8''" + url.PathEscape(filename)
}

// HeadObject checks if an object exists in R2 and returns its metadata.
func (s *R2StorageService) HeadObject(ctx context.Context, key string) (*ObjectMeta, error) {
	input := &s3.HeadObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(key),
	}

	result, err := s.client.HeadObject(ctx, input)
	if err != nil {
		return nil, fmt.Errorf("head object %s: %w", key, err)
	}

	meta := &ObjectMeta{
		Key:  key,
		Size: aws.ToInt64(result.ContentLength),
	}
	if result.ContentType != nil {
		meta.ContentType = *result.ContentType
	}
	return meta, nil
}

// GetObject downloads the full object body from R2 (Story 2.7 server-side
// parse). Bypasses RLS — the caller MUST have already enforced the tenant-key
// prefix guard (SEC-8).
func (s *R2StorageService) GetObject(ctx context.Context, key string) ([]byte, error) {
	input := &s3.GetObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(key),
	}

	result, err := s.client.GetObject(ctx, input)
	if err != nil {
		return nil, fmt.Errorf("get object %s: %w", key, err)
	}
	defer func() { _ = result.Body.Close() }()

	// Bound the server-side read (code review P1). The bulk-import parser is the
	// only GetObject caller and caps files at maxImportFileBytes; LimitReader
	// (+1 byte so an over-cap object is still detectable by len) prevents a large
	// or decompression-bomb object from being read fully into memory. The
	// oversize check + typed 413 lives in the import service, which never masks
	// this as a 404 the way a raw download error is.
	body, err := io.ReadAll(io.LimitReader(result.Body, maxImportFileBytes+1))
	if err != nil {
		return nil, fmt.Errorf("read object %s body: %w", key, err)
	}
	return body, nil
}

// Delete removes an object from R2 (Story 4.4a — confirm delete-on-mismatch /
// storage-full cleanup). S3 DeleteObject is idempotent (deleting an absent key
// is not an error), which is the right semantics for best-effort cleanup.
func (s *R2StorageService) Delete(ctx context.Context, key string) error {
	_, err := s.client.DeleteObject(ctx, &s3.DeleteObjectInput{
		Bucket: aws.String(s.bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		return fmt.Errorf("delete object %s: %w", key, err)
	}
	return nil
}
