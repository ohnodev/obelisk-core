# Obelisk Core UI

Visual node-based workflow editor for Obelisk Core AI agents, built with Next.js, React, and LiteGraph.js.

## Features

- **Visual Node Editor** — Drag-and-drop interface for building AI agent workflows (ComfyUI-style)
- **16 Node Types — BinaryIntentNode, InferenceConfigNode, InferenceNode, InputPromptNode, LoRALoaderNode, MemoryCreatorNode, MemorySelectorNode, MemoryStorageNode, ModelLoaderNode, OutputTextNode, SchedulerNode, TelegramBotNode, TelegramListenerNode, TelegramMemoryCreatorNode, TelegramMemorySelectorNode, TextNode**
- **One-Click Deploy** — Deploy workflows as autonomous Docker agents from the UI
- **Wallet Authentication** — Privy-based wallet connect for agent ownership
- **Deployments Dashboard** — View, restart, and stop running agents
- **Environment Variable Injection** — Auto-detects `{{process.env.XXX}}` patterns and pre-fills the deploy modal
- **Dark Theme** — Golden accents on dark background

## Getting Started

### Prerequisites

- Node.js 20+
- npm 9+

### Installation

```bash
cd ui
npm install
```

### Development

```bash
npm run dev
```

Opens on `http://localhost:3000` (or next available port).

### Build

```bash
npm run build
```

### Deploy to Cloudflare

```bash
npm run deploy
```

## Architecture

The UI is a **Next.js** app that communicates with:
- **Inference Service** (Python) — for LLM generation
- **Execution Engine** (TypeScript) — for workflow execution
- **Deployment Service** (private) — for Docker agent management

```text
Browser (UI)
  │
  ├── Queue Prompt ──→ Execution Engine ──→ Inference Service
  │
  ├── Deploy ──→ Deployment Service (Docker)
  │
  └── Deployments ──→ Deployment Service (list/stop/restart)
```

## Project Structure

```text
ui/
├── app/
│   ├── layout.tsx              # Root layout (PrivyProvider, global styles)
│   ├── page.tsx                # Main editor page
│   ├── globals.css             # Global CSS + Privy theme
│   ├── deployments/
│   │   └── page.tsx            # Deployments dashboard
│   ├── config/
│   │   └── wagmi.ts            # Wagmi configuration for Privy
│   ├── providers/
│   │   └── PrivyProvider.tsx   # Privy + Wagmi + React Query setup
│   └── styles/
│       ├── fonts.css           # Font declarations
│       └── variables.css       # CSS variables
├── components/
│   ├── Canvas.tsx              # LiteGraph canvas wrapper
│   ├── Toolbar.tsx             # Toolbar (execute, save, load, deploy)
│   ├── DeployModal.tsx         # Deploy modal with env var detection
│   ├── ConfirmModal.tsx        # Confirmation modal
│   ├── WalletButton.tsx        # Wallet connect button + modal
│   ├── WalletButton.css        # Wallet button styles
│   ├── Notification.tsx        # Global notification system
│   ├── icons/                  # SVG icon components
│   └── nodes/                  # LiteGraph node definitions
│       ├── TextNode.tsx
│       ├── InferenceNode.tsx
│       ├── InferenceConfigNode.tsx
│       ├── BinaryIntentNode.tsx
│       ├── TelegramListenerNode.tsx
│       ├── TelegramBotNode.tsx
│       ├── MemoryCreatorNode.tsx
│       ├── MemorySelectorNode.tsx
│       ├── MemoryStorageNode.tsx
│       ├── TelegramMemoryCreatorNode.tsx
│       ├── TelegramMemorySelectorNode.tsx
│       ├── SchedulerNode.tsx
│       ├── InputPromptNode.tsx
│       ├── OutputTextNode.tsx
│       ├── ModelLoaderNode.tsx
│       ├── LoRALoaderNode.tsx
│       └── index.ts
├── lib/
│   ├── litegraph.ts            # Workflow serialization utilities
│   ├── wallet.ts               # Address formatting + ownership checks
│   ├── api-config.ts           # API URL configuration
│   └── workflowExecutor.ts     # Workflow execution client
├── workflows/
│   └── default.json            # Default workflow template
└── public/
    └── lib/litegraph/          # LiteGraph.js library
```

## Node Types

### Core

| Node | Inputs | Outputs | Description |
|------|--------|---------|-------------|
| **Text** | text | text | Static text input/output with textarea widget |
| **Inference** | query, system_prompt, context | response, thinking | Calls the LLM via inference service |
| **Inference Config** | — | config | Model parameters (temperature, max tokens, thinking) |
| **Binary Intent** | message, criteria | result, raw | Yes/no classification for conditional logic |
| **Scheduler** | — | trigger | Cron-based periodic execution |

### Telegram

| Node | Inputs | Outputs | Description |
|------|--------|---------|-------------|
| **Telegram Listener** | — | trigger, message, user_id, username, chat_id, message_id, is_mention, is_reply_to_bot | Polls for incoming Telegram messages |
| **TG Send Message** | message, bot_id, chat_id, message_id | success, response | Sends messages via Telegram Bot API (supports quote-reply) |

### Memory

| Node | Inputs | Outputs | Description |
|------|--------|---------|-------------|
| **Memory Creator** | content, user_id | summary | Creates conversation summaries |
| **Memory Selector** | query, user_id | context | Retrieves relevant memories |
| **Memory Storage** | content, user_id | success | Persists memories to storage |
| **TG Memory Creator** | content, user_id | summary | Telegram-specific summarization |
| **TG Memory Selector** | query, user_id | context | Telegram-specific retrieval |

### Legacy (kept for compatibility)

| Node | Description |
|------|-------------|
| **Input Prompt** | Text input (use Text node instead) |
| **Output Text** | Text output (use Text node instead) |
| **Model Loader** | Model loading (handled by Inference Config now) |
| **LoRA Loader** | LoRA weight loading (not active in current version) |

## Usage

1. **Add Nodes**: Right-click on the canvas to open the node menu
2. **Connect Nodes**: Drag from output slots to input slots to connect
3. **Configure**: Click nodes to edit properties via widgets
4. **Execute**: Click ▶ **Queue Prompt** to run the workflow
5. **Save/Load**: Use Save/Load buttons to persist workflows as JSON
6. **Deploy**: Click Deploy to run the workflow as an autonomous agent

## Wallet Integration

The UI uses [Privy](https://privy.io/) for wallet authentication:

- Click the wallet icon in the toolbar to connect
- Deploying an agent associates it with your wallet address
- Only you can manage (stop/restart) your deployed agents
- Visit `/deployments` to see and manage your agents

## Environment Variables

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_PRIVY_APP_ID` | Privy app ID (required for wallet auth) |
| `NEXT_PUBLIC_API_URL` | Override API base URL |
| `NEXT_PUBLIC_CORE_API_URL` | Override core API URL |
