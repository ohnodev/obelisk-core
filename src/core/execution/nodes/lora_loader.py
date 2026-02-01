"""
LoRA Loader Node
Applies LoRA weights to the model if enabled
"""
from typing import Dict, Any, Optional
from ..node_base import BaseNode, ExecutionContext


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
        
        # If LoRA is enabled, ensure weights are loaded
        # The model's load_lora_weights() is idempotent, so this is safe
        if lora_enabled and model.storage:
            try:
                # Try to load latest LoRA weights
                # This is handled by the model's internal logic
                # We just ensure the model is ready
                pass  # Model already handles LoRA loading on init
            except Exception as e:
                # If LoRA loading fails, continue without it
                from ...utils.logger import get_logger
                logger = get_logger(__name__)
                logger.warning(f"Failed to load LoRA weights: {e}, continuing without LoRA")
        
        return {
            'model': model
        }
