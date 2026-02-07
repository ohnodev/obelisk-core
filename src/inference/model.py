"""
Inference Model
Loads and manages the LLM model for the inference service.
Clean extraction of model loading + generation from ObeliskLLM.
"""
import re
import sys
import logging
from typing import Dict, Any, Optional, List, Tuple

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer

from .config import InferenceConfig

logger = logging.getLogger("inference_service.model")


def _split_thinking_tokens(generated_tokens: List[int]) -> Tuple[List[int], List[int]]:
    """
    Split generated tokens into thinking tokens and content tokens.
    
    Per Qwen3 docs: token 151668 is the closing tag for thinking content (</think>).
    
    Args:
        generated_tokens: List of token IDs from model generation
        
    Returns:
        Tuple of (thinking_tokens, content_tokens)
    """
    end_token = 151668
    
    try:
        if end_token in generated_tokens:
            last = len(generated_tokens) - 1 - generated_tokens[::-1].index(end_token)
            thinking_tokens = generated_tokens[:last]
            content_tokens = generated_tokens[last + 1:]
            return thinking_tokens, content_tokens
        else:
            return [], generated_tokens
    except ValueError:
        return [], generated_tokens


class InferenceModel:
    """
    Manages the LLM for inference.
    
    Responsibilities:
    - Load and hold the model + tokenizer
    - Generate responses from prompts
    - Handle thinking mode parsing
    - Post-process output
    """
    
    def __init__(self):
        self.model = None
        self.tokenizer = None
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.model_name = InferenceConfig.MODEL_NAME
        self._loaded = False
    
    def load(self) -> bool:
        """
        Load the model and tokenizer.
        
        Returns:
            True if model loaded successfully, False otherwise
        """
        try:
            logger.info(f"Loading {self.model_name} on {self.device}...")
            
            # Load tokenizer
            self.tokenizer = AutoTokenizer.from_pretrained(
                self.model_name,
                local_files_only=False,
            )
            if self.tokenizer.pad_token is None:
                self.tokenizer.pad_token = self.tokenizer.eos_token
            
            # Try 4-bit quantization first, fall back to float16
            self.model = self._load_with_quantization()
            
            self.model.eval()
            
            # Try torch.compile on CPU for faster inference
            if self.device == "cpu":
                self._try_compile()
            
            self._loaded = True
            logger.info(f"Model loaded successfully. Memory: ~{self.estimate_memory()}MB")
            return True
            
        except Exception as e:
            logger.error(f"Error loading model: {e}")
            self.model = None
            self.tokenizer = None
            self._loaded = False
            return False
    
    def _load_with_quantization(self):
        """Try to load model with 4-bit quantization, fall back to float16"""
        try:
            from transformers import BitsAndBytesConfig
            
            quantization_config = BitsAndBytesConfig(
                load_in_4bit=True,
                bnb_4bit_compute_dtype=torch.float16,
                bnb_4bit_quant_type="nf4",
                bnb_4bit_use_double_quant=True,
            )
            
            model = AutoModelForCausalLM.from_pretrained(
                self.model_name,
                quantization_config=quantization_config,
                device_map="auto",
                torch_dtype=torch.float16,
                trust_remote_code=True,
                local_files_only=False,
            )
            logger.info("Model loaded with 4-bit quantization")
            return model
            
        except (ImportError, Exception) as e:
            logger.warning(f"4-bit quantization unavailable ({e}), loading in float16...")
            return AutoModelForCausalLM.from_pretrained(
                self.model_name,
                torch_dtype=torch.float16,
                device_map="auto",
                trust_remote_code=True,
                local_files_only=False,
            )
    
    def _try_compile(self):
        """Try to compile model for faster CPU inference"""
        if sys.version_info.major == 3 and sys.version_info.minor >= 14:
            logger.info("Skipping model compilation (not supported on Python 3.14+)")
            return
        
        try:
            if hasattr(torch, 'compile'):
                logger.info("Compiling model for faster CPU inference...")
                self.model = torch.compile(self.model, mode="reduce-overhead")
                logger.info("Model compiled successfully")
        except Exception as e:
            logger.warning(f"Model compilation failed: {e}")
    
    @property
    def is_loaded(self) -> bool:
        return self._loaded and self.model is not None and self.tokenizer is not None
    
    def estimate_memory(self) -> int:
        """Estimate model memory usage in MB"""
        if self.model is None:
            return 0
        try:
            param_count = sum(p.numel() for p in self.model.parameters())
            memory_mb = (param_count * 0.5) / (1024 * 1024)
            return int(memory_mb)
        except Exception:
            return 400
    
    def generate(
        self,
        query: str,
        system_prompt: str,
        conversation_history: Optional[List[Dict[str, str]]] = None,
        enable_thinking: bool = True,
        max_tokens: int = 1024,
        temperature: float = 0.6,
        top_p: float = 0.95,
        top_k: int = 20,
        repetition_penalty: float = 1.2,
    ) -> Dict[str, Any]:
        """
        Generate a response.
        
        Args:
            query: User query text
            system_prompt: System prompt
            conversation_history: Optional conversation messages
            enable_thinking: Whether to enable Qwen3 thinking mode
            max_tokens: Maximum output tokens
            temperature: Sampling temperature
            top_p: Top-p sampling
            top_k: Top-k sampling
            repetition_penalty: Repetition penalty
            
        Returns:
            Dict with response, thinking_content, metadata
        """
        if not self.is_loaded:
            return {
                "response": "",
                "thinking_content": "",
                "error": "Model not loaded",
                "source": "error",
                "model": self.model_name,
                "input_tokens": 0,
                "output_tokens": 0,
                "generation_params": {},
            }
        
        try:
            # Validate and clamp parameters
            temperature = max(0.01, min(2.0, temperature))
            top_p = max(0.01, min(1.0, top_p))
            top_k = max(1, min(200, top_k))
            repetition_penalty = max(1.0, min(3.0, repetition_penalty))
            max_tokens = max(1, min(InferenceConfig.MAX_OUTPUT_TOKENS_GPU if self.device == "cuda" else InferenceConfig.MAX_OUTPUT_TOKENS, max_tokens))
            
            # Validate and truncate query
            query, query_token_count = self._validate_query(query)
            
            # Clean conversation history (strip thinking tags from assistant msgs)
            history = self._clean_history(conversation_history or [])
            
            # Build messages
            messages = self._build_messages(query, history, system_prompt)
            
            # Apply chat template
            prompt_text = self.tokenizer.apply_chat_template(
                messages,
                tokenize=False,
                add_generation_prompt=True,
                enable_thinking=enable_thinking,
            )
            
            # Tokenize
            inputs = self.tokenizer([prompt_text], return_tensors="pt").to(self.model.device)
            input_token_count = inputs['input_ids'].shape[1]
            
            # Check context window
            available_tokens = InferenceConfig.MAX_CONTEXT_TOKENS - input_token_count
            if available_tokens <= 0:
                return {
                    "response": "",
                    "thinking_content": "",
                    "error": "Context window exceeded - input too long",
                    "source": "error",
                    "model": self.model_name,
                    "input_tokens": input_token_count,
                    "output_tokens": 0,
                    "generation_params": {},
                }
            
            safe_max_tokens = min(max_tokens, available_tokens)
            
            # Generate
            generated_tokens = self._generate_tokens(
                inputs, safe_max_tokens, enable_thinking,
                temperature, top_p, top_k, repetition_penalty,
            )
            output_token_count = len(generated_tokens)
            
            # Parse thinking vs content
            thinking_content, raw_content = self._parse_thinking(generated_tokens, enable_thinking)
            
            # Post-process
            response = self._post_process(raw_content)
            
            return {
                "response": response,
                "thinking_content": thinking_content,
                "error": None,
                "source": "inference_service",
                "model": self.model_name,
                "input_tokens": input_token_count,
                "output_tokens": output_token_count,
                "generation_params": {
                    "temperature": temperature,
                    "top_p": top_p,
                    "top_k": top_k,
                    "repetition_penalty": repetition_penalty,
                    "enable_thinking": enable_thinking,
                    "max_tokens": safe_max_tokens,
                },
            }
            
        except Exception as e:
            logger.exception("Error during generation")
            return {
                "response": "",
                "thinking_content": "",
                "error": str(e),
                "source": "error",
                "model": self.model_name,
                "input_tokens": 0,
                "output_tokens": 0,
                "generation_params": {},
            }
    
    def _validate_query(self, query: str) -> Tuple[str, int]:
        """Validate and truncate query if too long"""
        tokens = self.tokenizer.encode(query, add_special_tokens=False)
        if len(tokens) > InferenceConfig.MAX_USER_QUERY_TOKENS:
            logger.warning(f"Query too long ({len(tokens)} tokens), truncating to {InferenceConfig.MAX_USER_QUERY_TOKENS}")
            tokens = tokens[:InferenceConfig.MAX_USER_QUERY_TOKENS]
            query = self.tokenizer.decode(tokens, skip_special_tokens=True)
        return query, len(tokens)
    
    def _clean_history(self, history: List[Dict[str, str]]) -> List[Dict[str, str]]:
        """Remove thinking content from assistant messages in history"""
        cleaned = []
        for msg in history:
            if msg.get("role") == "assistant":
                content = msg.get("content", "")
                content = re.sub(r'<think>.*?</think>', '', content, flags=re.DOTALL | re.IGNORECASE)
                content = content.strip()
                if content:
                    cleaned.append({"role": "assistant", "content": content})
            else:
                cleaned.append(msg)
        return cleaned
    
    def _build_messages(
        self, query: str, history: List[Dict[str, str]], system_prompt: str
    ) -> List[Dict[str, str]]:
        """Build Qwen3 chat template messages"""
        return [
            {"role": "system", "content": system_prompt},
            *history,
            {"role": "user", "content": query},
        ]
    
    def _generate_tokens(
        self,
        inputs,
        max_output_tokens: int,
        enable_thinking: bool,
        temperature: float,
        top_p: float,
        top_k: int,
        repetition_penalty: float,
    ) -> List[int]:
        """Run model.generate and return new token IDs"""
        generate_kwargs = {
            **inputs,
            "max_new_tokens": max_output_tokens,
            "do_sample": True,
            "temperature": temperature,
            "top_p": top_p,
            "top_k": top_k,
            "pad_token_id": self.tokenizer.eos_token_id,
            "eos_token_id": self.tokenizer.eos_token_id,
            "repetition_penalty": repetition_penalty,
            "use_cache": True,
            "num_beams": 1,
        }
        
        # min_p support (transformers 4.36.0+)
        try:
            import transformers
            version_parts = transformers.__version__.split('.')
            if len(version_parts) >= 2:
                major, minor = int(version_parts[0]), int(version_parts[1])
                if major > 4 or (major == 4 and minor >= 36):
                    generate_kwargs["min_p"] = 0.0
        except (ImportError, ValueError, AttributeError):
            pass
        
        with torch.inference_mode():
            outputs = self.model.generate(**generate_kwargs)
        
        input_length = inputs['input_ids'].shape[1]
        return outputs[0][input_length:].tolist()
    
    def _parse_thinking(
        self, generated_tokens: List[int], enable_thinking: bool
    ) -> Tuple[str, str]:
        """Parse thinking and content from generated tokens"""
        if enable_thinking:
            thinking_tokens, content_tokens = _split_thinking_tokens(generated_tokens)
            thinking_content = self.tokenizer.decode(thinking_tokens, skip_special_tokens=True).strip("\n") if thinking_tokens else ""
            final_content = self.tokenizer.decode(content_tokens, skip_special_tokens=True).strip("\n") if content_tokens else ""
        else:
            thinking_content = ""
            final_content = self.tokenizer.decode(generated_tokens, skip_special_tokens=True).strip("\n")
        
        return thinking_content, final_content
    
    def _post_process(self, raw_response: str) -> str:
        """Clean up model output - remove conversation markers, artifacts"""
        response = raw_response
        
        # Remove everything after conversation markers
        for marker in InferenceConfig.STOP_SEQUENCES:
            marker_clean = marker.strip()
            if not marker_clean:
                continue
            if marker_clean.lower() in response.lower():
                pattern = re.compile(re.escape(marker_clean), re.IGNORECASE)
                match = pattern.search(response)
                if match:
                    response = response[:match.start()].strip()
        
        # Remove trailing artifacts that look like conversation markers
        if response:
            last_end = max(response.rfind('.'), response.rfind('!'), response.rfind('?'))
            if last_end > 0 and last_end < len(response) - 10:
                after = response[last_end + 1:].strip().lower()
                if any(kw in after for kw in ['user:', 'assistant:', 'overseer:']):
                    response = response[:last_end + 1].strip()
        
        # Normalize whitespace
        response = re.sub(r'[ \t]{3,}', ' ', response)
        response = re.sub(r'\n{3,}', '\n\n', response)
        response = response.strip()
        
        return response
