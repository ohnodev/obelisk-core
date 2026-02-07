"""
Inference Client
HTTP client for the Obelisk Inference Service.
Drop-in replacement for ObeliskLLM — same .generate() interface,
but calls the inference service API instead of running the model locally.

NOTE: LoRA is not supported via the inference client yet.
When LoRA support is needed, it will require a /v1/lora/load endpoint
on the inference service. For now, LoRA is local-only.
"""
import logging
import os
from typing import Dict, Any, Optional, List

import requests

logger = logging.getLogger(__name__)


class InferenceClient:
    """
    HTTP client that mirrors the ObeliskLLM.generate() interface.
    
    Nodes (InferenceNode, BinaryIntentNode, TelegramMemoryCreatorNode)
    call model.generate() — they don't care whether 'model' is an
    ObeliskLLM instance or an InferenceClient. Same interface, same return dict.
    
    The endpoint URL is resolved in this order:
    1. INFERENCE_SERVICE_URL environment variable (useful for Docker containers
       where the host is reachable at host.docker.internal instead of localhost)
    2. Hardcoded default: http://localhost:7780
    """
    
    DEFAULT_ENDPOINT = os.getenv("INFERENCE_SERVICE_URL", "http://localhost:7780")
    REQUEST_TIMEOUT = 120  # seconds
    
    # Quantum influence → sampling parameter mapping
    # (mirrors ObeliskLLM._prepare_sampling_parameters logic)
    TEMPERATURE_BASE = 0.6
    TOP_P_BASE = 0.95
    TOP_K = 20
    REPETITION_PENALTY = 1.2
    QUANTUM_TEMP_RANGE = 0.1
    QUANTUM_TOP_P_RANGE = 0.05
    
    def __init__(self, endpoint_url: str = None):
        """
        Args:
            endpoint_url: Base URL of the inference service (e.g. http://localhost:7780)
        """
        self.endpoint_url = (endpoint_url or self.DEFAULT_ENDPOINT).rstrip("/")
        logger.info(f"InferenceClient initialized → {self.endpoint_url}")
    
    def _quantum_to_sampling_params(self, quantum_influence: float) -> Dict[str, float]:
        """
        Convert quantum_influence to concrete sampling parameters.
        Mirrors the logic from ObeliskLLM._prepare_sampling_parameters.
        
        Args:
            quantum_influence: Value from 0.0 to 0.1 (will be clamped)
            
        Returns:
            Dict with quantum_influence (clamped), temperature, top_p
        """
        qi = max(0.0, min(0.1, quantum_influence))
        
        temperature = self.TEMPERATURE_BASE + (qi * self.QUANTUM_TEMP_RANGE)
        top_p = self.TOP_P_BASE + (qi * self.QUANTUM_TOP_P_RANGE)
        
        # Clamp to safe ranges
        temperature = max(0.1, min(0.9, temperature))
        top_p = max(0.01, min(1.0, top_p))
        
        return {
            "quantum_influence": qi,
            "temperature": temperature,
            "top_p": top_p,
        }
    
    def generate(
        self,
        query: str,
        system_prompt: str,
        quantum_influence: float = 0.7,
        max_length: int = 1024,
        conversation_history: Optional[List[Dict[str, str]]] = None,
        enable_thinking: bool = True,
    ) -> Dict[str, Any]:
        """
        Generate a response via the inference service API.
        
        Same signature as ObeliskLLM.generate() so nodes work unchanged.
        
        Args:
            query: User's query
            system_prompt: System prompt
            quantum_influence: Quantum random value (0-0.1, will be clamped)
            max_length: Maximum response length in tokens
            conversation_history: Optional previous messages
            enable_thinking: Whether to enable Qwen3 thinking mode
            
        Returns:
            Dict with response, thinking_content, and metadata
            (same shape as ObeliskLLM.generate() return value)
        """
        # Map quantum_influence → sampling params
        sampling = self._quantum_to_sampling_params(quantum_influence)
        
        # Build request payload (matches InferenceRequest schema)
        payload = {
            "query": query,
            "system_prompt": system_prompt,
            "enable_thinking": enable_thinking,
            "max_tokens": max_length,
            "temperature": sampling["temperature"],
            "top_p": sampling["top_p"],
            "top_k": self.TOP_K,
            "repetition_penalty": self.REPETITION_PENALTY,
        }
        
        if conversation_history:
            payload["conversation_history"] = conversation_history
        
        try:
            resp = requests.post(
                f"{self.endpoint_url}/v1/inference",
                json=payload,
                timeout=self.REQUEST_TIMEOUT,
            )
            resp.raise_for_status()
            data = resp.json()
            
            # Map inference service response → ObeliskLLM-compatible dict
            gen_params = data.get("generation_params", {})
            
            return {
                "response": data.get("response", ""),
                "thinking_content": data.get("thinking_content", ""),
                "thinking_mode": enable_thinking,
                "quantum_influence": sampling["quantum_influence"],
                "temperature": gen_params.get("temperature", sampling["temperature"]),
                "top_p": gen_params.get("top_p", sampling["top_p"]),
                "top_k": gen_params.get("top_k", self.TOP_K),
                "source": data.get("source", "inference_service"),
                "model": data.get("model", ""),
                "tokens_used": data.get("input_tokens", 0) + data.get("output_tokens", 0),
                "error": data.get("error"),
            }
        
        except requests.exceptions.ConnectionError:
            logger.error(f"Inference service unreachable at {self.endpoint_url}")
            return {
                "response": "◊ Inference service unavailable. Is it running? ◊",
                "thinking_content": "",
                "thinking_mode": enable_thinking,
                "quantum_influence": sampling["quantum_influence"],
                "temperature": sampling["temperature"],
                "top_p": sampling["top_p"],
                "top_k": self.TOP_K,
                "source": "error_fallback",
                "model": "",
                "error": f"Connection refused: {self.endpoint_url}",
            }
        
        except requests.exceptions.Timeout:
            logger.error(f"Inference request timed out ({self.REQUEST_TIMEOUT}s)")
            return {
                "response": "◊ Inference request timed out. ◊",
                "thinking_content": "",
                "thinking_mode": enable_thinking,
                "quantum_influence": sampling["quantum_influence"],
                "temperature": sampling["temperature"],
                "top_p": sampling["top_p"],
                "top_k": self.TOP_K,
                "source": "error_fallback",
                "model": "",
                "error": f"Request timeout ({self.REQUEST_TIMEOUT}s)",
            }
        
        except requests.exceptions.HTTPError as e:
            status = e.response.status_code if e.response is not None else "unknown"
            detail = ""
            try:
                detail = e.response.json().get("detail", str(e))
            except Exception:
                detail = str(e)
            
            logger.error(f"Inference service HTTP error {status}: {detail}")
            return {
                "response": f"◊ Inference service error ({status}) ◊",
                "thinking_content": "",
                "thinking_mode": enable_thinking,
                "quantum_influence": sampling["quantum_influence"],
                "temperature": sampling["temperature"],
                "top_p": sampling["top_p"],
                "top_k": self.TOP_K,
                "source": "error_fallback",
                "model": "",
                "error": f"HTTP {status}: {detail}",
            }
        
        except Exception as e:
            logger.exception("Unexpected error calling inference service")
            return {
                "response": f"◊ Inference error: {str(e)[:100]} ◊",
                "thinking_content": "",
                "thinking_mode": enable_thinking,
                "quantum_influence": sampling["quantum_influence"],
                "temperature": sampling["temperature"],
                "top_p": sampling["top_p"],
                "top_k": self.TOP_K,
                "source": "error_fallback",
                "model": "",
                "error": str(e),
            }
    
    def health_check(self) -> Dict[str, Any]:
        """
        Check if the inference service is healthy.
        
        Returns:
            Health response dict or error dict
        """
        try:
            resp = requests.get(f"{self.endpoint_url}/health", timeout=10)
            resp.raise_for_status()
            return resp.json()
        except Exception as e:
            return {"status": "unreachable", "error": str(e)}
    
    def __repr__(self) -> str:
        return f"InferenceClient(endpoint={self.endpoint_url})"
