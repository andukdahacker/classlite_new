// Package plan holds the LOCKED three-tier plan model as Go constants — the single
// source of truth for ClassLite's Free/Pro/Studio limits and prices (Story 9.1a,
// D2/FU-4-4-4). There is deliberately NO plan_limits DB table: a three-row map is
// YAGNI, and centers.storage_limit_bytes already IS the per-center effective ceiling
// (written FROM this catalog on subscription create/change).
//
// MONEY BOUNDARY (D25): this catalog is DISPLAY-ONLY. Nothing persisted references
// these price constants as historical truth. Story 9.2 invoices SNAPSHOT their own
// amount/vat/currency; Polar is authoritative for amounts actually charged. The VAT
// split is 10% inclusive, round-half-up on the integer VND (subtotal = round(price/1.1),
// vat = price - subtotal) — identical in Go / FE / Polar. Pricing + VAT-inclusive
// provenance ratified by Ducdo 2026-09-28 (epic-09:22-30 + blocker-resolutions A8).
package plan

import "math"

// Tier is the plan identifier. Its string values match the subscriptions.plan CHECK
// ('free','pro','studio') and are the wire values in the read API.
type Tier string

// The three locked tiers, in display order (Free → Pro → Studio).
const (
	Free   Tier = "free"
	Pro    Tier = "pro"
	Studio Tier = "studio"
)

// Unlimited is the sentinel for a limit with no ceiling (JSON null on the wire).
// A count is never blocked when its Max is Unlimited.
const Unlimited = -1

// vatDivisor is the 10%-inclusive VAT divisor: subtotal = price / 1.1 (D25).
const vatDivisor = 1.1

// Limits are the per-tier enforced caps. Unlimited (-1) means no ceiling.
// StorageBytes is the value written into centers.storage_limit_bytes (AC6/D21).
type Limits struct {
	TeachersMax         int
	ClassesMax          int
	StudentsPerClassMax int
	AICreditsPerMonth   int
	StorageBytes        int64
}

// Prices are the per-tier VND prices (integers — never float money, CQ-3). Free is 0.
type Prices struct {
	MonthlyVnd int
	AnnualVnd  int
}

// VATBreakdown is the 10%-inclusive split of each price into subtotal + VAT (D25).
type VATBreakdown struct {
	MonthlySubtotal int
	MonthlyVat      int
	AnnualSubtotal  int
	AnnualVat       int
}

// locked is the single source of truth for the tier → limits+prices map (AC5, the
// exact values from epic-09:22-30 + blocker-resolutions A8). Storage: 500 MiB / 5 GiB
// / 50 GiB.
var locked = map[Tier]struct {
	limits Limits
	prices Prices
}{
	Free: {
		limits: Limits{TeachersMax: 1, ClassesMax: 1, StudentsPerClassMax: 5, AICreditsPerMonth: 0, StorageBytes: 524288000},
		prices: Prices{MonthlyVnd: 0, AnnualVnd: 0},
	},
	Pro: {
		limits: Limits{TeachersMax: 10, ClassesMax: Unlimited, StudentsPerClassMax: 20, AICreditsPerMonth: 500, StorageBytes: 5368709120},
		prices: Prices{MonthlyVnd: 399000, AnnualVnd: 3990000},
	},
	Studio: {
		limits: Limits{TeachersMax: Unlimited, ClassesMax: Unlimited, StudentsPerClassMax: 60, AICreditsPerMonth: 2000, StorageBytes: 53687091200},
		prices: Prices{MonthlyVnd: 999000, AnnualVnd: 9990000},
	},
}

// AllTiers returns the three tiers in display order (Free → Pro → Studio) — the order
// the read API's plan catalog (AC17) and the 9-1b picker render.
func AllTiers() []Tier { return []Tier{Free, Pro, Studio} }

// IsValid reports whether t is one of the three known tiers.
func IsValid(t Tier) bool {
	_, ok := locked[t]
	return ok
}

// LimitsFor returns the enforced limits for t. An unknown tier falls back to Free
// (the safe, most-restrictive default) — the subscriptions.plan CHECK makes an unknown
// value unreachable in practice, but the gate must never fail open.
func LimitsFor(t Tier) Limits {
	if row, ok := locked[t]; ok {
		return row.limits
	}
	return locked[Free].limits
}

// PricesFor returns the VND prices for t (Free → 0/0).
func PricesFor(t Tier) Prices {
	if row, ok := locked[t]; ok {
		return row.prices
	}
	return locked[Free].prices
}

// VATFor returns the 10%-inclusive VAT split for t (D25). Free → all zeros.
func VATFor(t Tier) VATBreakdown {
	p := PricesFor(t)
	return VATBreakdown{
		MonthlySubtotal: Subtotal(p.MonthlyVnd),
		MonthlyVat:      VAT(p.MonthlyVnd),
		AnnualSubtotal:  Subtotal(p.AnnualVnd),
		AnnualVat:       VAT(p.AnnualVnd),
	}
}

// Subtotal is the pre-VAT amount for a 10%-inclusive VND price, round-half-up on the
// integer VND (D25). math.Round rounds half away from zero, which for non-negative VND
// is exactly round-half-up.
func Subtotal(priceVnd int) int {
	return int(math.Round(float64(priceVnd) / vatDivisor))
}

// VAT is the tax portion of a 10%-inclusive VND price: price - subtotal (D25), so the
// two always re-sum to the price exactly (no rounding drift).
func VAT(priceVnd int) int {
	return priceVnd - Subtotal(priceVnd)
}
