# Quick Start Guide

Get Obelisk Core running on your machine in under 10 minutes.

## Prerequisites

| Requirement | Version | Notes |
|-------------|---------|-------|
| Node.js | 20+ | For the execution engine and UI |
| Python | 3.10–3.12 | For the inference service |
| npm | 9+ | Comes with Node.js |
| Docker | 20.10+ | For running deployed agents |
| GPU (NVIDIA) | CUDA 12.x | Recommended for inference (CPU works but is slow) |

## Step 1: Clone and Configure

```bash
git clone https://github.com/ohnodev/obelisk-core.git
cd obelisk-core
cp .env.example .env
```

Edit `.env` if you want to change defaults. For local development, the defaults work out of the box.

## Step 2: Start the Inference Service

The inference service is a Python FastAPI server that loads the LLM model and serves it via REST API.

```bash
# Create a Python virtual environment
python3 -m venv venv
source venv/bin/activate

# Install dependencies (first run downloads ~2GB of model + deps)
pip install -r requirements.txt

# Start the inference service
python3 -m uvicorn src.inference.server:app --host 127.0.0.1 --port 7780
```

You should see:
```text
Obelisk Inference Service starting...
  Device: cuda          (or cpu if no GPU)
  Auth:   disabled      (set INFERENCE_API_KEY in .env to enable)
```

Verify it's running:
```bash
curl http://localhost:7780/health
# → {"status":"healthy","model_loaded":true,"model_name":"Qwen/Qwen3-0.6B","device":"cuda","memory_estimate_mb":620,"queue_size":0}
```

> **Tip**: Leave this running in a terminal tab. Or use PM2 (see Step 5).

## Step 3: Start the UI

```bash
# From the obelisk-core root directory
cd ui
npm install
npm run dev
```

Open **http://localhost:3000** in your browser. You'll see the visual workflow editor with a default workflow loaded.

## Step 4: Run Your First Workflow

1. The default workflow is already loaded with a basic Telegram bot setup
2. To test without Telegram, you can create a simple workflow:
   - Right-click the canvas → Add Node → **Text** (for input)
   - Right-click → Add Node → **Inference** (to call the LLM)
   - Connect the Text output to the Inference input
   - Click **Queue Prompt** (▶) in the toolbar
3. The LLM response appears in the output node

## Step 5: Use PM2 (Recommended)

For a more stable setup, use the included PM2 manager:

```bash
# From the obelisk-core root directory
# Make the script executable (first time only)
chmod +x pm2-manager.sh

# Start both inference and core services
./pm2-manager.sh start

# Check status
./pm2-manager.sh status

# View logs
./pm2-manager.sh logs

# Restart (also clears logs)
./pm2-manager.sh restart

# Stop everything
./pm2-manager.sh stop
```

## Step 6: Deploy an Agent (Optional)

To run a workflow as an autonomous agent in Docker:

```bash
# Build the agent Docker image (one time)
docker build -t obelisk-agent:latest -f docker/Dockerfile .
```

Then from the UI:
1. Connect your wallet (top-right corner)
2. Click **Deploy** in the toolbar
3. Give your agent a name and set any environment variables (e.g., `TELEGRAM_BOT_TOKEN`)
4. Click Deploy — the agent starts running in a Docker container
5. Visit `/deployments` to manage running agents

## Telegram Bot Quick Setup

To build a Telegram bot with Obelisk:

1. Create a bot via [@BotFather](https://t.me/BotFather) on Telegram
2. Copy the bot token
3. In the UI, set the bot token in your Telegram Listener node (or pass it as `{{process.env.TELEGRAM_BOT_TOKEN}}` and set it during deploy)
4. Set the chat ID in the TG Send Message node
5. Deploy the workflow — your bot is live!

The default workflow already has Telegram nodes wired up with quote-reply support.

## Troubleshooting

**Inference service won't start?**
- Check that Python 3.10–3.12 is installed: `python3 --version`
- Make sure the venv is activated: `source venv/bin/activate`
- Check GPU is detected: `python3 -c "import torch; print(torch.cuda.is_available())"`
- On CPU-only machines, inference works but is significantly slower

**UI can't connect to inference?**
- Make sure the inference service is running on port 7780
- Check `.env` — `INFERENCE_SERVICE_URL` should be `http://localhost:7780`

**Docker agent can't reach inference?**
- Agents in Docker need `INFERENCE_SERVICE_URL=http://host.docker.internal:7780`
- **Linux:** `host.docker.internal` may not resolve by default. Add `--add-host=host.docker.internal:host-gateway` when running the container (e.g., `docker run --add-host=host.docker.internal:host-gateway ...`)
- This is handled automatically when deploying from the UI, so the workaround is only needed for manual local Linux Docker runs

**PM2 not found?**
- Install it globally: `npm install -g pm2`

## Next Steps

- Read the full [README.md](README.md) for architecture details
- Check [INFERENCE_SERVER_SETUP.md](INFERENCE_SERVER_SETUP.md) to run inference on a remote GPU server
- See [docker/README.md](docker/README.md) for advanced Docker agent configuration
- Explore the [UI guide](ui/README.md) for workflow editor features
