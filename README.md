# Obelisk Core

<p align="center">
  <img src="assets/obelisk-logo.jpg" alt="Obelisk Core" width="400">
</p>

<p align="center">
  <strong>Open-source AI agent framework with a visual workflow editor, self-hosted inference, and one-click deployment</strong>
</p>

<p align="center">
  <a href="https://github.com/ohnodev/obelisk-core/releases"><img src="https://img.shields.io/badge/version-0.2.0--beta-blue?style=for-the-badge" alt="Version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="MIT License"></a>
  <a href="https://github.com/ohnodev/obelisk-core"><img src="https://img.shields.io/badge/Status-Beta-green?style=for-the-badge" alt="Status"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/TypeScript-5.x-blue?style=for-the-badge&logo=typescript" alt="TypeScript"></a>
  <a href="https://www.python.org/downloads/"><img src="https://img.shields.io/badge/Python-3.10+-blue?style=for-the-badge&logo=python" alt="Python (Inference)"></a>
</p>

<p align="center">
  <a href="https://theobelisk.ai">🌐 Website</a> ·
  <a href="https://x.com/theobeliskai">𝕏 X (Twitter)</a> ·
  <a href="https://t.me/theobeliskportal">💬 Telegram</a>
</p>

**Obelisk Core** is an open-source framework for building, running, and deploying AI agents. Design workflows visually, connect to a self-hosted LLM, and deploy autonomous agents — all from your own hardware.

**Status**: 🟢 Beta — v0.2.0-beta

---

## How It Works

Obelisk Core has three components that work together:

```text
┌──────────────────────────────────┐
│         Visual Workflow Editor   │  ← Browser UI (Next.js)
│   Design agent workflows with   │    Build, test, and deploy
│   drag-and-drop nodes           │    workflows visually
└──────────────┬───────────────────┘
               │ executes
┌──────────────▼───────────────────┐
│      TypeScript Execution Engine │  ← Agent Runtime (Node.js)
│   Runs workflows as autonomous   │    Nodes: inference, Telegram,
│   agents in Docker containers    │    memory, scheduling, etc.
└──────────────┬───────────────────┘
               │ calls
┌──────────────▼───────────────────┐
│      Python Inference Service    │  ← LLM Server (FastAPI + PyTorch)
│   Self-hosted Qwen3 model with   │    Runs on GPU, serves via
│   thinking mode and API auth     │    REST API with auth
└──────────────────────────────────┘
```

1. **UI** — A visual node editor (like ComfyUI) where you wire up agent workflows
2. **Execution Engine** — TypeScript runtime that processes workflows node-by-node, runs agents in Docker containers
3. **Inference Service** — Python FastAPI server that loads and serves a local LLM (Qwen3-0.6B) on your GPU

## Features

- **Visual Workflow Editor** — Drag-and-drop node-based editor to design agent logic
- **Self-Hosted LLM** — Qwen3-0.6B with thinking mode, no external API calls required
- **Autonomous Agents** — Deploy workflows as long-running Docker containers
- **Telegram Integration** — Listener and sender nodes for building Telegram bots
- **Conversation Memory** — Persistent memory with automatic summarization
- **Binary Intent** — Yes/no decision nodes for conditional workflow logic
- **Wallet Authentication** — Privy-based wallet connect for managing deployed agents
- **Scheduling** — Cron-like scheduling nodes for periodic tasks
- **One-Click Deploy** — Deploy agents from the UI with environment variable injection

## Quick Start

### Prerequisites

- **Node.js 20+** and **npm**
- **Python 3.10–3.12** with a CUDA-capable GPU (for the inference service)
- **Docker** (for running deployed agents)

### 1. Clone the repo

```bash
git clone https://github.com/ohnodev/obelisk-core.git
cd obelisk-core
```

### 2. Start the Inference Service (Python)

The inference service hosts the LLM model and serves it via REST API.

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

### 3. Start the Execution Engine (TypeScript)

```bash
cd ts
npm install
npm run build
cd ..
```

### 4. Start the UI

```bash
cd ui
npm install
npm run dev
```

Open `http://localhost:3000` in your browser. You should see the visual workflow editor.

### 5. Run your first workflow

1. The default workflow is pre-loaded — it includes a Telegram bot setup
2. Click **Queue Prompt** (▶) to execute the workflow
3. The output appears in the output nodes on the canvas

### Using PM2 (Recommended for Production)

We provide a `pm2-manager.sh` script that manages both services:

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

PM2 keeps the inference service and execution engine running, auto-restarts on crashes, and manages log files.

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

```bash
docker run -d \
  --name my-agent \
  -e WORKFLOW_JSON='<your workflow JSON>' \
  -e AGENT_ID=agent-001 \
  -e AGENT_NAME="My Bot" \
  -e INFERENCE_SERVICE_URL=http://host.docker.internal:7780 \
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
├── ui/                     # Next.js visual workflow editor
│   ├── app/                # Pages (editor, deployments)
│   ├── components/         # React components (Canvas, Toolbar, nodes)
│   └── lib/                # Utilities (litegraph, wallet, API config)
├── docker/                 # Dockerfile and compose for agent containers
├── pm2-manager.sh          # PM2 process manager script
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
