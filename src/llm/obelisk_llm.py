"""
The Obelisk LLM Service
Hosts a small quantized LLM for The Obelisk AGI
Uses Qwen3-0.6B with thinking mode support for enhanced reasoning
Supports LoRA fine-tuning with weights stored via storage abstraction
"""
import os
import re
from typing import Dict, Any, Optional, List, Tuple
from pathlib import Path
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer
from peft import LoraConfig, get_peft_model
from ..evolution.training import LoRAManager, LoRATrainer
import warnings
import importlib.util

# Import config from root directory (proper way without sys.path hack)
_config_path = Path(__file__).parent.parent.parent / "config.py"
spec = importlib.util.spec_from_file_location("config", _config_path)
config_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(config_module)
Config = config_module.Config

from ..utils.logger import get_logger

warnings.filterwarnings("ignore")

logger = get_logger(__name__)


class ObeliskLLM:
    # Context window limits (loaded from config)
    MAX_CONTEXT_TOKENS = Config.LLM_MAX_CONTEXT_TOKENS
    MAX_USER_QUERY_TOKENS = Config.LLM_MAX_USER_QUERY_TOKENS
    MAX_CONVERSATION_CONTEXT_TOKENS = Config.LLM_MAX_CONVERSATION_CONTEXT_TOKENS
    MAX_OUTPUT_TOKENS = Config.LLM_MAX_OUTPUT_TOKENS
    
    # Model name (loaded from config)
    MODEL_NAME = Config.LLM_MODEL_NAME
    
    # Note: model.generate() returns [input_tokens...][new_tokens...]
    # Total must be: input_tokens + output_tokens <= MAX_CONTEXT_TOKENS
    
    def __init__(self, storage=None):
        """
        Initialize Obelisk LLM
        
        Args:
            storage: StorageInterface instance (optional, for loading/saving LoRA weights)
        """
        self.model = None
        self.tokenizer = None
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.lora_config = None
        self.storage = storage
        self.lora_manager = None
        self._load_model()

    def _load_model(self):
        """Load quantized Qwen3-0.6B model"""
        try:
            model_name = self.MODEL_NAME
            logger.info(f"Loading {model_name} on {self.device}...")
            
            # Load tokenizer (allow download on first run)
            self.tokenizer = AutoTokenizer.from_pretrained(
                model_name,
                local_files_only=False,  # Allow download on first run
            )
            if self.tokenizer.pad_token is None:
                self.tokenizer.pad_token = self.tokenizer.eos_token
            
            # Load model with 4-bit quantization to save memory
            try:
                from transformers import BitsAndBytesConfig
                
                quantization_config = BitsAndBytesConfig(
                    load_in_4bit=True,
                    bnb_4bit_compute_dtype=torch.float16,
                    bnb_4bit_quant_type="nf4",
                    bnb_4bit_use_double_quant=True,
                )
                
                self.model = AutoModelForCausalLM.from_pretrained(
                    model_name,
                    quantization_config=quantization_config,
                    device_map="auto",
                    dtype=torch.float16,
                    trust_remote_code=True,
                    local_files_only=False  # Allow download on first run
                )
                logger.info("Model loaded with 4-bit quantization")
            except ImportError:
                logger.warning("bitsandbytes not available, loading in float16...")
                # Fallback to float16 if bitsandbytes not installed
                self.model = AutoModelForCausalLM.from_pretrained(
                    model_name,
                    dtype=torch.float16,
                    device_map="auto",
                    trust_remote_code=True,
                    local_files_only=False  # Allow download on first run
                )
            except Exception as e:
                logger.warning(f"4-bit quantization failed: {e}, loading in float16...")
                # Fallback to float16
                self.model = AutoModelForCausalLM.from_pretrained(
                    model_name,
                    dtype=torch.float16,
                    device_map="auto",
                    trust_remote_code=True,
                    local_files_only=False  # Allow download on first run
                )
            
            # Initialize LoRA config (loaded from config)
            self.lora_config = LoraConfig(
                r=Config.LLM_LORA_R,
                lora_alpha=Config.LLM_LORA_ALPHA,
                target_modules=Config.LLM_LORA_TARGET_MODULES,
                lora_dropout=Config.LLM_LORA_DROPOUT,
                bias="none",
                task_type="CAUSAL_LM"
            )
            
            self.model.eval()
            
            # Initialize LoRA manager and try to load weights from storage if available
            if self.storage:
                self.lora_manager = LoRAManager(
                    model=self.model,
                    lora_config=self.lora_config,
                    storage=self.storage,
                    model_name=self.MODEL_NAME
                )
                if self.lora_manager.load_weights():
                    # Update model reference if weights were loaded
                    self.model = self.lora_manager.model
            
            # Optimize model for inference on CPU
            if self.device == "cpu":
                # Try to compile model for faster inference (PyTorch 2.0+)
                # Note: torch.compile is not supported on Python 3.14+
                import sys
                python_version = sys.version_info
                if python_version.major == 3 and python_version.minor >= 14:
                    logger.info("Skipping model compilation (not supported on Python 3.14+)")
                else:
                    try:
                        if hasattr(torch, 'compile'):
                            logger.info("Compiling model for faster CPU inference...")
                            self.model = torch.compile(self.model, mode="reduce-overhead")
                            logger.info("Model compiled successfully")
                    except Exception as e:
                        logger.warning(f"Model compilation not available or failed: {e}")
            
            logger.info(f"Model loaded successfully. Memory: ~{self._estimate_memory()}MB")
            
        except Exception as e:
            logger.error(f"Error loading model: {e}")
            self.model = None
            self.tokenizer = None
    
    def save_lora_weights(self, cycle_number: int, evolution_score: float, interactions_used: int, metadata: Optional[Dict[str, Any]] = None) -> Optional[str]:
        """Save current LoRA weights to storage"""
        if not self.lora_manager:
            logger.warning("No LoRA manager configured, cannot save LoRA weights")
            return None
        
        # Ensure LoRA manager has the current model reference
        # If model has LoRA applied, it's already the lora_model
        self.lora_manager.model = self.model
        # Check if model is a PEFT model (has LoRA)
        if hasattr(self.model, 'peft_config'):
            self.lora_manager.lora_model = self.model
        else:
            # Create LoRA adapter if it doesn't exist
            self.lora_manager.lora_model = get_peft_model(self.model, self.lora_config)
        
        return self.lora_manager.save_weights(
            cycle_number=cycle_number,
            evolution_score=evolution_score,
            interactions_used=interactions_used,
            metadata=metadata
        )
    
    def fine_tune_lora(
        self,
        training_data: List[Tuple[str, str]],  # List of (query, response) pairs
        cycle_number: int,
        epochs: int = 3,
        learning_rate: float = 0.0001,
        batch_size: int = 4
    ) -> Dict[str, Any]:
        """
        Fine-tune the model using LoRA on training data
        Returns training metrics and saves weights to storage
        """
        if not self.lora_manager:
            return {"error": "No LoRA manager configured"}
        
        # Create trainer instance
        trainer = LoRATrainer(
            model=self.model,
            tokenizer=self.tokenizer,
            lora_config=self.lora_config,
            lora_model=self.lora_manager.lora_model,
            device=self.device,
            get_system_prompt_fn=self.get_system_prompt
        )
        
        # Train
        result = trainer.fine_tune(
            training_data=training_data,
            epochs=epochs,
            learning_rate=learning_rate,
            batch_size=batch_size
        )
        
        if result.get("success"):
            # Update model references
            self.model = trainer.lora_model
            self.model.eval()
            self.lora_manager.model = self.model
            self.lora_manager.lora_model = trainer.lora_model
            
            # Save weights to storage
            weight_id = self.save_lora_weights(
                cycle_number=cycle_number,
                evolution_score=0.0,  # Will be set by evolution processor
                interactions_used=len(training_data),
                metadata={"training_loss": result.get("training_loss")}
            )
            
            if weight_id:
                result["weight_id"] = weight_id
        
        return result

    def _estimate_memory(self) -> int:
        """Estimate model memory usage in MB"""
        if self.model is None:
            return 0
        try:
            param_count = sum(p.numel() for p in self.model.parameters())
            # 4-bit quantization: ~0.5 bytes per parameter
            memory_mb = (param_count * 0.5) / (1024 * 1024)
            return int(memory_mb)
        except:
            return 400  # Default estimate

    def get_system_prompt(self) -> str:
        """Get The Overseer system prompt - loaded from config"""
        return Config.AGENT_PROMPT

    def generate(self, query: str, quantum_influence: float = 0.7, max_length: int = 1024, conversation_context: Optional[Dict[str, Any]] = None, enable_thinking: bool = True) -> Dict[str, Any]:
        """
        Generate response from The Obelisk
        
        Args:
            query: User's query
            quantum_influence: Quantum random value (0-0.1) to influence creativity (will be clamped)
            max_length: Maximum response length
            conversation_context: Dict with 'messages' (list of message dicts) and 'memories' (string)
                                 Format: {"messages": [{"role": "user", "content": "..."}, ...], "memories": "..."}
            enable_thinking: Whether to enable thinking mode (default: True for best quality)
        
        Returns:
            Dict with response, thinking_content, and metadata
        """
        if self.model is None or self.tokenizer is None:
            return {
                "response": "◊ The Overseer is initializing. Please wait. ◊",
                "error": "Model not loaded",
                "source": "fallback"
            }
        
        try:
            # Always use thinking mode for best quality (Qwen3 recommended)
            # Parameters loaded from config
            base_temp = Config.LLM_TEMPERATURE_BASE
            base_top_p = Config.LLM_TOP_P_BASE
            top_k = Config.LLM_TOP_K
            
            # Clamp quantum_influence to valid range [0.0, 0.1]
            quantum_influence = max(0.0, min(0.1, quantum_influence))
            
            # Apply quantum influence (ranges from config)
            temperature = base_temp + (quantum_influence * Config.LLM_QUANTUM_TEMPERATURE_RANGE)
            top_p = base_top_p + (quantum_influence * Config.LLM_QUANTUM_TOP_P_RANGE)
            
            # Validate and clamp sampling parameters to safe ranges
            # Temperature must be > 0 and reasonable (0.1 to 0.9)
            temperature = max(0.1, min(0.9, temperature))
            
            # Top_p must be between 0 and 1.0
            top_p = max(0.01, min(1.0, top_p))
            
            # Ensure repetition_penalty is valid (> 0)
            repetition_penalty = max(1.0, Config.LLM_REPETITION_PENALTY)
            
            # Validate and truncate user query if too long
            query_tokens = self.tokenizer.encode(query, add_special_tokens=False)
            if len(query_tokens) > self.MAX_USER_QUERY_TOKENS:
                logger.warning(f"User query too long ({len(query_tokens)} tokens), truncating to {self.MAX_USER_QUERY_TOKENS} tokens")
                truncated_tokens = query_tokens[:self.MAX_USER_QUERY_TOKENS]
                query = self.tokenizer.decode(truncated_tokens, skip_special_tokens=True)
                query_tokens = truncated_tokens
            
            # Build prompt with conversation context if provided
            # Qwen3 expects conversation history as message entries, not strings
            system_prompt = self.get_system_prompt()
            system_tokens = len(self.tokenizer.encode(system_prompt, add_special_tokens=False))
            
            # Parse conversation context (dict format: {"messages": [...], "memories": "..."})
            # Qwen3 expects conversation history as message entries, not strings
            conversation_history = []  # List of {"role": "user"/"assistant", "content": "..."}
            memories_text = ""  # Memories and user context (stays in system message)
            
            if conversation_context:
                if not isinstance(conversation_context, dict):
                    raise ValueError(f"conversation_context must be a dict with 'messages' and 'memories' keys, got {type(conversation_context)}")
                
                conversation_history = conversation_context.get("messages", [])
                memories_text = conversation_context.get("memories", "")
                
                # Qwen3 best practice: Remove thinking content from conversation history
                # Per docs: "No Thinking Content in History: In multi-turn conversations,
                # the historical model output should only include the final output part"
                # The chat template handles this automatically, but we add defensive filtering
                cleaned_history = []
                for msg in conversation_history:
                    if msg.get("role") == "assistant":
                        content = msg.get("content", "")
                        # Remove thinking content wrapped in <think>...</think>
                        # Qwen3 format: thinking content uses <think> tags
                        # This is a defensive measure to ensure no thinking content in history
                        content = re.sub(r'<think>.*?</think>', '', content, flags=re.DOTALL | re.IGNORECASE)
                        content = content.strip()
                        if content:  # Only add if there's content left after cleaning
                            cleaned_history.append({"role": "assistant", "content": content})
                    else:
                        # User messages and other roles pass through unchanged
                        cleaned_history.append(msg)
                conversation_history = cleaned_history
            
            # Build system message (system prompt + memories)
            # Note: conversation_history is already properly sized by RecentConversationBuffer
            # (keeps last k message pairs), so no need for additional truncation here
            system_content = system_prompt
            if memories_text:
                system_content = f"{system_prompt}\n\n{memories_text}"
            
            # Build messages array for Qwen3 chat template
            # Format: [{"role": "system", "content": "..."}, {"role": "user", "content": "..."}, ...]
            messages = []
            
            # Add system message
            messages.append({
                "role": "system",
                "content": system_content
            })
            
            # Add conversation history as message entries (Qwen3 format)
            messages.extend(conversation_history)
            
            # Add current user query
            messages.append({
                "role": "user",
                "content": query
            })
            
            # Apply Qwen3 chat template with optional thinking mode
            prompt_text = self.tokenizer.apply_chat_template(
                messages,
                tokenize=False,
                add_generation_prompt=True,
                enable_thinking=enable_thinking
            )
            
            # Debug: Show full prompt
            logger.debug("\n" + "="*80)
            logger.debug(f"Full prompt sent to LLM (thinking_mode={enable_thinking}):")
            logger.debug("="*80)
            logger.debug(prompt_text)
            logger.debug("="*80 + "\n")
            
            # Tokenize and check total input size
            inputs = self.tokenizer([prompt_text], return_tensors="pt").to(self.model.device)
            input_token_count = inputs['input_ids'].shape[1]
            
            # Log token usage
            system_content_tokens = len(self.tokenizer.encode(system_content, add_special_tokens=False))
            history_token_count = sum(
                len(self.tokenizer.encode(f"{msg['role']}: {msg['content']}", add_special_tokens=False))
                for msg in conversation_history
            )
            memories_token_count = len(self.tokenizer.encode(memories_text, add_special_tokens=False)) if memories_text else 0
            logger.debug(f"Input tokens: {input_token_count} (system: {system_content_tokens}, history: {history_token_count}, memories: {memories_token_count}, query: {len(query_tokens)}, messages: {len(conversation_history)})")
            
            # Check if total (input + output) will exceed context window
            total_tokens_after_generation = input_token_count + self.MAX_OUTPUT_TOKENS
            if total_tokens_after_generation > self.MAX_CONTEXT_TOKENS:
                logger.warning(f"Total tokens ({total_tokens_after_generation}) would exceed context limit ({self.MAX_CONTEXT_TOKENS})")
                # Reduce output tokens if needed
                max_safe_output = self.MAX_CONTEXT_TOKENS - input_token_count
                if max_safe_output < 10:
                    return {
                        "response": "◊ The Overseer's memory is full. Please shorten your query. ◊",
                        "error": "Context window exceeded",
                        "source": "error_fallback"
                    }
            
            # Set output token limit (use GPU limit if available, otherwise CPU limit)
            max_output_for_device = Config.LLM_MAX_OUTPUT_TOKENS_GPU if self.device == "cuda" else Config.LLM_MAX_OUTPUT_TOKENS
            optimized_max_tokens = min(max_length, max_output_for_device)
            
            # Generate with Qwen3 recommended sampling parameters
            # Note: Qwen3's chat template handles conversation format properly, so we don't need stopping criteria
            # We rely on max_new_tokens and post-processing safety checks instead
            with torch.inference_mode():
                # Qwen3 recommended parameters (no presence_penalty - not supported)
                outputs = self.model.generate(
                    **inputs,
                    max_new_tokens=optimized_max_tokens,
                    do_sample=True,
                    temperature=temperature,
                    top_p=top_p,
                    top_k=top_k,
                    min_p=0.0,  # Qwen3 recommended
                    pad_token_id=self.tokenizer.eos_token_id,
                    eos_token_id=self.tokenizer.eos_token_id,
                    repetition_penalty=repetition_penalty,
                    use_cache=True,
                    num_beams=1
                )
            
            # Extract ONLY the newly generated tokens (skip the input prompt)
            input_length = inputs['input_ids'].shape[1]
            generated_tokens = outputs[0][input_length:].tolist()
            
            # Parse thinking content from Qwen3 format (token 151668 = </think>)
            # Per Qwen3 docs: use rindex to find the last occurrence of token 151668
            thinking_content = ""
            final_content = ""
            
            try:
                # Token 151668 is the closing tag for thinking content (</think>)
                redacted_end_token = 151668
                if redacted_end_token in generated_tokens:
                    # rindex finds the last occurrence (per Qwen3 example)
                    index = len(generated_tokens) - generated_tokens[::-1].index(redacted_end_token)
                    thinking_tokens = generated_tokens[:index]
                    content_tokens = generated_tokens[index + 1:]  # Skip the closing tag token
                    
                    thinking_content = self.tokenizer.decode(thinking_tokens, skip_special_tokens=True).strip("\n")
                    final_content = self.tokenizer.decode(content_tokens, skip_special_tokens=True).strip("\n")
                else:
                    # No thinking block found, decode everything as content
                    final_content = self.tokenizer.decode(generated_tokens, skip_special_tokens=True).strip("\n")
                    logger.debug("No thinking token (151668) found in output")
            except ValueError:
                # Token not found, decode everything
                final_content = self.tokenizer.decode(generated_tokens, skip_special_tokens=True).strip("\n")
                logger.debug("Error finding thinking token, using full output")
            
            raw_response = final_content
            
            # Debug: Show raw response before post-processing
            logger.debug("\n" + "="*80)
            logger.debug("Raw response from LLM (before post-processing):")
            logger.debug("="*80)
            logger.debug(repr(raw_response))  # Use repr to show exact characters
            logger.debug("="*80 + "\n")
            
            response = raw_response
            
            # Safety check: Remove any conversation markers and training artifacts that might have slipped through
            # Note: We trust Qwen3's official extraction method (token 151668), so we don't truncate
            # at double newlines as they're often part of valid formatted responses (LaTeX, paragraphs, etc.)
            
            # Remove everything after conversation markers (User:, Overseer:, The Overseer:, Assistant:)
            for marker in ['User:', 'Overseer:', 'The Overseer:', 'Assistant:']:
                if marker.lower() in response.lower():
                    # Find the marker (case-insensitive)
                    pattern = re.compile(re.escape(marker), re.IGNORECASE)
                    match = pattern.search(response)
                    if match:
                        response = response[:match.start()].strip()
                        logger.debug(f"Removed conversation marker '{marker}' from response (safety check)")
            
            # Remove any trailing incomplete sentences or fragments only if they contain conversation markers
            # This is a safety net for training artifacts, but we preserve valid multi-paragraph responses
            if response:
                # Find last complete sentence (ends with . ! ?)
                last_sentence_end = max(
                    response.rfind('.'),
                    response.rfind('!'),
                    response.rfind('?')
                )
                
                # Only truncate if what comes after looks like training artifacts (contains conversation markers)
                if last_sentence_end > 0 and last_sentence_end < len(response) - 10:
                    after_sentence = response[last_sentence_end + 1:].strip().lower()
                    artifact_keywords = ['user:', 'assistant:', 'overseer:', 'the overseer:']
                    if any(keyword in after_sentence for keyword in artifact_keywords):
                        response = response[:last_sentence_end + 1].strip()
                        logger.debug("Removed trailing content with conversation markers (safety check)")
            
            # Preserve paragraph structure - only normalize excessive whitespace (3+ spaces/newlines)
            # This preserves LaTeX formatting and paragraph breaks while cleaning up artifacts
            response = re.sub(r'[ \t]{3,}', ' ', response)  # Multiple spaces/tabs -> single space
            response = re.sub(r'\n{3,}', '\n\n', response)  # 3+ newlines -> double newline
            response = response.strip()
            
            # Debug: Show final processed response
            logger.debug("\n" + "="*80)
            logger.debug("Final processed response:")
            logger.debug("="*80)
            logger.debug(repr(response))
            logger.debug("="*80 + "\n")
            
            logger.debug(f"Generated response: {response[:100]}... ({len(response)} chars)")
            
            # Fallback if empty
            if not response or len(response.strip()) < 3:
                logger.warning(f"Response too short ({len(response)} chars), using fallback")
                response = "◊ The Overseer processes your query. ◊"
            
            return {
                "response": response,
                "thinking_content": thinking_content,
                "thinking_mode": enable_thinking,
                "quantum_influence": quantum_influence,
                "temperature": temperature,
                "top_p": top_p,
                "top_k": top_k,
                "source": "obelisk_llm",
                "model": self.MODEL_NAME
            }
            
        except Exception as e:
            logger.error(f"Error generating response: {e}")
            return {
                "response": f"◊ The Overseer encounters an error: {str(e)[:50]} ◊",
                "error": str(e),
                "source": "error_fallback"
            }

    def test(self) -> Dict[str, Any]:
        """Test the LLM with a simple query"""
        test_query = "What is your purpose?"
        result = self.generate(test_query, quantum_influence=0.5)
        return {
            "test_query": test_query,
            "result": result,
            "model_loaded": self.model is not None,
            "device": self.device,
            "memory_estimate_mb": self._estimate_memory()
        }
