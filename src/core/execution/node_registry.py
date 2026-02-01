"""
Node registry for execution engine
Maps node type strings to node classes
"""
from typing import Dict, Type, Optional
from .node_base import BaseNode

# Registry mapping node type -> node class
NODE_REGISTRY: Dict[str, Type[BaseNode]] = {}


def register_node(node_type: str, node_class: Type[BaseNode]):
    """
    Register a node type
    
    Args:
        node_type: String identifier for the node type (e.g., "input_prompt")
        node_class: Node class that extends BaseNode
    """
    NODE_REGISTRY[node_type] = node_class


def get_node_class(node_type: str) -> Optional[Type[BaseNode]]:
    """
    Get node class for a given type
    
    Args:
        node_type: String identifier for the node type
        
    Returns:
        Node class or None if not found
    """
    return NODE_REGISTRY.get(node_type)


# Import and register all node types
# This ensures nodes are registered when the module is imported
def _register_all_nodes():
    """Register all node types"""
    from .nodes.input_prompt import InputPromptNode
    from .nodes.model_loader import ModelLoaderNode
    from .nodes.sampler import SamplerNode
    from .nodes.output_text import OutputTextNode
    from .nodes.memory_adapter import MemoryAdapterNode
    from .nodes.lora_loader import LoRALoaderNode
    
    register_node("input_prompt", InputPromptNode)
    register_node("model_loader", ModelLoaderNode)
    register_node("sampler", SamplerNode)
    register_node("output_text", OutputTextNode)
    register_node("memory_adapter", MemoryAdapterNode)
    register_node("lora_loader", LoRALoaderNode)


# Auto-register on import
_register_all_nodes()
