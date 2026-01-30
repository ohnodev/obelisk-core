"""
LoRA Fine-Tuning Trainer
Handles training LoRA adapters on conversation data
"""
from typing import Dict, Any, List, Tuple
from transformers import TrainingArguments, Trainer
from peft import get_peft_model

from ...utils.logger import get_logger

logger = get_logger(__name__)


class LoRATrainer:
    """Handles LoRA fine-tuning on training data"""
    
    def __init__(self, model, tokenizer, lora_config, lora_model, device: str, get_system_prompt_fn):
        """
        Initialize LoRA Trainer
        
        Args:
            model: Base model
            tokenizer: Tokenizer instance
            lora_config: LoraConfig instance
            lora_model: Existing LoRA model (or None to create new)
            device: Device string ("cuda" or "cpu")
            get_system_prompt_fn: Function that returns the system prompt string
        """
        self.model = model
        self.tokenizer = tokenizer
        self.lora_config = lora_config
        self.lora_model = lora_model
        self.device = device
        self.get_system_prompt = get_system_prompt_fn
    
    def fine_tune(
        self,
        training_data: List[Tuple[str, str]],  # List of (query, response) pairs
        epochs: int = 3,
        learning_rate: float = 0.0001,
        batch_size: int = 4
    ) -> Dict[str, Any]:
        """
        Fine-tune the model using LoRA on training data
        Returns training metrics
        
        Args:
            training_data: List of (query, response) pairs
            epochs: Number of training epochs
            learning_rate: Learning rate for training
            batch_size: Batch size for training
            
        Returns:
            Dict with training results or error
        """
        try:
            from datasets import Dataset
            
            if not training_data or len(training_data) < 5:
                return {"error": "Need at least 5 training examples"}
            
            logger.info(f"Starting LoRA fine-tuning on {len(training_data)} examples...")
            
            # Ensure LoRA adapter exists
            if self.lora_model is None:
                self.lora_model = get_peft_model(self.model, self.lora_config)
            
            # Format training data
            def format_prompt(query: str, response: str) -> str:
                system_prompt = self.get_system_prompt()
                return f"{system_prompt}\n\nUser: {query}\nOverseer: {response}"
            
            # Create dataset
            formatted_data = [
                {"text": format_prompt(q, r)}
                for q, r in training_data
            ]
            
            dataset = Dataset.from_list(formatted_data)
            
            # Tokenize
            def tokenize_function(examples):
                return self.tokenizer(
                    examples["text"],
                    truncation=True,
                    max_length=512,
                    padding="max_length"
                )
            
            tokenized_dataset = dataset.map(tokenize_function, batched=True)
            
            # Training arguments
            training_args = TrainingArguments(
                output_dir="./lora_output",
                num_train_epochs=epochs,
                per_device_train_batch_size=batch_size,
                learning_rate=learning_rate,
                logging_steps=10,
                save_strategy="no",  # Don't save checkpoints, we'll save to storage
                fp16=self.device == "cuda",
                optim="adamw_torch",
                report_to="none"
            )
            
            # Trainer
            trainer = Trainer(
                model=self.lora_model,
                args=training_args,
                train_dataset=tokenized_dataset,
            )
            
            # Train
            train_result = trainer.train()
            
            logger.info(f"Fine-tuning completed. Loss: {train_result.training_loss:.4f}")
            
            return {
                "success": True,
                "training_loss": train_result.training_loss,
                "examples_trained": len(training_data),
                "epochs": epochs
            }
            
        except Exception as e:
            logger.error(f"Error during fine-tuning: {e}")
            import traceback
            traceback.print_exc()
            return {"error": str(e)}
