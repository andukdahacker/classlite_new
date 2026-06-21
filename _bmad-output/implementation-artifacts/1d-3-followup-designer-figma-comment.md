# Story 1d-3 follow-up: Designer Figma comment (Owner+Admin mobile extrapolation)

**Origin:** Story 1d-3 party-mode review, 2026-06-21 (Sally + John). Owner+Admin mobile tab sets in `MobileTabBar.stories.tsx` carry `@status: extrapolated-pending-design-review` JSDoc — the designer needs to ratify or amend before Epic 2 mobile work starts.

**Deadline:** 48h from 1d-3 merge (commit `7e606b5` on `main`, 2026-06-19 → respond by **2026-06-21 EOD**). Per John: "If the notification isn't out within 48h of merge, the extrapolated stories gain `@skip` until review lands."

**Status:** ⏳ Draft ready — Sally to paste into Figma once the file URL is shared.

---

## Message to paste into Figma

> 👋 @[designer]
>
> Quick design call needed for the Owner mobile dashboard tab bar. We just shipped Story 1d-3 (app-shell stack) and built three role variants of `MobileTabBar` — Student, Teacher, Owner. The Student and Teacher sets are direct from your IA Chapter 8 mockups (s74–s85). The Owner set is **extrapolated** — IA Chapter 8 only draws `s86` (push-approval), so I made a call from desktop sidebar priority:
>
> **Current Owner mobile (extrapolated):** Home / People / Inbox / Analytics / Me
>
> My read of Owner-on-mobile personas: firefighter mode. They open the app because a parent escalated, a teacher called out, payroll didn't run, enrollment spiked. That makes me question "People as tab 2" — Owners do roster management at their desk, not on their phone. On a phone they want **Schedule** (what's happening today) and **Inbox** (who needs me) above all.
>
> **Question for you:** Is the right Owner mobile tab 2 *Schedule* or *People*?
>
> Same question applies to Admin mobile (we currently reuse Owner's set per IA convention — Admin mobile isn't drawn in Chapter 8 at all).
>
> Storybook artifact is in the latest CI run: [link from Actions tab → 1d-3 commit → storybook-static]. The two stories to look at: `domain/MobileTabBar/OwnerView` and `AdminView` (with the `@status: extrapolated-pending-design-review` flag in the story JSDoc).
>
> Reply by Monday (2026-06-21 EOD) and I can swap the tab set in 10 minutes — it's a config change, not a refactor. If we miss the window, I'll add `@skip` to those two stories until we resolve it.
>
> Thanks!

---

## Locations to paste

- **Primary:** Comment on the Figma node for the Owner mobile dashboard (mockup `s86` or the dashboard hub if `s86` is just push-approval).
- **Fallback:** General comment on the IA Chapter 8 frame referencing both Owner and Admin mobile sections.
- **Backup channel:** Slack DM with the same body + Storybook artifact link, in case Figma notifications get missed.

## If the designer responds: how to amend

1. If **Schedule** wins for tab 2: edit `classlite-web/src/components/domain/MobileTabBar.tsx:74-80` — swap the OWNER_TABS entry `{ labelKey: 'mobileTab.owner.people', icon: Users, href: '/people/staff', testIdSlug: 'people' }` for `{ labelKey: 'mobileTab.owner.schedule', icon: CalendarDays, href: '/schedule', testIdSlug: 'schedule' }`. Add `mobileTab.owner.schedule` to en+vi locales. Update `STORY_1D_3_KEYS` in `i18n-parity-coverage.test.ts`. Remove `@status: extrapolated-pending-design-review` from `OwnerView` JSDoc.
2. If **People** wins: just remove the `@status:` JSDoc flag — the current code is correct.
3. If the designer wants something we didn't anticipate: update the story file's AC7, file a small amendment story.

In all three cases: update `MobileTabBar.stories.tsx` OwnerView's JSDoc header to record the ratification date.

## Tracking

This file remains until the designer responds; on response, delete this file and close the loop with a Change Log entry in `1d-3-app-shell-stack.md`.
