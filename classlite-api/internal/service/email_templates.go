package service

import (
	"fmt"
	"html"
)

// VerificationEmailSubject is hard-coded — no user input ever reaches this string,
// keeping us safe from SEC-11 header-injection concerns (also defended in resend sender).
const VerificationEmailSubject = "Verify your ClassLite email address"

// PasswordResetEmailSubject is hard-coded for the same SEC-11 reason.
const PasswordResetEmailSubject = "Reset your ClassLite password"

// InviteEmailSubjectTemplate is the subject pattern. centerName is the
// only variable — held against SEC-11 by Resend's sanitization plus the
// MAX subject cap.
const InviteEmailSubjectTemplate = "You're invited to join %s on ClassLite"

// RenderInviteEmail produces subject + HTML body for the staff-invite
// email. acceptURL already carries the raw token; the body never echoes
// the token alone. centerName, inviterName, role are all HTML-escaped
// because they originate from user input on the Owner side.
//
// English-only — i18n is deferred to Story 1.8/1.9c (frontend swap to
// react-i18next). Story 1.6 just ships the template; the actual send is
// wired by Epic 7 (staff-management). Until then, the synthetic
// AdminInviteStaff hook produces invite rows but does not email.
func RenderInviteEmail(centerName, inviterName, role, acceptURL string) (subject, htmlBody string) {
	safeCenter := html.EscapeString(centerName)
	safeInviter := html.EscapeString(inviterName)
	safeRole := html.EscapeString(role)
	safeURL := html.EscapeString(acceptURL)

	subject = fmt.Sprintf(InviteEmailSubjectTemplate, centerName)

	body := fmt.Sprintf(`<!doctype html>
<html>
  <body style="font-family: -apple-system, system-ui, sans-serif; line-height: 1.5; color: #1f2937; background: #f9fafb; margin: 0; padding: 24px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="background: #ffffff; border-radius: 8px; max-width: 480px; width: 100%%; padding: 32px;">
      <tr>
        <td>
          <h1 style="font-size: 20px; margin: 0 0 16px;">You're invited to %s</h1>
          <p style="margin: 0 0 16px;">%s invited you to join their ClassLite center as a <strong>%s</strong>.</p>
          <p style="margin: 0 0 24px;">Accept the invite below to set up your account. This link is valid for 7 days.</p>
          <p style="text-align: center; margin: 0 0 24px;">
            <a href="%s" style="display: inline-block; background: #2563eb; color: #ffffff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600;">Accept invite</a>
          </p>
          <p style="font-size: 13px; color: #6b7280; margin: 0 0 8px;">If the button doesn't work, copy and paste this link into your browser:</p>
          <p style="font-size: 13px; word-break: break-all; margin: 0;"><a href="%s" style="color: #2563eb;">%s</a></p>
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
          <p style="font-size: 12px; color: #9ca3af; margin: 0;">If you weren't expecting this invite, you can safely ignore this email.</p>
        </td>
      </tr>
    </table>
  </body>
</html>`, safeCenter, safeInviter, safeRole, safeURL, safeURL, safeURL)

	return subject, body
}

// RenderVerificationEmail produces the subject + HTML body for the verification
// email sent on registration and resend. The body includes the verifyURL as
// both a styled button and a raw <a> for clients that don't render buttons.
//
// The fullName is HTML-escaped because it comes from user input. The verifyURL
// is constructed server-side from a vetted base URL plus a server-generated
// token, so it does not require escaping — but we escape the path for the
// human-readable fallback link anyway as defence in depth.
func RenderVerificationEmail(fullName, verifyURL string) (subject, htmlBody string) {
	safeName := html.EscapeString(fullName)
	safeURL := html.EscapeString(verifyURL)

	body := fmt.Sprintf(`<!doctype html>
<html>
  <body style="font-family: -apple-system, system-ui, sans-serif; line-height: 1.5; color: #1f2937; background: #f9fafb; margin: 0; padding: 24px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="background: #ffffff; border-radius: 8px; max-width: 480px; width: 100%%; padding: 32px;">
      <tr>
        <td>
          <h1 style="font-size: 20px; margin: 0 0 16px;">Welcome to ClassLite, %s</h1>
          <p style="margin: 0 0 24px;">Please verify your email address to finish setting up your account. This link is valid for 24 hours.</p>
          <p style="text-align: center; margin: 0 0 24px;">
            <a href="%s" style="display: inline-block; background: #2563eb; color: #ffffff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600;">Verify email</a>
          </p>
          <p style="font-size: 13px; color: #6b7280; margin: 0 0 8px;">If the button doesn't work, copy and paste this link into your browser:</p>
          <p style="font-size: 13px; word-break: break-all; margin: 0;"><a href="%s" style="color: #2563eb;">%s</a></p>
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
          <p style="font-size: 12px; color: #9ca3af; margin: 0;">If you didn't sign up for ClassLite, you can safely ignore this email.</p>
        </td>
      </tr>
    </table>
  </body>
</html>`, safeName, safeURL, safeURL, safeURL)

	return VerificationEmailSubject, body
}

// RenderPasswordResetEmail produces subject + HTML body for the reset email.
// resetURL already carries the token; the body NEVER includes the raw token
// outside of that URL. fullName is HTML-escaped (user input).
func RenderPasswordResetEmail(fullName, resetURL string) (subject, htmlBody string) {
	safeName := html.EscapeString(fullName)
	safeURL := html.EscapeString(resetURL)

	body := fmt.Sprintf(`<!doctype html>
<html>
  <body style="font-family: -apple-system, system-ui, sans-serif; line-height: 1.5; color: #1f2937; background: #f9fafb; margin: 0; padding: 24px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="background: #ffffff; border-radius: 8px; max-width: 480px; width: 100%%; padding: 32px;">
      <tr>
        <td>
          <h1 style="font-size: 20px; margin: 0 0 16px;">Reset your password, %s</h1>
          <p style="margin: 0 0 24px;">Click the button below to set a new password. This link is valid for 1 hour and can only be used once.</p>
          <p style="text-align: center; margin: 0 0 24px;">
            <a href="%s" style="display: inline-block; background: #2563eb; color: #ffffff; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600;">Reset password</a>
          </p>
          <p style="font-size: 13px; color: #6b7280; margin: 0 0 8px;">If the button doesn't work, copy and paste this link into your browser:</p>
          <p style="font-size: 13px; word-break: break-all; margin: 0;"><a href="%s" style="color: #2563eb;">%s</a></p>
          <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
          <p style="font-size: 12px; color: #9ca3af; margin: 0;">If you didn't request a password reset, you can safely ignore this email — your password won't change.</p>
        </td>
      </tr>
    </table>
  </body>
</html>`, safeName, safeURL, safeURL, safeURL)

	return PasswordResetEmailSubject, body
}
