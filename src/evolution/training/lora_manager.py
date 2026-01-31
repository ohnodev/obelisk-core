"""
LoRA Weight Manager
Handles saving and loading LoRA adapter weights from storage
"""
import io
import pickle
from typing import Dict, Any, Optional
from peft import get_peft_model

from ...utils.logger import get_logger

logger = get_logger(__name__)


class LoRAManager:
    """Manages LoRA adapter weights (save/load from storage)"""
    
    def __init__(self, model, lora_config, storage, model_name: str):
        """
        Initialize LoRA Manager
        
        Args:
            model: Base model to apply LoRA to
            lora_config: LoraConfig instance
            storage: StorageInterface instance
            model_name: Name of the model (for storage keys)
        """
        self.model = model
        self.lora_config = lora_config
        self.storage = storage
        self.model_name = model_name
        self.lora_model = None
        self.current_weights_cycle = None
    
    def load_weights(self) -> bool:
        """Load LoRA weights from storage if available"""
        if not self.storage:
            return False
        
        try:
            weights_data = self.storage.get_latest_model_weights(self.model_name)
            if weights_data and weights_data.get('lora_weights'):
                logger.info(f"Loading LoRA weights from cycle {weights_data.get('cycle_number')}, version {weights_data.get('version')}")
                
                # Convert bytes to state dict
                lora_weights_bytes = weights_data['lora_weights']
                if isinstance(lora_weights_bytes, bytes):
                    state_dict = pickle.loads(lora_weights_bytes)
                else:
                    # Already a dict
                    state_dict = lora_weights_bytes
                
                # Apply LoRA to model
                self.lora_model = get_peft_model(self.model, self.lora_config)
                self.lora_model.load_state_dict(state_dict, strict=False)
                self.lora_model.eval()
                
                # Update model reference
                self.model = self.lora_model
                self.current_weights_cycle = weights_data.get('cycle_number')
                
                logger.info(f"LoRA weights loaded successfully from cycle {self.current_weights_cycle}")
                return True
            else:
                logger.info("No LoRA weights found in storage, using base model")
                return False
        except Exception as e:
            logger.error(f"Error loading LoRA weights: {e}")
            import traceback
            traceback.print_exc()
            return False
    
    def save_weights(
        self,
        cycle_number: int,
        evolution_score: float,
        interactions_used: int,
        metadata: Optional[Dict[str, Any]] = None
    ) -> Optional[str]:
        """Save current LoRA weights to storage"""
        if not self.storage:
            logger.warning("No storage configured, cannot save LoRA weights")
            return None
        
        try:
            if self.lora_model is None:
                logger.info("No LoRA model to save, creating new LoRA adapter...")
                # Create LoRA adapter if it doesn't exist
                self.lora_model = get_peft_model(self.model, self.lora_config)
            
            # Get state dict from LoRA adapter
            state_dict = self.lora_model.state_dict()
            
            # Serialize to bytes
            buffer = io.BytesIO()
            pickle.dump(state_dict, buffer)
            lora_weights_bytes = buffer.getvalue()
            
            # Save to storage (include model_name in metadata for retrieval)
            if metadata is None:
                metadata = {}
            metadata['base_model'] = self.model_name
            
            weight_id = self.storage.save_lora_weights(
                cycle_number=cycle_number,
                lora_weights=lora_weights_bytes,
                evolution_score=evolution_score,
                interactions_used=interactions_used,
                metadata=metadata
            )
            
            if weight_id:
                self.current_weights_cycle = cycle_number
                logger.info(f"LoRA weights saved successfully for cycle {cycle_number}")
                return weight_id
            else:
                logger.error("Failed to save LoRA weights")
                return None
        except Exception as e:
            logger.error(f"Error saving LoRA weights: {e}")
            import traceback
            traceback.print_exc()
            return None
