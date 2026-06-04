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

// Count returns the number of recorded sends under the mock's mutex so tests
// running alongside the retry worker do not race against Send writes.
func (m *MockEmailSender) Count() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.SentEmails)
}

// Snapshot returns a defensive copy of recorded sends under the mock's mutex.
// Callers may iterate the result without holding the lock.
func (m *MockEmailSender) Snapshot() []SentEmail {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]SentEmail, len(m.SentEmails))
	copy(out, m.SentEmails)
	return out
}
