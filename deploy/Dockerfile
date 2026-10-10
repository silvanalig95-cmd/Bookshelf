# Lesekompass als Docker-Container – baut die App und startet den Server, der sich selbst aktualisiert.
# Bauen aus dem Projektordner:   docker build -f deploy/Dockerfile -t lesekompass .
# Normalerweise über:            docker compose -f deploy/docker-compose.yml up -d --build

ARG RUNTIME_BASE=node:24-slim

# ---- 1. App bauen und testen
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund --loglevel=error
COPY . .
ARG BUILD=docker
RUN LESEKOMPASS_BUILD="$BUILD" npm run build && npm test

# ---- 2. Laufzeit: nur die gebaute App, der Server und die Update-Skripte (+ git und npm für Updates)
# RUNTIME_BASE/INSTALL_GIT nur ändern, wenn apt nicht erreichbar ist: z. B. node:24 (enthält git) und INSTALL_GIT=0.
FROM ${RUNTIME_BASE}
ARG INSTALL_GIT=1
RUN if [ "$INSTALL_GIT" = 1 ]; then apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
      && rm -rf /var/lib/apt/lists/*; fi \
    && git --version \
    && mkdir -p /srv/lesekompass && chown node:node /srv/lesekompass
ARG BUILD=docker
COPY --from=build --chown=node:node /app/dist /opt/lesekompass-seed/dist
COPY --chown=node:node server /opt/lesekompass-seed/server
COPY --chown=node:node deploy /opt/lesekompass-seed/deploy
COPY --chown=node:node package.json package-lock.json /opt/lesekompass-seed/
RUN echo "$BUILD" > /opt/lesekompass-seed/BUILD && chmod +x /opt/lesekompass-seed/deploy/*.sh
ENV LESEKOMPASS_HOME=/srv/lesekompass \
    LESEKOMPASS_SEED=/opt/lesekompass-seed \
    LESEKOMPASS_HOST=0.0.0.0 \
    LESEKOMPASS_PORT=8080 \
    LESEKOMPASS_REPO_URL=https://github.com/silvanalig95-cmd/Bookshelf.git \
    LESEKOMPASS_BRANCH=claude/book-search-recommendation-tool-2w5p6a
USER node
VOLUME ["/srv/lesekompass"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.LESEKOMPASS_PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/opt/lesekompass-seed/deploy/run.sh"]
