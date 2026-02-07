# Obelisk Agent Docker Image (TypeScript edition)
# Runs an autonomous workflow using the TypeScript execution engine

FROM node:20-slim

# Set working directory
WORKDIR /app

# Copy package files
COPY ts/package.json ts/package-lock.json* ./

# Install dependencies (runs as root so npm ci can write to node_modules)
RUN npm ci --omit=dev

# Copy TypeScript source
COPY ts/src/ ./src/
COPY ts/tsconfig.json ./
COPY ts/docker/entrypoint.ts ./

# Build TypeScript (needs root for writing to dist/)
RUN npx tsc

# Create runtime directories
RUN mkdir -p /app/workflows

# Create a non-root user and hand over ownership
RUN addgroup --system appgroup && \
    adduser --system --ingroup appgroup appuser && \
    chown -R appuser:appgroup /app

# Switch to non-root user for runtime
USER appuser

# Environment variables
ENV NODE_ENV=production

# The workflow JSON is passed via WORKFLOW_JSON env var
# Or mounted as a file at /app/workflows/workflow.json

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "require('./dist/core/execution/engine'); console.log('ok')" || exit 1

# Run the agent as unprivileged user
ENTRYPOINT ["node", "dist/docker/entrypoint.js"]
