# Obelisk Core

<p align="center">
  <img src="assets/obelisk-logo.jpg" alt="Obelisk Core" width="400">
</p>

<p align="center">
  <strong>Open-source AI agent framework with a visual workflow editor, self-hosted inference, and one-click deployment</strong>
</p>

<p align="center">
  <a href="https://github.com/ohnodev/obelisk-core/releases"><img src="https://img.shields.io/badge/version-0.2.0--alpha-blue?style=for-the-badge" alt="Version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="MIT License"></a>
  <a href="https://github.com/ohnodev/obelisk-core"><img src="https://img.shields.io/badge/Status-Alpha-yellow?style=for-the-badge" alt="Status"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/TypeScript-5.x-blue?style=for-the-badge&logo=typescript" alt="TypeScript"></a>
  <a href="https://www.python.org/downloads/"><img src="https://img.shields.io/badge/Python-3.10+-blue?style=for-the-badge&logo=python" alt="Python (Inference)"></a>
</p>

<p align="center">
  <a href="https://theobelisk.ai">🌐 Website</a> ·
  <a href="https://x.com/theobeliskai">𝕏 X (Twitter)</a> ·
  <a href="https://t.me/theobeliskportal">💬 Telegram</a>
</p>

**Obelisk Core** is an open-source framework for building, running, and deploying AI agents. Design workflows visually, connect to a self-hosted LLM, and deploy autonomous agents — all from your own hardware.

**Status**: 🟡 Alpha — v0.2.0-alpha

---

## How It Works

Obelisk Core uses several services that work together:

```text
┌──────────────────────────────────┐
│         Visual Workflow Editor   │     ← Browser UI (Next.js)
│   Design agent workflows with    │     Build, test, and deploy
│   drag-and-drop nodes            │     workflows visually
└──────────────┬───────────────────┘
               │ executes
┌──────────────▼───────────────────┐
│      TypeScript Execution Engine │     ← Agent Runtime (Node.js)
│   Runs workflows as autonomous   │     Nodes: inference, Telegram,
│   agents in Docker containers    │     memory, scheduling, Clanker, Polymarket, etc.
└──────────────┬───────────────────┘
               │ calls
     ┌─────────┴─────────┬─────────────────┬──────────────────┐
     ▼                   ▼                 ▼                  ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐
│  Inference   │  │  Blockchain  │  │  Polymarket  │  │  Deployment API  │
│  Service     │  │  Service     │  │  Service     │  │  (Agents)        │
│  (Python)    │  │  (Clanker)   │  │  (Orders,    │  │  Build, deploy,  │
│  Qwen3 local │  │  State, V4   │  │  Redeem,     │  │  manage agents   │
│  or Router   │  │  swaps       │  │  Snapshot)   │  │                  │
└──────────────┘  └──────────────┘  └──────────────┘  └──────────────────┘
```

**Services:**

1. **Inference Service** — Python FastAPI server with self-hosted Qwen3-0.6B, or use the **Router Service** ([https://router.theobelisk.ai](https://router.theobelisk.ai)) for hosted LLMs (e.g. Mistral). In the Inference Config node, set `endpoint_url` to `https://router.theobelisk.ai` (canonical default). If your router is behind a path-based proxy or the service docs specify a `/v1` base path, use `https://router.theobelisk.ai/v1` instead. Set `agent_id` (e.g. `clawballs`) for the agent to use.
2. **Blockchain Service** — Clanker state API, launch summary, V4 swaps (CabalSwapper); workflows read token/pool data and execute buys/sells
3. **Polymarket Service** — CLOB orders, redeem positions, market snapshot, probability model; used by Polymarket Sniper workflows
4. **Deployment Layer** — Deploy workflows as Docker agents from the UI; manage running agents at `/deployments`

The **Deployment API** (build, deploy, manage agents) is separate from the PM2-managed group: PM2 starts/stops only **core**, **inference**, **blockchain**, and **polymarket**. The Deployment API must be deployed and managed outside PM2. When self-hosting it, configure the service with the required settings (e.g. base URL, authentication tokens if applicable) and run it on a standalone VM, in a container (Docker), or on Kubernetes. The UI expects the deployment service at the URL configured in your environment (e.g. api.theobelisk.ai in production). See [docker/README.md](docker/README.md) for agent container and deploy endpoint details.

The **UI** is a visual node editor (like ComfyUI). The **Execution Engine** is a TypeScript runtime that processes workflows node-by-node and runs agents in Docker containers.

## Features

- **Visual Workflow Editor** — Drag-and-drop node-based editor to design agent logic
- **Self-Hosted LLM** — Qwen3-0.6B with thinking mode, no external API required; or use **Router Service** ([https://router.theobelisk.ai](https://router.theobelisk.ai)) to hook up Mistral or other hosted LLMs via Inference Config (`endpoint_url`: `https://router.theobelisk.ai`, `agent_id`: e.g. `clawballs`)
- **Autonomous Agents** — Deploy workflows as long-running Docker containers
- **Telegram Integration** — Listener and sender nodes for building Telegram bots
- **Conversation Memory** — Persistent memory with automatic summarization
- **Binary Intent** — Yes/no decision nodes for conditional workflow logic
- **Wallet Authentication** — Privy-based wallet connect for managing deployed agents
- **Clanker / Blockchain** — Blockchain service (obelisk-blockchain), Blockchain Config node, Clanker Launch Summary, Wallet, Clanker Buy/Sell (V4 swaps via CabalSwapper), Action Router; **onSwap trigger** (last_swap.json) for Bag Checker (profit/stop-loss) → Clanker Sell
- **Polymarket** — Polymarket service (polymarket-service): CLOB orders, redeem, snapshot, probability model; Polymarket Sniper template and nodes
- **Scheduling** — Cron-like scheduling nodes for periodic tasks
- **One-Click Deploy** — Deploy agents from the UI with environment variable injection

## Quick Start

### Prerequisites

- **Node.js 20+** and **npm**
- **Python 3.10+** — a CUDA-capable GPU is required only for local self-hosted Qwen inference; not required when using Router-hosted LLMs (e.g. [https://router.theobelisk.ai](https://router.theobelisk.ai))
- **Docker** (for running deployed agents)

### 1. Clone the repo

```bash
git clone https://github.com/ohnodev/obelisk-core.git
cd obelisk-core
```

### 2. Start the Inference Service (Python) — optional if using Router

The inference service hosts the LLM model and serves it via REST API. **Skip this step** if you use the Router service ([https://router.theobelisk.ai](https://router.theobelisk.ai)) for hosted LLMs; a GPU is only required for local self-hosted Qwen inference.

```bash
# Create Python venv and install dependencies
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Configure (optional — defaults work for local dev)
cp .env.example .env
# Edit .env if you want to set an API key or change the port

# Start the inference service
python3 -m uvicorn src.inference.server:app --host 127.0.0.1 --port 7780
```

The first run downloads the Qwen3-0.6B model (~600MB). Once running, test it:

```bash
curl http://localhost:7780/health
```

### 3. Start Blockchain / Polymarket Services (optional)

For Clanker or Polymarket workflows you need the **blockchain** and **polymarket** services. For local dev that only uses the default Telegram/inference flow, you can skip this step.

**Option A — PM2 (recommended):** start all services including blockchain and polymarket:

```bash
./pm2-manager.sh start
```

**Option B — Without PM2:** start each service from its directory (see [blockchain-service/README.md](blockchain-service/README.md) and [polymarket-service/README.md](polymarket-service/README.md)). For example, from the repo root: build and run the blockchain service on port 8888 and the polymarket service on port 1110.

### 4. Start the Execution Engine (TypeScript)

```bash
cd ts
npm install
npm run build
cd ..
```

### 5. Start the UI

```bash
cd ui
npm install
npm run dev
```

Open `http://localhost:3000` in your browser. You should see the visual workflow editor.

### 6. Run your first workflow

1. The default workflow is pre-loaded — it includes a Telegram bot setup
2. Click **Queue Prompt** (▶) to execute the workflow
3. The output appears in the output nodes on the canvas

### Using PM2 (Recommended for Production)

We provide a `pm2-manager.sh` script that manages all services (core, inference, blockchain, polymarket):

```bash
# Start everything
./pm2-manager.sh start

# Restart services (clears logs)
./pm2-manager.sh restart

# Stop everything
./pm2-manager.sh stop

# View status
./pm2-manager.sh status

# View logs
./pm2-manager.sh logs
```

PM2 keeps the core API, inference, blockchain, and polymarket services running, auto-restarts on crashes, and manages log files.

## Agent Deployment

Agents are workflows packaged into Docker containers that run autonomously.

### Building the Agent Image

```bash
docker build -t obelisk-agent:latest -f docker/Dockerfile .
```

### Deploying from the UI

1. Connect your wallet in the UI toolbar
2. Design your workflow (or use the default)
3. Click **Deploy** — the UI sends the workflow to your deployment service
4. The agent runs in a Docker container on your machine
5. Manage running agents at `/deployments`

### Running an Agent Manually

When running agents in Docker, the container must reach host services. Set **INFERENCE_SERVICE_URL**, **BLOCKCHAIN_SERVICE_URL**, and **POLYMARKET_SERVICE_URL** to point at the host (e.g. `host.docker.internal` with the appropriate ports). On **native Linux**, `host.docker.internal` is not defined by default — add `--add-host=host.docker.internal:host-gateway` so it resolves. **Docker Compose** users: add `extra_hosts: ["host.docker.internal:host-gateway"]` to the service for the same effect.

```bash
docker run -d \
  --add-host=host.docker.internal:host-gateway \
  --name my-agent \
  -e WORKFLOW_JSON='<your workflow JSON>' \
  -e AGENT_ID=agent-001 \
  -e AGENT_NAME="My Bot" \
  -e INFERENCE_SERVICE_URL=http://host.docker.internal:7780 \
  -e BLOCKCHAIN_SERVICE_URL=http://host.docker.internal:8888 \
  -e POLYMARKET_SERVICE_URL=http://host.docker.internal:1110 \
  -e TELEGRAM_BOT_TOKEN=your_token \
  obelisk-agent:latest
```

See [docker/README.md](docker/README.md) for full details on environment variables, resource limits, and Docker Compose.

## Available Nodes

| Node | Description |
|------|-------------|
| **Text** | Static text input/output |
| **Inference** | Calls the LLM via the inference service |
| **Inference Config** | Configures model parameters (temperature, max tokens, thinking mode) |
| **Binary Intent** | Yes/no classification for conditional logic |
| **Telegram Listener** | Polls for incoming Telegram messages |
| **TG Send Message** | Sends messages via Telegram Bot API (supports quote-reply) |
| **Memory Creator** | Creates conversation summaries |
| **Memory Selector** | Retrieves relevant memories for context |
| **Memory Storage** | Persists memories to storage |
| **Telegram Memory Creator** | Telegram-specific memory summarization |
| **Telegram Memory Selector** | Telegram-specific memory retrieval |
| **Scheduler** | Cron-based scheduling for periodic execution |

## Project Structure

```text
obelisk-core/
├── src/inference/          # Python inference service (FastAPI + PyTorch)
│   ├── server.py           # REST API server
│   ├── model.py            # LLM loading and generation
│   ├── queue.py            # Async request queue
│   └── config.py           # Inference configuration
├── ts/                     # TypeScript execution engine
│   ├── src/
│   │   ├── core/           # Workflow runner, node execution
│   │   │   └── execution/
│   │   │       ├── runner.ts
│   │   │       └── nodes/  # All node implementations
│   │   └── utils/          # JSON parsing, logging, etc.
│   └── tests/              # Vitest test suite
├── blockchain-service/     # Clanker state API, block processing, V4 swaps
├── polymarket-service/     # CLOB orders, redeem, market snapshot, probability model
├── ui/                     # Next.js visual workflow editor
│   ├── app/                # Pages (editor, deployments)
│   ├── components/         # React components (Canvas, Toolbar, nodes)
│   └── lib/                # Utilities (litegraph, wallet, API config)
├── docker/                 # Dockerfile and compose for agent containers
├── pm2-manager.sh          # PM2 process manager (core, inference, blockchain, polymarket)
├── requirements.txt        # Python deps (inference service only)
└── .env.example            # Environment variable template
```

## Configuration

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Key variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `INFERENCE_HOST` | Inference service bind address | `127.0.0.1` |
| `INFERENCE_PORT` | Inference service port | `7780` |
| `INFERENCE_API_KEY` | API key for inference auth (optional for local dev) | — |
| `INFERENCE_DEVICE` | PyTorch device (`cuda`, `cpu`) | auto-detect |
| `INFERENCE_SERVICE_URL` | URL agents use to reach inference | `http://localhost:7780` |
| `BLOCKCHAIN_SERVICE_URL` | Blockchain service (Clanker state, etc.) | `http://localhost:8888` |
| `POLYMARKET_SERVICE_URL` | Polymarket service (orders, redeem, snapshot) | `http://localhost:1110` |
| `TELEGRAM_DEV_AGENT_BOT_TOKEN` | Default Telegram bot token for dev | — |
| `TELEGRAM_CHAT_ID` | Default Telegram chat ID for dev | — |

For remote inference setup (GPU VPS), see [INFERENCE_SERVER_SETUP.md](INFERENCE_SERVER_SETUP.md).

## Documentation

- **[Quick Start Guide](QUICKSTART.md)** — Get running in 5 minutes
- **[Inference API](API.md)** — Inference service endpoints
- **[Inference Server Setup](INFERENCE_SERVER_SETUP.md)** — Deploy inference on a GPU VPS
- **[Docker Agents](docker/README.md)** — Build and run agent containers
- **[UI Guide](ui/README.md)** — Visual workflow editor
- **[Contributing](CONTRIBUTING.md)** — How to contribute
- **[Security](SECURITY.md)** — Security best practices
- **[Changelog](CHANGELOG.md)** — Version history

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

<p align="center">
  <strong>Built with ❤️ by <a href="https://theobelisk.ai">The Obelisk</a></strong>
</p>
