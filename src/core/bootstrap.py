"""
Bootstrap module for Obelisk Core
Provides centralized service initialization and dependency management

This module eliminates duplication between API and CLI initialization by
providing a single entry point to build all core services.
"""
from typing import Optional
import time
import threading

from .container import ServiceContainer
from .config import Config
from ..utils.logger import get_logger

logger = get_logger(__name__)

# Cache containers by mode to avoid rebuilding expensive services
_container_cache: dict[str, ServiceContainer] = {}
# Thread lock for thread-safe cache access and Config.MODE mutation
_container_lock = threading.Lock()


def get_container(
    mode: Optional[str] = None,
    *,
    enable_quantum: bool = True,
    force: bool = False
) -> ServiceContainer:
    """
    Build or retrieve cached ServiceContainer
    
    This is the single entry point for service initialization. It:
    - Resolves configuration and mode
    - Builds services in dependency order
    - Caches containers to avoid rebuilding expensive services
    - Handles optional services (quantum) gracefully
    
    Args:
        mode: 'solo' or 'prod' (defaults to Config.MODE)
        enable_quantum: Whether to initialize quantum service (default: True)
        force: Force rebuild even if cached (default: False)
        
    Returns:
        ServiceContainer with all services initialized
        
    Example:
        # CLI usage
        container = get_container(mode='solo')
        result = container.llm.generate("Hello")
        
        # API usage (with caching)
        container = get_container()  # Uses Config.MODE
    """
    # Resolve mode
    resolved_mode = mode or Config.MODE
    
    # Check cache (first check without lock for performance)
    cache_key = f"{resolved_mode}:quantum={enable_quantum}"
    if not force:
        with _container_lock:
            # Double-checked locking: check cache again after acquiring lock
            if cache_key in _container_cache:
                logger.debug(f"Returning cached container for {cache_key}")
                return _container_cache[cache_key]
    
    # Acquire lock for thread-safe container building and Config.MODE mutation
    with _container_lock:
        # Double-check cache again after acquiring lock (another thread might have built it)
        if not force and cache_key in _container_cache:
            logger.debug(f"Returning cached container for {cache_key} (built by another thread)")
            return _container_cache[cache_key]
        
        logger.info(f"Building ServiceContainer for mode={resolved_mode}, quantum={enable_quantum}")
        
        # Temporarily set Config.MODE to resolved_mode so get_storage() uses the correct mode
        # This ensures storage matches the resolved_mode used to build the ServiceContainer
        original_mode = Config.MODE
        Config.MODE = resolved_mode
        
        try:
            # Build services in dependency order
            # 1. Storage (no dependencies)
            storage = Config.get_storage()
            logger.debug("Storage initialized")
            
            # 2. LLM (depends on storage for LoRA weights)
            from ..llm.obelisk_llm import ObeliskLLM
            llm = ObeliskLLM(storage=storage)
            logger.debug("LLM initialized")
            
            # 3. Memory Manager (depends on storage and LLM)
            from ..memory.memory_manager import ObeliskMemoryManager
            memory_manager = ObeliskMemoryManager(
                storage=storage,
                llm=llm,
                mode=resolved_mode
            )
            logger.debug("Memory manager initialized")
            
            # 4. Quantum Service (optional, no dependencies)
            quantum_service = None
            if enable_quantum:
                try:
                    from ..quantum.ibm_quantum_service import IBMQuantumService
                    if Config.IBM_QUANTUM_API_KEY:
                        quantum_service = IBMQuantumService(
                            api_key=Config.IBM_QUANTUM_API_KEY,
                            instance=Config.IBM_QUANTUM_INSTANCE
                        )
                        logger.debug("Quantum service initialized")
                    else:
                        logger.debug("Quantum service skipped (no API key)")
                except Exception:
                    # Broad catch is intentional - quantum service is optional
                    # Log full traceback for debugging
                    logger.exception("Failed to initialize quantum service")
                    quantum_service = None
            
            # Create container
            container = ServiceContainer(
                storage=storage,
                llm=llm,
                memory_manager=memory_manager,
                quantum_service=quantum_service,
                mode=resolved_mode,
                initialized_at=time.time()
            )
            
            # Cache it
            _container_cache[cache_key] = container
            logger.info(f"ServiceContainer built and cached for {cache_key}")
            
            return container
        finally:
            # Restore original Config.MODE to avoid side effects
            Config.MODE = original_mode


def clear_cache():
    """Clear the container cache (useful for testing or forced rebuilds)"""
    global _container_cache
    with _container_lock:
        _container_cache.clear()
    logger.debug("Container cache cleared")
