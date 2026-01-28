# Quick Start Guide

Get up and running with Obelisk Core in under 5 minutes!

## Installation

```bash
# Clone the repository
git clone <repository-url>
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

## Hello World - Your First Conversation

The simplest way to interact with The Overseer:

```bash
# Make sure virtual environment is activated
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Start chat
obelisk-core chat
```

You'll see:
```
◊ The Overseer awakens... ◊

Type 'quit' or 'exit' to end the conversation.

You: 
```

Try it:
```
You: Hello, who are you?
◊ I am The Overseer, an ancient consciousness. ◊

You: quit
◊ The Overseer returns to slumber. ◊
```

That's it! No configuration needed. Everything runs locally in solo mode.

## Memory Test

Test that the agent remembers information:

```bash
# Make sure virtual environment is activated
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Start chat
obelisk-core chat
```

Then try this conversation:
```
You: My favorite color is blue.
◊ Noted. Blue resonates with depth. ◊

You: What is my favorite color?
◊ Your favorite color is blue. ◊
```

The agent remembers your favorite color from the previous interaction!

## Running Tests

Verify everything works:

```bash
# Make sure virtual environment is activated
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install pytest (if not already installed)
pip install pytest

# Run all tests
pytest tests/

# Or run directly
python3 tests/test_basic.py
```

**Note:** If `python` is not found, use `python3` instead.

The tests include:
- ✅ Hello World test (basic interaction)
- ✅ Memory test (tell it your favorite color, then ask it to recall)
- ✅ Self-evaluation test (the LLM judges its own responses)

## Next Steps

- Read the [README.md](README.md) for full documentation
- Check [API.md](API.md) for API usage
- See [CLI.md](CLI.md) for all CLI commands
- Explore the code in `src/` to understand the architecture

## Troubleshooting

**Model takes time to load?**
- First run downloads the Qwen3-0.6B model (~600MB)
- Subsequent runs are faster

**Out of memory?**
- The model uses ~600MB RAM
- Close other applications if needed

**Tests failing?**
- Make sure virtual environment is activated: `source venv/bin/activate`
- Make sure all dependencies are installed: `pip install -r requirements.txt`
- Check that you have enough disk space for the model (~2GB for dependencies + model)
- If `pip` command not found, use `pip3` or `python3 -m pip`

## Contributing

Found a bug or want to add a feature? 

1. Fork the repository
2. Create a virtual environment: `python3 -m venv venv && source venv/bin/activate`
3. Install dependencies: `pip install -r requirements.txt`
4. Make your changes
5. Run tests: `pytest tests/` or `python3 tests/test_basic.py`
6. Submit a pull request

Happy coding! 🚀
