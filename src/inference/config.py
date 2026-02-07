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
    
    # Debug
    DEBUG: bool = os.getenv("INFERENCE_DEBUG", "").lower() in ("true", "1", "yes")
    
    # Stop sequences
    STOP_SEQUENCES: List[str] = [
        "\n\nUser:", "\n\nOverseer:", "\n\nThe Overseer:", "\n\nAssistant:",
        "\nUser:", "\nOverseer:", "\nThe Overseer:", "\nAssistant:",
        "User:", "Overseer:", "The Overseer:", "Assistant:"
    ]
