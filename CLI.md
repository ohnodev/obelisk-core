# PM2 Manager

Obelisk Core uses a `pm2-manager.sh` script to manage its services via [PM2](https://pm2.keymetrics.io/).

> **Note**: The old `obelisk-core` CLI (`obelisk-core chat`, `obelisk-core serve`, etc.) has been removed. The execution engine is now TypeScript and services are managed via PM2.

## Prerequisites

Install PM2 globally:

```bash
npm install -g pm2
```

Make the script executable:

```bash
chmod +x pm2-manager.sh
```

## Commands

### Start

Start both the inference service and execution engine:

```bash
./pm2-manager.sh start
```

This starts:
- **obelisk-inference** — Python inference service on port 7780
- **obelisk-core** — TypeScript execution engine

### Stop

```bash
./pm2-manager.sh stop
```

### Restart

Restart services and clear logs:

```bash
./pm2-manager.sh restart
```

You can restart individual services:

```bash
./pm2-manager.sh restart core        # Restart only the execution engine
./pm2-manager.sh restart inference    # Restart only the inference service
```

### Status

```bash
./pm2-manager.sh status
```

### Logs

View live logs:

```bash
./pm2-manager.sh logs
```

## Services

| Service | Runtime | Default Port | Description |
|---------|---------|-------------|-------------|
| `obelisk-inference` | Python 3.10+ | 7780 | LLM inference via FastAPI |
| `obelisk-core` | Node.js 20+ | — | TypeScript workflow execution engine |

## Environment Variables

The services read configuration from `.env` in the project root. See [.env.example](.env.example) for all available variables.

Key settings:

```bash
# Inference service
INFERENCE_HOST=127.0.0.1
INFERENCE_PORT=7780
INFERENCE_API_KEY=your-secret-key
INFERENCE_DEVICE=cuda

# Telegram (for agent workflows)
TELEGRAM_DEV_AGENT_BOT_TOKEN=your-bot-token
TELEGRAM_CHAT_ID=your-chat-id
```

## Log Files

Logs are stored in the `logs/` directory:

```text
logs/
├── obelisk-core.log        # Execution engine logs
└── obelisk-inference.log   # Inference service logs
```

PM2 also maintains its own logs at `~/.pm2/logs/`.
