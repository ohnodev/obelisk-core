"""
Configuration for Obelisk Core
"""
import os
from pathlib import Path
from typing import Optional
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
