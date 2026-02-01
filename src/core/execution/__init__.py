"""
Execution Engine for Obelisk Core
Provides node-based workflow execution (similar to ComfyUI)
"""
from .engine import ExecutionEngine
from .node_base import BaseNode, ExecutionContext
from .node_registry import NODE_REGISTRY, register_node, get_node_class

__all__ = [
    'ExecutionEngine',
    'BaseNode',
    'ExecutionContext',
    'NODE_REGISTRY',
    'register_node',
    'get_node_class',
]
