"""
Model Loader Node
Loads and caches the LLM model
"""
from typing import Dict, Any, Optional
from ..node_base import BaseNode, ExecutionContext
from ....utils.logger import get_logger

logger = get_logger(__name__)

# Class-level cache for model instances
_model_cache: Dict[str, Any] = {}


class ModelLoaderNode(BaseNode):
    """
    Loads and caches the LLM model
    
    The model is cached at the class level, so multiple nodes can share the same instance.
    If the model is already loaded in the container, use it. Otherwise, load it.
    
    Inputs:
        model_name: Optional model name override (defaults to container's config)
        storage_instance: Optional StorageInterface (only needed for LoRA weights)
    
    Outputs:
        model: ObeliskLLM instance
    """
    
    def execute(self, context: ExecutionContext) -> Dict[str, Any]:
        """Execute model loader node"""
        model_name = self.get_input_value('model_name', context, None)
        storage_instance = self.get_input_value('storage_instance', context, None)
        
        # Check cache
        cache_key = model_name or 'default'
        if cache_key in _model_cache:
            logger.debug(f"Using cached model: {cache_key}")
            return {
                'model': _model_cache[cache_key]
            }
        
        # Load model (storage is optional - only needed for LoRA weights)
        logger.info(f"Loading model: {cache_key}")
        from .inference.obelisk_llm import ObeliskLLM
        
        # Storage is optional - only used for loading LoRA weights if available
        # Create and cache model
        llm = ObeliskLLM(storage=storage_instance)
        _model_cache[cache_key] = llm
        
        logger.info(f"Model loaded and cached: {cache_key}")
        return {
            'model': llm
        }
