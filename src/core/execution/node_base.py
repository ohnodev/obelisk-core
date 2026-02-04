"""
Base node class for execution engine
"""
from abc import ABC, abstractmethod
from typing import Dict, Any, Optional, List, TYPE_CHECKING
from dataclasses import dataclass, field
from enum import Enum
import copy
from ..types import NodeID, NodeData

if TYPE_CHECKING:
    from ..types import NodeGraph


class ExecutionMode(Enum):
    """
    Node execution modes for autonomous workflows
    
    ONCE: Execute once per workflow run (default behavior)
    CONTINUOUS: Keep executing on each tick (scheduler nodes)
    TRIGGERED: Execute only when trigger input fires
    """
    ONCE = "once"
    CONTINUOUS = "continuous"
    TRIGGERED = "triggered"


@dataclass
class ExecutionContext:
    """Context passed to nodes during execution"""
    container: Any = None  # Optional ServiceContainer (for backward compatibility, nodes should be self-contained)
    variables: Dict[str, Any] = field(default_factory=dict)  # Runtime variables (user_id, user_query, etc.)
    node_outputs: Dict[NodeID, Dict[str, Any]] = field(default_factory=dict)  # Cached outputs from previous nodes


class BaseNode(ABC):
    """
    Base class for all execution nodes
    
    Each node:
    - Has a unique ID
    - Defines inputs and outputs
    - Executes when all dependencies are met
    - Can access ServiceContainer and execution context
    """
    
    # Default execution mode for the node class (override in subclasses)
    execution_mode: ExecutionMode = ExecutionMode.ONCE
    
    def __init__(self, node_id: NodeID, node_data: NodeData):
        """
        Initialize node
        
        Args:
            node_id: Unique node identifier
            node_data: Node data from workflow JSON
        """
        self.node_id = node_id
        self.node_data = node_data
        self.node_type = node_data.get('type', '')
        # Deep copy inputs to prevent mutations from affecting original workflow
        self.inputs = copy.deepcopy(node_data.get('inputs', {}))
        self.position = node_data.get('position', {'x': 0, 'y': 0})
        self.metadata = node_data.get('metadata', {})
        # State for triggered nodes
        self._triggered = False
        self._last_trigger_value = None
    
    @abstractmethod
    def execute(self, context: ExecutionContext) -> Dict[str, Any]:
        """
        Execute the node
        
        Args:
            context: Execution context with container, variables, and node outputs
            
        Returns:
            Dictionary of output values (keys match output names)
        """
        pass
    
    def get_input_value(self, input_name: str, context: ExecutionContext, default: Any = None) -> Any:
        """
        Get input value, resolving connections from other nodes
        
        Args:
            input_name: Name of the input
            context: Execution context
            default: Default value if not found
            
        Returns:
            Resolved input value
        """
        # Check if input is connected to another node's output
        # For now, we'll resolve this in the engine
        # This method can be overridden for special handling
        
        # First check if it's a direct value in inputs
        if input_name in self.inputs:
            value = self.inputs[input_name]
            
            # Check if it's a template variable (e.g., "{{user_query}}")
            if isinstance(value, str) and value.startswith('{{') and value.endswith('}}'):
                var_name = value[2:-2].strip()
                return context.variables.get(var_name, default)
            
            return value
        
        return default
    
    def get_connected_input(self, input_name: str, context: ExecutionContext) -> Optional[Any]:
        """
        Get input value from connected node output
        
        Args:
            input_name: Name of the input
            context: Execution context with node outputs
            
        Returns:
            Value from connected node, or None if not connected
        """
        # This will be resolved by the engine based on connections
        # For now, return None - engine handles connection resolution
        return None
    
    def initialize(self, workflow: 'NodeGraph', all_nodes: Dict[NodeID, 'BaseNode']) -> None:
        """
        Initialize node after all nodes are built
        Called by engine to allow nodes to set up relationships if needed.
        
        Args:
            workflow: Workflow definition with nodes and connections
            all_nodes: Dictionary of all node instances (node_id -> node)
        """
        # Default implementation does nothing
        # Override in subclasses for custom initialization
        pass
    
    def _setup(self, workflow: 'NodeGraph', all_nodes: Dict[NodeID, 'BaseNode']) -> None:
        """
        Setup node after all nodes are built (alias for initialize for backward compatibility)
        Called by engine to allow nodes to set up relationships if needed.
        
        Args:
            workflow: Workflow definition with nodes and connections
            all_nodes: Dictionary of all node instances (node_id -> node)
        """
        # Call initialize for backward compatibility
        self.initialize(workflow, all_nodes)
    
    def is_autonomous(self) -> bool:
        """
        Check if this node runs autonomously (CONTINUOUS mode)
        
        Returns:
            True if node has CONTINUOUS execution mode
        """
        return self.execution_mode == ExecutionMode.CONTINUOUS
    
    def is_triggered(self) -> bool:
        """
        Check if this node is trigger-based (TRIGGERED mode)
        
        Returns:
            True if node has TRIGGERED execution mode
        """
        return self.execution_mode == ExecutionMode.TRIGGERED
    
    def set_triggered(self, value: bool = True) -> None:
        """
        Set the triggered state for this node
        
        Args:
            value: Whether the node has been triggered
        """
        self._triggered = value
    
    def check_and_clear_trigger(self) -> bool:
        """
        Check if node was triggered and clear the trigger state
        
        Returns:
            True if node was triggered (and clears the state)
        """
        was_triggered = self._triggered
        self._triggered = False
        return was_triggered
    
    def on_tick(self, context: ExecutionContext) -> Optional[Dict[str, Any]]:
        """
        Called on each tick for CONTINUOUS nodes
        Override in subclasses to implement tick behavior.
        
        Args:
            context: Execution context
            
        Returns:
            Output dict if node should fire this tick, None otherwise
        """
        # Default implementation does nothing
        # Override in CONTINUOUS nodes (like SchedulerNode)
        return None