# ThinkTutor Visual System

The durable design source of truth is [`design-system/thinktutor/MASTER.md`](design-system/thinktutor/MASTER.md).

<!-- impeccable:design-schema 1 -->

## Direction

Paper learning record as the material, knowledge relationships as the structure. The visual system is calm, mature, Chinese-first, and evidence-led. It uses paper white, ink, and a single muted teal accent.

## Product Expression

- Public pages persuade through the learning method and the evidence principle.
- Student, teacher, and administrator pages operate as precise workspaces.
- The learning session is a staged study record, not a generic chat client.
- The report privileges traceable evidence over decorative scoring.

## Constraints

Preserve all routes, product functions, accessible labels, security boundaries, and server-owned state. Never invent student evidence, metrics, testimonials, cloud verification, or customer claims.

## Responsive and accessibility decisions

- Authenticated mobile navigation uses a complete keyboard-operable menu; no role capability is removed to make the header fit.
- On mobile learning sessions, the active learning record and answer composer precede secondary task metadata so the current task remains in the first viewport.
- Muted text uses `#5e6c67` or darker against paper and canvas surfaces.
- Interactive targets are at least 44 px high, current navigation uses `aria-current`, and logout failures remain on the current page with a retryable alert.
