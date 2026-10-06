FROM node:24-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY services/api/package.json services/api/
RUN pnpm install --frozen-lockfile --filter @cm/api
COPY services/api services/api
RUN pnpm --filter @cm/api build && pnpm --filter @cm/api deploy --prod /out

FROM node:24-slim
ENV NODE_ENV=production
# zstd serve a seed:puzzles (dump Lichess)
RUN apt-get update && apt-get install -y --no-install-recommends zstd ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app/services/api
COPY --from=build /out .
COPY db/migrations /app/db/migrations
USER node
EXPOSE 3000
CMD ["node", "dist/server.js"]
