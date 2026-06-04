package service

import (
	"strings"
	"testing"
)

func TestRenderVerificationEmail_IncludesURL(t *testing.T) {
	url := "https://my.classlite.app/verify-email?token=abc"
	_, body := RenderVerificationEmail("Alice", url)
	if !strings.Contains(body, url) {
		t.Errorf("body missing verify URL")
	}
}

func TestRenderVerificationEmail_EscapesFullName(t *testing.T) {
	_, body := RenderVerificationEmail("<script>alert('x')</script>", "https://x")
	if strings.Contains(body, "<script>alert") {
		t.Errorf("fullName not HTML-escaped: %s", body)
	}
	if !strings.Contains(body, "&lt;script&gt;") {
		t.Errorf("expected HTML-escaped fullName, got: %s", body)
	}
}

func TestRenderVerificationEmail_SubjectStable(t *testing.T) {
	subject, _ := RenderVerificationEmail("Alice", "https://x")
	if subject != VerificationEmailSubject {
		t.Errorf("subject changed: %s", subject)
	}
}

func TestRenderVerificationEmail_NoSecretsLeaked(t *testing.T) {
	// Body MUST NOT contain anything besides the verify URL + fullName.
	// In particular, no DB IDs or password material.
	_, body := RenderVerificationEmail("Alice", "https://my.classlite.app/verify-email?token=abc")
	forbidden := []string{"$2a$", "$2b$", "password_hash", "email_verifications.id"}
	for _, s := range forbidden {
		if strings.Contains(body, s) {
			t.Errorf("body unexpectedly contains %q", s)
		}
	}
}
