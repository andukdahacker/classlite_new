package service

import "context"

// EmailSender abstracts email delivery, allowing provider swaps and test mocking.
type EmailSender interface {
	Send(ctx context.Context, to, subject string, htmlBody string) error
}
