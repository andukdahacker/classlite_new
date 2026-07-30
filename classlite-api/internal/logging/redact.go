// Package logging provides a slog JSON handler that redacts presigned-storage
// URLs and their signatures before they reach the log sink (Story 4.4a AC10 /
// A10 #6). A presigned R2 URL grants time-boxed write access to a tenant's
// object key; if one lands in a log aggregator it is a leaked capability. The
// redactor is installed as the process-wide default handler so ANY call site —
// not just the upload paths — is covered (defense in depth): both the record's
// message string and every attribute value are scanned.
package logging

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"regexp"
)

// redactPattern matches the two S3-compatible storage hosts ClassLite uses and
// the AWS SigV4 credential-bearing query parameters. A string containing any of
// these is replaced wholesale — a signed URL is worthless in fragments, so
// blanking the whole value is both safe and simplest. X-Amz-Credential embeds
// the access-key ID and X-Amz-Security-Token a session credential, so both are
// redacted alongside the signature even when the host is absent from the string.
var redactPattern = regexp.MustCompile(`(?i)(s3\.amazonaws\.com|r2\.cloudflarestorage\.com|X-Amz-Signature|X-Amz-Credential|X-Amz-Security-Token)`)

// RedactedPlaceholder is substituted for any redacted attribute value.
const RedactedPlaceholder = "[REDACTED]"

// NewRedactingJSONHandler returns a slog JSON handler that masks presigned-URL /
// signature material in BOTH the log message and attribute values. Attribute
// redaction runs via ReplaceAttr (composing with, and after, any caller-supplied
// ReplaceAttr in opts); message redaction runs in the wrapping handler's Handle,
// since slog never routes the record's Message through ReplaceAttr.
func NewRedactingJSONHandler(w io.Writer, opts *slog.HandlerOptions) slog.Handler {
	base := &slog.HandlerOptions{}
	if opts != nil {
		*base = *opts
	}
	userReplace := base.ReplaceAttr
	base.ReplaceAttr = func(groups []string, a slog.Attr) slog.Attr {
		if userReplace != nil {
			a = userReplace(groups, a)
		}
		a.Value = redactValue(a.Value)
		return a
	}
	return redactingHandler{slog.NewJSONHandler(w, base)}
}

// redactingHandler wraps a slog.Handler to redact the record's Message string,
// which ReplaceAttr does not cover. Attribute redaction is handled by the
// embedded handler's ReplaceAttr (installed in NewRedactingJSONHandler).
type redactingHandler struct {
	slog.Handler
}

func (h redactingHandler) Handle(ctx context.Context, r slog.Record) error {
	if redactPattern.MatchString(r.Message) {
		r.Message = RedactedPlaceholder
	}
	return h.Handler.Handle(ctx, r)
}

// WithAttrs / WithGroup re-wrap so the message redaction survives derived
// loggers (the embedded handler's methods would otherwise drop the wrapper).
func (h redactingHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	return redactingHandler{h.Handler.WithAttrs(attrs)}
}

func (h redactingHandler) WithGroup(name string) slog.Handler {
	return redactingHandler{h.Handler.WithGroup(name)}
}

// redactValue masks a leaked URL/signature in a string, recurses into groups,
// and stringifies+scans arbitrary values (a struct or error that embeds a URL).
func redactValue(v slog.Value) slog.Value {
	switch v.Kind() {
	case slog.KindString:
		if redactPattern.MatchString(v.String()) {
			return slog.StringValue(RedactedPlaceholder)
		}
	case slog.KindGroup:
		attrs := v.Group()
		out := make([]slog.Attr, len(attrs))
		for i, at := range attrs {
			at.Value = redactValue(at.Value)
			out[i] = at
		}
		return slog.GroupValue(out...)
	case slog.KindAny:
		if s := fmt.Sprint(v.Any()); redactPattern.MatchString(s) {
			return slog.StringValue(RedactedPlaceholder)
		}
	}
	return v
}
