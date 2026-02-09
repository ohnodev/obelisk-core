# Changelog

All notable changes to Obelisk Core will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0-beta] - 2026-02-10

### Major Changes

- **TypeScript Execution Engine**: Complete rewrite of the core workflow execution engine from Python to TypeScript. The agent runtime now runs on Node.js with full type safety and a modular node architecture.
- **Visual Workflow Editor**: New browser-based UI (Next.js) with a drag-and-drop node editor built on LiteGraph.js. Design agent workflows visually, connect nodes, and execute or deploy with one click.
- **Docker Agent Deployment**: Workflows can be deployed as autonomous agents running in isolated Docker containers. Build, deploy, manage, and monitor agents from the UI or API.
- **Standalone Inference Service**: The LLM model hosting is now a separate Python FastAPI service (`src/inference/`). Agents call the inference service over HTTP instead of loading models directly. This dramatically reduces agent container size and memory usage.
- **Telegram Integration**: New `TelegramListener` and `TelegramBot` nodes for building Telegram bots. Supports long polling, message filtering, quote-reply, and auto-skipping of old messages on startup.
- **Wallet Authentication**: Privy-based wallet connect for the UI. Agents are owned by wallet addresses. Only the owner can stop/restart their agents.

### Added

- **Nodes**: Inference, InferenceConfig, BinaryIntent, TelegramListener, TelegramBot, MemoryCreator, MemorySelector, MemoryStorage, TelegramMemoryCreator, TelegramMemorySelector, Scheduler, Text
- **JSON Parser**: Robust JSON extraction from LLM responses with repair logic for truncated/malformed output. Handles unterminated strings, missing braces, markdown code blocks, and thinking tags.
- **Binary Intent Classification**: Yes/no decision node using the LLM for conditional workflow branching.
- **Conversation Memory**: Persistent memory with automatic summarization and context-aware retrieval, supporting both local JSON and Supabase storage.
- **PM2 Manager**: `pm2-manager.sh` script for managing inference and core services with clean restart, log management, and status monitoring.
- **Inference API Authentication**: Optional API key auth for the inference service via `Authorization: Bearer` or `X-API-Key` headers.
- **Granular Inference Logging**: Detailed request/response logging with unique request IDs, token counts, and performance metrics at INFO and DEBUG levels.
- **Deploy Modal**: UI modal for deploying agents with name, environment variables, and auto-detection of `{{process.env.XXX}}` patterns from the workflow.
- **Deployments Page**: UI page for viewing and managing deployed agents with status indicators, ownership badges, and start/stop/restart controls.
- **Global Notification System**: Centralized toast notification system using `useSyncExternalStore` with deduplication.
- **Comprehensive Tests**: Vitest test suite for the TypeScript JSON parser (42 tests) and pytest suite for the Python equivalent.

### Changed

- **Python scope reduced**: Python is now used only for the inference service (`src/inference/`). All other Python code (core engine, CLI, API, storage, memory, evolution, quantum) has been removed.
- **Architecture**: Moved from a monolithic Python application to a three-component architecture (inference service + TypeScript execution engine + Next.js UI).
- **Model**: Updated from Qwen3-0.6B alpha to stable, with improved generation parameters and thinking mode support.
- **Dependencies**: Updated `torch>=2.2.0`, `transformers>=4.38.0`, `accelerate>=0.27.0`, `bitsandbytes>=0.43.0` for Python 3.12 compatibility.

### Removed

- **Python CLI** (`obelisk-core chat`, `serve`, `evolve`, `train`, `clear-lora`, etc.)
- **Python core engine** (`src/core/`, `src/api/`, `src/cli/`, `src/storage/`, `src/memory/`)
- **Evolution module** (`src/evolution/`)
- **Quantum module** (`src/quantum/`)
- **Python utils** (`src/utils/` — JSON parser and logger now in TypeScript)
- **Docker entrypoint.py** (replaced by `entrypoint.js`)

## [0.1.0-alpha] - 2025-01-28

### Added
- **Self-hosted LLM**: Qwen3-0.6B model with thinking mode support
- **Memory Layer**: Conversation memory with automatic summarization
- **Dual Storage Modes**: Solo mode (local JSON) and Prod mode (Supabase)
- **REST API**: FastAPI server with endpoints for generation, memory, and evolution
- **CLI Interface**: Interactive chat and command-line tools
- **Thinking Mode**: Qwen3 thinking mode for enhanced reasoning
- **Tests**: Basic test suite with model output verification
- **Documentation**: README, CONTRIBUTING, SECURITY, API, CLI, QUICKSTART docs

### Known Limitations
- Alpha version — API may change
- Evolution mechanics not fully tested
- LoRA fine-tuning integration in progress

[0.2.0-beta]: https://github.com/ohnodev/Obelisk-core/compare/v0.1.0-alpha...v0.2.0-beta
[0.1.0-alpha]: https://github.com/ohnodev/Obelisk-core/releases/tag/v0.1.0-alpha
