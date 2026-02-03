"""
Base node class for execution engine
"""
from abc import ABC, abstractmethod
from typing import Dict, Any, Optional, List, TYPE_CHECKING
from dataclasses import dataclass, field
import copy
from ..types import NodeID, NodeData

if TYPE_CHECKING:
    from ..types import NodeGraph


@dataclass
class ExecutionContext:
    """Context passed to nodes during execution"""
    container: Any  # ServiceContainer
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
        Called by engine to allow nodes to set up relationships, hooks, etc.
        
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
        Called by engine to allow nodes to set up relationships, hooks, etc.
        
        Args:
            workflow: Workflow definition with nodes and connections
            all_nodes: Dictionary of all node instances (node_id -> node)
        """
        # Call initialize for backward compatibility
        self.initialize(workflow, all_nodes)