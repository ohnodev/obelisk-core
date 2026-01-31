# Obelisk Core

<p align="center">
  <img src="assets/obelisk-logo.jpg" alt="Obelisk Core" width="400">
</p>

<p align="center">
  <strong>A simple Python framework for building AI agents with a self-hosted LLM and memory layer</strong>
</p>

<p align="center">
  <a href="https://github.com/ohnodev/obelisk-core/releases"><img src="https://img.shields.io/badge/version-0.1.0--alpha-blue?style=for-the-badge" alt="Version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="MIT License"></a>
  <a href="https://github.com/ohnodev/obelisk-core"><img src="https://img.shields.io/badge/Status-Alpha-yellow?style=for-the-badge" alt="Status"></a>
  <a href="https://www.python.org/downloads/"><img src="https://img.shields.io/badge/Python-3.8+-blue?style=for-the-badge&logo=python" alt="Python"></a>
</p>

<p align="center">
  <a href="https://theobelisk.ai">🌐 Website</a> ·
  <a href="https://x.com/theobeliskai">𝕏 X (Twitter)</a> ·
  <a href="https://t.me/theobeliskportal">💬 Telegram</a>
</p>

**Obelisk Core** is a Python framework for building AI agents with a self-hosted LLM and memory layer. Start with the basics and extend with modules as needed.

**Status**: 🟢 Alpha - v0.1.0-alpha

> **Note**: This is an alpha release. The API may change in future versions.

This is the first basic version of the framework. It provides:
- **Self-hosted LLM** (Qwen3-0.6B) with thinking mode
- **Intelligent conversation memory** with automatic summarization and context-aware selection
- **Dual storage modes** (local JSON / Supabase)
- **REST API** and CLI interface

[Quick Start](#quick-start) · [Documentation](#documentation) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [Changelog](CHANGELOG.md)

## ✨ Features

- **🧠 Self-Hosted LLM**: Qwen3-0.6B model with thinking mode support (no external API calls)
- **💾 Intelligent Memory**: LLM-based memory selection with automatic summarization and recent conversation buffer
- **🔄 Dual Mode**: Run in solo mode (local JSON) or prod mode (Supabase)
- **🌐 HTTP API**: FastAPI REST API for integration
- **⌨️ CLI**: Command-line tools for development and testing
- **🧩 Modular Design**: Clean separation of concerns (LLM, memory agents, training module)
- **🔒 Privacy-First**: All data stored locally in solo mode, no external API calls
- **🚀 Easy Setup**: Simple installation, works out of the box

## 🚀 Quick Start

Get up and running in under 5 minutes:

```bash
# Clone and install
git clone https://github.com/ohnodev/obelisk-core.git
cd obelisk-core
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
pip install -e .

# Start chatting
obelisk-core chat
```

**Example CLI Session:**

<p align="center">
  <img src="assets/overseer-cli-example.jpg" alt="Obelisk Core CLI Example" width="600">
</p>

See [QUICKSTART.md](QUICKSTART.md) for detailed instructions.

## 📦 Installation

```bash
# Clone the repository
git clone https://github.com/ohnodev/obelisk-core.git
cd obelisk-core

# Create virtual environment (recommended)
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies (this will take a few minutes - downloads ~2GB)
pip install -r requirements.txt

# Install the package so 'obelisk-core' command works
pip install -e .
```

**Note:** 
- If `pip` is not found, use `pip3` or `python3 -m pip` instead
- First installation downloads the Qwen3-0.6B model (~600MB) and dependencies (~2GB total)
- This may take 5-10 minutes depending on your internet connection

## Configuration

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

### Solo Mode (Default)

For local development and testing:

```env
OBELISK_CORE_MODE=solo
OBELISK_CORE_STORAGE_PATH=~/.obelisk-core/data/
```

### Prod Mode

For production with Supabase:

```env
OBELISK_CORE_MODE=prod
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

### Optional Services

```env
# IBM Quantum (optional, for future quantum influence module)
IBM_QUANTUM_API_KEY=your_ibm_quantum_key
IBM_QUANTUM_INSTANCE=your_instance

# Mistral AI (optional, for future evolution evaluation)
MISTRAL_API_KEY=your_mistral_key
MISTRAL_AGENT_ID=your_agent_id
MISTRAL_EVOLUTION_AGENT_ID=your_evolution_agent_id
```

## Usage

### CLI

```bash
# Run API server
obelisk-core serve --port 7779 --mode solo

# Interactive chat (solo mode only)
obelisk-core chat

# Train LoRA adapter on a dataset
obelisk-core train
obelisk-core train --dataset path/to/dataset.json --epochs 5 --learning-rate 0.0002

# Clear LoRA weights (revert to base model, solo mode only)
obelisk-core clear-lora
obelisk-core clear-lora --confirm

# Test LLM
obelisk-core test

# Show configuration
obelisk-core config

# Clear all local memory (fresh start, solo mode only)
obelisk-core clear
obelisk-core clear --confirm
```

### API Server

```bash
# Start the server
obelisk-core serve

# Or use uvicorn directly
uvicorn src.api.server:app --host 0.0.0.0 --port 7779
```

### Python API

```python
from config import Config
from src.llm.obelisk_llm import ObeliskLLM
from src.storage import LocalJSONStorage

# Initialize storage
storage = Config.get_storage()

# Initialize LLM
llm = ObeliskLLM(storage=storage)

# Generate response (thinking mode enabled by default)
result = llm.generate(
    query="What is The Obelisk?",
    quantum_influence=0.7,
    enable_thinking=True,  # Use thinking mode for complex reasoning
    conversation_context={
        "messages": [
            {"role": "user", "content": "Hello"},
            {"role": "assistant", "content": "Hello! How can I help?"}
        ],
        "memories": "Selected memory summaries..."
    }
)

print(result['response'])
print(result.get('thinking_content'))  # View reasoning process

# Disable thinking mode for faster responses
result = llm.generate(
    query="Hello!",
    enable_thinking=False
)

# Dynamic thinking mode control via query
result = llm.generate(
    query="Solve this math problem /think"  # Forces thinking mode
)
result = llm.generate(
    query="Just say hi /no_think"  # Disables thinking mode
)
```

### Thinking Mode

Qwen3-0.6B supports **thinking mode** for enhanced reasoning on complex tasks:

- **Enabled by default** - The model uses thinking mode automatically for better quality
- **Dynamic control** - Use `/think` or `/no_think` in your query to toggle per-request
- **Programmatic control** - Set `enable_thinking=True/False` in the `generate()` method
- **Thinking content** - Access reasoning process via `result['thinking_content']`

Thinking mode is ideal for:
- Math problems and logical reasoning
- Complex questions requiring step-by-step analysis
- Code generation and debugging

Non-thinking mode is better for:
- Simple conversational responses
- Quick answers that don't need deep reasoning
- Faster response times

## LoRA Fine-Tuning

Obelisk Core supports LoRA (Low-Rank Adaptation) fine-tuning to customize the model's behavior:

### Training a LoRA Adapter

1. **Prepare a dataset** in JSON format:
```json
[
  {
    "user": "your query here",
    "assistant": "desired response here"
  }
]
```

2. **Train the model**:
```bash
obelisk-core train --dataset src/evolution/training/dataset_example.json
```

3. **Use the trained model**: The LoRA weights are automatically loaded when you run `chat` or use the API.

### Training Options

```bash
# Basic training with defaults
obelisk-core train

# Custom dataset and parameters
obelisk-core train \
  --dataset path/to/dataset.json \
  --epochs 5 \
  --learning-rate 0.0002 \
  --batch-size 8
```

### Managing LoRA Weights

```bash
# Clear all LoRA weights (revert to base model)
obelisk-core clear-lora

# Clear without confirmation
obelisk-core clear-lora --confirm
```

The trained LoRA weights are automatically saved and loaded. The model will use the latest trained weights when you start a chat session.

## Architecture

```text
obelisk-core/
├── src/
│   ├── llm/                    # LLM inference (Qwen3-0.6B with thinking mode)
│   │   ├── obelisk_llm.py      # Core LLM generation
│   │   └── thinking_token_utils.py  # Thinking token parsing utilities
│   ├── evolution/              # Evolution and training module
│   │   ├── training/           # LoRA fine-tuning
│   │   │   ├── lora_manager.py # LoRA weight management
│   │   │   └── lora_trainer.py # LoRA fine-tuning trainer
│   │   │   └── dataset_example.json  # Example training dataset
│   ├── memory/                  # Conversation memory management
│   │   ├── memory_manager.py    # Main memory orchestration
│   │   ├── recent_buffer.py    # Recent conversation window (last k pairs)
│   │   └── agents/             # Memory subagents
│   │       ├── memory_creator.py  # Summarization agent
│   │       ├── memory_selector.py # Intelligent memory selection
│   │       └── config.py         # Agent configuration
│   ├── storage/                 # Storage abstraction (local JSON / Supabase)
│   ├── api/                     # FastAPI server and routes
│   ├── cli/                     # Command-line interface
│   ├── evolution/               # Configuration, evaluation, and processing for evolution features
│   ├── quantum/                 # IBM quantum service integration
│   └── utils/                   # Utility helpers (JSON parsing, logging)
├── config.py                    # Configuration management
├── requirements.txt              # Python dependencies
└── setup.py                      # Package setup
```

**Note**: Evolution, quantum, and other modules can be added as needed. The core framework provides LLM + memory as the foundation.

## Storage Modes

### Solo Mode

- Stores data in local JSON files (`~/.obelisk-core/data/`)
- Only accessible to the local user
- Perfect for development and testing
- No external dependencies

### Prod Mode

- Direct Supabase connection
- Shared data across users
- Production-ready
- Requires Supabase credentials

## 📚 Documentation

- **[API Documentation](API.md)** - REST API endpoints and usage
- **[CLI Documentation](CLI.md)** - Command-line interface guide
- **[Quick Start Guide](QUICKSTART.md)** - Get started in 5 minutes
- **[Contributing](CONTRIBUTING.md)** - How to contribute
- **[Security](SECURITY.md)** - Security best practices
- **[Changelog](CHANGELOG.md)** - Version history

## 💬 Example Usage

### Interactive Chat

```bash
obelisk-core chat
```

Example session:
```
◊ THE OBELISK ◊
[ALPHA VERSION]

✓ The Overseer is ready

Type 'quit' or 'exit' to end the conversation.

You: Hello, who are you?
◊ The Overseer: [response]

You: My favorite color is green.
◊ The Overseer: [acknowledgment]

You: What is my favorite color?
◊ The Overseer: Your favorite color is green.
```

## 🧪 Testing

Run the test suite to verify everything works:

```bash
# Run all tests
pytest tests/ -v

# Run specific test
pytest tests/test_basic.py::TestMemory::test_memory_storage -v

# With debug output
OBELISK_CORE_DEBUG=true pytest tests/ -v -s
```

The tests include:
- **Hello World**: Basic interaction test
- **Memory Test**: Tell the agent your favorite color, then ask it to recall it (verifies model output quality)
- **Multiple Interactions**: Test memory persistence across conversations

See [tests/README.md](tests/README.md) for more details.

## 🛠️ Development

```bash
# Install in development mode
pip install -e .

# Run tests
pytest tests/ -v

# Run linter (if configured)
flake8 src/
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for development guidelines.

## Production Deployment

### Solo Mode (Local/Development)

Solo mode is perfect for development and single-user scenarios:

```bash
# Set mode to solo
OBELISK_CORE_MODE=solo

# Start API server
obelisk-core serve --port 7779
```

**Storage**: Data is stored locally in `~/.obelisk-core/data/` (configurable via `OBELISK_CORE_STORAGE_PATH`)

**Limitations**: 
- Single user only
- No multi-user support
- Data stored locally (not shared)

### Prod Mode (Supabase/Production)

For production deployments with multiple users:

```bash
# Set mode to prod
OBELISK_CORE_MODE=prod
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Start API server
obelisk-core serve --port 7779
```

**Requirements**:
- Supabase project with required tables (see `supabase/schema.sql`)
- Service role key for database access
- Network access to Supabase

**Production Checklist**:
- [ ] Set `OBELISK_CORE_MODE=prod`
- [ ] Configure Supabase credentials
- [ ] Run database migrations
- [ ] Set up proper logging
- [ ] Configure reverse proxy (nginx, etc.) if needed
- [ ] Set up process manager (PM2, systemd, etc.)
- [ ] Configure monitoring/alerting
- [ ] Set up backups for Supabase database

### Security Considerations

- **Never commit `.env` files** - they're in `.gitignore`
- **Use environment variables** for all sensitive configuration
- **Rotate API keys regularly** in production
- **Use HTTPS** for API endpoints in production
- **Limit API access** with proper authentication/authorization
- **Monitor logs** for suspicious activity

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🤝 Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on:

- Creating pull requests
- Code style and standards
- Testing requirements
- Areas where help is needed

## 📝 Changelog

See [CHANGELOG.md](CHANGELOG.md) for a detailed list of changes and version history.

---

<p align="center">
  <strong>Built with ❤️ for the open source community</strong>
</p>
