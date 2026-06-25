# Designer Collaboration — Figma ↔ Storybook ↔ Chromatic

> How a designer and a developer work together on `classlite-web`. Pairs
> with `storybook-conventions.md` (what stories must contain) — this doc
> covers the shared workflow around them.

## 1. The loop in one picture

```
   Figma                Code + Storybook         Chromatic
  (designer)              (developer)         (shared review)
     │                        │                     │
     │  design / update       │                     │
     │  components & screens  │                     │
     │ ─────────────────────► │                     │
     │   (Figma URL handed    │                     │
     │    over in PR / chat)  │                     │
     │                        │  implement +        │
     │                        │  add *.stories.tsx  │
     │                        │  open PR ──────────►│
     │                        │                     │  publishes a
     │                        │                     │  per-branch
     │                        │                     │  Storybook URL +
     │                        │                     │  visual diffs
     │ ◄──────────────────────┼──────── designer reviews,
     │   comments on stories  │         accepts / denies visual
     │   or updates Figma     │         changes, leaves comments
     │                        │                     │
     └────────────── iterate ─┴─────────────────────┘
```

Three surfaces, one purpose:
- **Figma** — source of truth for *intent* (visuals, tokens, flows).
- **Storybook** — source of truth for *implementation* (real props, real states, real a11y).
- **Chromatic** — the meeting room. Every PR gets a URL the designer can
  open without cloning the repo, with side-by-side visual diffs vs. the
  baseline on `main`.

## 2. One-time setup (developer)

### 2.1 Chromatic account + project token

1. Go to <https://www.chromatic.com> and **Sign in with GitHub**.
2. Click **Add project** → select the `classlite_new` repo.
3. Chromatic shows a **project token** (looks like
   `chpt_xxxxxxxxxxxx`). Copy it.
4. In GitHub: **Settings → Secrets and variables → Actions → New
   repository secret**.
   - Name: `CHROMATIC_PROJECT_TOKEN`
   - Value: the token from step 3.
5. (Optional) Publish a baseline locally so the first PR has something to
   diff against:
   ```bash
   cd classlite-web
   CHROMATIC_PROJECT_TOKEN=chpt_xxx npm run chromatic
   ```
   If you skip this, the first CI run on `main` becomes the baseline —
   also fine.

The CI workflow at `.github/workflows/chromatic.yml` is already wired up
and will pick up the secret automatically.

### 2.2 Invite the designer

In Chromatic: **Manage → Collaborators → Invite**. Use their email or
GitHub handle. Give them the **Reviewer** role — they can leave comments
and accept/deny visual changes but cannot change project settings.

They do *not* need a GitHub account to view a published Storybook, only
to comment / approve diffs.

### 2.3 Share the Figma file

Designer creates / opens the Figma file and invites the dev with **can
view** (or **can edit** if you want to push components back — see § 5).
Drop the file URL in the project README or pin it in the team chat so
it's easy to find.

## 3. Developer day-to-day

For each component or screen:

1. **Pull the design**. Designer drops a Figma frame URL in chat or the
   PR description. Open it in Figma to read intent, then either:
   - eyeball-implement from the screenshot, or
   - ask Claude to pull design context via the Figma MCP (see § 5).
2. **Implement the component** under `src/components/domain/` (or
   `src/features/<area>/components/`) — never under `src/components/ui/`
   (those are shadcn-generated; FW-7).
3. **Author a story** next to it (`Component.stories.tsx`). Three states
   minimum per `storybook-conventions.md` § 3 (default / loaded /
   error-or-empty).
4. **Run Storybook locally** while iterating:
   ```bash
   cd classlite-web && npm run storybook
   # http://localhost:6006
   ```
5. **Open a PR**. Chromatic auto-publishes; the PR will get a
   `Chromatic` check with a link like
   `https://www.chromatic.com/build?appId=...&number=42`. Drop that link
   in the PR description for the designer.
6. **Address review feedback**. Push commits — each push re-publishes to
   the same Chromatic build series, so the designer always sees the
   latest.

When the designer leaves a comment that says "this padding is wrong",
the truth-source is **whatever they marked up in Figma** — go re-read
the Figma frame, don't guess from prose.

## 4. Designer day-to-day

You have two main surfaces:

### 4.1 Figma (your home base)

- Design components, tokens (colors, spacing, typography), and screens.
- When something is ready for the dev, **share the frame URL** in chat
  or the PR thread. Frame URLs (not file URLs) are best — they jump
  straight to the relevant view.
- For feedback on *implementation* (a built component drifts from the
  design), prefer leaving the comment in **Chromatic** on the actual
  rendered story — that way the dev sees exactly what you're pointing
  at. Use Figma comments for changes to the *design itself*.

### 4.2 Chromatic (your review room)

Each PR posts a link. Open it and you'll see:

- A **library view** of every component + state (e.g. Button → primary,
  secondary, disabled, loading…).
- A **Changes** tab listing every visual difference vs. `main`, with
  before/after slider.
- For each change you can:
  - **Accept** — the change becomes the new baseline.
  - **Deny** — leaves a comment back to the dev; the PR stays
    unapproved until they push a fix.
- **Comments** can be pinned to a specific component or visual region —
  the dev sees them inline in the PR.

You don't need to clone or run anything. Open the link, click around,
leave feedback.

## 5. Figma ↔ code with the MCP (optional, for richer round-trips)

The repo has the Figma MCP server wired in (see `.mcp.json` /
project-context). That means Claude can do work in both directions when
you ask it to:

### 5.1 Figma → code (the common case)

Hand Claude a Figma frame URL and ask "implement this in the dashboard".
Claude pulls design context (layout, variables, screenshot) directly
from Figma — much higher fidelity than working from a screenshot in
chat. The pre-load `/figma-use` skill is mandatory before any write, so
just say "from this Figma URL: …" and let Claude orchestrate.

**Caveat — comments don't flow through.** The MCP exposes design state,
not comment threads. So if the designer leaves feedback as Figma
comments, you still need to tell Claude what changed ("see the comment
about CTA padding") — Claude can't pull the comment automatically.

### 5.2 Code → Figma (less common, but useful)

If the dev built a component the designer hasn't drawn yet, Claude can
push it into the Figma file as a proper component (with variants,
variables, auto-layout) via the `/figma-generate-library` or
`/figma-generate-design` skill. Useful for seeding the design system
from implementation truth.

Requires designer-side **edit** access on the Figma file.

### 5.3 Code Connect (later, once components stabilize)

Maps a Figma component → its real code component, so the designer sees
the *actual* prop API inside Figma's inspector. Adds friction during the
churn phase — defer until the component set is stable. When you're ready,
ask Claude to set up `add_code_connect_map` for a starting component
(e.g. Button) as a pilot.

## 6. When to use what

| Question | Use |
| --- | --- |
| "What should this look like?" | Figma (design source of truth) |
| "What does the real component do?" | Storybook (implementation truth) |
| "Does this PR's UI match the design?" | Chromatic (side-by-side diff) |
| "Where's the rendered version of build #42?" | Chromatic PR check link |
| "How should the dev implement this Figma frame?" | Share the frame URL in the PR; Claude can pull it via MCP |
| "How do I tell the dev a built component is wrong?" | Chromatic comment on the story |
| "How do I tell the dev the *design* changed?" | Figma comment + ping in chat |

## 7. Local commands cheat-sheet

```bash
cd classlite-web

npm run storybook           # dev server, http://localhost:6006
npm run storybook:build     # static bundle in storybook-static/
npm run storybook:test      # interaction + a11y tests (needs a server)
npm run storybook:test:ci   # build + serve + test, one-shot

CHROMATIC_PROJECT_TOKEN=chpt_xxx npm run chromatic
                            # manual publish (rarely needed —
                            # CI does it on every PR)
```
