# Obelisk Agent Docker Image (TypeScript)
# Runs an autonomous workflow using obelisk-core WorkflowRunner
#
# Multi-stage build: compile TS in a build stage, run slim in production.

# ---- Build stage ----
FROM node:20-slim AS build

WORKDIR /build

# Copy package manifests
COPY ts/package.json ts/package-lock.json* ./

# Install ALL dependencies (including devDependencies for tsc)
RUN npm ci 2>/dev/null || npm install

# Copy TypeScript source and build config
COPY ts/tsconfig.json ./
COPY ts/src/ ./src/

# Compile TypeScript → dist/
RUN npx tsc

# ---- Production stage ----
FROM node:20-slim

WORKDIR /app

# Copy package manifests and install production deps only
COPY ts/package.json ts/package-lock.json* ./
RUN npm ci --omit=dev 2>/dev/null || npm install --omit=dev

# Copy compiled JS from build stage
COPY --from=build /build/dist ./dist

# Copy entrypoint
COPY docker/entrypoint.js .

# Create directories for runtime data
RUN mkdir -p /app/memory /app/workflows

# Create a non-root user to run the application
RUN groupadd --system obelisk \
 && useradd --system --gid obelisk --home-dir /app --shell /bin/sh obelisk \
 && chown -R obelisk:obelisk /app

# Environment variables
ENV NODE_ENV=production
ENV OBELISK_LOG_LEVEL=INFO

# The workflow JSON is passed via WORKFLOW_JSON env var
# Or mounted as a file at /app/workflows/workflow.json

# Expose HTTP Listener port (used by HttpListenerNode for API endpoints)
EXPOSE 8080

# Switch to non-root user
USER obelisk

# Health check - verify Node.js and imports work
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "require('./dist/core/execution/runner'); console.log('ok')" || exit 1

# Run the agent
ENTRYPOINT ["node", "entrypoint.js"]
