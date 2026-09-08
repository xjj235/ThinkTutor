# ThinkTutor Visual System

The durable design source of truth is [design-system/thinktutor/MASTER.md](design-system/thinktutor/MASTER.md).

<!-- impeccable:design-schema 1 -->

## Direction

Light professional learning workspace, selected by the user on 2026-09-04.
Top navigation replaces the sidebar at the user's request, implemented on 2026-09-07.
White content canvas, faint gray navigation, restrained emerald actions,
blue informational states and amber knowledge gaps. Reading-first Chinese typography,
revised on 2026-09-09 after a fresh GitHub reference and page-by-page review.

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
GitHub references inform composition; no external project code or product data is copied.

## Responsive and Accessibility Decisions

- Mobile navigation expands in document flow from the top, without a side drawer,
  modal overlay or focus trap. Escape dismisses it and restores trigger focus.
- Every role navigation item remains available on mobile.
- Task metadata uses a disclosure; the horizontal stage track reveals the current
  stage on mobile and remains keyboard-scrollable.
- Touch inputs use 16px text. Current items use aria-current.
- General interface text is 16px; study dialogue and response text are 18px.
  Secondary labels are at least 14px. Section headings use 18-20px.
- Desktop page titles use 32px; mobile titles use 28px. Controls reserve
  44-48px touch targets; larger type must not be compensated by clipped labels.
- Knowledge review tabs support arrows, Home and End; inactive forms retain their input.
- Reference research and current verification are recorded in
  [docs/UI_REDESIGN_RESULT.md](docs/UI_REDESIGN_RESULT.md).
- Top-navigation research and fresh verification are recorded in
  [docs/UI_TOP_NAVIGATION_REDESIGN_2026-09-07.md](docs/UI_TOP_NAVIGATION_REDESIGN_2026-09-07.md).
- Typography, form grouping and responsive page verification are recorded in
  [docs/UI_READABILITY_REDESIGN_2026-09-09.md](docs/UI_READABILITY_REDESIGN_2026-09-09.md).
