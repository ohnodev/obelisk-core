# Obelisk Agent Docker Image (TypeScript edition)
# Runs an autonomous workflow using the TypeScript execution engine

FROM node:20-slim

# Set working directory
WORKDIR /app

# Copy package files
COPY ts/package.json ts/package-lock.json* ./

# Install dependencies
RUN npm ci --omit=dev

# Copy TypeScript source
COPY ts/src/ ./src/
COPY ts/tsconfig.json ./
COPY ts/docker/entrypoint.ts ./

# Build TypeScript
RUN npx tsc

# Create directories for runtime data
RUN mkdir -p /app/workflows

# Environment variables
ENV NODE_ENV=production

# The workflow JSON is passed via WORKFLOW_JSON env var
# Or mounted as a file at /app/workflows/workflow.json

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD node -e "require('./dist/core/execution/engine'); console.log('ok')" || exit 1

# Run the agent
ENTRYPOINT ["node", "dist/docker/entrypoint.js"]
