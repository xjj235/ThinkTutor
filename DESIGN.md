# ThinkTutor Visual System

The durable design source of truth is [design-system/thinktutor/MASTER.md](design-system/thinktutor/MASTER.md).

<!-- impeccable:design-schema 1 -->

## Direction

Light professional learning workspace, selected by the user on 2026-09-04.
Top navigation replaces the sidebar at the user's request, implemented on 2026-09-07.
Unique visual benchmark: shadcn/ui new-york-v4 at
`3ba91b1cc83e1bbe4ab35a422ff2a694849c5048`, selected on 2026-09-09.
Neutral surfaces, charcoal primary actions, one restrained teal brand accent.
The complete style layer was replaced, not extended with legacy overrides.
Default light appearance, with a persistent optional dark appearance.

## Product Expression

- Authenticated users enter their role-specific workspace directly.
- A full-width brand header and horizontal role navigation precede centered content.
- Learning context and stage progress appear above the study record at every viewport.
- The learning session is a staged study record, not a generic chat client.
- Reports prioritize traceable evidence and targeted follow-up.
- The public entry retains the existing learning photograph, with legible text.
- Wording is precise, domain-specific and restrained, without inflated claims.

## Constraints

Preserve routes, role permissions, server-owned state and scoring contracts.
Never invent student evidence, metrics, testimonials, cloud verification or teacher approval.
The semantic tokens adapt the pinned MIT-licensed shadcn source. Attribution is in
THIRD_PARTY_NOTICES.md. No external product data or runtime resources are copied.

## Responsive and Accessibility Decisions

- Mobile navigation expands in document flow from the top, without a side drawer,
  modal overlay or focus trap. Escape dismisses it and restores trigger focus.
- Every role navigation item remains available on mobile.
- Task metadata uses a disclosure; the horizontal stage track reveals the current
  stage on mobile and remains keyboard-scrollable.
- Touch inputs use 16px text. Current items use aria-current.
- General interface text is 16px; study dialogue and response text are 18px.
  Secondary labels are at least 14px. Section headings use 18-20px.
- Page titles use 32px on desktop and mobile. Five sizes only: 14/16/18/20/32px. Controls reserve
  44-48px touch targets; larger type must not be compensated by clipped labels.
- Knowledge review tabs support arrows, Home and End; inactive forms retain their input.
- Reference research and current verification are recorded in
  [docs/UI_REDESIGN_RESULT.md](docs/UI_REDESIGN_RESULT.md).
- Top-navigation research and fresh verification are recorded in
  [docs/UI_TOP_NAVIGATION_REDESIGN_2026-09-07.md](docs/UI_TOP_NAVIGATION_REDESIGN_2026-09-07.md).
- Typography, form grouping and responsive page verification are recorded in
  [docs/UI_READABILITY_REDESIGN_2026-09-09.md](docs/UI_READABILITY_REDESIGN_2026-09-09.md).
- Shared values now live in `src/app/tokens.css`; spacing, state feedback and
  before/after evidence are documented in [docs/UI-改造总结.md](docs/UI-改造总结.md).
- The pinned numerical reference is [docs/GitHub-SHADCN-数值参照.md](docs/GitHub-SHADCN-数值参照.md).
- Root appearance is applied before first paint; storage failure never blocks use.
- Focus is inset on clipped list rows. Reduced motion stops looping animations.
