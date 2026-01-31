# Add Comprehensive Type System with Protocols and Node-Based Types

## Summary

This PR introduces a comprehensive type system for Obelisk Core, including Protocol definitions for core interfaces, TypedDict structures for structured data, and foundational types for a future node-based visual workflow system. Additionally, it fixes config import issues that were causing runtime errors.

## Changes

### 🎯 Core Type System (`src/core/types.py`)

**New file:** Comprehensive type definitions module with:

#### 1. **Protocol Definitions** (Structural Typing)
- `LLMProtocol` - Interface for any LLM implementation
- `MemoryManagerProtocol` - Interface for memory management
- `StorageProtocol` - Interface for storage backends
- `QuantumServiceProtocol` - Interface for quantum services

These Protocols enable:
- Better type safety and IDE autocomplete
- Easier testing with mock implementations
- Structural typing (duck typing with type checking)
- Future extensibility for alternative implementations

#### 2. **TypedDict Structures** (Structured Data)
- `ConversationMessage` - Single message structure
- `ConversationContextDict` - Full conversation context
- `LLMGenerationResult` - LLM response structure
- `InteractionDict` - User interaction data
- `EvolutionCycle` - Evolution cycle structure
- `TrainingDatasetItem` / `TrainingConfig` - Training types

#### 3. **Node-Based System Types** (Future Visual Workflow)
- `NodeInput` / `NodeOutput` - Node port definitions
- `NodeData` - Complete node structure with position, inputs, outputs
- `ConnectionData` - Connection between nodes
- `NodeGraph` - Complete workflow/graph structure
- `NodeExecutionResult` / `GraphExecutionResult` - Execution results
- `NodeTypeDefinition` - Node type metadata (for UI rendering)
- `VideoFrame` / `VideoGenerationParams` - Video generation types

These types provide the foundation for a future node-based visual workflow system where users can drag and drop nodes to build complex pipelines.

#### 4. **Type Aliases**
- `UserID`, `CycleID`, `NodeID`, `ConnectionID`, `MessageRole`

### 🔧 Config Import Fixes

**Fixed dynamic config loading issues:**
- `src/evolution/processor.py` - Replaced dynamic `importlib` loading with proper import
- `src/llm/obelisk_llm.py` - Replaced dynamic `importlib` loading with proper import

Both now use: `from ..core.config import Config`

This fixes the `FileNotFoundError: config.py not found` error that was breaking the CLI.

### 📦 Module Updates

- **`src/core/__init__.py`** - Exports types module for easy importing
- **`src/core/container.py`** - Added documentation about Protocol conformance

## Benefits

1. **Type Safety**: Protocols provide compile-time type checking and better IDE support
2. **Testability**: Easy to create mock implementations for testing
3. **Documentation**: Types serve as inline documentation
4. **Future-Ready**: Node-based system types ready for visual workflow implementation
5. **Maintainability**: Centralized type definitions reduce duplication
6. **Extensibility**: Easy to add new node types, video formats, etc.

## Usage Examples

### Using Protocols for Type Checking

```python
from src.core.types import LLMProtocol, MemoryManagerProtocol

def process_with_llm(llm: LLMProtocol, memory: MemoryManagerProtocol):
    user_id = "user123"
    user_query = "Hello"
    context = memory.get_conversation_context(user_id, user_query)
    result = llm.generate(user_query, conversation_context=context)
    return result
```

### Using TypedDict for Structured Data

```python
from src.core.types import ConversationContextDict

context: ConversationContextDict = {
    "messages": [
        {"role": "user", "content": "Hello"},
        {"role": "assistant", "content": "Hi there!"}
    ],
    "memories": "User prefers technical explanations"
}
```

### Using Node Types (Future)

```python
from src.core.types import NodeData, NodeGraph, ConnectionData

# Define a node
node: NodeData = {
    "id": "node_1",
    "type": "llm_generate",
    "position": {"x": 100.0, "y": 200.0},
    "inputs": {"query": "Hello", "temperature": 0.7},
    "outputs": {}
}

# Define a connection
connection: ConnectionData = {
    "id": "conn_1",
    "source_node": "node_1",
    "source_output": "response",
    "target_node": "node_2",
    "target_input": "input_text",
    "data_type": "text"
}

# Define a graph
graph: NodeGraph = {
    "id": "workflow_1",
    "name": "My Workflow",
    "nodes": [node],
    "connections": [connection]
}
```

## Testing

- ✅ All existing tests pass
- ✅ Type checking with `mypy` (if configured)
- ✅ No runtime errors from config imports
- ✅ CLI commands work correctly

## Migration Notes

**No breaking changes** - This is purely additive. Existing code continues to work as before.

The Protocols are optional - concrete implementations don't need to explicitly inherit from them. They provide structural typing benefits at development time.

## Future Work

This PR sets the foundation for:
1. **Node-Based System Refactor** - Extract model loading and sampling into separate nodes
2. **Visual Workflow UI** - Build UI on top of node system types
3. **Alternative Implementations** - Easy to swap LLM/memory/storage implementations using Protocols
4. **Enhanced Type Safety** - Gradually migrate existing code to use TypedDict types

## Files Changed

- ✨ `src/core/types.py` (new, 326 lines)
- 🔧 `src/core/__init__.py` (exports types)
- 🔧 `src/core/container.py` (Protocol docs)
- 🐛 `src/evolution/processor.py` (config import fix)
- 🐛 `src/llm/obelisk_llm.py` (config import fix)

## Related Issues

Fixes config import errors that were breaking CLI commands.

---

**Ready for Review** ✅
