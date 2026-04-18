# Minimal Dockerfile for the planforge HTTP service.
#
# This image ships the planforge CLI (JS, at the repo root) plus the HTTP
# service (TypeScript, in `server/`) and nothing else. It intentionally does
# NOT include scaffoldkit / Python — that's a separate concern tracked in a
# follow-up ticket and will layer onto this image when it lands.
#
# Build from the repo root:
#   docker build -f server/Dockerfile -t agent-planforge .
#
# Runtime:
#   docker run -p 8223:8223 \
#     -e PLANFORGE_SERVICE_TOKEN=<token> \
#     agent-planforge

FROM node:22-alpine AS builder
WORKDIR /app

# Server sub-package has its own package.json; install and build it first so
# the slow step (npm install) is cached independently of the CLI code below.
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci

COPY server/tsconfig.json server/
COPY server/src ./server/src
RUN cd server && npm run build

FROM node:22-alpine
WORKDIR /app

# The CLI lives at the repo root — copy the minimum it needs at runtime.
# Installed production deps of the root (ajv, etc.) come via the root's own
# npm install; this stays separate from the server install.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY scripts ./scripts
COPY config ./config
COPY models ./models
COPY examples ./examples
COPY templates ./templates
COPY playbooks ./playbooks

# Server runtime — only the built output and production deps.
COPY --from=builder /app/server/package.json ./server/
COPY --from=builder /app/server/package-lock.json ./server/
COPY --from=builder /app/server/dist ./server/dist
RUN cd server && npm ci --omit=dev

ENV PLANFORGE_ROOT=/app
ENV PORT=8223
EXPOSE 8223

CMD ["node", "server/dist/index.js"]
