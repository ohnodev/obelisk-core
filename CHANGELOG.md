# Changelog

All notable changes to Obelisk Core will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0-alpha] - 2025-01-28

### Added
- **Self-hosted LLM**: Qwen3-0.6B model with thinking mode support
- **Memory Layer**: LangChain-based conversation memory with automatic summarization
- **Dual Storage Modes**: 
  - Solo mode (local JSON storage)
  - Prod mode (Supabase integration)
- **REST API**: FastAPI server with endpoints for generation, memory, and evolution
- **CLI Interface**: Interactive chat and command-line tools
- **Thinking Mode**: Always-enabled thinking mode for enhanced reasoning (Qwen3)
- **Memory Management**: 
  - Buffer window memory for recent conversations
  - Automatic summarization every 10 message pairs
  - Context-aware responses using conversation history
- **Tests**: Basic test suite with model output verification
- **Documentation**: 
  - README with installation and usage guides
  - CONTRIBUTING.md with PR guidelines
  - SECURITY.md with best practices
  - API.md, CLI.md, QUICKSTART.md
  - Test documentation

### Technical Details
- Python 3.8+ support
- PyTorch-based inference with 4-bit quantization
- LangChain integration for memory management
- FastAPI for REST API
- Click for CLI interface

### Known Limitations
- Alpha version - API may change
- Evolution mechanics not yet fully tested
- LoRA fine-tuning integration in progress
- Quantum influence module planned

[0.1.0-alpha]: https://github.com/ohnodev/Obelisk-core/releases/tag/v0.1.0-alpha
