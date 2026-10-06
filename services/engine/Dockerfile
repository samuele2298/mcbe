FROM node:24-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY services/engine/package.json services/engine/
RUN pnpm install --frozen-lockfile --filter @cm/engine
COPY services/engine services/engine
RUN pnpm --filter @cm/engine build && pnpm --filter @cm/engine deploy --prod /out

# Stockfish ufficiale (build "universal": sceglie a runtime le istruzioni della CPU)
FROM debian:trixie-slim AS stockfish
ARG STOCKFISH_VERSION=sf_19
ARG TARGETARCH
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
    && arch=$([ "$TARGETARCH" = "arm64" ] && echo arm64 || echo x86-64) \
    && curl -fsSL -o /tmp/sf.tgz \
       "https://github.com/official-stockfish/Stockfish/releases/download/${STOCKFISH_VERSION}/stockfish-linux-${arch}-universal.tar.gz" \
    && tar xzf /tmp/sf.tgz -C /tmp \
    && install -m 755 /tmp/stockfish/stockfish-linux-*-universal /usr/local/bin/stockfish

FROM node:24-slim
ENV NODE_ENV=production
COPY --from=stockfish /usr/local/bin/stockfish /usr/local/bin/stockfish
WORKDIR /app/services/engine
COPY --from=build /out .
USER node
EXPOSE 4000
CMD ["node", "dist/index.js"]
