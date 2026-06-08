# Visual Baseline Snapshot — Placeholder Spec (Story 1.7a → 1d-1 handoff)

> **Status:** placeholder spec authored by Story 1.7a. Story 1d-1 (Storybook foundation) wires the actual `@storybook/test-runner` snapshot consumer against this frame.

## Why this file exists

Per Sally's party-mode pushback that AC1 is otherwise a "spelling test," the design-token contract needs a real visual baseline that downstream stories cannot reinvent. Story 1.7a ships only the **specification**; Story 1d-1 ships the executable snapshot. By pinning the frame here, 1d-1's dev has zero room to drift the baseline.

## Canonical baseline frame

A single composed frame that exercises every load-bearing token surface produced by Story 1.7a.

### Component composition (top to bottom)

```
┌──────────────────────────────────────────────────────────────────────┐
│  body                                                                │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │  paper background  (--cl-paper #f5f1ea)                        │  │
│  │  + dot-grid texture (bg-dot-grid → --cl-ink-dot 4% alpha,      │  │
│  │    24px tile, radial-gradient @ 1px 1px)                       │  │
│  │                                                                │  │
│  │  <h1>Design system baseline</h1>                               │  │
│  │     • font-family: 'Fraunces', 'Times New Roman', serif        │  │
│  │       (--cl-font-display)                                      │  │
│  │     • color:       --cl-ink (#1a1f2e)                          │  │
│  │     • font-size:   2.25rem (Tailwind text-4xl)                 │  │
│  │     • font-weight: 600                                         │  │
│  │     • letter-spacing: -0.02em                                  │  │
│  │                                                                │  │
│  │  <p>Body copy renders in the body sans-serif.</p>              │  │
│  │     • font-family: 'Geist', system-ui, sans-serif              │  │
│  │       (--cl-font-body)                                         │  │
│  │     • color:       --cl-ink-soft (#2c3242)                     │  │
│  │     • font-size:   1rem                                        │  │
│  │     • line-height: 1.5                                         │  │
│  │                                                                │  │
│  │  <span class="font-mono">$42.00 / mo</span>                    │  │
│  │     • font-family: 'Geist Mono', monospace                     │  │
│  │       (--cl-font-mono)                                         │  │
│  │     • color:       --cl-ink (#1a1f2e)                          │  │
│  │     • font-size:   0.875rem                                    │  │
│  │     • tabular-nums on                                          │  │
│  │                                                                │  │
│  └────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

### Frame dimensions for the snapshot

- Viewport: **1280 × 720** (Storybook default desktop preset)
- Container: centered, `--cl-page-max-width` (1320px) capped — page width is below the cap so no overflow
- Padding: 4rem horizontal, 3rem vertical
- No interactive states (no hover, no focus) — pure static composition

### Expected token resolution per element

| Element | CSS property | Expected computed value | Source token |
|---|---|---|---|
| `<body>` | `background-color` | `rgb(245, 241, 234)` | `--cl-paper` |
| `<body>` | `background-image` | `radial-gradient(circle at 1px 1px, rgba(26, 31, 46, 0.04) 1px, transparent 0)` | `--cl-ink-dot` via `bg-dot-grid` |
| `<body>` | `background-size` | `24px 24px` | (literal in `bg-dot-grid` utility) |
| `<h1>` | `font-family` | string containing `Fraunces` | `--cl-font-display` |
| `<h1>` | `color` | `rgb(26, 31, 46)` | `--cl-ink` |
| `<p>` | `font-family` | string containing `Geist` (NOT `Fraunces`) | `--cl-font-body` |
| `<p>` | `color` | `rgb(44, 50, 66)` | `--cl-ink-soft` |
| `<span.font-mono>` | `font-family` | string containing `Geist Mono` | `--cl-font-mono` |
| `<span.font-mono>` | `color` | `rgb(26, 31, 46)` | `--cl-ink` |

### Story 1d-1 handoff instructions

When Story 1d-1 implements the executable snapshot:

1. **Where to mount:** Storybook `design-tokens/baseline.stories.tsx` (or equivalent path Storybook chooses).
2. **What to render:** the composition above, exactly. No additional decoration, no extra characters that change layout.
3. **What to assert via `@storybook/test-runner`:**
   - Pixel snapshot of the rendered frame at viewport 1280×720.
   - `getComputedStyle` checks on each element per the table above (defensive — catches token regressions even when pixel diff tolerance hides them).
4. **What to NOT do:**
   - Do not invent new tokens for this frame. If a fallback color is needed, escalate to the design-system owner.
   - Do not add hover/focus/active states — those belong in primitive-level snapshots, not the baseline.
   - Do not vary by locale — this baseline is locale-agnostic; bilingual coverage is per-component.

### Why this placeholder, not an empty `.snapshot` file

Per Sally's pushback, an empty placeholder communicates nothing. This file IS the spec: every value above is a hard constraint, traceable to UX §5.2 / §5.3 / AC1 / AC7. Story 1d-1's dev should read this end-to-end before opening Storybook config.

### Cross-references

- Story 1.7a AC1 (token presence): `_bmad-output/implementation-artifacts/1-7a-design-system-and-component-library.md`
- Story 1.7a AC7 (`--cl-ink-dot` + `bg-dot-grid`): same file
- Story 1d-1 (Storybook foundation): `_bmad-output/implementation-artifacts/1d-1-storybook-foundation.md`
- UX spec §5.2 (canonical tokens): `_bmad-output/planning-artifacts/ux-design-specification.md`
- UX spec §5.3 (typography): same file
