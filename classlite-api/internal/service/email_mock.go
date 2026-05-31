package service

import (
	"context"
	"sync"
)

// SentEmail records the parameters of a sent email for test assertions.
type SentEmail struct {
	To      string
	Subject string
	HTML    string
}

// MockEmailSender records email sends without making external API calls.
type MockEmailSender struct {
	mu         sync.Mutex
	SentEmails []SentEmail
	SendError  error // Set this to simulate send failures in tests.
}

// Send records the email parameters. Returns SendError if set.
func (m *MockEmailSender) Send(ctx context.Context, to, subject string, htmlBody string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.SendError != nil {
		return m.SendError
	}

	m.SentEmails = append(m.SentEmails, SentEmail{
		To:      to,
		Subject: subject,
		HTML:    htmlBody,
	})
	return nil
}

// Reset clears all recorded emails.
func (m *MockEmailSender) Reset() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.SentEmails = nil
	m.SendError = nil
}
