"""
The Obelisk LLM Service
Hosts a small quantized LLM for The Obelisk AGI
Uses Qwen3-0.6B with thinking mode support for enhanced reasoning
Supports LoRA fine-tuning with weights stored via storage abstraction
"""
import os
import sys
import re
from typing import Dict, Any, Optional, List, Tuple
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer, StoppingCriteria, StoppingCriteriaList, TrainingArguments, Trainer
from peft import LoraConfig, get_peft_model, PeftModel
import warnings
import io
import pickle

# Add parent directory to path for config import
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))
from config import Config

warnings.filterwarnings("ignore")


class ConversationStopCriteria(StoppingCriteria):
    """Stop generation when conversation markers appear"""
    def __init__(self, tokenizer, stop_sequences: List[str], input_length: int):
        self.tokenizer = tokenizer
        self.input_length = input_length
        # Tokenize all stop sequences and store their token IDs
        self.stop_token_ids = []
        for seq in stop_sequences:
            tokens = tokenizer.encode(seq, add_special_tokens=False)
            if tokens:
                self.stop_token_ids.append(tokens)
    
    def __call__(self, input_ids: torch.LongTensor, scores: torch.FloatTensor, **kwargs) -> bool:
        # Only check the newly generated tokens (skip input)
        if input_ids.shape[1] <= self.input_length:
            return False
        
        generated_tokens = input_ids[0][self.input_length:].tolist()
        
        # Decode the entire generated text to check for conversation markers
        # This is more reliable than token matching since tokenization can vary
        if len(generated_tokens) > 0:
            generated_text = self.tokenizer.decode(generated_tokens, skip_special_tokens=False)
            
            # Check for conversation markers only (industry standard)
            stop_patterns = [
                "User:", "Overseer:", "The Overseer:", "Assistant:",
                "\n\nUser:", "\n\nOverseer:", "\n\nThe Overseer:", "\n\nAssistant:",
                "\nUser:", "\nOverseer:", "\nThe Overseer:", "\nAssistant:"
            ]
            
            # Stop immediately if we see any of these patterns
            for pattern in stop_patterns:
                if pattern.lower() in generated_text.lower():
                    return True
        
        return False

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
        self.lora_model = None
        self.current_weights_cycle = None
        self.storage = storage
        self._load_model()

    def _load_model(self):
        """Load quantized Qwen3-0.6B model"""
        try:
            model_name = self.MODEL_NAME
            print(f"Loading {model_name} on {self.device}...")
            
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
                print("Model loaded with 4-bit quantization")
            except ImportError:
                print("bitsandbytes not available, loading in float16...")
                # Fallback to float16 if bitsandbytes not installed
                self.model = AutoModelForCausalLM.from_pretrained(
                    model_name,
                    dtype=torch.float16,
                    device_map="auto",
                    trust_remote_code=True,
                    local_files_only=False  # Allow download on first run
                )
            except Exception as e:
                print(f"4-bit quantization failed: {e}, loading in float16...")
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
            
            # Try to load LoRA weights from storage if available
            if self.storage:
                self._load_lora_weights()
            
            # Optimize model for inference on CPU
            if self.device == "cpu":
                # Try to compile model for faster inference (PyTorch 2.0+)
                # Note: torch.compile is not supported on Python 3.14+
                import sys
                python_version = sys.version_info
                if python_version.major == 3 and python_version.minor >= 14:
                    print("Skipping model compilation (not supported on Python 3.14+)")
                else:
                    try:
                        if hasattr(torch, 'compile'):
                            print("Compiling model for faster CPU inference...")
                            self.model = torch.compile(self.model, mode="reduce-overhead")
                            print("Model compiled successfully")
                    except Exception as e:
                        print(f"Model compilation not available or failed: {e}")
            
            print(f"Model loaded successfully. Memory: ~{self._estimate_memory()}MB")
            
        except Exception as e:
            print(f"Error loading model: {e}")
            self.model = None
            self.tokenizer = None
    
    def _load_lora_weights(self):
        """Load LoRA weights from storage if available"""
        if not self.storage:
            return
        
        try:
            weights_data = self.storage.get_latest_model_weights(self.MODEL_NAME)
            if weights_data and weights_data.get('lora_weights'):
                print(f"[LLM] Loading LoRA weights from cycle {weights_data.get('cycle_number')}, version {weights_data.get('version')}")
                
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
                
                # Use LoRA model for inference
                self.model = self.lora_model
                self.current_weights_cycle = weights_data.get('cycle_number')
                
                print(f"[LLM] LoRA weights loaded successfully from cycle {self.current_weights_cycle}")
            else:
                print("[LLM] No LoRA weights found in storage, using base model")
        except Exception as e:
            print(f"[LLM] Error loading LoRA weights: {e}")
            import traceback
            traceback.print_exc()
    
    def save_lora_weights(self, cycle_number: int, evolution_score: float, interactions_used: int, metadata: Optional[Dict[str, Any]] = None) -> Optional[str]:
        """Save current LoRA weights to storage"""
        if not self.storage:
            print("[LLM] No storage configured, cannot save LoRA weights")
            return None
        
        try:
            if self.lora_model is None:
                print("[LLM] No LoRA model to save, creating new LoRA adapter...")
                # Create LoRA adapter if it doesn't exist
                self.lora_model = get_peft_model(self.model, self.lora_config)
            
            # Get state dict from LoRA adapter
            state_dict = self.lora_model.state_dict()
            
            # Serialize to bytes
            buffer = io.BytesIO()
            pickle.dump(state_dict, buffer)
            lora_weights_bytes = buffer.getvalue()
            
            # Save to storage
            weight_id = self.storage.save_lora_weights(
                cycle_number=cycle_number,
                lora_weights=lora_weights_bytes,
                evolution_score=evolution_score,
                interactions_used=interactions_used,
                metadata=metadata
            )
            
            if weight_id:
                self.current_weights_cycle = cycle_number
                print(f"[LLM] LoRA weights saved successfully for cycle {cycle_number}")
                return weight_id
            else:
                print("[LLM] Failed to save LoRA weights")
                return None
        except Exception as e:
            print(f"[LLM] Error saving LoRA weights: {e}")
            import traceback
            traceback.print_exc()
            return None
    
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
        try:
            from datasets import Dataset
            
            if not training_data or len(training_data) < 5:
                return {"error": "Need at least 5 training examples"}
            
            print(f"[LLM] Starting LoRA fine-tuning on {len(training_data)} examples...")
            
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
            
            # Update model reference
            self.model = self.lora_model
            self.model.eval()
            
            print(f"[LLM] Fine-tuning completed. Loss: {train_result.training_loss:.4f}")
            
            return {
                "success": True,
                "training_loss": train_result.training_loss,
                "examples_trained": len(training_data),
                "epochs": epochs
            }
            
        except Exception as e:
            print(f"[LLM] Error during fine-tuning: {e}")
            import traceback
            traceback.print_exc()
            return {"error": str(e)}

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

    def generate(self, query: str, quantum_influence: float = 0.7, max_length: int = 1024, conversation_context: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        Generate response from The Obelisk (always uses thinking mode for best quality)
        
        Args:
            query: User's query
            quantum_influence: Quantum random value (0-1) to influence creativity
            max_length: Maximum response length
            conversation_context: Dict with 'messages' (list of message dicts) and 'memories' (string)
                                 Format: {"messages": [{"role": "user", "content": "..."}, ...], "memories": "..."}
        
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
            
            # Apply quantum influence (ranges from config)
            temperature = base_temp + (quantum_influence * Config.LLM_QUANTUM_TEMPERATURE_RANGE)
            top_p = base_top_p + (quantum_influence * Config.LLM_QUANTUM_TOP_P_RANGE)
            
            # Validate and truncate user query if too long
            query_tokens = self.tokenizer.encode(query, add_special_tokens=False)
            if len(query_tokens) > self.MAX_USER_QUERY_TOKENS:
                print(f"[LLM] User query too long ({len(query_tokens)} tokens), truncating to {self.MAX_USER_QUERY_TOKENS} tokens")
                truncated_tokens = query_tokens[:self.MAX_USER_QUERY_TOKENS]
                query = self.tokenizer.decode(truncated_tokens, skip_special_tokens=True)
                query_tokens = truncated_tokens
            
            # Build prompt with conversation context if provided
            # Qwen3 expects conversation history as message entries, not strings
            system_prompt = self.get_system_prompt()
            system_tokens = len(self.tokenizer.encode(system_prompt, add_special_tokens=False))
            
            # Parse conversation context (new format: dict with 'messages' and 'memories')
            # Qwen3 expects conversation history as message entries, not strings
            conversation_history = []  # List of {"role": "user"/"assistant", "content": "..."}
            memories_text = ""  # Memories and user context (stays in system message)
            
            if conversation_context:
                # Handle both new dict format and old string format (backward compatibility)
                if isinstance(conversation_context, dict):
                    # New format: {"messages": [...], "memories": "..."}
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
                elif isinstance(conversation_context, str):
                    # Old format: string (for backward compatibility during transition)
                    # This should not happen in normal operation, but handle gracefully
                    print("[LLM] WARNING: Received string format conversation_context, expected dict. This is deprecated.")
                    memories_text = conversation_context  # Fallback: put entire string in memories
            
            # Build system message (system prompt + memories)
            system_content = system_prompt
            memories_tokens = 0
            if memories_text:
                system_content = f"{system_prompt}\n\n{memories_text}"
                memories_tokens = len(self.tokenizer.encode(memories_text, add_special_tokens=False))
            
            # Calculate token limits for conversation history
            # Reserve: system + memories + query + output + buffer
            system_content_tokens = len(self.tokenizer.encode(system_content, add_special_tokens=False))
            available_for_history = self.MAX_CONTEXT_TOKENS - system_content_tokens - len(query_tokens) - self.MAX_OUTPUT_TOKENS - 50
            max_history_tokens = min(self.MAX_CONVERSATION_CONTEXT_TOKENS, available_for_history)
            
            # Truncate conversation history if needed (keep most recent messages)
            original_history_count = len(conversation_history)
            if conversation_history and max_history_tokens > 0:
                # Estimate tokens for each message and keep most recent
                history_tokens = 0
                kept_messages = []
                
                # Count backwards from most recent
                for msg in reversed(conversation_history):
                    msg_text = f"{msg['role']}: {msg['content']}"
                    msg_tokens = len(self.tokenizer.encode(msg_text, add_special_tokens=False))
                    
                    if history_tokens + msg_tokens <= max_history_tokens:
                        kept_messages.insert(0, msg)  # Insert at beginning to maintain order
                        history_tokens += msg_tokens
                    else:
                        break
                
                conversation_history = kept_messages
                if len(kept_messages) < original_history_count:
                    print(f"[LLM] Truncated conversation history: kept {len(kept_messages)}/{original_history_count} messages")
            elif max_history_tokens <= 0:
                print(f"[LLM] Not enough tokens for conversation history, skipping it")
                conversation_history = []
            
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
            
            # Apply Qwen3 chat template with thinking mode (always enabled)
            prompt_text = self.tokenizer.apply_chat_template(
                messages,
                tokenize=False,
                add_generation_prompt=True,
                enable_thinking=True  # Always use thinking mode for best quality
            )
            
            # Debug: Show full prompt
            if Config.DEBUG:
                print("\n" + "="*80)
                print("[DEBUG] Full prompt sent to LLM (thinking_mode=True):")
                print("="*80)
                print(prompt_text)
                print("="*80 + "\n")
            
            # Tokenize and check total input size
            inputs = self.tokenizer([prompt_text], return_tensors="pt").to(self.model.device)
            input_token_count = inputs['input_ids'].shape[1]
            
            # Log token usage
            history_token_count = sum(
                len(self.tokenizer.encode(f"{msg['role']}: {msg['content']}", add_special_tokens=False))
                for msg in conversation_history
            )
            memories_token_count = len(self.tokenizer.encode(memories_text, add_special_tokens=False)) if memories_text else 0
            print(f"[LLM] Input tokens: {input_token_count} (system: {system_content_tokens}, history: {history_token_count}, memories: {memories_token_count}, query: {len(query_tokens)}, messages: {len(conversation_history)})")
            
            # Check if total (input + output) will exceed context window
            total_tokens_after_generation = input_token_count + self.MAX_OUTPUT_TOKENS
            if total_tokens_after_generation > self.MAX_CONTEXT_TOKENS:
                print(f"[LLM] WARNING: Total tokens ({total_tokens_after_generation}) would exceed context limit ({self.MAX_CONTEXT_TOKENS})")
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
            
            # Create stopping criteria to prevent conversation markers (loaded from config)
            stop_sequences = Config.LLM_STOP_SEQUENCES
            stopping_criteria = ConversationStopCriteria(self.tokenizer, stop_sequences, input_token_count)
            stopping_criteria_list = StoppingCriteriaList([stopping_criteria])
            
            # Generate with Qwen3 recommended sampling parameters
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
                    repetition_penalty=Config.LLM_REPETITION_PENALTY,
                    use_cache=True,
                    num_beams=1,
                    stopping_criteria=stopping_criteria_list
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
                    if Config.DEBUG:
                        print(f"[DEBUG] No thinking token (151668) found in output")
            except ValueError:
                # Token not found, decode everything
                final_content = self.tokenizer.decode(generated_tokens, skip_special_tokens=True).strip("\n")
                if Config.DEBUG:
                    print(f"[DEBUG] Error finding thinking token, using full output")
            
            raw_response = final_content
            
            # Debug: Show raw response before post-processing
            if Config.DEBUG:
                print("\n" + "="*80)
                print("[DEBUG] Raw response from LLM (before post-processing):")
                print("="*80)
                print(repr(raw_response))  # Use repr to show exact characters
                print("="*80 + "\n")
            
            response = raw_response
            
            # Safety check: Remove any conversation markers and training artifacts that might have slipped through
<<<<<<< HEAD
=======
            # Note: We trust Qwen3's official extraction method (token 151668), so we don't truncate
            # at double newlines as they're often part of valid formatted responses (LaTeX, paragraphs, etc.)
            import re
>>>>>>> main
            
            # Remove everything after conversation markers (User:, Overseer:, The Overseer:, Assistant:)
            for marker in ['User:', 'Overseer:', 'The Overseer:', 'Assistant:']:
                if marker.lower() in response.lower():
                    # Find the marker (case-insensitive)
                    pattern = re.compile(re.escape(marker), re.IGNORECASE)
                    match = pattern.search(response)
                    if match:
                        response = response[:match.start()].strip()
                        print(f"[LLM] Removed conversation marker '{marker}' from response (safety check)")
            
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
                        print(f"[LLM] Removed trailing content with conversation markers (safety check)")
            
            # Preserve paragraph structure - only normalize excessive whitespace (3+ spaces/newlines)
            # This preserves LaTeX formatting and paragraph breaks while cleaning up artifacts
            response = re.sub(r'[ \t]{3,}', ' ', response)  # Multiple spaces/tabs -> single space
            response = re.sub(r'\n{3,}', '\n\n', response)  # 3+ newlines -> double newline
            response = response.strip()
            
            # Debug: Show final processed response
            if Config.DEBUG:
                print("\n" + "="*80)
                print("[DEBUG] Final processed response:")
                print("="*80)
                print(repr(response))
                print("="*80 + "\n")
            
            print(f"[LLM] Generated response: {response[:100]}... ({len(response)} chars)")
            
            # Fallback if empty
            if not response or len(response.strip()) < 3:
                print(f"[LLM DEBUG] Response too short ({len(response)} chars), using fallback")
                response = "◊ The Overseer processes your query. ◊"
            
            return {
                "response": response,
                "thinking_content": thinking_content,
                "thinking_mode": True,  # Always enabled
                "quantum_influence": quantum_influence,
                "temperature": temperature,
                "top_p": top_p,
                "top_k": top_k,
                "source": "obelisk_llm",
                "model": self.MODEL_NAME
            }
            
        except Exception as e:
            print(f"Error generating response: {e}")
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
