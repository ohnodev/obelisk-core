# Obelisk Agent Docker Image
# Runs an autonomous workflow using obelisk-core WorkflowRunner

FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for better caching
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy source code
COPY src/ ./src/
COPY setup.py .
COPY README.md .

# Install obelisk-core
RUN pip install -e .

# Copy entrypoint
COPY docker/entrypoint.py .

# Create directories for runtime data
RUN mkdir -p /app/memory /app/workflows

# Environment variables
ENV PYTHONUNBUFFERED=1
ENV OBELISK_LOG_LEVEL=INFO

# The workflow JSON is passed via WORKFLOW_JSON env var
# Or mounted as a file at /app/workflows/workflow.json

# Health check - verify Python and imports work
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD python -c "from src.core.execution.runner import WorkflowRunner; print('ok')" || exit 1

# Run the agent
ENTRYPOINT ["python", "entrypoint.py"]
