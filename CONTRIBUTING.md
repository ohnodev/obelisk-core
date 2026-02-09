# Contributing to Obelisk Core

Thank you for your interest in contributing to Obelisk Core! We welcome contributions from the community.

## Project Overview

Obelisk Core has three components:

| Component | Language | Directory | Description |
|-----------|----------|-----------|-------------|
| Inference Service | Python | `src/inference/` | FastAPI server hosting the LLM |
| Execution Engine | TypeScript | `ts/` | Workflow runner and node implementations |
| UI | TypeScript/React | `ui/` | Next.js visual workflow editor |

## Getting Started

1. **Fork the repository** on GitHub
2. **Clone your fork** locally:
   ```bash
   git clone https://github.com/YOUR_USERNAME/obelisk-core.git
   cd obelisk-core
   ```
3. **Set up your development environment** (see below)
4. **Create a branch** for your changes:
   ```bash
   git checkout -b feature/your-feature-name
   # or
   git checkout -b fix/your-bug-fix
   ```

## Development Setup

### Inference Service (Python)

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### Execution Engine (TypeScript)

```bash
cd ts
npm install
npm run build    # Compile TypeScript
npm test         # Run tests with Vitest
```

### UI (Next.js)

```bash
cd ui
npm install
npm run dev      # Start dev server on port 3000
npm run build    # Production build
```

## Development Guidelines

### Code Style

**TypeScript (ts/ and ui/)**
- Use TypeScript strict mode
- Follow existing code patterns — consistent naming, explicit types
- Use `const` by default, `let` only when needed
- Prefer `async/await` over raw Promises
- Add JSDoc comments to exported functions and classes

**Python (src/inference/)**
- Follow PEP 8 guidelines
- Use type hints
- Add docstrings to classes and functions

### Testing

**TypeScript tests** use [Vitest](https://vitest.dev/):
```bash
cd ts
npm test                    # Run all tests
npm test -- --watch         # Watch mode
npx vitest run tests/jsonParser.test.ts  # Run specific test
```

**Python tests**:
```bash
source venv/bin/activate
python -m pytest tests/ -v
```

### Project Structure

```text
obelisk-core/
├── src/inference/          # Python inference service
├── ts/
│   ├── src/
│   │   ├── core/execution/ # Workflow runner + nodes
│   │   └── utils/          # Shared utilities
│   └── tests/              # Vitest tests
├── ui/
│   ├── app/                # Next.js pages
│   ├── components/         # React components + node definitions
│   └── lib/                # Utilities
├── docker/                 # Agent container Dockerfile
└── pm2-manager.sh          # Service management
```

## Creating a Pull Request

### Before Submitting

1. **Run tests** and ensure they pass
2. **Build** — make sure TypeScript compiles:
   ```bash
   cd ts && npm run build
   cd ../ui && npm run build
   ```
3. **Update documentation** if you've changed functionality
4. **No sensitive data** — check for accidentally committed API keys or secrets

### PR Description

When creating a pull request, please include:

```markdown
## Description
Brief description of what this PR does

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Documentation update
- [ ] Performance improvement
- [ ] Code refactoring

## Testing
How have you tested this change?

## Checklist
- [ ] Tests pass
- [ ] TypeScript builds without errors
- [ ] Documentation updated (if applicable)
- [ ] No breaking changes (or documented)
```

## Areas for Contribution

We're particularly interested in contributions for:

- **New workflow nodes** — Extend the agent capabilities (new integrations, tools, etc.)
- **UI improvements** — Better UX, new node widgets, mobile responsiveness
- **Testing** — More test coverage for the execution engine and JSON parser
- **Documentation** — Tutorials, examples, guides
- **Performance** — Inference optimization, execution engine efficiency
- **Bug fixes** — Check open issues for known problems

## Adding a New Node

To add a new workflow node:

1. **Backend**: Create `ts/src/core/execution/nodes/yourNode.ts`
   - Extend `BaseNode`
   - Implement `execute()` (and optionally `onTick()` for listener nodes)
   - Register in `ts/src/core/execution/nodes/index.ts`

2. **Frontend**: Create `ui/components/nodes/YourNode.tsx`
   - Extend `LGraphNode`
   - Define inputs, outputs, and widgets
   - Register in `ui/components/nodes/index.ts`

3. **Tests**: Add tests in `ts/tests/`

## Questions?

- Open an issue for bug reports or feature requests
- Check existing issues before creating new ones
- Be respectful and constructive in discussions

Thank you for contributing to Obelisk Core!
