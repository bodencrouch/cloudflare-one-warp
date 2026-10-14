FROM node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20

LABEL org.opencontainers.image.source="https://github.com/bodencrouch/cloudflare-one-warp"
LABEL org.opencontainers.image.description="Cloudflare One WARP API server (requires host warp-cli)"

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json server.js ./
COPY lib ./lib
COPY public ./public
COPY assets ./assets
COPY scripts ./scripts
COPY bin ./bin

ENV PORT=4173
EXPOSE 4173

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/api/health" | grep -q cloudflare-one-warp

USER node
CMD ["node", "server.js"]
