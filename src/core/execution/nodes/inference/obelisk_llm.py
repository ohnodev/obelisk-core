"""
The Obelisk LLM
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
from src.evolution.training import LoRAManager
from .thinking_token_utils import split_thinking_tokens
import warnings
from src.core.config import Config
from src.utils.logger import get_logger

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
    
    def __init__(self, storage=None, debug_logging=False):
        """
        Initialize Obelisk LLM
        
        Args:
            storage: StorageInterface instance (deprecated - LoRA loading handled by LoRALoaderNode)
            debug_logging: If True, enables verbose logging of prompts and responses (default: False)
        """
        self.model = None
        self.tokenizer = None
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.lora_config = None
        self.storage = storage  # Kept for backward compatibility, but LoRA handled by LoRALoaderNode
        self.lora_manager = None
        self.debug_logging = debug_logging  # Gated debug flag for sensitive data logging
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
            
            # Initialize LoRA config (loaded from config) - used by LoRALoaderNode
            self.lora_config = LoraConfig(
                r=Config.LLM_LORA_R,
                lora_alpha=Config.LLM_LORA_ALPHA,
                target_modules=Config.LLM_LORA_TARGET_MODULES,
                lora_dropout=Config.LLM_LORA_DROPOUT,
                bias="none",
                task_type="CAUSAL_LM"
            )
            
            self.model.eval()
            
            # LoRA loading is now handled by LoRALoaderNode, not here
            # This keeps model loading simple and LoRA loading separate
            
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


    def _prepare_sampling_parameters(self, quantum_influence: float) -> Dict[str, float]:
        """
        Prepare and validate sampling parameters with quantum influence.
        
        Args:
            quantum_influence: Quantum random value (0-0.1) to influence creativity (will be clamped)
            
        Returns:
            Dict with temperature, top_p, top_k, repetition_penalty, and clamped quantum_influence
        """
        # Clamp quantum_influence to valid range [0.0, 0.1]
        clamped_quantum_influence = max(0.0, min(0.1, quantum_influence))
        
        # Log if clamping occurred
        if clamped_quantum_influence != quantum_influence:
            logger.debug(f"quantum_influence clamped from {quantum_influence} to {clamped_quantum_influence}")
        
        # Apply quantum influence (ranges from config)
        base_temp = Config.LLM_TEMPERATURE_BASE
        base_top_p = Config.LLM_TOP_P_BASE
        top_k = Config.LLM_TOP_K
        
        temperature = base_temp + (clamped_quantum_influence * Config.LLM_QUANTUM_TEMPERATURE_RANGE)
        top_p = base_top_p + (clamped_quantum_influence * Config.LLM_QUANTUM_TOP_P_RANGE)
        
        # Validate and clamp sampling parameters to safe ranges
        temperature = max(0.1, min(0.9, temperature))
        top_p = max(0.01, min(1.0, top_p))
        repetition_penalty = max(1.0, Config.LLM_REPETITION_PENALTY)
        
        return {
            "temperature": temperature,
            "top_p": top_p,
            "top_k": top_k,
            "repetition_penalty": repetition_penalty,
            "quantum_influence": clamped_quantum_influence  # Return clamped value for metadata
        }

    def _validate_and_truncate_query(self, query: str) -> Tuple[str, List[int]]:
        """
        Validate and truncate user query if too long.
        
        Args:
            query: User's query string
            
        Returns:
            Tuple of (validated_query, query_tokens)
        """
        query_tokens = self.tokenizer.encode(query, add_special_tokens=False)
        if len(query_tokens) > self.MAX_USER_QUERY_TOKENS:
            logger.warning(f"User query too long ({len(query_tokens)} tokens), truncating to {self.MAX_USER_QUERY_TOKENS} tokens")
            truncated_tokens = query_tokens[:self.MAX_USER_QUERY_TOKENS]
            query = self.tokenizer.decode(truncated_tokens, skip_special_tokens=True)
            query_tokens = truncated_tokens
        return query, query_tokens

    def _parse_conversation_context(self, conversation_context: Optional[Dict[str, Any]]) -> Tuple[List[Dict[str, str]], str]:
        """
        Parse and clean conversation context.
        
        Args:
            conversation_context: Dict with 'messages' and 'memories' keys
            
        Returns:
            Tuple of (cleaned_conversation_history, memories_text)
        """
        conversation_history = []
        memories_text = ""
        
        if conversation_context:
            if not isinstance(conversation_context, dict):
                raise ValueError(f"conversation_context must be a dict with 'messages' and 'memories' keys, got {type(conversation_context)}")
            
            conversation_history = conversation_context.get("messages", [])
            memories_text = conversation_context.get("memories", "")
            
            # Qwen3 best practice: Remove thinking content from conversation history
            cleaned_history = []
            for msg in conversation_history:
                if msg.get("role") == "assistant":
                    content = msg.get("content", "")
                    # Remove thinking content wrapped in <think>...</think>
                    content = re.sub(r'<think>.*?</think>', '', content, flags=re.DOTALL | re.IGNORECASE)
                    content = content.strip()
                    if content:  # Only add if there's content left after cleaning
                        cleaned_history.append({"role": "assistant", "content": content})
                else:
                    # User messages and other roles pass through unchanged
                    cleaned_history.append(msg)
            conversation_history = cleaned_history
        
        return conversation_history, memories_text

    def _build_messages(self, query: str, conversation_history: List[Dict[str, str]], system_prompt: str, memories_text: str = "") -> List[Dict[str, str]]:
        """
        Build messages array for Qwen3 chat template.
        
        Args:
            query: Current user query
            conversation_history: List of previous messages
            system_prompt: System prompt (can include memories)
            memories_text: Additional memories text (optional, can be merged into system_prompt)
            
        Returns:
            List of message dicts in Qwen3 format
        """
        system_content = system_prompt
        if memories_text:
            system_content = f"{system_prompt}\n\n{memories_text}"
        
        messages = [
            {"role": "system", "content": system_content},
            *conversation_history,
            {"role": "user", "content": query}
        ]
        
        return messages

    def _validate_context_window(self, input_token_count: int, max_length: int) -> Dict[str, Any]:
        """
        Validate context window and compute safe output token limit.
        
        Args:
            input_token_count: Number of input tokens
            max_length: Requested max output length
            
        Returns:
            Dict with:
            - If error: "error" key with error dict (contains "response", "error", "source")
            - If success: "max_output_tokens" key with clamped safe token count
        """
        # Compute safe output tokens: min of requested length, max output tokens, and available context
        safe_output_tokens = min(
            max_length,
            self.MAX_OUTPUT_TOKENS,
            self.MAX_CONTEXT_TOKENS - input_token_count
        )
        
        if safe_output_tokens <= 0:
            # Context window exceeded - return error
            return {
                "error": {
                    "response": "◊ The Overseer's memory is full. Please shorten your query. ◊",
                    "error": "Context window exceeded",
                    "source": "error_fallback"
                }
            }
        
        # Return safe token count for caller to use
        if safe_output_tokens < max_length:
            logger.warning(
                f"Requested max_length ({max_length}) reduced to {safe_output_tokens} "
                f"to fit context window (input: {input_token_count}, limit: {self.MAX_CONTEXT_TOKENS})"
            )
        
        return {"max_output_tokens": safe_output_tokens}

    def _generate_tokens(self, inputs, sampling_params: Dict[str, float], max_output_tokens: int, enable_thinking: bool) -> List[int]:
        """
        Generate tokens from the model.
        
        Args:
            inputs: Tokenized input tensors
            sampling_params: Dict with temperature, top_p, top_k, repetition_penalty
            max_output_tokens: Maximum output tokens (already validated and clamped)
            enable_thinking: Whether thinking mode is enabled
            
        Returns:
            List of generated token IDs
        """
        # Set output token limit (use GPU limit if available, otherwise CPU limit)
        max_output_for_device = Config.LLM_MAX_OUTPUT_TOKENS_GPU if self.device == "cuda" else Config.LLM_MAX_OUTPUT_TOKENS
        optimized_max_tokens = min(max_output_tokens, max_output_for_device)
        
        # Build generate kwargs - conditionally include min_p based on transformers version
        generate_kwargs = {
            **inputs,
            "max_new_tokens": optimized_max_tokens,
            "do_sample": True,
            "temperature": sampling_params["temperature"],
            "top_p": sampling_params["top_p"],
            "top_k": sampling_params["top_k"],
            "pad_token_id": self.tokenizer.eos_token_id,
            "eos_token_id": self.tokenizer.eos_token_id,
            "repetition_penalty": sampling_params["repetition_penalty"],
            "use_cache": True,
            "num_beams": 1
        }
        
        # min_p was added in transformers 4.36.0+ - only include if supported
        # Check version by comparing version strings (simple approach without packaging)
        try:
            import transformers
            if hasattr(transformers, '__version__'):
                version_str = transformers.__version__
                # Simple version comparison: check if >= 4.36.0
                version_parts = version_str.split('.')
                if len(version_parts) >= 2:
                    major = int(version_parts[0])
                    minor = int(version_parts[1])
                    if major > 4 or (major == 4 and minor >= 36):
                        generate_kwargs["min_p"] = 0.0  # Qwen3 recommended
        except (ImportError, ValueError, AttributeError):
            # If version check fails, skip min_p to ensure compatibility with transformers 4.30.0
            pass
        
        with torch.inference_mode():
            outputs = self.model.generate(**generate_kwargs)
        
        # Extract ONLY the newly generated tokens (skip the input prompt)
        input_length = inputs['input_ids'].shape[1]
        generated_tokens = outputs[0][input_length:].tolist()
        
        return generated_tokens

    def _parse_thinking_tokens(self, generated_tokens: List[int], enable_thinking: bool) -> Tuple[str, str]:
        """
        Parse thinking and content tokens from generated output.
        
        Args:
            generated_tokens: List of generated token IDs
            enable_thinking: Whether thinking mode was enabled
            
        Returns:
            Tuple of (thinking_content, final_content)
        """
        if enable_thinking:
            thinking_tokens, content_tokens = split_thinking_tokens(generated_tokens)
            
            if thinking_tokens:
                thinking_content = self.tokenizer.decode(thinking_tokens, skip_special_tokens=True).strip("\n")
            else:
                thinking_content = ""
                logger.debug("No thinking token (151668) found in output")
            
            if content_tokens:
                final_content = self.tokenizer.decode(content_tokens, skip_special_tokens=True).strip("\n")
            else:
                final_content = ""
                logger.debug("No content tokens after thinking block")
        else:
            # When thinking is disabled, all tokens are content
            thinking_content = ""
            final_content = self.tokenizer.decode(generated_tokens, skip_special_tokens=True).strip("\n")
            logger.debug("Thinking mode disabled - all tokens treated as content")
        
        return thinking_content, final_content

    def _redact_and_truncate(self, text: str, max_chars: int = 200) -> str:
        """
        Redact PII and truncate long content for safe logging.
        
        Args:
            text: Text to redact and truncate
            max_chars: Maximum characters to keep (default: 200)
        
        Returns:
            Redacted and truncated text safe for logging
        """
        if not isinstance(text, str):
            text = str(text)
        
        # Basic PII redaction patterns (email, phone, credit card, SSN-like patterns)
        # Email pattern
        text = re.sub(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b', '[EMAIL_REDACTED]', text)
        # Phone pattern (various formats)
        text = re.sub(r'\b\d{3}[-.]?\d{3}[-.]?\d{4}\b', '[PHONE_REDACTED]', text)
        text = re.sub(r'\b\(\d{3}\)\s?\d{3}[-.]?\d{4}\b', '[PHONE_REDACTED]', text)
        # Credit card pattern (16 digits, possibly with spaces/dashes)
        text = re.sub(r'\b\d{4}[-.\s]?\d{4}[-.\s]?\d{4}[-.\s]?\d{4}\b', '[CARD_REDACTED]', text)
        # SSN pattern
        text = re.sub(r'\b\d{3}-\d{2}-\d{4}\b', '[SSN_REDACTED]', text)
        
        # Truncate if too long
        if len(text) > max_chars:
            text = text[:max_chars] + "..."
        
        return text

    def _post_process_response(self, raw_response: str) -> str:
        """
        Post-process response to remove artifacts and clean up formatting.
        
        Args:
            raw_response: Raw response from model
            
        Returns:
            Cleaned response string
        """
        response = raw_response
        
        # Remove everything after conversation markers (User:, Overseer:, The Overseer:, Assistant:)
        for marker in ['User:', 'Overseer:', 'The Overseer:', 'Assistant:']:
            if marker.lower() in response.lower():
                pattern = re.compile(re.escape(marker), re.IGNORECASE)
                match = pattern.search(response)
                if match:
                    response = response[:match.start()].strip()
                    logger.debug(f"Removed conversation marker '{marker}' from response (safety check)")
        
        # Remove any trailing incomplete sentences or fragments only if they contain conversation markers
        if response:
            last_sentence_end = max(
                response.rfind('.'),
                response.rfind('!'),
                response.rfind('?')
            )
            
            # Only truncate if what comes after looks like training artifacts
            if last_sentence_end > 0 and last_sentence_end < len(response) - 10:
                after_sentence = response[last_sentence_end + 1:].strip().lower()
                artifact_keywords = ['user:', 'assistant:', 'overseer:', 'the overseer:']
                if any(keyword in after_sentence for keyword in artifact_keywords):
                    response = response[:last_sentence_end + 1].strip()
                    logger.debug("Removed trailing content with conversation markers (safety check)")
        
        # Preserve paragraph structure - only normalize excessive whitespace
        response = re.sub(r'[ \t]{3,}', ' ', response)  # Multiple spaces/tabs -> single space
        response = re.sub(r'\n{3,}', '\n\n', response)  # 3+ newlines -> double newline
        response = response.strip()
        
        # Fallback if empty
        if not response or len(response.strip()) < 3:
            logger.warning(f"Response too short ({len(response)} chars), using fallback")
            response = "◊ The Overseer processes your query. ◊"
        
        return response

    def get_system_prompt(self) -> str:
        """
        Get the default system prompt for The Overseer.
        
        Returns:
            Default system prompt string
        """
        return Config.AGENT_PROMPT

    def generate(self, query: str, system_prompt: str, quantum_influence: float = 0.7, max_length: int = 1024, conversation_history: Optional[List[Dict[str, str]]] = None, enable_thinking: bool = True) -> Dict[str, Any]:
        """
        Generate response from The Obelisk
        
        Args:
            query: User's query
            system_prompt: System prompt (can include memories, user context, etc.)
            quantum_influence: Quantum random value (0-0.1) to influence creativity (will be clamped)
            max_length: Maximum response length
            conversation_history: Optional list of previous messages [{"role": "user", "content": "..."}, ...]
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
            # Prepare sampling parameters
            sampling_params = self._prepare_sampling_parameters(quantum_influence)
            
            # Validate and truncate query
            query, query_tokens = self._validate_and_truncate_query(query)
            
            # Build messages array for Qwen3
            messages = self._build_messages(query, conversation_history or [], system_prompt, memories_text="")
            
            # Apply Qwen3 chat template
            prompt_text = self.tokenizer.apply_chat_template(
                messages,
                tokenize=False,
                add_generation_prompt=True,
                enable_thinking=enable_thinking
            )
            
            # Debug: Show full prompt (gated by debug_logging flag)
            if self.debug_logging:
                safe_prompt = self._redact_and_truncate(prompt_text, max_chars=200)
                logger.debug("\n" + "="*80)
                logger.debug(f"Full prompt sent to LLM (thinking_mode={enable_thinking}):")
                logger.debug("="*80)
                logger.debug(safe_prompt)
                logger.debug("="*80 + "\n")
            
            # Tokenize input
            inputs = self.tokenizer([prompt_text], return_tensors="pt").to(self.model.device)
            input_token_count = inputs['input_ids'].shape[1]
            
            # Log token usage
            system_content_tokens = len(self.tokenizer.encode(system_prompt, add_special_tokens=False))
            history_token_count = sum(
                len(self.tokenizer.encode(f"{msg['role']}: {msg['content']}", add_special_tokens=False))
                for msg in (conversation_history or [])
            )
            logger.debug(f"Input tokens: {input_token_count} (system: {system_content_tokens}, history: {history_token_count}, query: {len(query_tokens)})")
            
            # Validate context window and get safe output token limit
            context_validation = self._validate_context_window(input_token_count, max_length)
            if "error" in context_validation:
                return context_validation["error"]
            
            # Use the safe output token count from validation
            safe_max_tokens = context_validation["max_output_tokens"]
            
            # Generate tokens using the validated safe token limit
            generated_tokens = self._generate_tokens(inputs, sampling_params, safe_max_tokens, enable_thinking)
            
            # Parse thinking and content tokens
            thinking_content, final_content = self._parse_thinking_tokens(generated_tokens, enable_thinking)
            
            # Debug: Show raw response before post-processing (gated by debug_logging flag)
            if self.debug_logging:
                safe_content = self._redact_and_truncate(final_content, max_chars=200)
                logger.debug("\n" + "="*80)
                logger.debug("Raw response from LLM (before post-processing):")
                logger.debug("="*80)
                logger.debug(safe_content)
                logger.debug("="*80 + "\n")
            
            # Post-process response
            response = self._post_process_response(final_content)
            
            # Debug: Show final processed response (gated by debug_logging flag)
            if self.debug_logging:
                safe_response = self._redact_and_truncate(response, max_chars=200)
                logger.debug("\n" + "="*80)
                logger.debug("Final processed response:")
                logger.debug("="*80)
                logger.debug(safe_response)
                logger.debug("="*80 + "\n")
            
            # Always log summary (truncated and redacted)
            safe_summary = self._redact_and_truncate(response, max_chars=100)
            logger.debug(f"Generated response: {safe_summary}... ({len(response)} chars)")
            
            return {
                "response": response,
                "thinking_content": thinking_content,
                "thinking_mode": enable_thinking,
                "quantum_influence": sampling_params["quantum_influence"],  # Use clamped value from sampling_params
                "temperature": sampling_params["temperature"],
                "top_p": sampling_params["top_p"],
                "top_k": sampling_params["top_k"],
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
        system_prompt = Config.AGENT_PROMPT
        result = self.generate(test_query, system_prompt, quantum_influence=0.5)
        return {
            "test_query": test_query,
            "result": result,
            "model_loaded": self.model is not None,
            "device": self.device,
            "memory_estimate_mb": self._estimate_memory()
        }
