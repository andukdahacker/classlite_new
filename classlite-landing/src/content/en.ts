/**
 * en.ts — English strings for the landing site. Story 1.10.
 *
 * Mirrors `vi.ts` key-for-key. The R38 four-layer discharge (AC8)
 * enforces parity at compile time (`as const satisfies Strings`),
 * runtime (`assertLandingI18nParity`), and CI
 * (`check-landing-parity.mjs` + ATDD parity-coverage specimen with
 * `STORY_1_10_KEYS` closed enumeration).
 *
 * VND prices are LOCKED per BLOCKER A8 — see `vi.ts` JSDoc.
 */
import type { Strings } from './types'

export const strings = {
  meta: {
    title: 'ClassLite — IELTS Center Management with AI-Assisted Grading',
    description:
      'A Vietnamese-first IELTS center management platform. AI grades Writing and Speaking, you manage classes, students, and revenue. Free for small centers.',
    ogTitle: 'ClassLite — IELTS Center Management',
    ogDescription:
      'AI grades Writing and Speaking in 3 minutes per essay, not 12. Manage classes, students, schedule, revenue — all in one place. Free for small centers.',
  },
  header: {
    cta: 'Get started free',
    nav: {
      features: 'Features',
      pricing: 'Pricing',
      proof: 'Customers',
    },
    langToggleLabel: 'Tiếng Việt',
    hamburgerLabel: 'Open navigation menu',
  },
  hero: {
    eyebrow: 'IELTS center management platform',
    headline:
      'Your teachers spend 12 minutes grading each Writing essay. ClassLite cuts that to 3 minutes.',
    cta: 'Get started free',
  },
  painCalculator: {
    line1: '5 teachers × 3 hours/week × 48 weeks',
    line2: '= 720 hours/year',
    footnote: 'Time spent grading Writing essays',
    moneyConversion: '≈ ~6,000 USD/year in grading labor',
    assumption: 'Assumption: 200,000 VND/hr fully-loaded teacher cost',
  },
  feature: {
    writing: {
      title: 'AI Writing grading with edit suggestions',
      body: 'AI grades Writing on the IELTS band scale, leaves anchored comments, and suggests edits paragraph-by-paragraph. Teachers review in 3 minutes instead of 12.',
    },
    qa: {
      title: 'Q&A anchored to the right paragraph',
      body: 'Students ask exactly where they need help; teachers reply exactly where the question lives. Nothing gets lost in a long inbox.',
    },
    analytics: {
      title: 'Analytics & at-risk student alerts',
      body: "Track each student's Band score over time. Get early warnings when a learner's progress plateaus.",
    },
  },
  socialProof: {
    sectionHeader: 'Picture the results with ClassLite',
    sectionNote:
      'The centers below are illustrative scenarios for our launch phase. We will update with real centers as soon as our first partners give permission to share.',
    card1: {
      center: 'Sao Mai English Center',
      outcomeLabel: 'Writing-grading time saved',
      outcomeValue: '-65%',
      quote:
        'I used to spend 15 hours a week grading essays. Now it is 5 — and I teach an extra class with the time I get back.',
      attribution: 'Ms. Phương · Center owner',
      stats: '3 branches · 18 teachers · 240 students',
    },
    card2: {
      center: 'IELTS Hồng Hà',
      outcomeLabel: 'Revenue per teacher',
      outcomeValue: '+40%',
      quote:
        'I teach and run the center alone. ClassLite lets me take on more students without hiring a TA.',
      attribution: 'Mr. Minh · Teacher and owner',
      stats: '1 location · 1 teacher · 35 students',
    },
  },
  pricing: {
    heading: 'Transparent pricing — Start for free',
    toggleMonthly: 'Monthly',
    toggleAnnual: 'Annual',
    annualBadge: '~2 months free',
    popularBadge: 'Most popular',
    free: {
      name: 'Free',
      priceMonthly: '0',
      priceAnnual: '0',
      vatNote: 'Prices include 10% VAT',
      description:
        'Up to 1 teacher + 20 students. All AI grading features. No credit card required.',
      cta: 'Get started free',
    },
    pro: {
      name: 'Pro',
      priceMonthly: '399.000',
      priceAnnual: '3.990.000',
      vatNote: 'Prices include 10% VAT',
      description:
        'Up to 10 teachers + 200 students. Unlimited AI Writing & Speaking grading. Advanced analytics.',
      cta: 'Choose Pro',
    },
    studio: {
      name: 'Studio',
      priceMonthly: '999.000',
      priceAnnual: '9.990.000',
      vatNote: 'Prices include 10% VAT',
      description:
        'Unlimited teachers and students. White-label branding. Priority support via Zalo.',
      cta: 'Choose Studio',
    },
    belowCta: 'Start free — no credit card required',
  },
  footer: {
    tagline:
      'End-to-end IELTS center management. AI-assisted grading. Built in Vietnam, for Vietnam.',
    product: 'Product',
    legal: 'Legal & Support',
    legalLinks: {
      terms: 'Terms',
      privacy: 'Privacy',
      zalo: 'Contact via Zalo',
    },
    copyright: '© 2026 ClassLite. All rights reserved.',
  },
  banner: {
    sessionExpired: {
      body: 'Your session has expired. Please sign in again to continue.',
      cta: 'Sign in',
    },
  },
} as const satisfies Strings
