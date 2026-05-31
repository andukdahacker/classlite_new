---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]
lastStep: 14
status: 'complete'
completedAt: '2026-05-28'
status: 'in-progress'
inputDocuments:
  - '_bmad-output/planning-artifacts/prds/prd-classlite_new-2026-05-26/prd.md'
  - 'docs/classlite-entry/classlite-ia.md'
  - '_bmad-output/planning-artifacts/architecture.md'
workflowType: 'ux-design'
project_name: 'classlite_new'
user_name: 'Ducdo'
date: '2026-05-27'
---

# UX Design Specification ClassLite v2

**Author:** Ducdo
**Date:** 2026-05-27

---

<!-- UX design content will be appended sequentially through collaborative workflow steps -->

## Executive Summary

### Project Vision

ClassLite v2 is a purpose-built SaaS for IELTS tutoring centers and freelance teachers in Vietnam, replacing the patchwork of WhatsApp, Google Sheets, and paper gradebooks. The core differentiator is AI-assisted grading — cutting Writing essay marking from ~12 minutes to ~3 minutes while keeping the teacher in control.

The existing mockup set covers 93 screens across the authenticated product experience. This UX specification addresses two critical gaps: the **landing page** (`classlite.app`, Astro static site) and the **authentication flows** (`my.classlite.app`, React SPA). Every user passes through these before touching the product.

### Target Users

**Center Owners (Operator/Founder)** — 2–15 teachers, 50–300 students. Former teachers turned business operators. Evaluate tools on desktop. Primary conversion target. Key anxiety: "Will this actually work for a center like mine, or is it another startup toy that disappears in six months?"

**Freelance Teachers (Solo)** — 1–5 classes, no center overhead. Live in Google Workspace. Value speed and simplicity. Most likely to enter via Google OAuth.

**Students (age 16–30)** — Mobile-first. Highest volume, lowest revenue. Enter via invite links from their teacher/center. Auth must be zero-abandonment, not delightful — students don't convert to paying customers; their owners do.

### Key Design Challenges

1. **Trust construction, not friction reduction.** The Vietnamese tutoring center market is largely undigitized. Competitors aren't other SaaS products — they're WhatsApp groups and shared Google Sheets. The landing page must solve a category education problem: convincing a skeptical center owner that software is worth paying for at all. Trust signals must be local and specific — named center archetypes, outcome data ("giảm 9 phút chấm bài"), visible pricing in VND — not generic startup polish.

2. **User intent routing.** Three very different people land on classlite.app for very different reasons: an owner researching tools, a teacher clicking an invite link, a student tapping a class join link. The landing page and auth flows need to route by intent, not funnel everyone through the same hero section.

3. **Auth flow branching with failure state design.** Seven FRs (FR-75–FR-81) create multiple branching paths: email registration → verification gate, Google OAuth → account linking, invite acceptance → expired token handling, password reset → session invalidation. The failure states (expired invite, lockout, verification pending, silent refresh bounce) need equal design care to the happy paths — these are where users are permanently lost.

4. **Email verification gating decision.** A fork-in-the-road that must be resolved before screen design begins: do we gate dashboard access behind email verification (requires a "verification pending" holding screen), or allow access with a persistent banner (requires degraded-permission states throughout the dashboard)? This changes the shape of the onboarding flow materially.

5. **Three-domain OAuth redirect.** Google OAuth routes through three domains: `my.classlite.app → accounts.google.com → api.classlite.app/callback → my.classlite.app/dashboard`. No custom loading state is possible during the Google leg. Design the "before" (login page) and "after" (dashboard landing) states only.

6. **15-minute token expiry UX.** Short-lived access tokens mean a teacher who steps away for 20 minutes hits a failed request → silent refresh → if refresh fails, login bounce. The bounce must preserve in-progress state (a teacher mid-lesson-plan losing work is a support ticket).

### Design Opportunities

1. **Google OAuth as the happy path.** Gmail dominates in Vietnam. Teachers already live in Google Workspace. Making "Continue with Google" the visually primary action dramatically shortens time-to-dashboard and skips email verification entirely. This is a jobs-to-be-done win, not just a convenience feature.

2. **Invite acceptance as the highest-value conversion path.** An owner who invites 8 teachers has already committed. Each invite accepted is a social proof node and switching-cost multiplier. The invite acceptance screen is that teacher's first contact with ClassLite — show the center name, the inviter, the role. Make them feel expected, not processed. Design the expired-invite recovery path with equal care.

3. **Free tier activation quality over conversion volume.** SM-6 (>15% free-to-pro within 60 days) requires that free-tier users experience AI grading in their first session. The landing page should sell the 12→3 minute claim, and onboarding should deliver on it immediately. The differentiator must be felt, not described.

4. **Landing page as local credibility builder.** Social proof in the Vietnamese register: named center archetypes ("Trung tâm IELTS, Hà Nội, 12 giáo viên"), outcome specificity, and pricing transparency. The free tier must be visible as an entry point. The Studio tier must signal that the product scales — don't optimize only for free-tier acquisition.

5. **Domain transition is technically seamless.** Auth cookies on `.classlite.app` with `SameSite=Lax` mean the browser handles the session automatically across subdomains. No redirect dance needed. The landing page can detect logged-in users for redirect (FR-73) via a fetch to the API. Visual consistency between Astro and React is the real design task — shared brand, shared Tailwind config, same language state.

## Core User Experience

### Defining Experience

The landing page and auth flows serve one purpose: **convert a skeptical Vietnamese center owner or freelance teacher into an active ClassLite user who experiences AI grading in their first session.**

Getting users *in* is necessary but insufficient. The business metrics (SM-6: >15% free-to-pro within 60 days) require getting users *to value*. The core experience breaks into four sequential moments:

1. **Landing page → Understanding the cost of the status quo** (classlite.app). The visitor — a center owner or freelance teacher — isn't evaluating ClassLite against competitors. They're evaluating it against doing nothing. The landing page must first articulate the pain as a quantified cost (time per essay × teachers × weeks = hours lost), then show ClassLite as the resolution. Category education before conversion. Trust before CTA.

2. **Auth → Account creation** (my.classlite.app). Two paths, one happy: Google OAuth is the primary action (target: 10 seconds P50 to onboarding for Google users). Email/password is the secondary path. Email registration gates access behind verification — the user must verify before entering the product. Google OAuth users bypass verification entirely (Google has already verified their email).

3. **Invite acceptance → Joining a center** (my.classlite.app/invite). A staff member or student receives an invite link. This is their first contact with ClassLite. The screen shows who invited them, which center, and what role — making them feel expected. The business outcome: teacher activates and grades within 48 hours of invite, generating data that proves ROI to the center owner.

4. **First AI grade → Experiencing the differentiator** (post-auth). The first session must route the user to a pre-loaded sample essay with a single CTA to run the AI grader. No class setup, no configuration — those come after the user has felt the 12→3 minute promise. This is the moment where the landing page's claim becomes real. Everything before this is setup; this is the conversion trigger. **For owners:** the first-run experience shows a pre-graded sample dashboard — what their center analytics will look like once teachers are active. The owner sees the value their teachers will generate, not just configuration forms.

### Platform Strategy

**Two platforms, one brand:**
- **Landing page** (`classlite.app`): Astro static site on Cloudflare Pages. Desktop-optimized for the primary audience (owners and teachers researching tools), fully responsive for mobile. SEO-first — server-rendered HTML, meta tags, Open Graph. Bilingual with `/vi` and `/en` route prefixes.
- **Auth screens** (`my.classlite.app`): React SPA. Must match the landing page's visual identity exactly. Auth screens are mobile-first since students (highest volume) arrive on phones via invite links.

**Visual consistency strategy:** Astro uses `.astro` components, React uses `.tsx` — they cannot share components directly. To prevent drift:
- **Shared design token package** (`@classlite/tokens`): CSS variables for colors, typography, spacing, radii. Both codebases consume tokens. No shared components — low coupling, no framework lock-in.
- **Visual regression tests** (Chromatic or Percy) diffing equivalent screens across landing and dashboard to catch drift early.

**Platform constraints:**
- No offline mode — internet required for all flows.
- Google OAuth callback traverses three domains (`my.classlite.app → accounts.google.com → api.classlite.app/callback → my.classlite.app`). No custom loading state is possible during the Google leg. Design the "before" (login page) and "after" (dashboard landing) states only.
- Auth cookies on `.classlite.app` domain with `SameSite=Lax` — session is seamless across subdomains. `SameSite=Strict` would silently break the OAuth redirect flow.
- FR-73 (logged-in redirect from landing page): Astro cannot read `httpOnly` cookies. Implementation uses a non-httpOnly `logged_in=1` hint cookie readable by client-side JS. The JWT remains `httpOnly`. Stale hint cookie must be handled: if redirect to `my.classlite.app` results in a failed silent refresh, redirect back to landing with `?session_expired=true` to break the loop.

### Effortless Interactions

**Google OAuth — 10 seconds P50 to onboarding.** A teacher clicks "Continue with Google" → Google account picker → lands on onboarding or dashboard. No email verification step. No password creation. This is the path we optimize for — visually primary, fewest steps, fastest time-to-value. P95 will be higher due to Google consent screen variability and React cold-start bundle; the 10-second target is for the median case.

**Invite acceptance — 30 seconds for authenticated users.** A user who is already logged in taps an invite link → sees who invited them and which center → confirms → lands in their class. For unauthenticated users (cold path), the target is under 50 seconds total (aspirational — validate with real device + network testing before committing as SLA). The invite link should pre-fill context so the user never re-enters information.

**Logged-in redirect — near-instant.** A returning user who hits `classlite.app` is detected via hint cookie and redirected to their dashboard. The landing page is invisible to active users.

**Language continuity.** If a user selects Vietnamese on the landing page, that preference is stored and carries through to the auth screens and into the product via a shared cookie or query parameter. No re-selection at any transition point.

**First AI grade — zero configuration.** Post-signup, the onboarding routes the user to a pre-loaded sample IELTS essay. One button: "Run AI grading." The user sees band scores, inline comments, and the 3-minute experience before any center setup, class creation, or teacher invitation. Value first, configuration second. For owners, a pre-graded sample dashboard shows center-level analytics (band trends, teacher workload, at-risk flags) — the value they'll get once their team is onboarded.

### Critical Success Moments

1. **"This costs me more than I thought"** — First 10 seconds on the landing page. Before the visitor asks "is this for me?", the page quantifies their current pain: "Your teachers spend X hours/week grading essays by hand. That's Y hours/month you're paying for." This reframes the decision from "should I try new software?" to "can I afford not to?" The pain articulation layer precedes the feature showcase and pricing.

2. **"This is for centers like mine"** — Within 15 seconds. After the pain hook, the visitor sees their world reflected: center sizes they recognize (2–15 teachers), pricing in VND, Vietnamese-language social proof with named center archetypes and outcome specificity ("giảm 9 phút chấm bài"). The free tier is visible as an honest entry point. The Studio tier signals the product scales.

3. **"They were expecting me"** — Invite acceptance screen showing the center name, inviter's name, and assigned role. The user feels like they're joining something, not filling out a form. For teachers, this includes a clear answer to "what do I actually do right now?" — not a product tour, but a single actionable next step. The business outcome: teacher grades their first assignment within 48 hours, generating analytics visible to the center owner.

4. **"I just saved time"** — The instant after the first AI grade. The user submitted a sample essay (or their own), the AI returned band scores and inline comments in under 30 seconds, and the teacher realizes the 12→3 minute promise is real. This is the highest-leverage conversion trigger in the entire funnel. Every UX decision in the landing page and auth flows exists to get the user to this moment as fast as possible. For owners, the equivalent moment is seeing a pre-graded sample dashboard that shows what their center analytics will look like — proof of operational visibility without micromanaging.

5. **"I verified, now let me in"** — The email verification gate (email/password users only). User registers, gets the verification email, clicks the link, and immediately enters onboarding. The hold screen feels like a brief pause, not a wall: "Check your email — we sent a link to [email]. Click it and you're in." Resend available after 60 seconds. If the email doesn't arrive promptly, trust evaporates. Google OAuth users never see this screen.

### Failure State Catalog

Every failure state gets an explicit recovery path. These are not edge cases — they are the moments where users are permanently lost.

| Failure State | Trigger | Recovery Path |
|---|---|---|
| **Expired invite** | Staff/student clicks invite link after 7 days | Clear message with center name: "This invitation has expired." CTA: "Ask [inviter name] to send a new one" with a mailto or copy-to-clipboard link. Not a generic error. |
| **Already-accepted invite** | User clicks the same invite link twice | Redirect to login if unauthenticated, or to dashboard if authenticated. Message: "You've already joined [center name]." |
| **Invite email already has account** | Existing user receives invite to a new center | Show: "You already have a ClassLite account. Join [center name] as [role]?" One-click merge, no re-registration. |
| **Google Workspace blocks OAuth** | Institutional Google account blocks third-party apps | Fallback messaging on the OAuth error return: "Your Google account doesn't allow sign-in to ClassLite. Try a personal Gmail account, or sign up with email instead." Both alternatives are one click away. |
| **Email verification not received** | User waits >60 seconds, no email | "Didn't get it?" link with troubleshooting: check spam, verify email spelling, resend (rate-limited). After 2 resends, offer: "Try signing up with Google instead." |
| **Account lockout** | 5 failed login attempts in 10 minutes | 15-minute lockout with countdown timer visible. Message explains when they can retry. "Forgot password?" link remains active during lockout. |
| **Password reset link expired** | User clicks reset link after 1 hour | "This link has expired." CTA: "Request a new one" — single click, pre-fills email. |
| **Silent refresh failure** | Access token expired + refresh token expired/revoked | Redirect to login with message: "Your session expired — please log in again." Must preserve the URL the user was trying to reach so they return to it post-login. In-progress work (e.g., teacher mid-lesson-plan) must be preserved via autosave — the refresh bounce must never lose state. |
| **Stale hint cookie redirect loop** | `logged_in=1` cookie exists but session is actually expired | `my.classlite.app` detects failed silent refresh, clears hint cookie, redirects to `classlite.app?session_expired=true`. Landing page shows a subtle "Session expired — please log in again" banner. Loop broken in one redirect. |
| **Bad AI grade output** | Teacher runs AI grading on sample essay and the result seems wrong or low-quality | "This doesn't look right?" link visible alongside AI results. Opens a one-click re-run option with a different prompt framing. Disclaimer always visible: "AI suggestions are starting points — you have full control." For first-run, the sample essay is curated to produce reliably strong AI output, minimizing this risk. If AI service is temporarily degraded, show: "AI grading is temporarily slow — your essay is queued" rather than a broken result. |

### Experience Principles

1. **Value before configuration.** The first post-auth action is experiencing AI grading on a sample essay — not setting up a center, not creating classes, not inviting teachers. Configuration is important but it's not the conversion trigger. Get the user to "I just saved time" before asking them to build anything. For owners, value means seeing what their center dashboard will look like, not filling out forms.

2. **Trust before conversion.** Every element on the landing page earns credibility before asking for action. Pain is quantified. Pricing is visible in VND. Social proof is local and specific. The free tier is an honest offer. Vietnamese center owners have been burned by overpromising software — we understate and overdeliver.

3. **Route by intent, don't funnel.** An owner researching tools, a teacher clicking an invite, and a student joining a class are three different journeys. Each gets the shortest path to their goal. The landing page serves researchers; invite links bypass it entirely. Post-auth onboarding branches by role — teachers get a "grade your first essay" flow, owners get a center setup flow preceded by a sample dashboard preview.

4. **Google first, email second.** Google OAuth is the visually dominant action on every auth screen. Email/password is always available but positioned as the alternative. Fallback for blocked Google Workspace accounts is explicit and one click away. The verification gate only applies to email/password users — Google users are pre-verified.

5. **Design the failure state first.** Expired invites, undelivered verification emails, lockout, blocked Google accounts, silent refresh bounces, stale cookie loops, bad AI output — each has an explicit recovery path with clear messaging and a single next action. Generic error pages are forbidden. Every failure state names what happened and offers a way forward.

6. **One brand, two codebases, shared tokens.** The Astro landing site and React dashboard are visually indistinguishable via shared design tokens (CSS variables). No shared components — accept that `.astro` and `.tsx` are different worlds. Visual regression tests catch drift. A user crossing from `classlite.app` to `my.classlite.app` should not notice the transition.

## Desired Emotional Response

### Primary Emotional Goals

| User | Primary Emotion | Expression |
|---|---|---|
| **Center Owner** | Recognition → Relief | "They understand my world" → "Someone finally built this" |
| **Teacher** | Momentum | "This is moving fast, I'm already in" |
| **Teacher (invited)** | Belonging | "My center is already here, they saved me a spot" |
| **Student** | Simplicity | "I know exactly what to do" |
| **All (failure states)** | Confident recovery | "This broke, but I can see the next step" |
| **All (first AI grade)** | Quiet competence | "This thing actually works" |

### Emotional Journey Mapping

| Stage | Owner | Teacher | Student |
|---|---|---|---|
| **Landing page (first 5s)** | Recognition — "this is my world" | N/A (arrives via invite, bypasses landing) | N/A (arrives via invite) |
| **Landing page (15s)** | Relief — "the cost of doing nothing is real" | N/A | N/A |
| **Landing page CTA** | Cautious optimism — "the free tier is honest" | N/A | N/A |
| **Auth screen** | Efficiency — "Google, one click, done" | Momentum — "I'm already moving" | Simplicity — "one tap" |
| **Email verification gate** | Patience — "brief pause, not a wall" | Patience | Patience |
| **Invite acceptance** | N/A (owner initiates invites) | Belonging — "they expected me" | Belonging — "my teacher set this up for me" |
| **First-run / onboarding** | Anticipation — "I can see what this will become" (sample dashboard) | Curiosity — "let me try this grading thing" | Clarity — "here's my class, here's my work" |
| **First AI grade** | Operational confidence — "I can see my center's data" | Quiet competence — "this actually works, next essay" | N/A (students don't grade) |
| **Failure state** | Confidence — "I know what to do next" | Confidence — "clear path to recovery" | Confidence — "not stuck" |
| **Return visit** | Control — "my center data is here, current, useful" | Flow — "pick up where I left off" | Ease — "check feedback, move on" |

### Micro-Emotions

**Critical to cultivate:**
- **Trust over excitement.** Vietnamese center owners have been sold to before. The landing page should feel steady and credible, not hype-driven. Muted confidence over startup energy.
- **Competence over delight.** Teachers don't want to be delighted by a grading tool. They want to feel competent and fast. The AI grading result should feel like a reliable assistant, not a magic trick.
- **Belonging over onboarding.** Invited users should feel they're joining an existing community, not starting a new account. The invite screen centers the center's identity, not ClassLite's.
- **Calm over urgency.** Even on the landing page, avoid countdown timers, "limited time" pressure, or aggressive CTAs. The free tier is always available. Calm confidence converts better in this market than manufactured urgency.

**Critical to avoid:**
- **Suspicion** — "this looks too good / too polished to be real." Ground every claim. Show pricing. Name real center archetypes.
- **Abandonment** — "it's broken and no one is helping me." Every failure state names what happened and offers one clear next action. No dead ends, no generic errors.
- **Overwhelm** — "there's too much to set up before I can use this." Value before configuration. One sample essay, one button. Setup comes after the user has felt the product work.
- **Impatience** — "why do I need to verify my email to use this?" The verification gate must feel like a 30-second pause, not a bureaucratic wall. Copy matters: "Almost there — check your inbox" not "You must verify your email before proceeding."

### Design Implications

| Emotional Goal | UX Design Approach |
|---|---|
| **Recognition** (owner, landing) | Use Vietnamese-register social proof: named center archetypes, specific outcomes in VND and minutes saved. Mirror the visitor's reality before pitching the product. |
| **Relief** (owner, landing) | Pain articulation layer with quantified cost. Calculator-style framing: "5 teachers × 3 hours/week × 48 weeks = 720 hours/year on manual grading." Make the status quo feel expensive. |
| **Momentum** (teacher, auth) | Google OAuth as the largest button on the page. Minimal form fields. Progress indicators that move fast. No unnecessary screens between click and dashboard. |
| **Belonging** (invited users) | Invite screen leads with the center's name and inviter's identity, not ClassLite branding. "Linh invited you to join IELTS Academy as a Teacher." The product is the backdrop; the center is the foreground. |
| **Simplicity** (student, mobile) | Auth screens at mobile breakpoint: one action per screen, full-width buttons, no sidebar, no navigation chrome. The student path is a straight line — no branches, no choices beyond "Continue with Google" or "Create account." |
| **Quiet competence** (first AI grade) | No celebratory animations or "congratulations" modals after the first AI grade. The result simply appears — band scores, inline comments, clear and usable. The teacher's reaction should be "huh, that was fast" not "wow, cool animation." Understatement signals reliability. |
| **Confident recovery** (failure states) | Every error screen uses a three-part structure: (1) what happened, in plain language, (2) why it happened, in one sentence, (3) what to do next, as a single button. No jargon, no error codes, no dead ends. |
| **Calm** (landing page tone) | No countdown timers, no "limited spots", no aggressive red CTAs. The primary button is a calm, confident color. The free tier is permanent and visible. Annual pricing toggle shows savings without pressure language. |
| **Patience** (verification gate) | The verification pending screen uses a friendly illustration, a clear "check your inbox" message, and a visible countdown to when "Resend" becomes available. The page auto-detects verification (polls or listens) and redirects without requiring the user to click anything after verifying. |

### Emotional Design Principles

1. **Credibility is the emotion.** In a market where software distrust is the default, the highest-value emotional state is "I believe this will work." Every design choice — copy, layout, imagery, pricing display — is in service of credibility. Delight is a luxury; trust is the requirement.

2. **Understatement signals reliability.** The product that works doesn't need to shout. AI grading results appear cleanly. Pricing is stated plainly. Error messages are calm and helpful. The tone is a confident professional, not an excited salesperson.

3. **Speed is an emotion.** When auth takes 10 seconds and the first AI grade takes 30 seconds, the user *feels* that the product respects their time. Speed isn't a technical metric — it's the primary emotional signal that this product is different from the tools that wasted their time before.

4. **Belonging before branding.** On invite flows, the center's identity comes first, ClassLite's branding comes second. The product is the infrastructure; the user's center is the experience. This applies to invite emails, acceptance screens, and the first dashboard view.

5. **Recovery is care.** How a product handles failure is how it shows it cares. A thoughtful error message with a clear next step communicates more empathy than any onboarding animation. Design failure states with the same care as happy paths.

## UX Pattern Analysis & Inspiration

### Inspiring Products Analysis

#### Duolingo — "Play first, profile second"

Duolingo's core UX insight is radical: **let the user experience value before asking them to create an account.** A visitor starts a language exercise within seconds of landing — no signup, no email, no profile. Account creation is deferred until the user has already invested effort and wants to save progress. By the time the signup modal appears, the user has felt the product work and has a reason to stay.

**What ClassLite can learn:**
- **Value before identity.** Duolingo proves that deferring signup increases activation. ClassLite's "first AI grade on a sample essay" principle is the equivalent — but we require signup first (because AI grading consumes credits and needs a center context). The takeaway: make the path from signup to first AI grade as short as Duolingo makes the path from landing to first exercise.
- **One action per screen.** Duolingo's onboarding never shows two choices when one will do. Each screen has one primary action. ClassLite's auth screens should follow this — especially the mobile student path.
- **Friendly, non-intimidating tone.** Duolingo's copy is warm and encouraging, never corporate. ClassLite's landing page and auth screens should use a similar register — professional but approachable. "Almost there — check your inbox" not "Email verification required."
- **Personalization at signup.** Duolingo asks 3-4 questions (language, goal, level) to personalize the experience immediately. ClassLite's persona selection (Operator/Founder/Solo Teacher) serves the same function — but should feel equally lightweight and purposeful.
- **Contextual education over upfront tutorials.** Duolingo teaches by doing, not by explaining. ClassLite's first-run AI grading experience should work the same way — the user learns what AI grading does by doing it, not by reading about it.

#### YouPass — Vietnamese IELTS credibility benchmark

YouPass (by IELTS 1984) is the closest product to ClassLite's market. It's a self-study IELTS platform, free, built by a recognized Ho Chi Minh City prep center. Teachers and students already use it — it's the default reference point for "IELTS tool in Vietnam."

**What ClassLite can learn:**
- **Immediate skill-based entry.** YouPass's landing page shows four skill cards (Reading, Listening, Writing, Speaking) with "Practice Now" buttons. Zero friction to start. ClassLite's landing page is B2B (selling to center owners), so it can't do the same — but the principle of "show what you can do, not what you are" applies. Feature screenshots showing AI grading in action > abstract benefit statements.
- **Vietnamese-first with IELTS English.** YouPass is fully Vietnamese with IELTS terminology in English (band score, Reading, Listening, etc.). This is the correct bilingual register for the Vietnamese IELTS market. ClassLite should follow the same pattern — Vietnamese primary, IELTS terms in English, not translated.
- **Clean, card-based visual hierarchy.** Red/coral accent on white, Nunito typography, SVG illustrations. Student-friendly and approachable. ClassLite needs to feel more *professional* than YouPass (B2B vs B2C), but the clean card-based approach and warm color palette are worth noting.
- **Zalo support widget.** YouPass has floating Zalo chat. Vietnamese users expect Zalo as a support channel. ClassLite should consider this for the landing page — it's a trust signal in this market.
- **Institutional credibility.** YouPass leads with "from IELTS 1984" — a recognized center. ClassLite doesn't have institutional backing, so it must build credibility through other means: named center archetypes, outcome data, transparent pricing.

**Key difference:** YouPass is a B2C self-study tool (free, student-facing). ClassLite is a B2B center management platform (paid, owner/teacher-facing). YouPass's UX can be frictionless because there's nothing to configure. ClassLite must balance "try it fast" with "set up your center." The first AI grade experience bridges this gap — it's the ClassLite equivalent of YouPass's instant "Practice Now."

### Transferable UX Patterns

**Navigation Patterns:**
- **Skill-based entry cards** (YouPass) → Adapt for landing page feature showcase. Instead of "Practice Now," show "See AI Grading," "See Class Management," "See Analytics" with visual previews.
- **One action per screen** (Duolingo) → Apply to all auth screens, especially mobile. Login: one form. Register: one form. Verify: one message + one button. Never two competing CTAs.

**Interaction Patterns:**
- **Value before signup** (Duolingo) → Express as "first AI grade before configuration." The sample essay grading experience is ClassLite's equivalent of Duolingo's first translation exercise.
- **Personalization at entry** (Duolingo) → The persona selection (Operator/Founder/Solo Teacher) is ClassLite's personalization moment. Make it feel like Duolingo's language picker — visual, quick, with clear "this changes what you see next" signaling.
- **Contextual learning** (Duolingo) → Don't explain AI grading before the user tries it. Let them run the grader on a sample essay, then explain the result. Learning by doing.

**Visual Patterns:**
- **Clean card-based layout on white** (YouPass) → Landing page pricing section and feature blocks as cards with clear visual hierarchy.
- **Warm, approachable color palette** (both) → ClassLite's amber accent is already in this space. Avoid cold corporate blues for the landing page. Warm signals trust in the Vietnamese market.
- **Vietnamese-first with English IELTS terms** (YouPass) → Landing page default language is Vietnamese. IELTS terminology stays in English. Language toggle is visible but not the first thing users see.

### Anti-Patterns to Avoid

- **Generic SaaS landing page template.** Stock photos, vague "streamline your workflow" copy, English-first with Vietnamese as afterthought. This signals "foreign startup" and kills trust in the Vietnamese market. ClassLite must feel local.
- **Feature-first landing page.** Listing 20 features above the fold. YouPass works because it shows what you can *do*, not what the product *has*. Lead with the pain articulation and outcome, not a feature grid.
- **Signup wall before any value.** Duolingo proves this kills activation. ClassLite can't fully defer signup (AI grading needs auth), but the path from signup to first value must be measured in seconds, not minutes.
- **"Schedule a demo" as primary CTA.** This is enterprise SaaS pattern. Vietnamese center owners (2-15 teachers) want to try it themselves, not book a call. The free tier is the demo. "Start free" is the only CTA that works.
- **Translated-from-English copy.** Writing landing page copy in English and translating to Vietnamese produces awkward, unnatural text. Vietnamese copy should be written natively, not translated. IELTS terms remain in English.
- **Heavy JavaScript landing page.** YouPass loads fast on Vietnamese mobile networks. Astro's static output is the right call — the landing page should feel as instant as YouPass, not like a React SPA cold-starting.

### Design Inspiration Strategy

**Adopt directly:**
- One action per screen on auth flows (Duolingo)
- Vietnamese-first with English IELTS terms (YouPass)
- Card-based visual hierarchy for pricing and features (YouPass)
- Warm, approachable color palette — amber/coral over corporate blue (both)
- Fast static page load for landing (YouPass + Astro architecture)

**Adapt for ClassLite's B2B context:**
- Duolingo's "play first" → "grade first" (sample essay before configuration)
- Duolingo's persona questions → ClassLite's Operator/Founder/Solo picker (make it feel equally lightweight)
- YouPass's "Practice Now" instant entry → Feature preview cards with screenshots/demos showing AI grading in action
- YouPass's Zalo support widget → Consider for landing page as a Vietnamese-market trust signal

**Avoid:**
- Generic English-first SaaS templates (kills local trust)
- Feature-list landing pages (lead with pain + outcome, not capabilities)
- "Schedule a demo" CTAs (free tier is the demo)
- Heavy JS landing pages (Astro static is correct — match YouPass's speed)
- Translated-from-English copy (write Vietnamese natively)

## Design System Foundation

### Design System Choice

**Tailwind CSS + shadcn/ui**, themed to match ClassLite's existing mockup design language — a warm, paper-toned aesthetic with serif display typography and navy/amber accent system.

- **Dashboard auth screens** (`my.classlite.app`): shadcn/ui components themed with ClassLite's design tokens. Radix UI primitives provide WCAG 2.1 AA accessibility.
- **Landing page** (`classlite.app`): Tailwind CSS consuming the same tokens. Astro components are hand-built but visually identical.
- **Shared design tokens** (`@classlite/tokens`): CSS custom properties — single source of truth.

### Rationale for Selection

1. **Strong existing visual identity.** The mockups define a distinctive warm, paper-toned design language with serif display type. This is not a generic SaaS look — it must be preserved exactly.
2. **shadcn/ui is fully customizable.** Components are copied into the project and themed via CSS variables. The paper/ink palette maps directly to token overrides.
3. **Tailwind bridges both codebases.** Both Astro and React consume the same custom properties.
4. **Accessibility built-in.** Radix primitives handle focus management, keyboard navigation, and ARIA for auth forms.

### Implementation Approach

**Design tokens (`@classlite/tokens`) — extracted from mockups:**

```css
:root {
  /* Surfaces */
  --cl-paper:          #f5f1ea;   /* Primary background (warm off-white) */
  --cl-paper-2:        #efe9df;   /* Secondary background */
  --cl-surface:        #ffffff;   /* Card/panel background */
  --cl-surface-warm:   #fcfaf6;   /* Side panels, modal footers */
  --cl-surface-compose:#fdf9ef;   /* Compose/editor bg */

  /* Text */
  --cl-ink:            #1a1f2e;   /* Primary text / dark UI */
  --cl-ink-soft:       #2c3242;   /* Secondary text */
  --cl-muted:          #6b6f7a;   /* Tertiary text / labels / placeholders */

  /* Accents */
  --cl-accent:         #1e3a8a;   /* Primary accent (deep blue) */
  --cl-accent-2:       #d97706;   /* Secondary accent (amber/gold) */

  /* Borders */
  --cl-line:           #d9d2c4;   /* Border / divider (warm gray) */
  --cl-line-soft:      #e6e1d5;   /* Subtle border */

  /* Status */
  --cl-green:          #166534;   /* Success / active */
  --cl-red:            #991b1b;   /* Error / danger */
  --cl-amber:          #b45309;   /* Warning / late */

  /* Status tints (backgrounds) */
  --cl-tint-blue:      #eef0fb;   /* Accent/upcoming */
  --cl-tint-gold:      #fdf6e3;   /* Writing/amber */
  --cl-tint-green:     #ecf4ec;   /* Reading/success/active */
  --cl-tint-red:       #fbeaea;   /* Speaking/error/ended */

  /* Chip */
  --cl-chip-bg:        #ebe5d6;

  /* Typography */
  --cl-font-display:   'Fraunces', 'Times New Roman', serif;
  --cl-font-body:      'Geist', system-ui, sans-serif;
  --cl-font-mono:      'Geist Mono', monospace;

  /* Radius */
  --cl-radius-xs:      4px;    /* Tags, badges, pills (inner) */
  --cl-radius-sm:      6px;    /* Buttons, inputs, nav items, tabs */
  --cl-radius-md:      8px;    /* Link cards, compose areas */
  --cl-radius-lg:      10px;   /* Section blocks, action cards, hub tiles */
  --cl-radius-xl:      12px;   /* Dashboard stats, setup cards, schedule cards */
  --cl-radius-2xl:     14px;   /* Modals, browser frames */
  --cl-radius-full:    999px;  /* Pills, chips, switches, progress bars */

  /* Shadows */
  --cl-shadow-subtle:  0 1px 3px rgba(0,0,0,0.06);
  --cl-shadow-card:    0 8px 24px -12px rgba(26,31,46,0.08);
  --cl-shadow-dropdown:0 6px 20px -6px rgba(26,31,46,0.4);
  --cl-shadow-modal:   0 30px 60px -20px rgba(26,31,46,0.5);
  --cl-shadow-amber:   0 4px 14px -6px rgba(217,119,6,0.4);

  /* Scrim */
  --cl-scrim:          rgba(26,31,46,0.32);

  /* Sidebar */
  --cl-sidebar-bg:     #1a1f2e;
  --cl-sidebar-text:   #cfd1d8;
  --cl-sidebar-hover:  #252a39;
  --cl-sidebar-active-bg: #ffffff;
  --cl-sidebar-active-text: #1a1f2e;
  --cl-sidebar-width:  220px;

  /* Layout */
  --cl-topbar-height:  56px;
  --cl-page-max-width: 1320px;
  --cl-modal-width:    460px;
  --cl-side-panel:     300px;
  --cl-detail-panel:   320px;
}
```

**Typography scale (from mockups):**

| Role | Font | Size | Weight | Letter-spacing |
|---|---|---|---|---|
| Hero h1 | Fraunces | 44px | 400 | -0.02em |
| Page h1 | Fraunces | 36px | 400 | -0.02em |
| Section h2 | Fraunces | 28px | 400 | -0.01em |
| Section h3 | Fraunces | 18px | 500 | -0.005em |
| Modal title | Fraunces | 19px | 400 | -0.02em |
| Body | Geist | 15px | 400 | 0 |
| Body small | Geist | 13px | 400 | 0 |
| Buttons | Geist | 12.5px | 500 | 0 |
| Labels/mono | Geist Mono | 10px | 500 | 0.14em |
| Nav group | Geist Mono | 9.5px | 500 | 0.18em |
| Eyebrow | Geist Mono | 11px | 500 | 0.14em |

**Component specs (from mockups):**

| Component | Spec |
|---|---|
| **Button (default)** | bg: `#fff`, border: `1px solid var(--cl-line)`, radius: `6px`, padding: `7px 14px`, font: Geist 12.5px/500 |
| **Button (primary)** | bg: `var(--cl-ink)`, color: `#fff`, hover: bg `var(--cl-accent)` |
| **Input** | border: `1px solid var(--cl-line)`, radius: `6px`, padding: `9px 11px`, font: Geist 13px |
| **Card** | bg: `#fff`, border: `1px solid var(--cl-line-soft)`, radius: `10px` |
| **Modal** | width: `460px`, radius: `14px`, shadow: `--cl-shadow-modal`, scrim: `--cl-scrim`, footer bg: `#fcfaf6` |
| **Status pill** | radius: `999px`, padding: `4px 10px`, font: 11.5px/500 |
| **Badge (nav)** | bg: `var(--cl-accent-2)`, color: `#fff`, font: 10px/600, radius: `999px` |
| **Table header** | font: Geist Mono 10px/500, letter-spacing: 0.14em, padding: `14px 16px` |
| **Avatar** | 28px circle, gradient: `135deg var(--cl-accent) → var(--cl-accent-2)` |
| **Switch** | track: 34×19px, knob: 15px circle, on: `var(--cl-accent)` |
| **Progress bar** | height: 6px, track: `var(--cl-line-soft)`, fill: `var(--cl-accent)`, radius: `999px` |

**Background pattern (dot grid):**
`radial-gradient(circle at 1px 1px, rgba(26,31,46,0.04) 1px, transparent 0)`, size: `24px 24px` — used on body and onboarding shell.

### Customization Strategy

**What the tokens mean for landing page + auth:**

- **Paper background, not white.** The mockups use `#f5f1ea` (warm parchment), not pure white. The landing page and auth screens must match this warmth.
- **Deep navy as primary, not amber.** The primary action color is `--cl-ink` (`#1a1f2e`) with blue hover (`--cl-accent` `#1e3a8a`). Amber (`--cl-accent-2`) is secondary — used for badges, highlights, and accents.
- **Fraunces serif for headings.** The landing page hero, pricing section headers, and auth screen titles use Fraunces — a warm, distinctive serif. Body text uses Geist sans-serif. This serif/sans pairing gives ClassLite a more refined feel than typical SaaS.
- **Dot grid background pattern.** The subtle dot grid is used throughout the mockups. The landing page and auth screens should carry this pattern for visual continuity.
- **Sidebar is dark navy.** The authenticated app uses a `#1a1f2e` sidebar with white active states. Auth screens (pre-sidebar) should reference this navy — in the footer and as a design accent.

**Auth-specific application:**
- Google OAuth button: large, uses `--cl-ink` bg with white text (matches primary button style), Google logo inline. Visually dominant per "Google first" principle.
- Email/password form: `--cl-surface` (#fff) card on `--cl-paper` (#f5f1ea) background. Inputs use mockup specs (6px radius, line border, 13px Geist).
- Verification pending screen: dot grid background, Fraunces heading ("Almost there"), centered card layout matching modal specs (14px radius, warm footer bg).
- Error states: red tint background (`#fbeaea`) with `--cl-red` text, matching mockup status patterns.
- Invite acceptance: center's name in Fraunces display, role badge using `--cl-accent-2` amber (matching nav badge style).

**Landing-specific application:**
- Hero: Fraunces 44px heading on dot-grid `--cl-paper` background. Primary CTA button in `--cl-ink` navy.
- Pricing cards: white cards (`--cl-surface`) on paper background, `--cl-line-soft` borders, `10px` radius. Popular tier highlighted with `--cl-tint-gold` border.
- Feature blocks: card-based with `--cl-shadow-card`, matching hub-tile and action-card patterns from mockups.
- Footer: `--cl-ink` navy background, `--cl-sidebar-text` (#cfd1d8) for links — mirrors the sidebar aesthetic.

## Defining Core Experience

### Defining Experience

**"I saw what it does, signed up with Google, and graded a sample essay — all before my coffee got cold."**

The defining experience for the landing page and auth flows is the **speed of the trust-to-value pipeline** — how fast a skeptical Vietnamese center owner or teacher goes from "what is this?" to "this actually works." This is not a single screen or interaction. It's the seamless compression of five cognitive stages into minutes:

1. Awareness → "I have a problem I'm paying for" (landing page pain articulation)
2. Recognition → "This is for someone like me" (social proof, pricing, center archetypes)
3. Decision → "I'll try the free tier" (CTA click)
4. Entry → "I'm in" (Google OAuth, 10 seconds)
5. Proof → "It works" (first AI grade on sample essay)

Every screen in this scope exists to accelerate the visitor through these stages. A delay at any stage — a confusing landing page, a slow auth flow, a verification wall, a blank dashboard — breaks the pipeline and loses the user permanently.

### User Mental Model

**What the center owner brings to this moment:**

The Vietnamese center owner arriving at `classlite.app` is not a first-time software buyer. They've used Google Classroom, maybe Zalo for group communication, probably a shared Google Sheet for grades. Their mental model for "new software" is:

- "This will take hours to set up before I know if it's useful"
- "My teachers won't adopt it even if I like it"
- "The free tier will be crippled and I'll have to pay to evaluate properly"
- "It's probably not designed for Vietnamese centers"

Every one of these assumptions must be broken in the first 60 seconds.

**What the teacher brings:**

A teacher clicking an invite link thinks: "My boss told me to sign up for this thing." Their mental model is compliance, not curiosity. The invite flow must convert compliance into interest by answering one question immediately: "What do I actually do here?" The answer is: "Grade this sample essay with AI." Not "explore the dashboard" or "complete your profile."

**What the student brings:**

A student tapping a link on their phone thinks: "My teacher told me to join." Their mental model is simplicity — tap, sign in, see my class. Any screen that isn't directly on that path is friction. Students don't read onboarding. They don't care about ClassLite's value proposition. They want to find their assignment.

**Current solutions and their mental residue:**

| Current tool | What they love | What they hate | Mental residue for ClassLite |
|---|---|---|---|
| WhatsApp/Zalo groups | Instant, everyone's already there | Chaotic, no structure, can't find anything | "Will this be as fast to communicate through?" |
| Google Sheets (gradebook) | Flexible, familiar, free | Manual, error-prone, no analytics | "Will entering grades be slower than my spreadsheet?" |
| Paper gradebooks | Tangible, no tech issues | Can't share, no analytics, lost data | "I don't trust digital — what if data disappears?" |
| YouPass | Free practice, AI writing feedback | Student-only, no center management | "Will this have the same quality of IELTS content?" |

### Success Criteria

The core experience succeeds when:

| Criteria | Metric | How we know |
|---|---|---|
| **Landing page holds attention** | Visitor stays >15 seconds, scrolls past hero | Scroll depth tracking, bounce rate <60% |
| **CTA converts** | >20% of visitors who scroll to pricing click "Start free" | Click-through rate on primary CTA |
| **Auth completes** | >85% of users who start signup finish it | Funnel completion rate (start → dashboard) |
| **Google OAuth dominance** | >65% of signups use Google OAuth | Auth method distribution |
| **Verification doesn't kill** | >80% of email/password users verify within 1 hour | Time-to-verify distribution |
| **First AI grade happens** | >60% of new users run AI grading in first session | SM-adjacent: first-session activation |
| **Time-to-value** | Median <5 minutes from landing page to first AI grade result | End-to-end funnel timing |
| **Invite acceptance rate** | >70% of sent invites are accepted within 48 hours | Invite → active user conversion |

The experience fails when:
- A visitor bounces from the landing page because it looks like a generic English-language SaaS
- A user abandons signup because Google OAuth failed and email/password feels like too much work
- A teacher accepts an invite but never grades anything because there was no clear first action
- An owner sets up their center but never sees proof that AI grading works

### Novel UX Patterns

**Mostly established patterns, applied to a specific market:**

The landing page and auth flows don't require novel interaction design. Registration forms, OAuth buttons, pricing tables, and verification screens are deeply established. The innovation is in how these patterns are **sequenced and contextualized** for the Vietnamese IELTS market.

**Established patterns we adopt as-is:**
- Google OAuth as primary auth (standard)
- Email/password as fallback (standard)
- Pricing comparison table with tier toggle (standard SaaS)
- Email verification with resend (standard)
- Password reset via email link (standard)
- Invite acceptance with pre-filled form (standard B2B SaaS)

**Established patterns we adapt:**
- **Pain articulation before feature showcase** (adapted from long-form sales pages). Landing pages typically lead with features or a hero value proposition. We lead with a quantified cost of the status quo — adapted from direct-response copywriting, uncommon in SaaS landing pages.
- **"Grade first, configure later" onboarding** (adapted from Duolingo's "play first" pattern). Instead of setup → explore → discover value, we flip to: signup → sample AI grade → setup. This is a known pattern (Duolingo, Canva) but novel for B2B education SaaS.
- **Center-branded invite acceptance** (adapted from Slack's workspace invite). The invite screen foregrounds the center's identity, not ClassLite's. This is borrowed from team-first collaboration tools but uncommon in edtech.

**Nothing requires user education.** Every interaction uses patterns users already know. The "novelty" is contextual — not in how the interactions work, but in what content they surface and in what order.

### Experience Mechanics

**The trust-to-value pipeline, screen by screen:**

#### Stage 1: Landing Page → Decision (classlite.app)

**Initiation:** Visitor arrives via search, referral, or direct URL. Browser detects locale → Vietnamese or English route.

**Interaction flow:**
1. **Hero** (above fold) — Fraunces heading quantifying the pain: "Giáo viên của bạn đang mất 12 phút chấm mỗi bài Writing. ClassLite giảm xuống còn 3 phút." Primary CTA: "Bắt đầu miễn phí" (Start free). Secondary: "Xem cách hoạt động" (See how it works) scrolls to features.
2. **Pain articulation** — Calculator-style visual: "5 giáo viên × 3 giờ/tuần × 48 tuần = 720 giờ/năm chấm bài thủ công" (720 hours/year of manual grading).
3. **Feature showcase** — 3-4 cards with screenshots: AI grading in action, class management dashboard, student analytics. Visual proof of capability, not a feature list.
4. **Social proof** — Named center archetypes: "Trung tâm IELTS, TP.HCM, 8 giáo viên — giảm 65% thời gian chấm bài." Local, specific, Vietnamese-register.
5. **Pricing** — Three tier cards (Free/Pro/Studio), VND, annual/monthly toggle. Free tier CTA: "Bắt đầu miễn phí." Pro/Studio: "Dùng thử miễn phí."
6. **Footer** — Navy background (mirrors sidebar), legal links, language toggle, Zalo support widget.

**Feedback:** Smooth scroll between sections. CTA buttons always visible (sticky header with CTA on scroll-past-hero).

**Completion:** Visitor clicks CTA → redirected to `my.classlite.app/register` (or `/register?plan=pro` for tier-specific CTAs).

#### Stage 2: Auth → Account Creation (my.classlite.app)

**Initiation:** User lands on register page. Same paper background, dot grid, Fraunces headings — visually continuous with landing page.

**Interaction flow (Google OAuth — happy path):**
1. Register screen shows: Fraunces heading "Tạo tài khoản", large Google OAuth button ("Tiếp tục với Google"), divider "hoặc", email/password form below.
2. User clicks Google OAuth → Google consent screen → callback → cookie set → redirect to onboarding.
3. Total time: ~10 seconds P50.

**Interaction flow (Email/password — secondary path):**
1. Same screen. User fills: full name, email, password (with strength indicator). Clicks "Tạo tài khoản."
2. → Verification pending screen: dot grid background, Fraunces heading "Kiểm tra email", email address shown, "Gửi lại" button with 60-second cooldown, link to "Thử đăng nhập bằng Google."
3. User clicks email link → verified → redirect to onboarding.
4. Total time: 1-3 minutes (dependent on email delivery).

**Interaction flow (Login — returning user):**
1. Login screen: Google OAuth button (primary), email/password form (secondary), "Quên mật khẩu?" link.
2. Failed login: generic "Email hoặc mật khẩu không đúng" error. After 5 failures: lockout screen with countdown.

**Feedback:** Inline validation, live password strength indicator. Google OAuth shows brief loading state before redirect.

**Completion:** Authenticated user lands on persona selection (new) or dashboard (returning).

#### Stage 3: Invite Acceptance (my.classlite.app/invite)

**Initiation:** User clicks invite link from email. Link contains signed token with invite ID.

**Interaction flow (valid invite, new user):**
1. Invite screen: center logo/lettermark, Fraunces heading "[Inviter name] đã mời bạn tham gia [Center name]", role badge in amber, Google OAuth button + email/password form (email locked to invite address).
2. User authenticates → role-appropriate dashboard. No onboarding wizard.
3. Teachers see "Chấm bài đầu tiên" (Grade your first essay) CTA card with pre-loaded sample.

**Interaction flow (valid invite, existing user):**
1. "Bạn đã có tài khoản ClassLite" message + single "Tham gia [Center name]" button.
2. One click → linked to center → dashboard.

**Interaction flow (expired/invalid invite):**
1. Fraunces heading "Lời mời đã hết hạn", center name visible, CTA: "Liên hệ [inviter name] để gửi lại" with mailto link.

**Feedback:** Center branding loads immediately — no skeleton for center info.

**Completion:** User is in the center's dashboard with a clear first action.

#### Stage 4: First AI Grade → Proof (post-auth)

**Initiation:** New user sees prominent "Thử chấm bài bằng AI" card on first dashboard. One click.

**Interaction flow:**
1. Pre-loaded sample IELTS Writing essay in grading view. Single CTA: "Chạy AI chấm bài."
2. Click → loading state (~15-30 seconds) with "AI đang phân tích bài viết..." → results appear: band scores for 4 criteria, inline comments, overall band.
3. No forced next action — user can explore, dismiss, or start setting up.

**Feedback:** Animated progress during AI processing. Result appears with subtle transition — no celebratory modal. Clean and usable.

**Completion:** The teacher has felt the 12→3 minute promise. The pipeline is complete.

## Visual Design Foundation

### Color System — Accessibility Audit

**WCAG 2.1 AA contrast ratio verification against mockup tokens:**

#### Passing Combinations (no changes needed)

| Combination | Ratio | AA Normal | AA Large | AAA |
|---|---|---|---|---|
| `--cl-ink` on `--cl-paper` | 14.6:1 | PASS | PASS | PASS |
| `--cl-ink` on `--cl-surface` | 16.4:1 | PASS | PASS | PASS |
| `--cl-ink` on `--cl-paper-2` | 13.6:1 | PASS | PASS | PASS |
| `--cl-ink-soft` on `--cl-paper` | 11.4:1 | PASS | PASS | PASS |
| `--cl-ink-soft` on `--cl-surface` | 12.8:1 | PASS | PASS | PASS |
| `--cl-accent` on `--cl-paper` | 9.2:1 | PASS | PASS | PASS |
| `--cl-accent` on `--cl-surface` | 10.4:1 | PASS | PASS | PASS |
| `--cl-green` on `--cl-tint-green` | 6.4:1 | PASS | PASS | — |
| `--cl-red` on `--cl-tint-red` | 7.2:1 | PASS | PASS | PASS |
| `--cl-amber` on `--cl-tint-gold` | 4.7:1 | PASS | PASS | — |
| `--cl-accent` on `--cl-tint-blue` | 9.1:1 | PASS | PASS | PASS |
| `--cl-sidebar-text` on `--cl-sidebar-bg` | 10.8:1 | PASS | PASS | PASS |
| `#fff` on `--cl-ink` (primary btn) | 16.4:1 | PASS | PASS | PASS |
| `#fff` on `--cl-accent` (btn hover) | 10.4:1 | PASS | PASS | PASS |

#### Failures Requiring Token Adjustments

| # | Combination | Ratio | Severity | Issue |
|---|---|---|---|---|
| 1 | `--cl-muted` on `--cl-paper` | 4.5:1 | MEDIUM | Borderline — fails AA normal by rounding |
| 2 | `--cl-muted` on `--cl-paper-2` | 4.2:1 | MEDIUM | Fails AA normal text |
| 3 | `--cl-accent-2` on `--cl-paper` | 2.8:1 | HIGH | Fails AA normal AND large text |
| 4 | `--cl-accent-2` on `--cl-surface` | 3.2:1 | HIGH | Fails AA normal text |
| 5 | `#fff` on `--cl-accent-2` (badge) | 3.2:1 | HIGH | White on amber fails AA normal |
| 6 | `--cl-line` on `--cl-paper` | 1.3:1 | INFO | Decorative border — exempt if non-interactive |
| 7 | `--cl-line-soft` on `--cl-surface` | 1.3:1 | INFO | Decorative border — exempt if non-interactive |

#### Required Token Fixes

```css
/* FIX 1: Darken muted text for AA compliance on warm backgrounds */
--cl-muted: #595c66;   /* 5.1:1 on --cl-paper, 5.7:1 on --cl-surface */

/* FIX 2: Amber accent needs text-safe and decorative variants */
--cl-accent-2: #d97706;          /* KEEP for decorative use */
--cl-accent-2-text: #7c4309;     /* Text-safe: 5.0:1 on white */
--cl-accent-2-btn: #92500a;      /* Button-safe: white text = 4.6:1 */

/* FIX 3: Input borders — darken for interactive controls (WCAG 1.4.11) */
--cl-line-interactive: #a8a095;   /* 3.0:1 on --cl-paper */
```

**Rule for auth screens:** `--cl-accent-2` (#d97706) is never used as foreground text on light backgrounds. Use `--cl-accent-2-text` for text, or `--cl-ink` on `--cl-accent-2` backgrounds.

### Landing Page Visual Hierarchy

#### Layout Structure

```
┌─────────────────────────────────────────────┐
│  Header (sticky on scroll)                  │
│  Logo · Nav links · Lang toggle · CTA btn   │
├─────────────────────────────────────────────┤
│  HERO (--cl-paper bg, dot grid)             │
│  Fraunces 44px · Geist 15px · CTA btn      │
├─────────────────────────────────────────────┤
│  PAIN ARTICULATION (--cl-surface cards)     │
│  Calculator visual, Geist Mono numbers      │
├─────────────────────────────────────────────┤
│  FEATURES (3-4 cards, --cl-surface bg)      │
│  Screenshot + Fraunces 28px + body          │
├─────────────────────────────────────────────┤
│  SOCIAL PROOF (--cl-paper-2 bg section)     │
│  Center archetypes, outcome stats           │
├─────────────────────────────────────────────┤
│  PRICING (--cl-paper bg)                    │
│  3 tier cards, toggle, VND                  │
├─────────────────────────────────────────────┤
│  FOOTER (--cl-ink bg, mirrors sidebar)      │
│  --cl-sidebar-text for links                │
└─────────────────────────────────────────────┘
```

#### Section Specs

| Section | Background | Max Width | Typography | Spacing |
|---|---|---|---|---|
| **Header** | `--cl-surface` + `--cl-line-soft` border | 1320px | Fraunces 22px logo, Geist 13px nav | `18px 32px` |
| **Hero** | `--cl-paper` + dot grid | 880px | Fraunces 44px h1, Geist 15px body | `80px 32px 64px` |
| **Pain** | `--cl-surface` | 880px | Geist Mono 28px stats, Geist 13px labels | `64px 32px` |
| **Features** | `--cl-paper` | 1120px (3-col) | Fraunces 28px titles, Geist 13px body | Gap `24px`, card padding `24px` |
| **Social proof** | `--cl-paper-2` | 880px | Fraunces 18px names, Geist 13px | `64px 32px` |
| **Pricing** | `--cl-paper` | 1000px (3-col) | Fraunces 22px tiers, Geist Mono 28px prices | Gap `20px`, card padding `28px` |
| **Footer** | `--cl-ink` | 1320px | Fraunces 22px wordmark, Geist 12px links | `48px 32px` |

#### Landing Component Variants

| Component | Dashboard spec | Landing adaptation |
|---|---|---|
| **Primary CTA** | `7px 14px`, 12.5px | Larger: `14px 28px`, 15px. Full-width on mobile. |
| **Secondary CTA** | N/A | Ghost: transparent bg, `--cl-ink` text, `--cl-line` border |
| **Feature card** | Hub tile: 10px radius | Larger padding (24px), `--cl-shadow-card` on hover |
| **Pricing card** | N/A | 12px radius, `--cl-line-soft` border. Popular: `2px solid --cl-accent-2` + `--cl-tint-gold` header |
| **Stat number** | Fraunces 28px | Geist Mono 28px (desktop 36px), `--cl-accent-2-text` |

#### Sticky Header Behavior

- Default: transparent bg, logo + nav, CTA secondary style
- On scroll past hero: `--cl-surface` bg + `--cl-line-soft` border + `--cl-shadow-subtle`, CTA becomes primary
- Transition: `all 0.2s`

### Mobile Auth Visual Treatment

Auth screens at 390×844 (iPhone reference). No sidebar, no topbar — full-bleed until authenticated.

#### Mobile Layout Principles

- One action per screen, full-width buttons, centered card layout
- Minimum 44×44px touch targets (WCAG 2.5.5), buttons at 48px height
- Thumb-zone: primary CTA in bottom third of screen
- Card: 14px radius, `--cl-shadow-card`, `padding: 24px 20px`

#### Mobile Screen Wireframes

**Register:**
```
┌──────────────────────┐
│  ClassLite wordmark   │  Fraunces 22px
│  (dot grid bg)        │
│  ┌──────────────────┐ │
│  │ Tạo tài khoản    │ │  Fraunces 28px
│  │ [Google btn]     │ │  48px, full-width, --cl-ink
│  │ ─── hoặc ───    │ │
│  │ [Họ và tên]      │ │  48px inputs
│  │ [Email]          │ │
│  │ [Mật khẩu] [👁]  │ │  Strength indicator
│  │ [Tạo tài khoản]  │ │  Full-width primary
│  │ Đã có? Đăng nhập │ │  --cl-accent link
│  └──────────────────┘ │
└──────────────────────┘
```

**Verification pending:**
```
┌──────────────────────┐
│  ClassLite wordmark   │
│  ┌──────────────────┐ │
│  │  ✉️              │ │  80px illustration
│  │ Kiểm tra email   │ │  Fraunces 28px
│  │ Link xác nhận    │ │  Geist 15px
│  │ đến email@...    │ │  --cl-ink bold
│  │ [Gửi lại] (57s)  │ │  Secondary btn + countdown
│  │ Thử Google       │ │  --cl-accent link
│  └──────────────────┘ │
└──────────────────────┘
```

**Invite acceptance:**
```
┌──────────────────────┐
│  ClassLite wordmark   │
│  ┌──────────────────┐ │
│  │  [Center logo]   │ │  48px
│  │ Linh đã mời bạn  │ │  Fraunces 22px
│  │ IELTS Academy    │ │  Fraunces 28px
│  │ [Giáo viên]      │ │  Amber badge
│  │ [Google btn]     │ │  Full-width
│  │ ─── hoặc ───    │ │
│  │ [Email locked]   │ │  Read-only
│  │ [Password]       │ │
│  │ [Tham gia]       │ │  Full-width primary
│  └──────────────────┘ │
└──────────────────────┘
```

**Expired invite:**
```
┌──────────────────────┐
│  ClassLite wordmark   │
│  ┌──────────────────┐ │
│  │  ⏰              │ │  Illustration
│  │ Lời mời hết hạn  │ │  Fraunces 28px
│  │ IELTS Academy    │ │  --cl-ink bold
│  │ [Liên hệ Linh]   │ │  Primary btn, mailto
│  │ Về trang chủ     │ │  --cl-accent link
│  └──────────────────┘ │
└──────────────────────┘
```

#### Mobile Token Overrides

```css
@media (max-width: 640px) {
  --cl-input-height: 48px;
  --cl-btn-height: 48px;
  --cl-btn-font-size: 15px;
  --cl-card-padding: 24px 20px;
  --cl-card-margin: 0 16px;
  --cl-heading-size: 28px;
}
```

### Accessibility Considerations

1. **Focus indicators.** `2px solid var(--cl-accent)` with `2px` offset on all interactive elements.
2. **Touch targets.** Minimum 44×44px, buttons 48px on mobile.
3. **Form accessibility.** Visible labels (not placeholder-only), `aria-describedby` for errors, `aria-required` for required fields.
4. **Screen reader flow.** Landmark regions, sequential headings, `aria-label` on icon-only buttons.
5. **Motion sensitivity.** `prefers-reduced-motion` disables transitions and parallax.
6. **Language declaration.** `lang="vi"` or `lang="en"` on `<html>`. IELTS terms wrapped in `<span lang="en">`.
7. **Color not sole indicator.** Error = red tint + icon + text. Success = green tint + checkmark + text.

## Design Direction Decision

### Design Directions Explored

A single design direction was explored — the existing ClassLite mockup design language applied to the new landing page and auth screens. The visual identity is already established across 93 authenticated screens; the task was to extend it to the pre-auth experience, not to explore alternatives.

The HTML showcase (`_bmad-output/planning-artifacts/ux-design-directions.html`) contains 9 screens: LP-01 (Landing Page Desktop), AUTH-01 through AUTH-08 (Register, Login, Verification, Invite Acceptance, Lockout, Password Reset in desktop and mobile variants).

### Chosen Direction

**Warm paper aesthetic with serif/sans typography, navy/amber accents, extended to landing page and auth.** The direction maintains exact visual continuity with the 93 existing mockup screens.

Key characteristics:
- Warm parchment background (`#f5f1ea`) with subtle dot-grid pattern
- Fraunces serif for display headings, Geist sans-serif for body, Geist Mono for labels
- Deep navy (`#1a1f2e`) as primary button/text color, deep blue (`#1e3a8a`) as accent, amber (`#d97706`) as secondary accent
- White cards on paper background with warm gray borders
- Navy footer mirroring the authenticated sidebar

### Design Rationale

1. **Visual continuity across domains.** A user going from `classlite.app` (landing) to `my.classlite.app` (auth) to the dashboard must not notice the domain transition. Same paper background, same dot grid, same Fraunces headings, same button styles.

2. **Warm ≠ playful.** The paper/serif combination reads as professional-yet-approachable — right for B2B edtech in Vietnam. It avoids both the cold corporate blue of enterprise SaaS and the playful cartoon style of consumer apps like Duolingo. Trust through warmth, credibility through refinement.

3. **Vietnamese-first with IELTS English.** All screen text is natively Vietnamese with proper diacritics. IELTS terminology (Writing, Reading, Speaking, Listening, Task 2, band score) stays in English — matching the bilingual register Vietnamese IELTS teachers already use daily.

### Implementation Notes from Review

Feedback from party mode review (John, Winston, Amelia) produced these refinements, already applied to the HTML showcase:

**Google OAuth button (Winston — ToS compliance):** Changed from navy (`--ink`) background to Google's required branded styling — white background, line border, colored Google logo. Non-negotiable per Google's OAuth branding guidelines.

**Collapsed email/password form (John — conversion):** Register and login screens now show only the Google OAuth button by default. Email/password form is collapsed behind a "Đăng ký bằng email" / "Đăng nhập bằng email" link. Reduces visual noise, emphasizes Google as the primary path.

**"For IELTS centers" above the fold (John — intent clarity):** Added eyebrow text "Nền tảng quản lý trung tâm IELTS" above the hero heading. Answers "is this for me?" within the first 3 seconds.

**Recovery-focused lockout (John — tone):** Lockout screen heading changed from "Tài khoản tạm khóa" (punishing) to "Hãy thử lại sau" (recovery). "Quên mật khẩu?" promoted to primary CTA. Countdown timer made secondary.

**Spam hint on password reset (John — trust):** Added "Không nhận được email? Kiểm tra thư mục spam" below the submit button.

**Explicit verification fallback (John — clarity):** Verification pending Google fallback changed to: "Không nhận được email? Đăng nhập bằng Google — cùng tài khoản, không cần xác nhận."

**CTA after pricing (John — conversion):** Added "Bắt đầu miễn phí" CTA centered below the pricing grid.

**Vietnamese font support verified:** Fraunces supports Vietnamese subset (Google Fonts). Geist added full Vietnamese diacritics support in v1.6.0. Google Fonts URL includes `&subset=vietnamese,latin`.

### Open Implementation Questions (from Amelia)

These need answers before implementation begins:

| # | Question | Blocks |
|---|---|---|
| 1 | Go API endpoint contracts (request/response shapes) for auth | AUTH-04, AUTH-07 |
| 2 | Pain calculator formula + interactive inputs (static or configurable?) | LP-01 |
| 3 | OAuth strategy: redirect to `/auth/google` or use `@react-oauth/google` SDK? | AUTH-01/02/03 |
| 4 | Password strength library: `zxcvbn` or custom? | AUTH-01/02 |
| 5 | Invite token URL structure: `/invite?token=abc` or `/invite/abc`? | AUTH-05 |
| 6 | Pricing data: hardcoded in Astro or fetched from API? | LP-01 |
| 7 | Sticky header scroll threshold (px value) | LP-01 |
| 8 | Form validation trigger: `onBlur` or `onChange`? | AUTH-01/02/03 |
| 9 | `@classlite/tokens` package: monorepo workspace or inline CSS vars? | All screens |

**Recommended implementation order:** AUTH-08 → AUTH-06 → AUTH-03 → AUTH-05 → AUTH-01/02 → AUTH-07 → AUTH-04 → LP-01 (safest first, most dependencies last).

## User Journey Flows

### Journey 1: Owner Discovery → Signup → First AI Grade

The primary conversion funnel. A center owner finds ClassLite, evaluates it, signs up, and experiences AI grading.

```mermaid
flowchart TD
    A[Owner lands on classlite.app] --> B{Browser locale?}
    B -->|Vietnamese| C[/vi/ landing page]
    B -->|English| D[/en/ landing page]
    B -->|Other| C
    
    C --> E{Already logged in?<br>hint cookie check}
    D --> E
    E -->|Yes| F[Redirect to my.classlite.app/dashboard]
    E -->|No| G[View landing page]
    
    G --> H[Hero: pain articulation<br>"12 phút → 3 phút"]
    H --> I[Scroll: calculator, features,<br>social proof, pricing]
    I --> J{Clicks CTA?}
    J -->|"Bắt đầu miễn phí"| K[→ my.classlite.app/register]
    J -->|Pro/Studio CTA| L[→ my.classlite.app/register?plan=pro]
    J -->|Bounces| M[Lost — landing page failed]
    
    K --> N{Auth method?}
    L --> N
    N -->|Google OAuth| O[Google consent screen]
    N -->|"Đăng ký bằng email"| P[Expand email form]
    
    O --> Q{OAuth success?}
    Q -->|Yes| R[Cookie set → Redirect to onboarding]
    Q -->|Workspace blocked| S[Error: "Thử Gmail cá nhân<br>hoặc đăng ký bằng email"]
    S --> N
    
    P --> T[Fill: name, email, password]
    T --> U[Submit → Verification pending]
    U --> V{Email received?}
    V -->|Yes, clicks link| W[Verified → Redirect to onboarding]
    V -->|No after 60s| X["Gửi lại" or<br>"Thử Google — không cần xác nhận"]
    X -->|Resend| U
    X -->|Switch to Google| O
    
    R --> Y[Persona selection:<br>Operator / Founder / Solo]
    W --> Y
    Y --> Z[Center setup + class creation]
    Z --> AA["Thử chấm bài bằng AI" card<br>on first dashboard]
    AA --> AB[Pre-loaded sample essay]
    AB --> AC[Click "Chạy AI chấm bài"]
    AC --> AD[AI processing ~15-30s]
    AD --> AE[Band scores + inline comments appear]
    AE --> AF[✅ Pipeline complete:<br>"I just saved time"]
```

**Key decision points:**
- Auth method selection (Google vs email) — Google is visually primary
- Verification gate (email users only) — must feel brief, not blocking
- Persona selection — determines onboarding path, creates intermediate `role: null` state; API must handle users past auth but pre-onboarding
- First AI grade — the conversion trigger that justifies everything before it; sample essay is pre-loaded server-side, not hitting external LLM on unauthenticated users

**Estimated time (happy path):** Landing page (30-60s scroll) → Google OAuth (10s) → Persona + setup (2-3 min) → First AI grade (30s) = **under 5 minutes total**

---

### Journey 2: Teacher Invite Acceptance → First Grade

The highest-value conversion path. Each invite accepted is a switching-cost multiplier.

```mermaid
flowchart TD
    A[Teacher receives invite email] --> B[Clicks invite link]
    B --> C[→ my.classlite.app/invite/:token]
    C --> D{Token valid?}
    
    D -->|Expired| E[Expired screen:<br>"Lời mời đã hết hạn"<br>CTA: "Liên hệ inviter"]
    D -->|Already used| F[Redirect to login<br>"Bạn đã tham gia center"]
    D -->|Not found| G[Error screen:<br>"Link không hợp lệ"]
    
    D -->|Valid| H[Invite screen:<br>Center logo, inviter name,<br>role badge, center name]
    
    H --> I{Has existing account?}
    I -->|Yes, logged in| J[One-click "Tham gia"<br>→ linked to center → dashboard]
    I -->|Yes, not logged in| K[Login form with<br>Google OAuth + email/password]
    I -->|No account| L{Auth method?}
    
    L -->|Google OAuth| M[Google consent → callback<br>→ invite token in state param<br>→ validate email match<br>→ create account + accept invite]
    L -->|"Đăng ký bằng email"| N[Email locked to invite address<br>+ name + password]
    
    K --> O{Login success?}
    O -->|Yes| J
    O -->|Wrong password| P[Error + "Quên mật khẩu?" link]
    
    M --> Q{Email matches invite?}
    Q -->|Yes| R[Account created/linked<br>→ invite accepted → dashboard]
    Q -->|No| S[Mismatch screen:<br>"Lời mời gửi đến teacher@school.com.<br>Bạn đã đăng nhập bằng personal@gmail.com."]
    S --> S2{Recovery options}
    S2 -->|"Thử tài khoản Google khác"| M2[Sign out of Google<br>→ re-initiate OAuth]
    S2 -->|"Đăng ký bằng email"| N
    
    N --> T[Submit → Verification email]
    T --> U[Verify → invite accepted → dashboard]
    
    R --> V[Teacher dashboard:<br>"Chấm bài đầu tiên" CTA card]
    J --> V
    U --> V
    V --> W[Pre-loaded sample essay]
    W --> X[AI grading → results]
    X --> Y[✅ Teacher activated:<br>grades within 48 hours]
```

**Critical failure states:**
- Expired invite → shows center name and inviter, not generic error
- Email mismatch on OAuth → **specific recovery screen** showing which email was expected vs. which was used, with two recovery paths: try different Google account, or use email registration instead
- Already-accepted invite → graceful redirect to login, not an error
- Not-found token → distinct from expired (different error message)

**OAuth state management (from Winston):**
- Invite token travels in the OAuth `state` parameter, combined with CSRF nonce: `${nonce}:${inviteToken}`. Split on callback. Never skip CSRF verification.
- Token persistence: use the state param itself, not sessionStorage (which breaks if OAuth opens a new tab).
- Email match validated server-side atomically with account creation + invite acceptance.

---

### Journey 3: Student Invite Acceptance (Mobile)

Highest volume, simplest path. Zero tolerance for friction.

```mermaid
flowchart TD
    A[Student receives invite<br>via Zalo/SMS/email] --> B[Taps link on phone]
    B --> C[→ my.classlite.app/invite/:token<br>Mobile viewport]
    C --> D{Token valid?}
    
    D -->|Expired| E[Expired screen:<br>"Liên hệ giáo viên"]
    D -->|Valid| F[Invite screen:<br>Center name, teacher name,<br>role: "Học viên"]
    
    F --> G{Auth method?}
    G -->|Google OAuth<br>one tap| H[Google → callback<br>→ accept invite → class dashboard]
    G -->|"Đăng ký bằng email"| I[Name + email locked<br>+ password → verify → dashboard]
    
    H --> J[Student class dashboard:<br>assignments, schedule, feedback]
    I --> J
    
    J --> K[✅ Student in class:<br>sees first assignment]
```

**Target time:** Under 30 seconds for Google OAuth path (authenticated), under 50 seconds for cold unauthenticated path.

**Mobile-specific:** Full-width buttons, 48px touch targets, one action per screen. Student never sees onboarding wizard — they're placed directly into their class.

---

### Journey 4: Returning User Login (Happy + Failure Paths)

```mermaid
flowchart TD
    A[User opens my.classlite.app] --> B{Valid session?}
    B -->|Access token valid| C[→ Dashboard]
    B -->|Access token expired| D{Silent refresh}
    
    D -->|Refresh succeeds| C
    D -->|Refresh fails<br>token expired/revoked| E[→ Login screen<br>"Phiên đã hết hạn"]
    
    B -->|No session| F[→ Login screen]
    
    E --> F
    F --> G{Auth method?}
    G -->|Google OAuth| H[Google consent → dashboard]
    G -->|Email/password| I[Enter credentials]
    
    I --> J{Login result?}
    J -->|Success| K{Remember me?}
    K -->|Yes| L[30-day refresh token → dashboard]
    K -->|No| M[24-hour refresh token → dashboard]
    
    J -->|Wrong credentials| N[Generic error:<br>"Email hoặc mật khẩu không đúng"]
    N --> O{Attempt count?}
    O -->|< 5 attempts| F
    O -->|5 attempts in 10 min| P[Lockout screen:<br>"Hãy thử lại sau" + countdown]
    
    P --> Q{"Đặt lại mật khẩu"<br>primary CTA}
    Q --> R[Password reset flow]
    P --> S{Countdown expires}
    S --> F
    
    J -->|Unverified email| T[Verification pending screen<br>with resend + Google fallback]
```

**Multi-tab refresh coordination (from Winston):**
- Use `navigator.locks.request('token_refresh', ...)` alongside `BroadcastChannel`. One tab acquires the lock and refreshes; others wait, then read the new token from the broadcast.
- Without this lock, strict token rotation (single-use refresh tokens) causes one tab to get 401 on concurrent refresh — appearing as a silent logout.
- Lockout countdown initialized from server's `retry_after` timestamp, not a client-side constant. Page refresh fetches remaining lockout duration from API.

**Silent refresh preserves state:** When refresh bounce redirects to login, the URL the user was trying to reach is preserved. Post-login, they return to their in-progress work. Autosave ensures no data loss.

---

### Journey 5: Email Verification Gate

```mermaid
flowchart TD
    A[User registers with<br>email/password] --> B[API creates unverified account<br>+ sends verification email via Resend]
    B --> C[→ Verification pending screen]
    
    C --> D[Page polls GET /auth/verify-status<br>every 5 seconds]
    
    D --> E{Poll response?}
    E -->|status: unverified| D
    E -->|status: verified| F[Auto-redirect to onboarding<br>no manual action needed]
    E -->|status: token_expired| G["Link đã hết hạn"<br>→ "Gửi email mới" CTA]
    
    D --> H{Poll timeout?<br>10 min max}
    H -->|Yes| I[Stop polling<br>show manual "Kiểm tra lại" button]
    
    C --> J{60 seconds elapsed?}
    J -->|No| D
    J -->|Yes| K["Gửi lại" button activates]
    
    K --> L{User action?}
    L -->|Clicks "Gửi lại"| M[POST /auth/resend-verification<br>rate-limited server-side]
    M --> N[New email sent<br>countdown resets to 60s]
    N --> D
    
    L -->|Clicks Google fallback| O[Google OAuth flow]
    O --> P{oauth_email === registered_email?}
    P -->|Yes| Q[Account linked + verified<br>→ onboarding]
    P -->|No| R[Error: email mismatch<br>→ "Thử tài khoản Google khác"]
    
    L -->|Closes tab, returns later| S[Tries to login]
    S --> T{Account verified?}
    T -->|No| C
    T -->|Yes| U[→ Onboarding or dashboard]
```

**Key implementation details (from Winston):**
- Poll endpoint must be cheap — potentially hit every 5s by every unverified user. Go handler should be a simple DB lookup, no business logic.
- **Poll timeout at 10 minutes.** After 10 min, stop polling and show a manual "Kiểm tra lại" button. Prevents leaked long-lived connections.
- **Server returns three distinct statuses:** `unverified` (keep polling), `verified` (auto-redirect), `token_expired` (show "request new link"). Never return the same response for "not yet verified" and "token expired."
- **Google escape hatch security:** When OAuth callback arrives for an unverified email-registered account, server must explicitly verify `oauth_email === registered_email` before marking account verified. If emails don't match, it's an account takeover surface, not a linking operation.

---

### Journey Patterns

**Common patterns across all five journeys:**

1. **Google OAuth as escape hatch.** Every flow that encounters friction (lockout, verification delay, failed credentials, email mismatch) offers Google OAuth as an alternative. It's the universal recovery path.

2. **Center identity foregrounds on invite flows.** Journeys 2 and 3 show the center's name and inviter before showing ClassLite's UI. The product recedes; the center advances.

3. **Auto-detection over manual action.** Verification pending auto-polls and auto-redirects. Session refresh is silent. Logged-in redirect on the landing page is automatic. The user takes fewer actions than they expect.

4. **Three-part error recovery.** Every failure state follows: (1) what happened, (2) why, (3) what to do next — as a single button. No dead ends across any journey.

5. **Time-to-value compression.** Every journey converges on the same endpoint: the first AI grade. Owner signs up → grade. Teacher accepts invite → grade. The product's value proposition is the gravitational center of all flows.

### Flow Optimization Principles

1. **Minimize screens between intent and value.** The owner's happy path is: landing page → Google OAuth → persona pick → first AI grade. Four screens. Every additional screen is a potential drop-off.

2. **Branch late, not early.** Auth method selection (Google vs email) is one decision point, not two screens. Persona selection is one screen, not a wizard. Defer complexity until after the user has committed.

3. **Failure states are conversion paths.** An expired invite is a "contact your admin" path. A lockout is a "reset your password" path. An email mismatch is a "try a different account" path. No dead ends.

4. **Mobile flows are subsets, not adaptations.** The student mobile journey (Journey 3) has fewer decision points than the owner desktop journey (Journey 1). Mobile means fewer steps, not same flow on a small screen.

### Out of Scope — Flagged for Next UX Pass

**Return-visit journey and upgrade trigger.** SM-6 (free-to-pro >15% within 60 days) requires the owner to come back on day 3, day 7. What triggers re-engagement? What's the upgrade moment? This is outside the landing + auth scope but critical for conversion. Flagged for the retention/engagement UX pass.

## Component Strategy

### Design System Components (shadcn/ui — React auth screens)

Components used directly from shadcn/ui, themed with ClassLite design tokens:

| Component | Theme Overrides | Auth Usage |
|---|---|---|
| **Button** | `--cl-ink` bg, `6px` radius, Geist 12.5px/500 | Primary submit, secondary actions |
| **Input** | `--cl-line` border, `6px` radius, Geist 13px | Email, name fields |
| **Card** | `--cl-surface` bg, `--cl-line-soft` border, `14px` radius | Auth form wrapper |
| **Alert** | Red tint for errors, gold tint for warnings | Lockout, validation errors |
| **Separator** | `--cl-line-soft` | "hoặc" divider |
| **Badge** | `--cl-accent-2-btn` bg, white text, `999px` radius | Role badge on invite |
| **Checkbox** | `--cl-accent` accent | "Nhớ tài khoản" |
| **Label** | Geist Mono 10px/500, `0.12em` tracking, uppercase | Form field labels |
| **Collapsible** | Structural only | Email form expand/collapse |

### Custom Components — React (my.classlite.app/features/auth/)

#### 1. GoogleOAuthButton

Google-branded OAuth button compliant with Google's ToS. White bg, `1px solid var(--cl-line)`, colored Google SVG logo. Hover: `#f8f8f8` bg. Full-width on auth screens (`padding: 12px 20px`). States: default, hover, loading (spinner replaces logo during redirect), disabled. Label: "Tiếp tục với Google". `aria-label="Đăng nhập bằng tài khoản Google"`.

#### 2. PasswordInput + PasswordStrengthBar

**PasswordInput:** shadcn Input with `padding-right: 38px` for eye toggle SVG. Eye toggle: `aria-label="Hiện mật khẩu"` / `"Ẩn mật khẩu"`.

**PasswordStrengthBar** (extracted — isolated unit tests for strength logic): 4 segments, each `3px` height, `999px` radius. Colors: 1/4 `--cl-red`, 2/4 `--cl-amber`, 3/4 `--cl-accent-2`, 4/4 `--cl-green`. Strength communicated via `aria-live="polite"`: "Mật khẩu: yếu/trung bình/tốt/mạnh". Strength library: decision needed (zxcvbn vs custom regex tiers) before implementation.

#### 3. AuthCard

Centered card container for all auth screens. ClassLite wordmark (Fraunces 22px italic + amber dot) above card. Card: `max-width: 420px`, `padding: 36px 32px`, `14px` radius, `--cl-shadow-card`. Paper background with dot grid behind. Mobile: `max-width: none`, `padding: 24px 20px`, `margin: 0 16px`.

#### 4. VerificationPending + useVerificationPoller hook

**useVerificationPoller** (extracted — testable without rendering): Polls `GET /auth/verify-status` every 5 seconds. Returns status: `unverified` | `verified` | `token_expired`. Auto-stops after 10 minutes (wall clock, not poll count). On `verified`: triggers redirect to onboarding URL (passed as prop/config, not hardcoded). On `token_expired`: returns expired state for UI to show "Gửi email mới" CTA.

**VerificationPending** (UI shell): Envelope SVG (80×80), Fraunces heading "Kiểm tra email", bold email address, "Gửi lại" secondary button with countdown. States: waiting (countdown active, resend disabled), resend available (countdown expired, button enabled), verified (auto-redirect), token expired ("Link đã hết hạn"), poll timeout (manual "Kiểm tra lại" button). Google fallback: "Không nhận được email? Đăng nhập bằng Google — cùng tài khoản, không cần xác nhận."

Resend calls `POST /auth/resend-verification` (rate-limited server-side). Countdown is UI-only — server enforces the real rate limit.

#### 5. InviteCard + useInviteToken hook

**useInviteToken** (extracted — MSW-mockable fetch logic): Calls `GET /api/invites/:token` (unauthenticated). Returns: `{ status, centerName, centerLogoUrl, inviterName, role, inviteEmail }`. Status enum: `valid` | `expired` | `already_accepted` | `not_found`. High-entropy tokens (128-bit minimum).

**InviteCard** (display): Center lettermark (56×56 gradient circle), invite heading "[Inviter] đã mời bạn tham gia", center name (Fraunces 24px), role badge (`--cl-accent-2-btn`). Six states:
- Valid (new user): Google OAuth + CollapsibleEmailForm (email locked to invite address)
- Valid (existing user, logged in): single "Tham gia" button — **prompts for confirmation, does not auto-accept**
- Valid (existing user, not logged in): login form
- Expired: clock illustration + "Lời mời đã hết hạn" + "Liên hệ [inviter]" mailto CTA
- Already accepted: redirect to dashboard with "Bạn đã tham gia [center]"
- Not found: "Link không hợp lệ" error (distinct from expired)

Error boundary: InviteCard owns all 6 state UIs. Parent route handles only network failures.

#### 6. CollapsibleEmailForm

Wraps shadcn Collapsible. Trigger: "Đăng ký bằng email" (register) or "Đăng nhập bằng email" (login). `aria-expanded` on trigger, `aria-label="Mở form đăng ký bằng email"`. Collapsed: dashed border container with trigger link. Expanded: solid border, form fields animate in (200ms ease). Validation: client-side mirrors server rules (min 8 chars for password, email format). Server 422 errors rendered inline on relevant fields.

### Custom Components — Astro (classlite-landing/src/components/)

#### 7. StickyHeader

Transparent → solid on scroll past 400px from top. `client:load` directive. Default: transparent bg, secondary CTA. Scrolled: `--cl-surface` bg + `--cl-line-soft` border + `--cl-shadow-subtle`, primary CTA. Transition: `all 0.2s`. Respects `prefers-reduced-motion` (instant transition). Mobile: hamburger menu (not specced — flag for landing page detail pass).

#### 8. PainCalculator

Static stat display: `5 giáo viên × 3 giờ/tuần × 48 tuần = 720 giờ/năm`. Values are hardcoded (not configurable). Geist Mono 28px values, Geist Mono 11px units, result in `--cl-accent-2-text` at 36px. No JS needed — pure HTML/CSS. No `client:visible` animation in MVP (revisit post-launch).

#### 9. PricingCard

Tier card. Props: `tier` (string), `price` (string), `priceUnit` (string), `features` (string[]), `ctaLabel` (string), `ctaHref` (string), `popular` (boolean). Popular variant: `2px solid var(--cl-accent-2)` border + absolute-positioned "Phổ biến" badge. CTA: `<a>` tag linking to `my.classlite.app/register` (or `?plan=pro`). Prices hardcoded in Astro — no API fetch.

#### 10. SocialProofCard

Props: `stat` (string, e.g. "-65%"), `quote` (string), `source` (string, e.g. "Trung tâm IELTS, TP.HCM"), `details` (string, e.g. "8 giáo viên · 120 học viên"). All content hardcoded in Astro pages — no CMS, no API.

#### 11. FeatureCard

Props: `title` (string), `description` (string), `tint` (`blue` | `gold` | `green`), `icon` (inline SVG slot). Tint maps to `--cl-tint-blue` / `--cl-tint-gold` / `--cl-tint-green`. Preview area: 160px height. SVG passed as inline slot content (not `<img>` — avoids alt text requirement, enables token-colored strokes).

### Shared Design Tokens Strategy

**Pragmatic path (from Winston):** Skip full monorepo `@classlite/tokens` package for MVP. Instead:

- Ship a single `tokens.css` file defining all CSS custom properties
- Commit it to both `classlite-web/src/` and `classlite-landing/src/styles/`
- Add a lint rule (ESLint custom rule or stylelint) enforcing no raw hex values — all colors must reference `var(--cl-*)` tokens
- Track drift via visual regression tests (Chromatic or Percy) comparing equivalent elements across both codebases
- Revisit the monorepo workspace package when a second team starts touching tokens independently

This gives 80% of the shared-token benefit with 20% of the infrastructure cost.

### Implementation Roadmap

**Phase 1 — Auth core (blocks all other auth work):**
- `tokens.css` committed to both repos + lint rule
- AuthCard (layout wrapper)
- GoogleOAuthButton (ToS-compliant)
- CollapsibleEmailForm (Google-first pattern)
- PasswordInput + PasswordStrengthBar

**Phase 2 — Auth flows (needs API contracts first):**
- useVerificationPoller hook + VerificationPending UI
- useInviteToken hook + InviteCard (all 6 states)

**Phase 3 — Landing page (most external dependencies):**
- StickyHeader
- PainCalculator
- FeatureCard, PricingCard, SocialProofCard

Build order: AUTH-08 → AUTH-06 → AUTH-03 → AUTH-05 → AUTH-01/02 → AUTH-07 → AUTH-04 → LP-01.

## UX Consistency Patterns

Quick-reference guide for consistent interaction patterns across all landing page and auth screens.

### Button Patterns

| Context | Style | Size (desktop) | Size (mobile) | Behavior |
|---|---|---|---|---|
| **Primary action** (submit, CTA) | `--cl-ink` bg, white text, hover `--cl-accent` | `7px 14px`, 12.5px | `14px 20px`, 15px, full-width | Single primary per screen |
| **Secondary action** (cancel, back) | White bg, `--cl-line` border, `--cl-ink` text | Same padding | Full-width | Never competes with primary |
| **Google OAuth** | White bg, `--cl-line` border, Google colored logo | `12px 20px`, 14px | `14px 20px`, 15px, full-width | Always largest button on auth screens |
| **Landing CTA** | `--cl-ink` bg, white text | `14px 28px`, 15px | Full-width | Sticky header CTA transitions from secondary → primary on scroll |
| **Text link action** | `--cl-accent` text, no underline, 500 weight | 13px | 13px | Used for "Quên mật khẩu?", "Đăng nhập", navigation |

### Form Patterns

| Pattern | Rule |
|---|---|
| **Labels** | Always visible above field (Geist Mono 10px uppercase). Never placeholder-only. |
| **Validation** | Inline, triggered on `blur`. All errors shown simultaneously. Server 422 errors rendered on relevant fields. |
| **Required fields** | All auth fields are required. No asterisk markers needed — if everything is required, marking it is noise. |
| **Password** | Always has eye toggle + strength indicator bar. Placeholder: "Ít nhất 8 ký tự". |
| **Read-only fields** | `--cl-paper` bg, `--cl-muted` text, cursor: default. Used for locked invite email. |
| **Error state** | `--cl-red` border on field + error message below in `--cl-red` 12px. Field label unchanged. |
| **Focus state** | `--cl-accent` border (2px). No other visual change. |

### Error & Feedback Patterns

| Pattern | Treatment |
|---|---|
| **Inline field error** | Red text below field, 12px. Shows on blur after first submit attempt. |
| **Form-level error** | Alert component above form. Red tint bg + `--cl-red` text + icon. "Email hoặc mật khẩu không đúng." |
| **Recovery-focused error** | Gold tint bg + `--cl-amber` text. Used for lockout. Tone: "Hãy thử lại sau" not "Tài khoản bị khóa". |
| **Success feedback** | Auto-redirect (verification complete) or page transition (login success). No success toasts on auth screens — speed is the feedback. |
| **Loading state** | Primary button shows spinner, text changes to "Đang xử lý...". Form fields disabled. Google button: spinner replaces logo. |
| **Rate limit hit** | "Vui lòng thử lại sau X giây." Countdown visible. Action disabled until countdown completes. |

### Navigation Patterns

| Pattern | Rule |
|---|---|
| **Auth screen → auth screen** | Link text below card: "Đã có tài khoản? Đăng nhập" / "Chưa có tài khoản? Đăng ký". |
| **Back to landing** | "Quay lại trang chủ" link, `--cl-accent` color. Always at bottom of card. |
| **Post-auth redirect** | New user → onboarding (persona selection). Returning user → dashboard. Invited user → center dashboard (skip onboarding). |
| **Landing page scroll** | Smooth scroll for internal anchor links. Sticky header CTA scrolls to pricing or links to register. |
| **Language toggle** | VI/EN toggle in header (landing) and on auth screens. Selection persists via cookie across domains. |

### Spacing Patterns

| Context | Spacing |
|---|---|
| **Between form fields** | `16px` margin-bottom |
| **Between sections in card** | `20px` (divider, button group) |
| **Card to wordmark** | `32px` (desktop), `24px` (mobile) |
| **Landing page sections** | `64px` padding top/bottom |
| **Screen sections in doc** | `80px` margin-bottom |

## Responsive Design & Accessibility Summary

### Responsive Strategy

This UX spec covers two responsive contexts:

**Landing page (classlite.app):** Desktop-first design surface. The primary audience (center owners, teachers) evaluates on desktop. Responsive down to 390px for mobile visitors. Key breakpoints:
- Desktop: full layout as designed (max-width sections at 880px-1320px)
- Tablet (768px): pricing grid collapses to 1-column, feature grid to 2-column
- Mobile (≤640px): single column, full-width buttons, hero heading drops to 28px

**Auth screens (my.classlite.app):** Mobile-first design surface. Students (highest volume) arrive on phones via invite links. Key breakpoints:
- Mobile (390px reference): full-width card, 48px inputs/buttons, 24px padding
- Desktop (>640px): centered card at max-width 420px, 36px padding, standard input heights

### Accessibility Compliance Summary

All requirements documented inline throughout previous sections. Consolidated reference:

| Requirement | Standard | Implementation |
|---|---|---|
| **Color contrast** | WCAG 2.1 AA (4.5:1 normal, 3:1 large) | All token pairs verified. `--cl-muted` darkened to `#595c66`. `--cl-accent-2` restricted to decorative use; text variant `#7c4309`. |
| **Touch targets** | WCAG 2.5.5 (44×44px minimum) | All buttons 48px on mobile. Links have sufficient padding or own line. |
| **Focus indicators** | WCAG 2.4.7 | `2px solid var(--cl-accent)` with `2px` offset on all interactive elements. |
| **Form labels** | WCAG 1.3.1 | All inputs have visible `<label>`. No placeholder-only fields. `aria-describedby` for errors. `aria-required` on all auth fields. |
| **Screen readers** | WCAG 4.1.2 | Landmark regions (`<main>`, `<nav>`, `<footer>`). Sequential heading hierarchy. `aria-label` on icon-only buttons. `aria-live="polite"` for password strength and verification status. |
| **Motion** | WCAG 2.3.3 | `prefers-reduced-motion` disables scroll transitions and animations. |
| **Language** | WCAG 3.1.1, 3.1.2 | `lang="vi"` or `lang="en"` on `<html>`. IELTS terms wrapped in `<span lang="en">`. |
| **Non-text contrast** | WCAG 1.4.11 (3:1 for UI boundaries) | Interactive borders use `--cl-line-interactive` (`#a8a095`). Decorative borders exempt. |
| **Color not sole indicator** | WCAG 1.4.1 | Error = red tint + icon + text. Success = green tint + checkmark + text. Strength bar segments use color + position. |

### Screen Inventory (this UX spec)

| Screen ID | Screen | Platform | Status |
|---|---|---|---|
| LP-01 | Landing Page | Desktop (responsive) | Designed — HTML showcase |
| AUTH-01 | Register | Desktop | Designed — HTML showcase |
| AUTH-02 | Register | Mobile (390px) | Designed — HTML showcase |
| AUTH-03 | Login | Desktop | Designed — HTML showcase |
| AUTH-04 | Verification Pending | Mobile | Designed — HTML showcase |
| AUTH-05 | Invite Acceptance (Valid) | Desktop | Designed — HTML showcase |
| AUTH-06 | Invite Acceptance (Expired) | Mobile | Designed — HTML showcase |
| AUTH-07 | Login Lockout | Desktop | Designed — HTML showcase |
| AUTH-08 | Password Reset | Desktop | Designed — HTML showcase |

These 9 screens extend the existing 93-screen mockup set (s00-s87) documented in `docs/classlite-entry/classlite-ia.md`. Together they provide complete UX coverage from first visit through authentication to the product experience.
