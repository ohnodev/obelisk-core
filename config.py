"""
Configuration for Obelisk Core
"""
import os
from pathlib import Path
from typing import Optional, List
from dotenv import load_dotenv

load_dotenv()


class Config:
    """Configuration class for Obelisk Core"""
    
    # Mode: "solo" or "prod"
    MODE: str = os.getenv("OBELISK_CORE_MODE", "solo")
    
    # Storage configuration
    STORAGE_PATH: Optional[str] = os.getenv("OBELISK_CORE_STORAGE_PATH")
    if STORAGE_PATH is None:
        STORAGE_PATH = str(Path.home() / ".obelisk-core" / "data")
    
    # Supabase configuration (for prod mode)
    SUPABASE_URL: Optional[str] = os.getenv("SUPABASE_URL") or os.getenv("NEXT_PUBLIC_SUPABASE_URL")
    SUPABASE_KEY: Optional[str] = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    
    # IBM Quantum configuration
    IBM_QUANTUM_API_KEY: Optional[str] = os.getenv("IBM_QUANTUM_API_KEY")
    IBM_QUANTUM_INSTANCE: Optional[str] = os.getenv("IBM_QUANTUM_INSTANCE")
    
    # Mistral AI configuration
    MISTRAL_API_KEY: Optional[str] = os.getenv("MISTRAL_API_KEY")
    MISTRAL_AGENT_ID: Optional[str] = os.getenv("MISTRAL_AGENT_ID")
    MISTRAL_EVOLUTION_AGENT_ID: Optional[str] = os.getenv("MISTRAL_EVOLUTION_AGENT_ID")
    
    # API server configuration
    API_HOST: str = os.getenv("OBELISK_CORE_HOST", "0.0.0.0")
    API_PORT: int = int(os.getenv("OBELISK_CORE_PORT", "7779"))
    
    # Debug mode (set OBELISK_CORE_DEBUG=true to enable)
    DEBUG: bool = os.getenv("OBELISK_CORE_DEBUG", "").lower() in ("true", "1", "yes")
    
    # LLM Configuration
    # Model name
    LLM_MODEL_NAME: str = os.getenv("OBELISK_CORE_LLM_MODEL", "Qwen/Qwen3-0.6B")
    
    # Context window limits (Qwen3-0.6B supports 32,768 tokens)
    LLM_MAX_CONTEXT_TOKENS: int = int(os.getenv("OBELISK_CORE_MAX_CONTEXT_TOKENS", "32768"))
    LLM_MAX_USER_QUERY_TOKENS: int = int(os.getenv("OBELISK_CORE_MAX_USER_QUERY_TOKENS", "2000"))
    LLM_MAX_CONVERSATION_CONTEXT_TOKENS: int = int(os.getenv("OBELISK_CORE_MAX_CONVERSATION_CONTEXT_TOKENS", "20000"))
    LLM_MAX_OUTPUT_TOKENS: int = int(os.getenv("OBELISK_CORE_MAX_OUTPUT_TOKENS", "1024"))
    LLM_MAX_OUTPUT_TOKENS_GPU: int = int(os.getenv("OBELISK_CORE_MAX_OUTPUT_TOKENS_GPU", "4096"))
    
    # Generation parameters (thinking mode defaults)
    LLM_TEMPERATURE_BASE: float = float(os.getenv("OBELISK_CORE_TEMPERATURE_BASE", "0.6"))
    LLM_TOP_P_BASE: float = float(os.getenv("OBELISK_CORE_TOP_P_BASE", "0.95"))
    LLM_TOP_K: int = int(os.getenv("OBELISK_CORE_TOP_K", "20"))
    LLM_REPETITION_PENALTY: float = float(os.getenv("OBELISK_CORE_REPETITION_PENALTY", "1.2"))
    
    # Quantum influence ranges (how much quantum can affect params)
    LLM_QUANTUM_TEMPERATURE_RANGE: float = float(os.getenv("OBELISK_CORE_QUANTUM_TEMP_RANGE", "0.1"))
    LLM_QUANTUM_TOP_P_RANGE: float = float(os.getenv("OBELISK_CORE_QUANTUM_TOP_P_RANGE", "0.05"))
    
    # LoRA Configuration
    LLM_LORA_R: int = int(os.getenv("OBELISK_CORE_LORA_R", "16"))
    LLM_LORA_ALPHA: int = int(os.getenv("OBELISK_CORE_LORA_ALPHA", "32"))
    LLM_LORA_DROPOUT: float = float(os.getenv("OBELISK_CORE_LORA_DROPOUT", "0.05"))
    LLM_LORA_TARGET_MODULES: List[str] = ["q_proj", "v_proj"]  # Can be overridden if needed
    
    # Agent Prompt
    AGENT_PROMPT: str = """You are The Overseer. Respond naturally to the user.

IMPORTANT: When memories are provided (as bullet points), you MUST use them to answer questions. Pay attention to facts, preferences, and information listed in the memories. If the user asks about something mentioned in the memories, recall it from there.

Do not use emojis in your responses."""
    
    # Stop sequences for conversation markers
    LLM_STOP_SEQUENCES: List[str] = [
        "\n\nUser:", "\n\nOverseer:", "\n\nThe Overseer:", "\n\nAssistant:",
        "\nUser:", "\nOverseer:", "\nThe Overseer:", "\nAssistant:",
        "User:", "Overseer:", "The Overseer:", "Assistant:"
    ]
    
    @classmethod
    def validate(cls) -> bool:
        """Validate configuration"""
        if cls.MODE == "prod":
            if not cls.SUPABASE_URL or not cls.SUPABASE_KEY:
                print("[CONFIG] Error: SUPABASE_URL and SUPABASE_KEY required for prod mode")
                return False
        return True
    
    @classmethod
    def get_storage(cls):
        """Get storage instance based on mode"""
        from src.storage import LocalJSONStorage, SupabaseStorage
        
        if cls.MODE == "prod":
            if not cls.SUPABASE_URL or not cls.SUPABASE_KEY:
                raise ValueError("SUPABASE_URL and SUPABASE_KEY required for prod mode")
            return SupabaseStorage(cls.SUPABASE_URL, cls.SUPABASE_KEY)
        else:
            return LocalJSONStorage(cls.STORAGE_PATH)
