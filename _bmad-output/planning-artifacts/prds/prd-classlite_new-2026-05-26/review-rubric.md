# PRD Quality Review — ClassLite v2

## Overall verdict

This is a strong, well-structured PRD that earns its length. The 70 FRs are individually testable, the four user journeys are concrete and load-bearing, and the scope decisions are stated as decisions rather than hedged away. The main risks are downstream: a handful of FRs lack boundary specificity that engineers will need, the NFR section leans on adjectives in places, and several assumptions mask unresolved product decisions that could block architecture or UX work.

## Decision-readiness — strong

The PRD makes real choices and names what was given up. Non-Goals (§5) does genuine work — "Not a messaging product," "No custom grading rubrics," "No offline mode" are commitments that constrain the design space. The MVP scope split (§6.1 vs §6.2) is explicit, and the `[NOTE FOR PM]` callout on email notifications (§6.2) honestly flags a deferred tension rather than burying it. Open Questions (§8) distinguish resolved from unresolved items. The trade-off between AI rubber-stamping and AI usefulness is surfaced via counter-metric SM-C1, which is unusually thoughtful.

The one soft spot: the PRD resolves pricing currency (VND) but punts on actual price points entirely (FR-61 assumption). For a launch-grade PRD feeding architecture and billing implementation, this leaves the billing domain under-specified — Polar.sh integration work can proceed, but plan-selection UX and upgrade math cannot be finalized.

### Findings
- **medium** Pricing still TBD (§4.16 FR-61, §9) — VND price points are unresolved. Downstream billing UX and proration logic (FR-63) need concrete numbers to design confirmation modals and invoice line items. *Fix:* Resolve price points or add explicit placeholder ranges before UX design begins.
- **low** Auth provider undecided (§8 Q6) — Open question on auth provider could affect architecture decisions around session management and role enforcement. *Fix:* Resolve before architecture phase; flag as a blocker in §8.

## Substance over theater — strong

The three personas are genuinely distinct and each drives different product paths: Owner gets center management + analytics + billing; Teacher gets grading + exercises + Q&A; Student gets attempt interfaces + feedback + "My Performance." No persona is furniture — all three appear in UJs and drive FR scoping. The JTBD statements (§2.2) are specific to the Vietnam IELTS tutoring context, not generic SaaS platitudes.

AI-assisted grading is positioned as the core differentiator (§1) and is backed by concrete FRs (FR-34, FR-36), a success metric (SM-2: grading time), and a counter-metric (SM-C1: override rate). This is earned differentiation, not innovation theater.

NFRs are mostly specific (NFR-3 has concrete thresholds: <2s FCP, <3s grading view, <500ms search). NFR-5 (Accessibility) names WCAG 2.1 AA — a real standard, not a vague promise.

### Findings
- **low** NFR-4 Security is thin (§Cross-Cutting NFRs) — "Authentication via a proven auth provider" and "Rate limiting on authentication endpoints" are directionally correct but lack specifics (rate limits? lockout policy? session duration?). Acceptable at PRD level given the auth provider is still TBD, but flag for architecture. *Fix:* Add a `[NOTE FOR PM]` that security NFRs need expansion once auth provider is selected.

## Strategic coherence — strong

The thesis is clear: replace the WhatsApp/Sheets/paper patchwork with a single IELTS-specific tool, differentiated by AI grading. Every major feature group traces back to this thesis. The MVP scope is a problem-solving MVP — it solves the complete teacher workflow (author → assign → grade → analyze) rather than shipping a thin horizontal slice.

Success metrics validate the thesis directly: SM-2 (grading time reduction) is the headline metric for the AI differentiator; SM-1 (weekly active teachers) validates the "single tool" value prop; SM-5 + SM-C1 together form a healthy tension around AI quality. SM-6 (conversion rate) validates the business model.

Feature prioritization follows the thesis. The heaviest FR density is in grading (FR-33–37) and exercise authoring (FR-20–26) — the core teacher workflow. Billing and admin features are present but lighter, which is appropriate.

### Findings
- **medium** No retention or churn metric (§7) — For a SaaS product, the absence of a retention/churn metric is notable. SM-1 (WAT) measures engagement but not whether centers stay month-over-month. *Fix:* Add a counter-metric or secondary metric for monthly center churn rate.

## Done-ness clarity — adequate

Most FRs have testable consequences that an engineer could write acceptance tests against. The pattern of "Consequences (testable):" with bullet points is effective and consistent across all 70 FRs. Standouts: FR-65 (payment failure) specifies retry days, warning email schedule, and exact downgrade behavior; FR-34 (AI grading) specifies accept/edit/dismiss per suggestion and bulk actions.

However, several FRs have gaps that will force engineers to make product decisions:

### Findings
- **high** At-risk detection lacks thresholds (§3, §8 Q4) — "At-Risk Student" is defined in the glossary and referenced in FR-19, FR-43, FR-44, FR-48, FR-51, FR-52, but the actual triggering conditions are unspecified. Open Question 4 asks about this but it remains unresolved. Engineers cannot implement at-risk flagging without concrete rules. *Fix:* Define default thresholds (e.g., attendance <70% over last 4 sessions, band drop >0.5 over 3 submissions, 2+ consecutive missed assignments) even if they are hardcoded for MVP.
- **high** FR-22 case-sensitivity example is misleading (§4.6) — The consequence says `"hydroelectric" and "hydro-electric"` should match when case-sensitive is off, but that is a hyphenation/normalization issue, not a case issue. This conflates two distinct behaviors. *Fix:* Separate case-sensitivity from answer normalization. Define what normalization rules apply (trim whitespace, ignore hyphens, ignore articles, etc.).
- **medium** FR-31 hard deadline vs. soft deadline undefined (§4.8) — FR-31 introduces both a soft deadline (late with penalty) and a hard deadline (locked, extension required), but does not specify how the hard deadline is set or what the default gap is between soft and hard deadlines. *Fix:* Specify whether the hard deadline is a separate field on the assignment or a system-wide offset (e.g., soft deadline + 48 hours).
- **medium** FR-14 class lifecycle transitions (§4.4) — Statuses are listed (Upcoming → Active → Paused → Ended) but transition triggers are not specified. Is Upcoming → Active automatic on first session date? Can a teacher move directly to Ended? *Fix:* Define transition triggers and permissions for each status change.
- **low** FR-48 "repetitive mistakes" aggregation logic (§4.12) — The consequence says mistakes are aggregated from multiple sources but does not define what constitutes a "pattern" or the minimum threshold for surfacing. *Fix:* Defer to architecture/UX or add a `[NOTE FOR PM]`.

## Scope honesty — strong

Non-Goals (§5) is one of the best sections in this PRD — nine explicit exclusions, each doing real work. The MVP scope split (§6) is clean and the Out of Scope items (§6.2) include reasoning ("No abstraction layer needed now; build for IELTS directly"). Assumptions are tagged inline and indexed in §9 with section cross-references.

The `[NOTE FOR PM]` on email notifications (§6.2) is a good example of honest de-scoping with a flag for fast follow. The assumption about spreadsheet import (FR-6 note) correctly identifies a visible mockup feature that was intentionally deferred.

Open items density is reasonable for a launch-grade PRD: 3 unresolved open questions, 14 assumptions, 1 `[NOTE FOR PM]`. The unresolved questions (at-risk thresholds, auth provider, hosting) are legitimate blockers for downstream work but are correctly identified as open.

### Findings
- **medium** Data retention policy unresolved (§8 Q8) — Vietnamese PDPD compliance is flagged but not addressed. For a SaaS product storing student data (including minors aged 16+), this needs resolution before architecture, not after. *Fix:* Escalate to a `[NOTE FOR PM: BLOCKER]` or resolve with a default retention policy.

## Downstream usability — strong

This PRD is explicitly designed as a chain-top document (§0 states it feeds UX, architecture, and developers). The structure supports clean extraction:

- FR IDs are globally unique and contiguous (FR-1 through FR-70).
- UJs reference personas by name and link to FRs via feature group descriptions.
- Glossary (§3) defines domain terms used consistently throughout.
- NFRs are numbered (NFR-1 through NFR-6).
- Success metrics are numbered (SM-1 through SM-6, SM-C1, SM-C2) with FR cross-references.
- The IA is correctly externalized to a companion document with a clear pointer.

### Findings
- **medium** SM IDs reference wrong FRs (§7) — SM-1 says "Validates FR-33, FR-34, FR-37" but FR-37 is auto-grading (Reading/Listening), not a teacher engagement feature. SM-1 measures teachers performing "grading or exercise action" — the FR references should include exercise authoring FRs (FR-20, FR-21) and possibly FR-27 (assignment creation). *Fix:* Audit SM→FR cross-references for accuracy.
- **low** Assumptions Index has section mismatches (§9) — The index entry "§4.16 FR-59" should be "§4.16 FR-61" (pricing is FR-61, not FR-59). The entry "§4.14 FR-57" appears twice — one is about real-time updates (actually FR-59, not FR-57) and one about email notifications (also FR-59). *Fix:* Correct section and FR references in the Assumptions Index.
- **low** Persona label drift (§2.1 vs §4.1) — §2.1 defines "Center Owner (Operator/Founder)" as one persona, but FR-1 splits into three distinct personas: Operator, Founder, Solo Teacher. The mapping (Operator→Admin, Founder→Owner) means the §2.1 "Center Owner" persona maps to two different onboarding paths. This is not wrong but could confuse downstream UX work. *Fix:* Clarify in §2.1 that "Center Owner" encompasses both the Operator and Founder onboarding personas, or split into distinct persona entries.

## Shape fit — strong

This is a multi-stakeholder B2B SaaS product with three distinct user roles and meaningful UX across all of them. The PRD correctly treats UJs and personas as load-bearing. Four UJs covering the four primary workflows (setup, grading, student attempt, owner monitoring) is the right density — not padded, not thin.

As a chain-top PRD feeding UX → architecture → stories, the traceability infrastructure (FR IDs, SM cross-refs, glossary, assumptions index) is well-suited. The externalized IA document is the right call for a 93-screen product — keeping navigation details out of the PRD while maintaining a clear pointer.

The IELTS-specific hardcoding decision (§6.2: "No abstraction layer needed now; build for IELTS directly") is a good shape-fit choice — it avoids premature generalization while the product validates its thesis.

### Findings
No findings. Shape is appropriate.

## Mechanical notes

- **Glossary drift:** Minor. "Class Template" (§3) is sometimes referred to as just "template" in FR text — acceptable shorthand but could cause extraction ambiguity. "Anchored Q&A" is used consistently.
- **ID continuity:** FR-1 through FR-70 are contiguous with no gaps or duplicates. SM-1 through SM-6 plus SM-C1 and SM-C2 are contiguous. NFR-1 through NFR-6 contiguous.
- **Assumptions Index roundtrip:** 14 inline assumptions, 14 index entries. One discrepancy: the inline assumption on browser support (§Platform, final line) is not indexed in §9. The index entry "§4.16 FR-59" should read "§4.16 FR-61" (pricing is in FR-61). The entry "§4.14 FR-57" appears twice but both refer to FR-59 content.
- **UJ persona linkage:** UJ-1 names "Linh" (Owner), UJ-2 names "Minh" (Teacher), UJ-3 names "Trang" (Student), UJ-4 names "Linh" (Owner). All map to §2.1 personas. No floating UJs.
- **Cross-references:** Feature descriptions reference UJs (e.g., "Realizes UJ-1"). SM entries reference FRs. All resolve correctly except the SM-1 FR-37 reference noted above.
- **Missing index entry:** Browser support assumption at end of §Platform is not in §9.
