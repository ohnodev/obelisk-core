# Obelisk Core Tests

Tests to verify that Obelisk Core works correctly. Run these tests to ensure everything is functioning after making changes.

## Running Tests

### Using pytest (Recommended)

```bash
# Install pytest if not already installed
pip install pytest

# Run all tests
pytest tests/

# Run specific test file
pytest tests/test_basic.py

# Run with verbose output
pytest tests/ -v
```

### Running Tests Directly

```bash
# Run basic tests
python tests/test_basic.py
```

## Test Coverage

### Basic Tests (`test_basic.py`)

- **Hello World Test**: Verifies the agent can respond to a simple greeting
- **Model Loaded Test**: Checks that the LLM model loads correctly
- **Memory Storage Test**: Tests that the agent can remember information (e.g., favorite color)
- **Multiple Interactions Test**: Verifies memory persists across multiple conversations
- **Storage Test**: Tests saving and retrieving interactions

### Evolution Tests

**TODO**: Add basic evolution tests to verify evolution mechanics functionality.

## Example Test: Memory Test

The memory test demonstrates the core functionality:

1. Tell the agent: "My favorite color is blue."
2. Ask the agent: "What is my favorite color?"
3. Verify the agent remembers and responds with "blue"

This test ensures that:
- The agent can process queries
- Memory storage works correctly
- Conversation context is maintained
- The agent can recall previous information

## Adding New Tests

When adding new features, create corresponding tests:

1. Create a new test file in `tests/` (e.g., `test_new_feature.py`)
2. Use pytest fixtures for setup (storage, llm, etc.)
3. Follow the naming convention: `test_<feature_name>`
4. Add assertions to verify expected behavior
5. Include print statements for clarity when running directly

Example:

```python
def test_new_feature(self, llm):
    """Test description"""
    result = llm.some_method()
    assert result is not None
    print(f"\n✅ Test Passed")
```

## Continuous Integration

These tests can be integrated into CI/CD pipelines to ensure code quality:

```yaml
# Example GitHub Actions
- name: Run tests
  run: |
    pip install -r requirements.txt
    pip install pytest
    pytest tests/ -v
```
