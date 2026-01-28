# Contributing to Obelisk Core

Thank you for your interest in contributing to Obelisk Core! We welcome contributions from the community.

## Getting Started

1. **Fork the repository** on GitHub
2. **Clone your fork** locally:
   ```bash
   git clone https://github.com/YOUR_USERNAME/obelisk-core.git
   cd obelisk-core
   ```
3. **Set up your development environment**:
   ```bash
   python3 -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   pip install -r requirements.txt
   pip install -e .
   ```
4. **Create a branch** for your changes:
   ```bash
   git checkout -b feature/your-feature-name
   # or
   git checkout -b fix/your-bug-fix
   ```

## Development Guidelines

### Code Style

- Follow PEP 8 Python style guidelines
- Use type hints where appropriate
- Keep functions focused and small
- Add docstrings to classes and functions
- Write clear, descriptive commit messages

### Testing

- Run tests before submitting:
  ```bash
  python3 -m pytest tests/ -v
  ```
- Add tests for new features
- Ensure all tests pass before creating a pull request

### Project Structure

```
obelisk-core/
├── src/
│   ├── llm/          # LLM inference
│   ├── memory/       # Memory management
│   ├── storage/      # Storage abstraction
│   ├── api/          # API server
│   └── cli/          # CLI interface
├── tests/            # Test suite
└── docs/             # Documentation
```

## Creating a Pull Request

### Before Submitting

1. **Update documentation** if you've changed functionality
2. **Run tests** and ensure they pass
3. **Check for linting errors**:
   ```bash
   # If you have a linter configured
   pylint src/
   ```
4. **Update CHANGELOG.md** (if it exists) with your changes

### PR Checklist

- [ ] Code follows the project's style guidelines
- [ ] Tests pass locally
- [ ] Documentation is updated
- [ ] Commit messages are clear and descriptive
- [ ] No sensitive data (API keys, secrets) is included
- [ ] Changes are focused and address a single issue/feature

### PR Description Template

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
- [ ] Documentation updated
- [ ] No breaking changes (or breaking changes documented)
```

### Review Process

1. **Automated checks** will run on your PR (tests, linting)
2. **Maintainers will review** your code
3. **Feedback will be provided** if changes are needed
4. **Once approved**, your PR will be merged

## Areas for Contribution

We're particularly interested in contributions for:

- **Memory improvements**: Better summarization, context management
- **LLM enhancements**: Better prompt engineering, response quality
- **Storage backends**: Additional storage options beyond JSON/Supabase
- **Testing**: More comprehensive test coverage
- **Documentation**: Examples, tutorials, API docs
- **Performance**: Optimization, caching, efficiency improvements
- **New features**: Tool integrations, agent capabilities

## Questions?

- Open an issue for bug reports or feature requests
- Check existing issues before creating new ones
- Be respectful and constructive in discussions

## Code of Conduct

- Be respectful and inclusive
- Welcome newcomers and help them learn
- Focus on constructive feedback
- Respect different viewpoints and experiences

Thank you for contributing to Obelisk Core! 🚀
