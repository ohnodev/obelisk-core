"""
Service Container
Holds all core services in a single, testable container
"""
from dataclasses import dataclass
from typing import Optional, TYPE_CHECKING

if TYPE_CHECKING:
    # Import concrete types for runtime type checking
    from ..storage.base import StorageInterface
    from ..llm.obelisk_llm import ObeliskLLM
    from ..memory.buffer_manager import RecentBufferManager
    from ..quantum.ibm_quantum_service import IBMQuantumService


@dataclass
class ServiceContainer:
    """
    Container holding all core services for Obelisk Core
    
    This provides a single source of truth for service instances,
    eliminating duplication between API and CLI initialization.
    """
    storage: 'StorageInterface'
    llm: 'ObeliskLLM'
    memory_selector: Any  # MemorySelectorWrapper (from bootstrap)
    memory_creator: Any  # MemoryCreatorWrapper (from bootstrap)
    buffer_manager: 'RecentBufferManager'
    quantum_service: Optional['IBMQuantumService'] = None
    
    # Metadata
    mode: str = "solo"
    initialized_at: Optional[float] = None
    
    def __post_init__(self):
        """Set initialization timestamp if not provided"""
        if self.initialized_at is None:
            import time
            self.initialized_at = time.time()
