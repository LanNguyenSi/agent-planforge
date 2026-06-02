# Multi-stage Dockerfile for the planforge HTTP service.
#
# Layers:
#   1. `node-builder`   — installs server npm deps, builds the TS output
#   2. `scaffoldkit`    — clones scaffoldkit, installs it into a pinned
#                          Python venv at /opt/sk-venv. The clone stays at
#                          /opt/scaffoldkit so `loadScaffoldkitContext()`
#                          (scripts/bootstrap-plan.js:1036) finds its
#                          `src/scaffoldkit/blueprints/` directory.
#   3. final (`node:22-bookworm-slim`) — bundles the planforge CLI,
#                          the compiled server, and both scaffoldkit
#                          artifacts, then runs the Hono HTTP service.
#
# We use `bookworm-slim` (Debian) rather than Alpine because the
# scaffoldkit venv built in stage 2 would otherwise ship glibc-linked
# CPython and fail to execute on musl. The image-size trade-off (~40 MB)
# is worth the robustness.
#
# Scaffoldkit is pinned to a commit rather than tracking main so a
# breaking change upstream doesn't silently ride in on a planforge
# rebuild. Bump deliberately.
#
# Build from the repo root:
#   docker build -f server/Dockerfile -t agent-planforge .
#
# Runtime:
#   docker run -p 8223:8223 \
#     -e PLANFORGE_SERVICE_TOKEN=<token> \
#     agent-planforge

# ─── Stage 1: Node/TS build ─────────────────────────────────────────────────
FROM node:22-bookworm-slim AS node-builder
WORKDIR /app

COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci

COPY server/tsconfig.json server/
COPY server/src ./server/src
RUN cd server && npm run build

# ─── Stage 2: Scaffoldkit venv ──────────────────────────────────────────────
# Pinned to 3.11 because the final stage pulls Debian-Bookworm's
# python3 (= 3.11) via apt. Using 3.12 in the builder would mismatch
# and the venv's python3 binary would fail at runtime with
# `cannot open shared object file: libpython3.12.so.1.0`.
FROM python:3.11-slim AS scaffoldkit
# Pinned to https://github.com/LanNguyenSi/scaffoldkit @ f52acba (2026-06).
# Update this when bumping scaffoldkit; image build will pull a fresh
# clone and rebuild the venv. f52acba unifies the fastapi-backend blueprint on the
# src/ layout (app/ -> src/, app/api/routes/ -> src/routes/) so the scaffold matches
# the planner's task paths, on top of d2739c2's fastapi-backend starter source.
ARG SCAFFOLDKIT_REF=26d9ce1ac54eecb5989c4e5c762b84c703615125

RUN apt-get update \
 && apt-get install --no-install-recommends -y git ca-certificates \
 && rm -rf /var/lib/apt/lists/*

RUN git clone https://github.com/LanNguyenSi/scaffoldkit.git /opt/scaffoldkit \
 && cd /opt/scaffoldkit \
 && git checkout "$SCAFFOLDKIT_REF" \
 && rm -rf .git

# The venv's own scripts shebang `#!/opt/sk-venv/bin/python3` works on
# the final image because the Bookworm `python3` package (= 3.11)
# provides the matching libpython3.11.so.1.0. No `--copies` needed —
# symlinking into the system python keeps the venv small.
RUN python3 -m venv /opt/sk-venv \
 && /opt/sk-venv/bin/pip install --no-cache-dir --upgrade pip \
 && /opt/sk-venv/bin/pip install --no-cache-dir /opt/scaffoldkit

# Smoke: verify the CLI entry is reachable inside the venv. If this
# line fails, the image build fails — better here than at runtime.
RUN /opt/sk-venv/bin/scaffoldkit --help > /dev/null

# ─── Stage 3: runtime ──────────────────────────────────────────────────────
FROM node:22-bookworm-slim
WORKDIR /app

# Python runtime + ca-certs. The scaffoldkit venv is a Python-3.11
# build (see stage 2 comment); Bookworm ships 3.11 as its `python3`, so
# installing it here gives the venv the matching `libpython3.11.so.1.0`
# it needs at runtime. `--no-install-recommends` keeps the image from
# dragging in a GUI toolchain along with the interpreter.
#
# The venv's python3 symlink points at `/usr/local/bin/python3` (the
# location of python on the builder's `python:3.11-slim` base), but
# Bookworm's apt installs python3 at `/usr/bin/python3`. Symlink from
# the expected builder path to the apt-installed path so the venv's
# scripts work without being rewritten.
RUN apt-get update \
 && apt-get install --no-install-recommends -y python3 ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && ln -s /usr/bin/python3 /usr/local/bin/python3

# The CLI (and its root package.json) live at the repo root.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY scripts ./scripts
COPY config ./config
COPY models ./models
COPY examples ./examples
COPY templates ./templates
COPY playbooks ./playbooks

# Server runtime — only built output and prod deps.
COPY --from=node-builder /app/server/package.json ./server/
COPY --from=node-builder /app/server/package-lock.json ./server/
COPY --from=node-builder /app/server/dist ./server/dist
RUN cd server && npm ci --omit=dev

# Scaffoldkit venv + source clone. The source clone is what
# `loadScaffoldkitContext()` reads for blueprint metadata; the venv
# holds the CLI entry the service subprocess-spawns.
COPY --from=scaffoldkit /opt/sk-venv /opt/sk-venv
COPY --from=scaffoldkit /opt/scaffoldkit /opt/scaffoldkit

ENV PLANFORGE_ROOT=/app \
    PORT=8223 \
    SCAFFOLDKIT_ROOT=/opt/scaffoldkit \
    SCAFFOLDKIT_PYTHON=/opt/sk-venv/bin/python3

# Prepend the venv to PATH so `scaffoldkit` is callable bare. Done in a
# separate ENV because `$PATH` expansion inside the multi-line ENV above
# would refer to whatever PATH Docker had set at ENV-processing time
# (often empty or the base image's default) rather than the image's
# runtime PATH — subtle enough to silently break the smoke below.
ENV PATH=/opt/sk-venv/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

EXPOSE 8223

# Sanity check at image bake: a real invocation that exercises the
# import path planforge uses at runtime (`python -m scaffoldkit.cli`).
# Catches venv-copy regressions AND shebang mismatches. `--help` is
# used as the smoke because scaffoldkit doesn't expose `--version`.
RUN /opt/sk-venv/bin/python3 -m scaffoldkit.cli --help > /dev/null \
 && scaffoldkit --help > /dev/null

CMD ["node", "server/dist/index.js"]
