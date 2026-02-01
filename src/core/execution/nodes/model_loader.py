"""
Model Loader Node
Loads the LLM model (cached/singleton)
"""
from typing import Dict, Any
from ..node_base import BaseNode, ExecutionContext


class ModelLoaderNode(BaseNode):
    """
    Loads the LLM model from the container
    
    Inputs:
        model_name: Optional model name override (defaults to container's model)
    
    Outputs:
        model: ObeliskLLM instance
    """
    
    def execute(self, context: ExecutionContext) -> Dict[str, Any]:
        """Execute model loader node"""
        # Model is already loaded in container, just return it
        # The container's LLM is a singleton, so this is just a pass-through
        return {
            'model': context.container.llm
        }
