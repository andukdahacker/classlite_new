package service

import (
	"context"
	"fmt"
	"net/mail"
	"strings"

	"github.com/resend/resend-go/v2"
)

// ResendEmailSender sends emails via the Resend API.
type ResendEmailSender struct {
	client    *resend.Client
	fromEmail string
}

// NewResendEmailSender creates a new Resend-backed email sender.
// fromEmail is sanitized at construction per SEC-11.
func NewResendEmailSender(apiKey, fromEmail string) (*ResendEmailSender, error) {
	sanitizedFrom, err := sanitizeEmail(fromEmail)
	if err != nil {
		return nil, fmt.Errorf("invalid from email: %w", err)
	}
	return &ResendEmailSender{
		client:    resend.NewClient(apiKey),
		fromEmail: sanitizedFrom,
	}, nil
}

// Send delivers an email via Resend. Headers are sanitized per SEC-11.
func (s *ResendEmailSender) Send(ctx context.Context, to, subject string, htmlBody string) error {
	sanitizedTo, err := sanitizeEmail(to)
	if err != nil {
		return fmt.Errorf("send email: invalid to address: %w", err)
	}

	sanitizedSubject := sanitizeHeader(subject)
	subjectRunes := []rune(sanitizedSubject)
	if len(subjectRunes) > 200 {
		sanitizedSubject = string(subjectRunes[:200])
	}

	params := &resend.SendEmailRequest{
		From:    s.fromEmail,
		To:      []string{sanitizedTo},
		Subject: sanitizedSubject,
		Html:    htmlBody,
	}

	_, err = s.client.Emails.SendWithContext(ctx, params)
	if err != nil {
		return fmt.Errorf("send email via resend: %w", err)
	}
	return nil
}

// sanitizeEmail validates an email address using net/mail.ParseAddress
// and strips CRLF characters (SEC-11).
func sanitizeEmail(email string) (string, error) {
	cleaned := sanitizeHeader(email)
	addr, err := mail.ParseAddress(cleaned)
	if err != nil {
		return "", fmt.Errorf("parse email %q: %w", cleaned, err)
	}
	return addr.Address, nil
}

// sanitizeHeader strips \r and \n from header fields to prevent email header injection (SEC-11).
func sanitizeHeader(value string) string {
	r := strings.NewReplacer("\r", "", "\n", "")
	return r.Replace(value)
}
