/**
 * Nominal brand for HTML strings that have been sanitized by the caller
 * (server-side allowlist, DOMPurify, or fixture content vetted at build
 * time). The brand prevents raw `string` from flowing into
 * `dangerouslySetInnerHTML` without an explicit sanitization step.
 */
export type SafeHtml = string & { readonly __safeHtml: unique symbol }

/**
 * Brand assertion. Call ONLY after the input has been sanitized — passing
 * raw untrusted HTML through this helper defeats the type system's
 * purpose. The runtime is a no-op cast; correctness rests on the caller.
 */
export function asSafeHtml(html: string): SafeHtml {
  return html as SafeHtml
}
