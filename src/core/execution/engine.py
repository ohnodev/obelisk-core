"""
Execution Engine for Obelisk Core
Executes node-based workflows (similar to ComfyUI)
"""
from typing import Dict, Any, List, Optional, Set
from collections import defaultdict, deque
from ..types import NodeGraph, NodeID, ConnectionData, NodeData, GraphExecutionResult, NodeExecutionResult
from .node_base import BaseNode, ExecutionContext
from .node_registry import get_node_class
from ..container import ServiceContainer
from ...utils.logger import get_logger
import time

logger = get_logger(__name__)


class CycleError(ValueError):
    """Raised when a cycle is detected in the workflow graph"""
    pass


class ExecutionEngine:
    """
    Executes JSON workflow graphs
    
    Features:
    - Topological sort for execution order
    - Dependency resolution
    - Connection handling between nodes
    - State management across execution
    """
    
    def __init__(self, container: Optional[ServiceContainer] = None):
        """
        Initialize execution engine
        
        Args:
            container: Optional ServiceContainer (for backward compatibility, nodes should be self-contained)
        """
        self.container = container
    
    def execute(self, workflow: NodeGraph, context_variables: Optional[Dict[str, Any]] = None) -> GraphExecutionResult:
        """
        Execute a workflow graph
        
        Args:
            workflow: NodeGraph definition (from JSON)
            context_variables: Runtime variables (e.g., {"user_id": "cli_user", "user_query": "Hello"})
            
        Returns:
            GraphExecutionResult with execution results
        """
        start_time = time.time()
        context_variables = context_variables or {}
        
        logger.info(f"Executing workflow: {workflow.get('name', workflow.get('id', 'unknown'))}")
        
        # Validate graph
        if not self.validate_graph(workflow):
            return GraphExecutionResult(
                graph_id=workflow.get('id', 'unknown'),
                success=False,
                node_results=[],
                final_outputs={},
                error="Graph validation failed",
                total_execution_time=time.time() - start_time
            )
        
        # Build node instances
        nodes = self._build_nodes(workflow)
        
        # Resolve execution order (topological sort)
        try:
            execution_order = self.resolve_execution_order(workflow, nodes)
        except CycleError as e:
            return GraphExecutionResult(
                graph_id=workflow.get('id', 'unknown'),
                success=False,
                node_results=[],
                final_outputs={},
                error=f"Cycle detected in workflow graph: {str(e)}",
                total_execution_time=time.time() - start_time
            )
        
        # Create execution context
        context = ExecutionContext(
            container=self.container,
            variables=context_variables,
            node_outputs={}
        )
        
        # Execute nodes in order
        node_results: List[NodeExecutionResult] = []
        errors: List[str] = []
        
        for node_id in execution_order:
            node = nodes[node_id]
            node_start_time = time.time()
            
            try:
                # Resolve inputs from connections
                resolved_inputs = self._resolve_node_inputs(node, workflow, context)
                
                # Update node inputs with resolved values
                original_inputs = node.inputs.copy()
                node.inputs.update(resolved_inputs)
                
                # Execute node
                outputs = node.execute(context)
                
                # Store outputs in context
                context.node_outputs[node_id] = outputs
                
                # Restore original inputs
                node.inputs = original_inputs
                
                execution_time = time.time() - node_start_time
                
                node_results.append(NodeExecutionResult(
                    node_id=node_id,
                    success=True,
                    outputs=outputs,
                    execution_time=execution_time
                ))
                
                logger.debug(f"Node {node_id} ({node.node_type}) executed successfully in {execution_time:.3f}s")
                
            except Exception as e:
                execution_time = time.time() - node_start_time
                error_msg = f"Node {node_id} ({node.node_type}) failed: {str(e)}"
                errors.append(error_msg)
                logger.error(error_msg, exc_info=True)
                
                node_results.append(NodeExecutionResult(
                    node_id=node_id,
                    success=False,
                    outputs={},
                    error=str(e),
                    execution_time=execution_time
                ))
                
                # Stop execution on error (can be made configurable)
                break
        
        # Collect final outputs (from output_text nodes)
        final_outputs = self._collect_final_outputs(workflow, context)
        
        total_time = time.time() - start_time
        success = len(errors) == 0
        
        logger.info(f"Workflow execution {'succeeded' if success else 'failed'} in {total_time:.3f}s")
        
        return GraphExecutionResult(
            graph_id=workflow.get('id', 'unknown'),
            success=success,
            node_results=node_results,
            final_outputs=final_outputs,
            error="; ".join(errors) if errors else None,
            total_execution_time=total_time,
            execution_order=execution_order  # Include execution order for frontend highlighting
        )
    
    def validate_graph(self, workflow: NodeGraph) -> bool:
        """
        Validate workflow graph structure
        
        Args:
            workflow: NodeGraph to validate
            
        Returns:
            True if valid, False otherwise
        """
        if 'nodes' not in workflow or not workflow['nodes']:
            logger.error("Workflow has no nodes")
            return False
        
        if 'connections' not in workflow:
            workflow['connections'] = []
        
        # Check all connections reference valid nodes
        node_ids = {node['id'] for node in workflow['nodes']}
        
        for conn in workflow['connections']:
            if conn.get('source_node') not in node_ids:
                logger.error(f"Connection references invalid source node: {conn.get('source_node')}")
                return False
            if conn.get('target_node') not in node_ids:
                logger.error(f"Connection references invalid target node: {conn.get('target_node')}")
                return False
        
        # Check all node types are registered
        for node in workflow['nodes']:
            node_type = node.get('type')
            if not node_type:
                logger.error(f"Node {node.get('id')} has no type")
                return False
            
            if not get_node_class(node_type):
                logger.error(f"Unknown node type: {node_type}")
                return False
        
        return True
    
    def resolve_execution_order(self, workflow: NodeGraph, nodes: Dict[NodeID, BaseNode]) -> List[NodeID]:
        """
        Resolve execution order using topological sort
        
        Args:
            workflow: NodeGraph definition
            nodes: Dictionary of node_id -> node instance
            
        Returns:
            List of node IDs in execution order
        """
        # Build dependency graph
        # dependencies[node_id] = set of node IDs that must execute before this node
        dependencies: Dict[NodeID, Set[NodeID]] = defaultdict(set)
        in_degree: Dict[NodeID, int] = defaultdict(int)
        
        # Initialize all nodes
        for node_id in nodes.keys():
            in_degree[node_id] = 0
        
        # Process connections to build dependency graph
        connections = workflow.get('connections', [])
        for conn in connections:
            source_id = conn['source_node']
            target_id = conn['target_node']
            
            if source_id not in dependencies[target_id]:
                dependencies[target_id].add(source_id)
                in_degree[target_id] += 1
        
        # Topological sort (Kahn's algorithm)
        queue = deque([node_id for node_id, degree in in_degree.items() if degree == 0])
        execution_order: List[NodeID] = []
        
        while queue:
            node_id = queue.popleft()
            execution_order.append(node_id)
            
            # Find nodes that depend on this node
            for target_id, deps in dependencies.items():
                if node_id in deps:
                    in_degree[target_id] -= 1
                    if in_degree[target_id] == 0:
                        queue.append(target_id)
        
        # Check for cycles (shouldn't happen in DAG, but fail fast if detected)
        if len(execution_order) != len(nodes):
            # Find nodes that weren't included in execution order (part of cycle)
            executed_node_ids = set(execution_order)
            cycle_nodes = [node_id for node_id in nodes.keys() if node_id not in executed_node_ids]
            raise CycleError(
                f"Cycle detected in workflow graph: {len(execution_order)}/{len(nodes)} nodes in execution order. "
                f"Nodes involved in cycle: {cycle_nodes}"
            )
        
        return execution_order
    
    def _build_nodes(self, workflow: NodeGraph) -> Dict[NodeID, BaseNode]:
        """
        Build node instances from workflow
        
        Args:
            workflow: NodeGraph definition
            
        Returns:
            Dictionary of node_id -> node instance
        """
        nodes: Dict[NodeID, BaseNode] = {}
        
        # First pass: create all nodes (without workflow/all_nodes)
        for node_data in workflow['nodes']:
            node_id = node_data['id']
            node_type = node_data['type']
            
            node_class = get_node_class(node_type)
            if not node_class:
                raise ValueError(f"Unknown node type: {node_type}")
            
            nodes[node_id] = node_class(node_id, node_data)
        
        # Second pass: setup all nodes (now they can discover other nodes)
        for node in nodes.values():
            node._setup(workflow, nodes)
        
        return nodes
    
    def _resolve_node_inputs(self, node: BaseNode, workflow: NodeGraph, context: ExecutionContext) -> Dict[str, Any]:
        """
        Resolve node inputs from connections and context variables
        
        Args:
            node: Node to resolve inputs for
            workflow: Workflow definition
            context: Execution context
            
        Returns:
            Dictionary of resolved input values
        """
        resolved = {}
        connections = workflow.get('connections', [])
        
        # Find all connections targeting this node
        for conn in connections:
            if conn['target_node'] != node.node_id:
                continue
            
            source_id = conn['source_node']
            source_output = conn.get('source_output', 'default')
            target_input = conn.get('target_input', 'default')
            
            # Get output from source node
            if source_id in context.node_outputs:
                source_outputs = context.node_outputs[source_id]
                if source_output in source_outputs:
                    resolved[target_input] = source_outputs[source_output]
        
        # Also resolve template variables in direct inputs
        for input_name, input_value in node.inputs.items():
            if input_name not in resolved:  # Don't override connections
                if isinstance(input_value, str) and input_value.startswith('{{') and input_value.endswith('}}'):
                    var_name = input_value[2:-2].strip()
                    # Only resolve if variable exists in context (don't overwrite with None)
                    if var_name in context.variables:
                        resolved[input_name] = context.variables[var_name]
                    # If variable doesn't exist, leave unresolved so get_input_value() can use defaults
                else:
                    resolved[input_name] = input_value
        
        return resolved
    
    def _collect_final_outputs(self, workflow: NodeGraph, context: ExecutionContext) -> Dict[str, Any]:
        """
        Collect final outputs from output_text nodes
        
        Args:
            workflow: Workflow definition
            context: Execution context
            
        Returns:
            Dictionary of final outputs
        """
        outputs = {}
        
        for node_data in workflow['nodes']:
            if node_data['type'] == 'output_text':
                node_id = node_data['id']
                if node_id in context.node_outputs:
                    outputs.update(context.node_outputs[node_id])
        
        return outputs
