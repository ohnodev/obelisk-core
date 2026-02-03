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
    
    def _get_storage_identity(self, storage_instance) -> str:
        """
        Get a stable identifier for the storage instance.
        
        Uses id(storage_instance) to uniquely identify different storage backends.
        This ensures LoRA weights from different storage instances are not shared.
        
        Args:
            storage_instance: StorageInterface instance or None
        
        Returns:
            String identifier for the storage instance
        """
        if storage_instance is None:
            return 'no_storage'
        # Use id() to get unique identifier for each storage instance
        # This ensures different storage backends get separate cached models
        return f"storage_{id(storage_instance)}"
    
    def execute(self, context: ExecutionContext) -> Dict[str, Any]:
        """Execute model loader node"""
        model_name = self.get_input_value('model_name', context, None)
        storage_instance = self.get_input_value('storage_instance', context, None)
        
        # Build cache key incorporating both model_name and storage identity
        # This ensures LoRA weights from different storage backends are not shared
        model_key = model_name or 'default'
        storage_id = self._get_storage_identity(storage_instance)
        cache_key = f"{model_key}::{storage_id}"
        
        # Check cache
        if cache_key in _model_cache:
            logger.debug(f"Using cached model: {cache_key} (model={model_key}, storage={storage_id})")
            return {
                'model': _model_cache[cache_key]
            }
        
        # Load model (storage is optional - only needed for LoRA weights)
        logger.info(f"Loading model: {cache_key} (model={model_key}, storage={storage_id})")
        from .inference.obelisk_llm import ObeliskLLM
        
        # Storage is optional - only used for loading LoRA weights if available
        # Create and cache model
        llm = ObeliskLLM(storage=storage_instance)
        _model_cache[cache_key] = llm
        
        logger.info(f"Model loaded and cached: {cache_key} (model={model_key}, storage={storage_id})")
        return {
            'model': llm
        }
