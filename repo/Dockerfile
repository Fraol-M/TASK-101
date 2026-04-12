# =============================================================================
# GradAdmissions Platform — Multi-stage Dockerfile
#
# Targets:
#   development — hot-reload dev server (source bind-mounted by compose)
#   test        — one-shot Vitest runner
#   production  — lean, non-root, dumb-init PID 1           ← default
#
# Usage:
#   docker build --target production .          # CI / prod
#   docker build --target development .         # local (via compose)
#   docker build --target test .               # CI test run
# =============================================================================

# ── Stage 1: base ─────────────────────────────────────────────────────────────
# Shared by all stages. Installs dumb-init and copies manifests only.
# Manifest-only layer means dependency installs are cached across source changes.
FROM node:20-alpine AS base

# dumb-init: proper PID-1 signal forwarding + zombie reaping
RUN apk add --no-cache dumb-init

WORKDIR /app
COPY package.json package-lock.json ./

# ── Stage 2: deps-dev — all dependencies (prod + dev) ─────────────────────────
FROM base AS deps-dev
RUN npm ci

# ── Stage 3: deps-prod — production dependencies only ─────────────────────────
# Smaller layer: no vitest, supertest, eslint, etc.
FROM base AS deps-prod
RUN npm ci --omit=dev

# ── Stage 4: development ──────────────────────────────────────────────────────
# docker-compose.override.yml bind-mounts ./src over /app/src for live reload.
# Source is also COPY-ed here so the image works standalone (e.g., CI smoke test).
FROM deps-dev AS development

ENV NODE_ENV=development

COPY . .

EXPOSE 3000

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
# Node 20 built-in file watcher — no nodemon required
CMD ["node", "--watch", "src/server.js"]

# ── Stage 5: test ─────────────────────────────────────────────────────────────
# One-shot test runner. Exit code propagates to docker compose run exit code.
FROM deps-dev AS test

ENV NODE_ENV=test

COPY . .

ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["npm", "run", "test"]

# ── Stage 6: production ───────────────────────────────────────────────────────
FROM deps-prod AS production

ENV NODE_ENV=production

# Copy only what the runtime needs
COPY src       ./src
COPY db        ./db
COPY scripts   ./scripts
COPY docker    ./docker
COPY knexfile.js package.json ./

# Non-root user for defence-in-depth
RUN addgroup -g 1001 -S appgroup \
 && adduser  -u 1001 -S appuser -G appgroup \
 && mkdir -p /app/storage/attachments \
 && chown -R appuser:appgroup /app/storage \
 && chmod +x /app/docker/entrypoint.sh

USER appuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# entrypoint.sh runs `npm run migrate` then execs the server.
ENTRYPOINT ["/usr/bin/dumb-init", "--", "/app/docker/entrypoint.sh"]
