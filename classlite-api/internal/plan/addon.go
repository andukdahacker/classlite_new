// Story 9.2a (D7/FR-64) — the LOCKED one-time AI-credit add-on pack catalog. Like the tier
// catalog it is the single source of truth and DISPLAY-ONLY (D25): nothing persisted
// references these price constants as historical truth — invoices SNAPSHOT their own amount,
// and Polar is authoritative for the actual charge.
//
// Availability is TIER-CONDITIONAL (epic:106-125): Free centers cannot buy add-ons at all
// (403 ADDON_NOT_AVAILABLE — a plan-eligibility problem, not a payment one); the 500-pack is
// sold to BOTH Pro and Studio at DIFFERENT prices (a Studio loyalty discount). Money is
// integer VND; VAT is the 10%-inclusive round-half-up split via the shared Subtotal/VAT
// helpers, so a pack's subtotal+vat always re-sums to its price exactly.
package plan

// AddonPack is one purchasable credit pack. Prices are per-tier (the 500-pack costs less on
// Studio), so callers resolve a price with PriceForTier(tier) against the tier the buyer is on.
type AddonPack struct {
	ID      string
	Credits int
	// prices maps an eligible tier → its VND price for this pack. A tier absent from the map is
	// NOT eligible for this pack (AvailableFor is false).
	prices map[Tier]int
}

// Add-on pack ids (the wire packId values — the FE + Polar metadata key). Stable identifiers.
const (
	AddonPack100ID  = "credits_100"
	AddonPack500ID  = "credits_500"
	AddonPack2000ID = "credits_2000"
)

// lockedAddons is the single source of truth for the pack catalog (D7 — the exact values from
// epic:106-125). 100 credits = 99000 VND (Pro only); 500 credits = 399000 Pro / 299000 Studio
// (loyalty); 2000 credits = 999000 VND (Studio only).
var lockedAddons = []AddonPack{
	{ID: AddonPack100ID, Credits: 100, prices: map[Tier]int{Pro: 99000}},
	{ID: AddonPack500ID, Credits: 500, prices: map[Tier]int{Pro: 399000, Studio: 299000}},
	{ID: AddonPack2000ID, Credits: 2000, prices: map[Tier]int{Studio: 999000}},
}

// AddonPackByID returns the pack with id, or a zero-value pack (Credits == 0) if unknown — the
// caller treats Credits == 0 as "no such pack". The catalog is small; a linear scan is fine.
func AddonPackByID(id string) AddonPack {
	for _, p := range lockedAddons {
		if p.ID == id {
			return p
		}
	}
	return AddonPack{}
}

// AllAddonPacks returns the full catalog in display order.
func AllAddonPacks() []AddonPack {
	out := make([]AddonPack, len(lockedAddons))
	copy(out, lockedAddons)
	return out
}

// AddonPacksForTier returns the packs available to buy on tier, in display order (empty for
// Free — add-ons are Pro/Studio only, D7).
func AddonPacksForTier(tier Tier) []AddonPack {
	out := make([]AddonPack, 0, len(lockedAddons))
	for _, p := range lockedAddons {
		if p.AvailableFor(tier) {
			out = append(out, p)
		}
	}
	return out
}

// AvailableFor reports whether tier may purchase this pack (has a configured price).
func (p AddonPack) AvailableFor(tier Tier) bool {
	_, ok := p.prices[tier]
	return ok
}

// PriceForTier returns the VND price of this pack on tier (0 if the tier is ineligible — the
// caller gates on AvailableFor first).
func (p AddonPack) PriceForTier(tier Tier) int { return p.prices[tier] }

// SubtotalForTier / VatForTier are the 10%-inclusive round-half-up split of the tier price
// (D25) — identical helpers as the plan tiers, so a pack always re-sums exactly.
func (p AddonPack) SubtotalForTier(tier Tier) int { return Subtotal(p.PriceForTier(tier)) }
func (p AddonPack) VatForTier(tier Tier) int      { return VAT(p.PriceForTier(tier)) }
