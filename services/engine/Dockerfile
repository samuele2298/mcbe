FROM node:24-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY services/engine/package.json services/engine/
RUN pnpm install --frozen-lockfile --filter @cm/engine
COPY services/engine services/engine
RUN pnpm --filter @cm/engine build && pnpm --filter @cm/engine deploy --prod /out

FROM node:24-slim
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends stockfish \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app/services/engine
COPY --from=build /out .
USER node
CMD ["node", "dist/index.js"]
