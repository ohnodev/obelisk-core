"""
Configuration for the Inference Service
"""
import os
from typing import List
from dotenv import load_dotenv

load_dotenv()


class InferenceConfig:
    """Configuration for the standalone inference service"""
    
    # Server
    # Default to localhost so the service is NOT publicly exposed.
    # Set INFERENCE_HOST=0.0.0.0 explicitly to bind to all interfaces
    # (required for Docker / remote access).
    HOST: str = os.getenv("INFERENCE_HOST", "127.0.0.1")
    PORT: int = int(os.getenv("INFERENCE_PORT", "7780"))
    
    # Backend: "transformers" (default) or "vllm". vLLM requires vllm>=0.8.5 for Qwen3.
    INFERENCE_BACKEND: str = os.getenv("INFERENCE_BACKEND", "transformers").lower()

    # vLLM engine options (reduce memory on smaller GPUs, e.g. T4)
    VLLM_GPU_MEMORY_UTILIZATION: float = float(os.getenv("VLLM_GPU_MEMORY_UTILIZATION", "0.85"))
    VLLM_MAX_NUM_SEQS: int = int(os.getenv("VLLM_MAX_NUM_SEQS", "64"))

    # Model
    MODEL_NAME: str = os.getenv("INFERENCE_MODEL", "Qwen/Qwen3-0.6B")
    
    # Context window limits (Qwen3-0.6B supports 32,768 tokens)
    MAX_CONTEXT_TOKENS: int = int(os.getenv("INFERENCE_MAX_CONTEXT_TOKENS", "32768"))
    MAX_OUTPUT_TOKENS: int = int(os.getenv("INFERENCE_MAX_OUTPUT_TOKENS", "1024"))
    MAX_OUTPUT_TOKENS_GPU: int = int(os.getenv("INFERENCE_MAX_OUTPUT_TOKENS_GPU", "4096"))
    MAX_USER_QUERY_TOKENS: int = int(os.getenv("INFERENCE_MAX_USER_QUERY_TOKENS", "2000"))
    
    # Queue
    MAX_QUEUE_SIZE: int = int(os.getenv("INFERENCE_MAX_QUEUE_SIZE", "100"))
    REQUEST_TIMEOUT: int = int(os.getenv("INFERENCE_REQUEST_TIMEOUT", "120"))
    
    # CORS — allowed origins for browser-based requests.
    # Server-to-server calls (InferenceClient) are NOT affected by CORS.
    # Override with INFERENCE_CORS_ORIGINS (comma-separated) in production.
    # Default includes the production domain and common local dev origins.
    CORS_ORIGINS: List[str] = [
        o.strip() for o in os.getenv(
            "INFERENCE_CORS_ORIGINS",
            "https://build.theobelisk.ai,https://trade.deepentryai.com,http://localhost:3000,http://localhost:7779,http://127.0.0.1:3000,http://127.0.0.1:7779"
        ).split(",") if o.strip()
    ]
    
    # API Key — if set, all /v1/* endpoints require this key via
    # the Authorization header: "Bearer <key>" or X-API-Key header.
    # Leave empty/unset to disable auth (local dev).
    API_KEY: str = os.getenv("INFERENCE_API_KEY", "")
    
    # Debug
    DEBUG: bool = os.getenv("INFERENCE_DEBUG", "").lower() in ("true", "1", "yes")
    
    # Stop sequences
    STOP_SEQUENCES: List[str] = [
        "\n\nUser:", "\n\nOverseer:", "\n\nThe Overseer:", "\n\nAssistant:",
        "\nUser:", "\nOverseer:", "\nThe Overseer:", "\nAssistant:",
        "User:", "Overseer:", "The Overseer:", "Assistant:"
    ]
