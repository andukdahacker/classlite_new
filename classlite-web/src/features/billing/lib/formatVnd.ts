/**
 * formatVnd — integer VND with '.' thousands separators + the ₫ symbol
 * (Story 9-1b, CQ-3 — money is integer VND everywhere, never a float).
 *
 * Uses `vi-VN` grouping unconditionally: the ₫ price format ("399.000₫") is a
 * Vietnamese-market convention that reads identically to EN users, so it does
 * NOT vary by UI locale (the same reason `formatBytes` keeps its unit symbols
 * locale-neutral). The value is rounded defensively — callers pass server
 * integers, but a stray float never renders fractional đồng.
 */
const VND_GROUPING = new Intl.NumberFormat('vi-VN')

/** formatVnd renders an integer VND amount as e.g. `399.000₫`. */
export function formatVnd(amount: number): string {
  const safe = Number.isFinite(amount) ? Math.round(amount) : 0
  return `${VND_GROUPING.format(safe)}₫`
}
