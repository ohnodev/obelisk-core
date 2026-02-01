"""
LoRA Loader Node
Applies LoRA weights to the model if enabled
"""
from typing import Dict, Any, Optional
from ..node_base import BaseNode, ExecutionContext
from ...utils.logger import get_logger

logger = get_logger(__name__)


class LoRALoaderNode(BaseNode):
    """
    Applies LoRA weights to the model if enabled
    
    Inputs:
        model: ObeliskLLM instance from ModelLoaderNode
        lora_enabled: Whether to apply LoRA weights (default: True)
    
    Outputs:
        model: Model with LoRA applied (or original if disabled)
    """
    
    def execute(self, context: ExecutionContext) -> Dict[str, Any]:
        """Execute LoRA loader node"""
        model = self.get_input_value('model', context)
        lora_enabled = self.get_input_value('lora_enabled', context, True)
        
        if model is None:
            # Fallback to container's model
            model = context.container.llm
        
        # If LoRA is enabled, try to load weights from storage
        if lora_enabled and model.storage:
            try:
                # Check if model has lora_manager (created during initialization if storage available)
                if hasattr(model, 'lora_manager') and model.lora_manager:
                    # Try to load latest LoRA weights
                    # load_weights() returns True if weights were loaded, False otherwise
                    weights_loaded = model.lora_manager.load_weights()
                    if weights_loaded:
                        # Update model reference if weights were loaded
                        model.model = model.lora_manager.model
                        logger.debug("LoRA weights loaded successfully")
                    else:
                        logger.debug("No LoRA weights found in storage, using base model")
                else:
                    # LoRA manager not initialized (shouldn't happen if storage is available)
                    logger.debug("LoRA manager not available, using base model")
            except Exception as e:
                # If LoRA loading fails, continue without it
                logger.warning(f"Failed to load LoRA weights: {e}, continuing without LoRA", exc_info=True)
        
        return {
            'model': model
        }
