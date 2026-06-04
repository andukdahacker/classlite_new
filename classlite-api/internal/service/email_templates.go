package service

import (
	"fmt"
	"html"
)

// VerificationEmailSubject is hard-coded — no user input ever reaches this string,
// keeping us safe from SEC-11 header-injection concerns (also defended in resend sender).
const VerificationEmailSubject = "Verify your ClassLite email address"

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
