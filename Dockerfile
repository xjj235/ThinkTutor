FROM node:24-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@11.19.0 --activate
WORKDIR /app

FROM base AS dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM dependencies AS builder
COPY . .
ENV NODE_ENV=production
ENV DEPLOYMENT_ENV=development
ENV AI_PROVIDER=mock
RUN pnpm prisma:generate && pnpm build && pnpm prune --prod

FROM node:24-bookworm-slim AS runner
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
WORKDIR /app
RUN groupadd --system --gid 1001 thinktutor && useradd --system --uid 1001 --gid thinktutor thinktutor
COPY --from=builder --chown=thinktutor:thinktutor /app/public ./public
COPY --from=builder --chown=thinktutor:thinktutor /app/.next/standalone ./
COPY --from=builder --chown=thinktutor:thinktutor /app/.next/static ./.next/static
COPY --from=builder --chown=thinktutor:thinktutor /app/prisma ./prisma
COPY --from=builder --chown=thinktutor:thinktutor /app/prisma.config.ts ./prisma.config.ts
USER thinktutor
EXPOSE 3000
CMD ["node", "server.js"]

FROM dependencies AS worker
COPY . .
ENV NODE_ENV=production
RUN pnpm prisma:generate && groupadd --system --gid 1001 thinktutor && useradd --system --uid 1001 --gid thinktutor thinktutor && chown -R thinktutor:thinktutor /app
USER thinktutor
CMD ["pnpm", "worker"]
