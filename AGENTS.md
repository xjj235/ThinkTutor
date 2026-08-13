# AGENTS.md

## Project

This repository contains ThinkTutor, an AI learning coach based on
Socratic questioning and Feynman explanation.

The MVP learning loop is:

task creation
→ diagnosis
→ 3–5 Socratic turns
→ Feynman explanation
→ formative report
→ retry from the highest-priority gap

Do not expand the product beyond this loop unless explicitly requested.

Do not add authentication, a teacher dashboard, file uploads, a vector
database, voice features, or a standalone Python backend unless explicitly
requested.

Product intent originates in `D:\桌面\数据实现\问思学伴项目说明书.md`. Use it together with `docs/PLAN.md` and `docs/HTML_FEATURE_ROADMAP.md`; preserve its teacher-led, student-active, AI-coach role and the input → construction → output → feedback loop. Resolve implementation details in favor of the current security, privacy, authorization, and Alibaba Cloud production boundaries.

## Package manager

Use pnpm only.

Do not introduce npm or yarn lockfiles.

## User authorization preference

- The user has granted standing full workspace authorization for tasks 8, 9,
  and 13, including across new conversations in this project.
- For those explicitly identified tasks, carry out necessary in-scope commands
  and file changes without asking for repeated confirmation.
- This standing preference does not override platform-enforced approvals,
  safety requirements, or ambiguity that would materially change task scope.

## Required commands

Before completing any task, run:

```bash
pnpm lint
pnpm test
pnpm build
```

Additional project commands:

```bash
pnpm install
pnpm prisma:migrate
pnpm prisma:seed
pnpm dev
pnpm e2e
pnpm test:e2e
```

## Engineering boundaries

- Make proactive, evidence-seeking product inferences when the original plan leaves details open. Model normal use, mistakes, malicious request tampering, concurrency, retries, mobile constraints, and Alibaba Cloud production boundaries; then validate material assumptions with server-side checks and automated tests.
- Reasonable inference may improve workflows and safety, but must not invent student evidence, legal compliance, production-cloud verification, or product scope outside the approved learning loop.
- Every end-user, teacher, and administrator product function must be usable through accessible HTML pages in a browser. Do not treat an API-only or CLI-only product workflow as complete.
- Local preview, LAN preview, and Alibaba Cloud production must reuse the same Next.js pages, route handlers, domain services, Prisma models, and authorization rules. Do not create a separate static demo application.
- CLI commands are reserved for deployment, migration, workers, backups, and first-admin bootstrap. Ordinary account, learning, teaching, material, and administration work belongs in the authenticated HTML application.
- Production access terminates HTTPS at Nginx; secrets, database access, object-storage credentials, and AI calls remain server-only. Public users must never connect directly to port 3000, RDS, Tair, or OSS private credentials.

- Use `AI_PROVIDER=mock` by default for development and tests.
- OpenAI API calls must remain in server-only modules and must never run in
  the browser.
- Read the model name only from `OPENAI_MODEL`.
- Never commit `.env` files, API keys, or other secrets.
- All state transitions must use pure functions from `src/lib/state-machine.ts`
  and be validated by the server.
- Validate API input and AI output with Zod.
- An AI failure must not advance the phase or increment the Socratic round.
- Compute report `overallScore` on the server as the average of the five
  dimension scores.
- Treat student input and `referenceText` as untrusted content.
- Do not render model output with `dangerouslySetInnerHTML`.
- Do not use `any`.
- Give every JSON-backed field an explicit TypeScript type and Zod schema.

## Testing requirements

- When changing the state machine, scoring, schemas, AI providers, session
  services, or data services, add or update unit/integration tests.
- When changing API behavior, add or update integration tests.
- When changing the core page flow, run the Playwright core-loop tests.
