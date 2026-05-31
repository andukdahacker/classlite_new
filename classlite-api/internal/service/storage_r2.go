package service

import (
	"context"
	"fmt"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

// R2StorageService implements StorageService using Cloudflare R2 (S3-compatible).
type R2StorageService struct {
	client       *s3.Client
	presignClient *s3.PresignClient
	bucket       string
}

// NewR2StorageService creates a new R2-backed storage service.
func NewR2StorageService(accountID, accessKeyID, secretAccessKey, bucketName string) *R2StorageService {
	endpoint := fmt.Sprintf("https://%s.r2.cloudflarestorage.com", accountID)

	cfg := aws.Config{
		Region:      "auto",
		Credentials: credentials.NewStaticCredentialsProvider(accessKeyID, secretAccessKey, ""),
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
