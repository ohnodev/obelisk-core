"""
LoRA Loader Node
Applies LoRA weights to the model if enabled
"""
from typing import Dict, Any, Optional
from ..node_base import BaseNode, ExecutionContext
from ....utils.logger import get_logger

logger = get_logger(__name__)


class LoRALoaderNode(BaseNode):
    """
    Applies LoRA weights to the model if enabled
    
    LoRA loading is handled entirely by this node - model loading is separate.
    Loads the latest LoRA weights from storage if available.
    
    Inputs:
        model: ObeliskLLM instance from ModelLoaderNode (required)
        storage_instance: StorageInterface instance (optional, only needed if loading LoRA weights)
        lora_enabled: Whether to apply LoRA weights (default: True)
    
    Outputs:
        model: Model with LoRA applied (or original if disabled/not found)
    """
    
    def execute(self, context: ExecutionContext) -> Dict[str, Any]:
        """Execute LoRA loader node"""
        model = self.get_input_value('model', context)
        storage_instance = self.get_input_value('storage_instance', context, None)
        lora_enabled = self.get_input_value('lora_enabled', context, True)
        
        if model is None:
            raise ValueError("model is required for LoRALoaderNode. Connect a ModelLoaderNode first.")
        
        # If LoRA is enabled, try to load weights from storage
        if lora_enabled and storage_instance:
            try:
                # Initialize or reinitialize LoRA manager if:
                # 1. It doesn't exist or is None, OR
                # 2. It exists but points to a different storage instance
                needs_reinit = (
                    not hasattr(model, 'lora_manager') or 
                    model.lora_manager is None or
                    getattr(model.lora_manager, 'storage', None) is not storage_instance
                )
                
                if needs_reinit:
                    from src.evolution.training import LoRAManager
                    model.lora_manager = LoRAManager(
                        model=model.model,
                        lora_config=model.lora_config,
                        storage=storage_instance,
                        model_name=model.MODEL_NAME
                    )
                
                # Try to load LoRA weights
                # load_weights() returns True if weights were loaded, False otherwise
                weights_loaded = model.lora_manager.load_weights()
                if weights_loaded:
                    # Update model reference if weights were loaded
                    model.model = model.lora_manager.model
                    logger.info("LoRA weights loaded successfully")
                else:
                    logger.debug("No LoRA weights found in storage, using base model")
            except Exception as e:
                # If LoRA loading fails, continue without it
                logger.warning(f"Failed to load LoRA weights: {e}, continuing without LoRA", exc_info=True)
        elif lora_enabled and not storage_instance:
            logger.debug("LoRA enabled but no storage_instance provided, using base model")
        
        return {
            'model': model
        }
