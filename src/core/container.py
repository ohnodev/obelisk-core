"""
Service Container
Minimal container for node-based architecture
Nodes initialize their own dependencies as needed
"""
from dataclasses import dataclass
from typing import Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from ..storage.base import StorageInterface
    from ..core.execution.nodes.inference.obelisk_llm import ObeliskLLM
    from ..quantum.ibm_quantum_service import IBMQuantumService


@dataclass
class ServiceContainer:
    """
    Minimal container for node-based architecture
    
    In a fully node-based architecture, nodes initialize their own dependencies.
    This container is minimal - it may hold config or be empty.
    Nodes can access it to share state if needed.
    """
    # Optional services that nodes can initialize and cache
    storage: Optional['StorageInterface'] = None
    llm: Optional['ObeliskLLM'] = None
    quantum_service: Optional['IBMQuantumService'] = None
    
    # Metadata
    mode: str = "solo"
    initialized_at: Optional[float] = None
    
    def __post_init__(self):
        """Set initialization timestamp if not provided"""
        if self.initialized_at is None:
            import time
            self.initialized_at = time.time()
