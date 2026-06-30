/**
 * Strings — the structural contract for the landing site's locale
 * modules (`vi.ts` + `en.ts`). Story 1.10 AC8 R38 Layer 1.
 *
 * Both locale modules export a `strings` constant declared as:
 *
 *   export const strings = { ... } as const satisfies Strings
 *
 * The `as const satisfies` shape (Amelia STRONG #8) gives us two
 * guarantees the locale modules cannot opt out of:
 *
 *   1. `satisfies Strings` — every key required by this interface MUST
 *      be present. Missing a key is a compile error in the locale
 *      module, not a runtime "undefined" in a rendered component.
 *
 *   2. `as const` — the inferred type stays literal (`'Pro'` not
 *      `string`). Combined with `satisfies`, downstream consumers see
 *      the literal value AND we still check structural conformance.
 *      The naive alternative `: Strings = { ... } satisfies Strings`
 *      widens the type to `Strings` at the binding site and discards
 *      the literal narrowing — defeats the whole point.
 *
 * The other three R38 layers (Vitest helper + ATDD parity-coverage
 * specimen + CI `check-landing-parity.mjs` script) live alongside this
 * file; together they form the full landing-side discharge of R38
 * (i18n parity, score 6). Single-layer parity is strictly weaker than
 * the dashboard's four-layer 1-7c discharge — so landing matches.
 */
export interface SocialProofCardStrings {
  center: string
  outcomeLabel: string
  outcomeValue: string
  quote: string
  attribution: string
  stats: string
}

export interface PricingTierStrings {
  name: string
  priceMonthly: string
  priceAnnual: string
  vatNote: string
  description: string
  cta: string
}

export interface Strings {
  meta: {
    title: string
    description: string
    ogTitle: string
    ogDescription: string
  }
  header: {
    cta: string
    nav: {
      features: string
      pricing: string
      proof: string
    }
    langToggleLabel: string
    hamburgerLabel: string
  }
  hero: {
    eyebrow: string
    headline: string
    cta: string
  }
  painCalculator: {
    line1: string
    line2: string
    footnote: string
    moneyConversion: string
    assumption: string
  }
  feature: {
    writing: { title: string; body: string }
    qa: { title: string; body: string }
    analytics: { title: string; body: string }
  }
  socialProof: {
    sectionHeader: string
    sectionNote: string
    card1: SocialProofCardStrings
    card2: SocialProofCardStrings
  }
  pricing: {
    heading: string
    toggleMonthly: string
    toggleAnnual: string
    annualBadge: string
    popularBadge: string
    free: PricingTierStrings
    pro: PricingTierStrings
    studio: PricingTierStrings
    belowCta: string
  }
  footer: {
    tagline: string
    product: string
    legal: string
    legalLinks: {
      terms: string
      privacy: string
      zalo: string
    }
    copyright: string
  }
  banner: {
    sessionExpired: {
      body: string
      cta: string
    }
  }
}
