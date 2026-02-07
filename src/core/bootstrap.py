"""
Bootstrap module for Obelisk Core
Minimal initialization for node-based architecture
"""
from typing import Optional
import time
import threading

from .container import ServiceContainer
from .config import Config
from ..utils.logger import get_logger

logger = get_logger(__name__)

# Cache containers by mode (minimal containers)
_container_cache: dict[str, ServiceContainer] = {}
_container_lock = threading.Lock()


def get_container(
    mode: Optional[str] = None,
    *,
    enable_quantum: bool = True,
    force: bool = False
) -> ServiceContainer:
    """
    Build or retrieve cached minimal ServiceContainer
    
    In node-based architecture, nodes initialize their own dependencies.
    This container is minimal - just holds config/metadata.
    
    Args:
        mode: 'solo' or 'prod' (defaults to Config.MODE)
        enable_quantum: Whether to initialize quantum service (default: True)
        force: Force rebuild even if cached (default: False)
        
    Returns:
        Minimal ServiceContainer (nodes will initialize services as needed)
    """
    resolved_mode = mode or Config.MODE
    
    cache_key = f"{resolved_mode}:quantum={enable_quantum}"
    if not force:
        with _container_lock:
            if cache_key in _container_cache:
                logger.debug(f"Returning cached container for {cache_key}")
                return _container_cache[cache_key]
    
    with _container_lock:
        if not force and cache_key in _container_cache:
            logger.debug(f"Returning cached container for {cache_key} (built by another thread)")
            return _container_cache[cache_key]
        
        logger.info(f"Building minimal ServiceContainer for mode={resolved_mode}")
        
        # Create minimal container - nodes will initialize services as needed
        container = ServiceContainer(
            storage=None,  # Nodes will initialize if needed
            llm=None,  # InferenceConfigNode will initialize
            quantum_service=None,  # Quantum nodes will initialize if needed
            mode=resolved_mode,
            initialized_at=time.time()
        )
        
        # Optionally initialize quantum service if requested
        if enable_quantum and Config.IBM_QUANTUM_API_KEY:
            try:
                from ..quantum.ibm_quantum_service import IBMQuantumService
                container.quantum_service = IBMQuantumService(
                    api_key=Config.IBM_QUANTUM_API_KEY,
                    instance=Config.IBM_QUANTUM_INSTANCE
                )
                logger.debug("Quantum service initialized")
            except Exception as e:
                logger.warning(f"Failed to initialize quantum service: {e}")
                container.quantum_service = None
        
        _container_cache[cache_key] = container
        logger.info(f"Minimal ServiceContainer created for {cache_key}")
        
        return container


def clear_cache():
    """Clear container cache (useful for testing)"""
    global _container_cache
    with _container_lock:
        _container_cache.clear()
        logger.info("Container cache cleared")
