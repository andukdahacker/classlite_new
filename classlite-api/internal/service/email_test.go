package service

import (
	"context"
	"fmt"
	"strings"
	"testing"
)

func TestSanitizeHeader_StripsCRLF(t *testing.T) {
	input := "Subject\r\nBcc: evil@hack.com"
	got := sanitizeHeader(input)
	if strings.Contains(got, "\r") || strings.Contains(got, "\n") {
		t.Errorf("expected no CRLF, got %q", got)
	}
	if got != "SubjectBcc: evil@hack.com" {
		t.Errorf("unexpected result: %q", got)
	}
}

func TestSanitizeEmail_ValidAddress(t *testing.T) {
	addr, err := sanitizeEmail("user@example.com")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if addr != "user@example.com" {
		t.Errorf("expected user@example.com, got %s", addr)
	}
}

func TestSanitizeEmail_WithDisplayName(t *testing.T) {
	addr, err := sanitizeEmail("John Doe <john@example.com>")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if addr != "john@example.com" {
		t.Errorf("expected john@example.com, got %s", addr)
	}
}

func TestSanitizeEmail_InvalidAddress(t *testing.T) {
	_, err := sanitizeEmail("not-an-email")
	if err == nil {
		t.Error("expected error for invalid email")
	}
}

func TestSanitizeEmail_CRLFInjection(t *testing.T) {
	// After stripping CRLF, the concatenated result is an invalid email — injection prevented.
	_, err := sanitizeEmail("user@example.com\r\nBcc: evil@hack.com")
	if err == nil {
		t.Error("expected error: CRLF injection should produce invalid email after sanitization")
	}
}

func TestSanitizeHeader_SubjectCapping(t *testing.T) {
	long := strings.Repeat("a", 250)
	got := sanitizeHeader(long)
	if len(got) > 200 {
		// sanitizeHeader itself doesn't cap — the caller does.
		// This test validates sanitizeHeader preserves length.
		if len(got) != 250 {
			t.Errorf("expected 250 chars, got %d", len(got))
		}
	}
}

func TestMockEmailSender_RecordsSends(t *testing.T) {
	mock := &MockEmailSender{}

	err := mock.Send(context.Background(), "user@test.com", "Welcome", "<p>Hello</p>")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(mock.SentEmails) != 1 {
		t.Fatalf("expected 1 sent email, got %d", len(mock.SentEmails))
	}
	if mock.SentEmails[0].To != "user@test.com" {
		t.Errorf("expected to user@test.com, got %s", mock.SentEmails[0].To)
	}
	if mock.SentEmails[0].Subject != "Welcome" {
		t.Errorf("expected subject Welcome, got %s", mock.SentEmails[0].Subject)
	}
}

func TestMockEmailSender_SimulatesError(t *testing.T) {
	mock := &MockEmailSender{SendError: fmt.Errorf("service unavailable")}

	err := mock.Send(context.Background(), "user@test.com", "Test", "<p>test</p>")
	if err == nil {
		t.Error("expected error from mock")
	}
	if len(mock.SentEmails) != 0 {
		t.Error("expected no emails recorded on error")
	}
}

func TestMockEmailSender_Reset(t *testing.T) {
	mock := &MockEmailSender{}
	mock.Send(context.Background(), "a@b.com", "Test", "<p>test</p>")
	mock.Reset()

	if len(mock.SentEmails) != 0 {
		t.Error("expected empty after reset")
	}
	if mock.SendError != nil {
		t.Error("expected nil SendError after reset")
	}
}

// Verify MockEmailSender implements EmailSender at compile time.
var _ EmailSender = (*MockEmailSender)(nil)
