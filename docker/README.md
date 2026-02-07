# Obelisk Agent Docker Image

Run autonomous obelisk-core workflows in isolated Docker containers.

## Quick Start

### 1. Build the image

```bash
cd /path/to/obelisk-core
docker build -t obelisk-agent:latest -f docker/Dockerfile .
```

### 2. Run with a workflow

**Option A: Pass workflow as environment variable**

```bash
docker run -d \
  --name my-agent \
  -e WORKFLOW_JSON='{"id":"test","nodes":[...],"connections":[...]}' \
  -e AGENT_ID=my-agent-1 \
  -e AGENT_NAME="My First Agent" \
  obelisk-agent:latest
```

**Option B: Mount workflow file**

```bash
docker run -d \
  --name my-agent \
  -v /path/to/workflow.json:/app/workflows/workflow.json:ro \
  -e AGENT_ID=my-agent-1 \
  -e AGENT_NAME="My First Agent" \
  obelisk-agent:latest
```

### 3. Check logs

```bash
docker logs -f my-agent
```

### 4. Stop agent

```bash
docker stop my-agent
docker rm my-agent
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `WORKFLOW_JSON` | Workflow JSON string | - |
| `WORKFLOW_FILE` | Path to workflow JSON file | `/app/workflows/workflow.json` |
| `AGENT_ID` | Unique agent identifier | `unknown` |
| `AGENT_NAME` | Human-readable agent name | `unnamed` |
| `OBELISK_LOG_LEVEL` | Logging level (DEBUG, INFO, WARNING, ERROR) | `INFO` |
| `OBELISK_VAR_*` | Custom context variables (e.g., `OBELISK_VAR_USER_ID=123`) | - |

## Passing Secrets

For API keys and sensitive data, pass them as environment variables:

```bash
docker run -d \
  --name my-agent \
  -e WORKFLOW_JSON='...' \
  -e OPENAI_API_KEY=sk-xxx \
  -e TELEGRAM_BOT_TOKEN=123:ABC \
  obelisk-agent:latest
```

These will be available in workflow nodes via `process.env.*` template syntax.

## Resource Limits

Control memory and CPU usage:

```bash
docker run -d \
  --name my-agent \
  --memory=512m \
  --cpus=0.5 \
  -e WORKFLOW_JSON='...' \
  obelisk-agent:latest
```

## Docker Compose

For local development, use docker-compose:

```bash
cd docker
docker-compose up --build
```

Edit `docker-compose.yml` to configure your agent.

## Health Check

The container includes a health check that verifies the Node.js runtime is working:

```bash
docker inspect --format='{{.State.Health.Status}}' my-agent
```

## Volumes

Mount volumes for persistent data:

```bash
docker run -d \
  --name my-agent \
  -v agent_memory:/app/memory \
  -e WORKFLOW_JSON='...' \
  obelisk-agent:latest
```

## Deployment with obelisk-service

The obelisk-service private API can manage these containers automatically:

```bash
POST /agents/deploy
{
  "workflow": { ... },
  "name": "My Agent",
  "env_vars": {
    "OPENAI_API_KEY": "sk-xxx"
  }
}
```

See the obelisk-service documentation for more details.
