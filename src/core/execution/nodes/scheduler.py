"""
Scheduler Node
Autonomous node that triggers connected nodes at random intervals
"""
import random
import time
from typing import Dict, Any, Optional

from ..node_base import BaseNode, ExecutionContext, ExecutionMode
from ....utils.logger import get_logger

logger = get_logger(__name__)


class SchedulerNode(BaseNode):
    """
    Scheduler node for autonomous workflow execution
    
    Fires a trigger signal at random intervals between min_seconds and max_seconds.
    Connected nodes will execute when the trigger fires.
    
    Properties (from metadata):
        min_seconds: Minimum interval between triggers (default: 5)
        max_seconds: Maximum interval between triggers (default: 10)
        enabled: Whether the scheduler is active (default: True)
    
    Outputs:
        trigger: Boolean signal (True when trigger fires)
        tick_count: Number of times the scheduler has fired
        timestamp: Unix timestamp of the trigger
    """
    
    # This is a CONTINUOUS node - it runs on every tick
    execution_mode = ExecutionMode.CONTINUOUS
    
    def __init__(self, node_id: str, node_data: Dict[str, Any]):
        super().__init__(node_id, node_data)
        
        # Get configuration from metadata
        self._min_seconds = float(self.metadata.get('min_seconds', 5.0))
        self._max_seconds = float(self.metadata.get('max_seconds', 10.0))
        self._enabled = self.metadata.get('enabled', True)
        
        # Validate
        if self._min_seconds > self._max_seconds:
            self._min_seconds, self._max_seconds = self._max_seconds, self._min_seconds
        
        # State
        self._last_fire_time: float = 0.0
        self._next_interval: float = self._generate_interval()
        self._fire_count: int = 0
        
        logger.debug(
            f"[Scheduler {node_id}] Initialized: "
            f"interval={self._min_seconds}-{self._max_seconds}s, "
            f"enabled={self._enabled}"
        )
    
    def _generate_interval(self) -> float:
        """Generate a random interval between min and max seconds"""
        return random.uniform(self._min_seconds, self._max_seconds)
    
    def execute(self, context: ExecutionContext) -> Dict[str, Any]:
        """
        Execute scheduler node (called once at workflow start)
        
        For continuous execution, use on_tick() instead.
        """
        # Initialize last fire time to now so we don't immediately fire
        self._last_fire_time = time.time()
        self._next_interval = self._generate_interval()
        
        return {
            'trigger': False,
            'tick_count': self._fire_count,
            'timestamp': time.time(),
            'next_fire_in': self._next_interval
        }
    
    def on_tick(self, context: ExecutionContext) -> Optional[Dict[str, Any]]:
        """
        Called on each tick to check if scheduler should fire
        
        Args:
            context: Execution context
            
        Returns:
            Output dict with trigger=True if firing, None otherwise
        """
        if not self._enabled:
            return None
        
        current_time = time.time()
        elapsed = current_time - self._last_fire_time
        
        # Check if interval has elapsed
        if elapsed >= self._next_interval:
            self._fire_count += 1
            self._last_fire_time = current_time
            self._next_interval = self._generate_interval()
            
            logger.info(
                f"[Scheduler {self.node_id}] Fired! "
                f"count={self._fire_count}, "
                f"next_in={self._next_interval:.2f}s"
            )
            
            return {
                'trigger': True,
                'tick_count': self._fire_count,
                'timestamp': current_time,
                'next_fire_in': self._next_interval
            }
        
        # Not time to fire yet
        return None
    
    def set_enabled(self, enabled: bool) -> None:
        """Enable or disable the scheduler"""
        self._enabled = enabled
        logger.info(f"[Scheduler {self.node_id}] {'Enabled' if enabled else 'Disabled'}")
    
    def reset(self) -> None:
        """Reset the scheduler state"""
        self._last_fire_time = time.time()
        self._next_interval = self._generate_interval()
        self._fire_count = 0
        logger.info(f"[Scheduler {self.node_id}] Reset")
    
    def get_status(self) -> Dict[str, Any]:
        """Get current scheduler status"""
        current_time = time.time()
        elapsed = current_time - self._last_fire_time
        time_until_next = max(0, self._next_interval - elapsed)
        
        return {
            'enabled': self._enabled,
            'fire_count': self._fire_count,
            'min_seconds': self._min_seconds,
            'max_seconds': self._max_seconds,
            'time_until_next': time_until_next,
            'last_fire_time': self._last_fire_time
        }
