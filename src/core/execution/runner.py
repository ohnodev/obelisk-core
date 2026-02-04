"""
Workflow Runner for Obelisk Core
Manages continuous/autonomous workflow execution with tick-based scheduling
"""
import asyncio
import random
import time
import threading
from typing import Dict, Any, Optional, List, Set, Callable
from dataclasses import dataclass, field
from enum import Enum

from .engine import ExecutionEngine
from .node_base import BaseNode, ExecutionContext, ExecutionMode
from ..types import NodeGraph, NodeID
from ..container import ServiceContainer
from ...utils.logger import get_logger

logger = get_logger(__name__)


def _make_serializable(value: Any, max_depth: int = 5) -> Any:
    """
    Convert a value to be JSON-serializable.
    Filters out complex objects that can't be serialized.
    
    Args:
        value: Any Python value
        max_depth: Maximum recursion depth
        
    Returns:
        JSON-serializable version of the value
    """
    if max_depth <= 0:
        return "<max depth reached>"
    
    # Basic types are already serializable
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    
    # Handle lists
    if isinstance(value, (list, tuple)):
        return [_make_serializable(item, max_depth - 1) for item in value]
    
    # Handle dicts
    if isinstance(value, dict):
        return {
            str(k): _make_serializable(v, max_depth - 1)
            for k, v in value.items()
        }
    
    # For complex objects, return a placeholder with type info
    type_name = type(value).__name__
    module = type(value).__module__
    
    # Check if it has a string representation that's useful
    try:
        str_repr = str(value)
        if len(str_repr) < 200 and not str_repr.startswith('<'):
            return f"<{type_name}: {str_repr}>"
    except Exception:
        pass
    
    return f"<{module}.{type_name}>"


class RunnerState(Enum):
    """State of a workflow runner"""
    STOPPED = "stopped"
    RUNNING = "running"
    PAUSED = "paused"


@dataclass
class RunningWorkflow:
    """Tracks state of a running workflow"""
    workflow_id: str
    workflow: NodeGraph
    state: RunnerState = RunnerState.STOPPED
    tick_count: int = 0
    last_tick_time: float = 0.0
    nodes: Dict[NodeID, BaseNode] = field(default_factory=dict)
    context: Optional[ExecutionContext] = None
    # Callbacks for result streaming
    on_tick_complete: Optional[Callable[[Dict[str, Any]], None]] = None
    on_error: Optional[Callable[[str], None]] = None
    # Latest execution results (for frontend polling)
    latest_results: Optional[Dict[str, Any]] = None
    results_version: int = 0  # Incremented each execution, frontend can use to detect new results


class WorkflowRunner:
    """
    Manages continuous workflow execution with tick-based scheduling
    
    Features:
    - Tick-based execution loop
    - Support for CONTINUOUS nodes (schedulers)
    - Support for TRIGGERED nodes
    - Multiple concurrent workflows
    - Start/stop/pause control
    """
    
    # Default tick interval in seconds
    DEFAULT_TICK_INTERVAL = 0.1  # 100ms
    
    def __init__(self, container: Optional[ServiceContainer] = None):
        """
        Initialize workflow runner
        
        Args:
            container: Optional ServiceContainer for node initialization
        """
        self.container = container
        self.engine = ExecutionEngine(container)
        self._running_workflows: Dict[str, RunningWorkflow] = {}
        self._tick_interval = self.DEFAULT_TICK_INTERVAL
        self._runner_thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()
        self._lock = threading.Lock()
    
    def start_workflow(
        self, 
        workflow: NodeGraph, 
        context_variables: Optional[Dict[str, Any]] = None,
        on_tick_complete: Optional[Callable[[Dict[str, Any]], None]] = None,
        on_error: Optional[Callable[[str], None]] = None
    ) -> str:
        """
        Start continuous execution of a workflow
        
        Args:
            workflow: NodeGraph to execute
            context_variables: Initial context variables
            on_tick_complete: Callback for each tick completion
            on_error: Callback for errors
            
        Returns:
            Workflow ID for tracking
        """
        workflow_id = workflow.get('id', f'workflow-{time.time()}')
        
        with self._lock:
            # Check if already running
            if workflow_id in self._running_workflows:
                existing = self._running_workflows[workflow_id]
                if existing.state == RunnerState.RUNNING:
                    logger.warning(f"Workflow {workflow_id} is already running")
                    return workflow_id
            
            # Build nodes
            nodes = self.engine._build_nodes(workflow)
            
            # Check if workflow has autonomous nodes
            has_autonomous = any(node.is_autonomous() for node in nodes.values())
            if not has_autonomous:
                logger.info(f"Workflow {workflow_id} has no autonomous nodes, executing once")
                # Execute once and return
                result = self.engine.execute(workflow, context_variables)
                if on_tick_complete:
                    on_tick_complete(result)
                return workflow_id
            
            # Create execution context
            context = ExecutionContext(
                container=self.container,
                variables=context_variables or {},
                node_outputs={}
            )
            
            # Create running workflow entry
            running = RunningWorkflow(
                workflow_id=workflow_id,
                workflow=workflow,
                state=RunnerState.RUNNING,
                nodes=nodes,
                context=context,
                on_tick_complete=on_tick_complete,
                on_error=on_error
            )
            
            self._running_workflows[workflow_id] = running
            logger.info(f"Started workflow {workflow_id} with {len(nodes)} nodes")
        
        # Start runner thread if not already running
        self._ensure_runner_thread()
        
        return workflow_id
    
    def stop_workflow(self, workflow_id: str) -> bool:
        """
        Stop a running workflow
        
        Args:
            workflow_id: ID of workflow to stop
            
        Returns:
            True if stopped, False if not found
        """
        with self._lock:
            if workflow_id not in self._running_workflows:
                logger.warning(f"Workflow {workflow_id} not found")
                return False
            
            running = self._running_workflows[workflow_id]
            running.state = RunnerState.STOPPED
            logger.info(f"Stopped workflow {workflow_id} after {running.tick_count} ticks")
            
            # Remove from running workflows
            del self._running_workflows[workflow_id]
            
            # Stop runner thread if no more workflows
            if not self._running_workflows:
                self._stop_runner_thread()
            
            return True
    
    def stop_all(self) -> None:
        """Stop all running workflows"""
        with self._lock:
            workflow_ids = list(self._running_workflows.keys())
        
        for workflow_id in workflow_ids:
            self.stop_workflow(workflow_id)
    
    def get_status(self, workflow_id: str) -> Optional[Dict[str, Any]]:
        """
        Get status of a workflow
        
        Args:
            workflow_id: ID of workflow
            
        Returns:
            Status dict or None if not found
        """
        with self._lock:
            if workflow_id not in self._running_workflows:
                return None
            
            running = self._running_workflows[workflow_id]
            return {
                'workflow_id': workflow_id,
                'state': running.state.value,
                'tick_count': running.tick_count,
                'last_tick_time': running.last_tick_time,
                'node_count': len(running.nodes),
                'latest_results': running.latest_results,
                'results_version': running.results_version
            }
    
    def list_running(self) -> List[str]:
        """List IDs of all running workflows"""
        with self._lock:
            return [wid for wid, w in self._running_workflows.items() 
                    if w.state == RunnerState.RUNNING]
    
    def _ensure_runner_thread(self) -> None:
        """Ensure the runner thread is running"""
        if self._runner_thread is None or not self._runner_thread.is_alive():
            self._stop_event.clear()
            self._runner_thread = threading.Thread(
                target=self._run_loop,
                daemon=True,
                name="WorkflowRunner"
            )
            self._runner_thread.start()
            logger.debug("Started workflow runner thread")
    
    def _stop_runner_thread(self) -> None:
        """Stop the runner thread"""
        self._stop_event.set()
        if self._runner_thread and self._runner_thread.is_alive():
            self._runner_thread.join(timeout=2.0)
        self._runner_thread = None
        logger.debug("Stopped workflow runner thread")
    
    def _run_loop(self) -> None:
        """Main tick loop for workflow execution"""
        logger.info("Workflow runner loop started")
        
        while not self._stop_event.is_set():
            tick_start = time.time()
            
            # Get list of running workflows
            with self._lock:
                running_list = [
                    (wid, running) 
                    for wid, running in self._running_workflows.items()
                    if running.state == RunnerState.RUNNING
                ]
            
            # Process each workflow
            for workflow_id, running in running_list:
                try:
                    self._process_tick(running)
                except Exception as e:
                    logger.error(f"Error in workflow {workflow_id}: {e}", exc_info=True)
                    if running.on_error:
                        running.on_error(str(e))
            
            # Sleep for remaining tick interval
            elapsed = time.time() - tick_start
            sleep_time = max(0, self._tick_interval - elapsed)
            if sleep_time > 0:
                self._stop_event.wait(timeout=sleep_time)
        
        logger.info("Workflow runner loop stopped")
    
    def _process_tick(self, running: RunningWorkflow) -> None:
        """
        Process a single tick for a workflow
        
        Args:
            running: Running workflow state
        """
        running.tick_count += 1
        running.last_tick_time = time.time()
        
        # Find CONTINUOUS nodes and call on_tick
        triggered_nodes: Set[NodeID] = set()
        
        for node_id, node in running.nodes.items():
            if node.is_autonomous():
                # Call on_tick for autonomous nodes
                result = node.on_tick(running.context)
                if result is not None:
                    # Node fired - store outputs and find connected nodes
                    running.context.node_outputs[node_id] = result
                    
                    # Find nodes connected to this scheduler's outputs
                    for conn in running.workflow.get('connections', []):
                        source_id = conn.get('source_node') or conn.get('from')
                        if source_id == node_id:
                            target_id = conn.get('target_node') or conn.get('to')
                            triggered_nodes.add(target_id)
        
        # Execute the subgraph connected to the scheduler
        if triggered_nodes:
            self._execute_subgraph(running, triggered_nodes)
    
    def _execute_subgraph(
        self, 
        running: RunningWorkflow, 
        triggered_ids: Set[NodeID]
    ) -> None:
        """
        Execute the subgraph connected to triggered nodes
        
        This finds:
        1. All downstream nodes from the triggered nodes
        2. All upstream dependencies those downstream nodes need
        3. Executes the combined subgraph in proper topological order
        
        Args:
            running: Running workflow state
            triggered_ids: Set of node IDs directly triggered by scheduler
        """
        workflow = running.workflow
        nodes = running.nodes
        context = running.context
        
        # Step 1: Find all downstream nodes from triggered nodes
        downstream = self._get_all_downstream(workflow, triggered_ids, nodes)
        
        # Step 2: Find all upstream dependencies of the downstream nodes
        subgraph_nodes = self._get_subgraph_with_dependencies(workflow, downstream, nodes)
        
        logger.info(f"Scheduler triggered - executing subgraph with {len(subgraph_nodes)} nodes")
        logger.debug(f"Subgraph nodes: {subgraph_nodes}")
        
        # Step 3: Build a filtered workflow with only subgraph nodes
        subgraph_workflow = self._build_subgraph_workflow(workflow, subgraph_nodes)
        
        # Step 4: Execute the subgraph using the engine
        result = self.engine.execute(subgraph_workflow, context.variables)
        
        # Update context with new outputs
        for node_result in result.get('node_results', []):
            node_id = node_result.get('node_id')
            if node_id and node_result.get('success'):
                context.node_outputs[node_id] = node_result.get('outputs', {})
        
        # Store latest results for frontend polling (sanitized for JSON serialization)
        running.results_version += 1
        running.latest_results = {
            'tick': running.tick_count,
            'success': result.get('success', False),
            'executed_nodes': result.get('execution_order', []),
            'results': {
                str(nr.get('node_id')): {'outputs': _make_serializable(nr.get('outputs', {}))}
                for nr in result.get('node_results', [])
                if nr.get('success')
            },
            'error': result.get('error'),
            'version': running.results_version
        }
        
        # Call completion callback
        if running.on_tick_complete:
            running.on_tick_complete(running.latest_results)
        
        if result.get('success'):
            logger.info(f"Subgraph execution completed successfully")
        else:
            logger.error(f"Subgraph execution failed: {result.get('error')}")
    
    def _get_all_downstream(
        self,
        workflow: NodeGraph,
        start_nodes: Set[NodeID],
        nodes: Dict[NodeID, BaseNode]
    ) -> Set[NodeID]:
        """
        Get all nodes downstream from start_nodes (BFS)
        
        Args:
            workflow: Workflow definition
            start_nodes: Starting node IDs
            nodes: All node instances
            
        Returns:
            Set of all downstream node IDs (including start_nodes)
        """
        connections = workflow.get('connections', [])
        
        # Build adjacency list (node -> nodes it outputs to)
        adjacency: Dict[NodeID, Set[NodeID]] = {}
        for node_id in nodes.keys():
            adjacency[node_id] = set()
        
        for conn in connections:
            source_id = conn.get('source_node') or conn.get('from')
            target_id = conn.get('target_node') or conn.get('to')
            if source_id in adjacency:
                adjacency[source_id].add(target_id)
        
        # BFS to find all downstream nodes
        downstream: Set[NodeID] = set(start_nodes)
        queue = list(start_nodes)
        
        while queue:
            node_id = queue.pop(0)
            for target_id in adjacency.get(node_id, []):
                if target_id not in downstream:
                    downstream.add(target_id)
                    queue.append(target_id)
        
        return downstream
    
    def _get_subgraph_with_dependencies(
        self,
        workflow: NodeGraph,
        downstream_nodes: Set[NodeID],
        nodes: Dict[NodeID, BaseNode]
    ) -> Set[NodeID]:
        """
        Get the full subgraph including upstream dependencies
        
        For each downstream node, find all nodes that provide inputs to it
        (recursively), so the subgraph is complete and can execute.
        
        Args:
            workflow: Workflow definition
            downstream_nodes: Set of downstream node IDs
            nodes: All node instances
            
        Returns:
            Set of all node IDs needed for the subgraph
        """
        connections = workflow.get('connections', [])
        
        # Build reverse adjacency (node -> nodes that provide inputs to it)
        reverse_adjacency: Dict[NodeID, Set[NodeID]] = {}
        for node_id in nodes.keys():
            reverse_adjacency[node_id] = set()
        
        for conn in connections:
            source_id = conn.get('source_node') or conn.get('from')
            target_id = conn.get('target_node') or conn.get('to')
            if target_id in reverse_adjacency:
                reverse_adjacency[target_id].add(source_id)
        
        # For each downstream node, find all upstream dependencies (BFS backwards)
        subgraph: Set[NodeID] = set(downstream_nodes)
        queue = list(downstream_nodes)
        
        while queue:
            node_id = queue.pop(0)
            for source_id in reverse_adjacency.get(node_id, []):
                if source_id not in subgraph:
                    # Don't include scheduler nodes as dependencies
                    node = nodes.get(source_id)
                    if node and not node.is_autonomous():
                        subgraph.add(source_id)
                        queue.append(source_id)
        
        return subgraph
    
    def _build_subgraph_workflow(
        self,
        workflow: NodeGraph,
        subgraph_nodes: Set[NodeID]
    ) -> NodeGraph:
        """
        Build a filtered workflow containing only the subgraph nodes
        
        Args:
            workflow: Original workflow
            subgraph_nodes: Set of node IDs to include
            
        Returns:
            Filtered workflow with only subgraph nodes and their connections
        """
        # Filter nodes
        filtered_nodes = [
            node for node in workflow.get('nodes', [])
            if node.get('id') in subgraph_nodes
        ]
        
        # Filter connections (both source and target must be in subgraph)
        filtered_connections = []
        for conn in workflow.get('connections', []):
            source_id = conn.get('source_node') or conn.get('from')
            target_id = conn.get('target_node') or conn.get('to')
            if source_id in subgraph_nodes and target_id in subgraph_nodes:
                filtered_connections.append(conn)
        
        return {
            'id': workflow.get('id', 'subgraph'),
            'name': workflow.get('name', 'Subgraph'),
            'nodes': filtered_nodes,
            'connections': filtered_connections
        }
    
    def _execute_triggered_nodes(
        self, 
        running: RunningWorkflow, 
        triggered_ids: Set[NodeID]
    ) -> None:
        """
        Execute nodes that were triggered (DEPRECATED - use _execute_full_workflow)
        
        This method only executes downstream nodes and may fail if dependencies
        aren't satisfied. Kept for reference but not used.
        
        Args:
            running: Running workflow state
            triggered_ids: Set of node IDs to execute
        """
        # Get execution order for triggered nodes
        # For now, we re-execute the full subgraph starting from triggered nodes
        # This is a simplified approach - could be optimized later
        
        workflow = running.workflow
        nodes = running.nodes
        context = running.context
        
        # Build execution order starting from triggered nodes
        # Use topological sort considering only nodes downstream of triggers
        execution_order = self._get_downstream_order(workflow, triggered_ids, nodes)
        
        logger.debug(f"Executing {len(execution_order)} triggered nodes: {execution_order}")
        
        # Execute nodes in order
        for node_id in execution_order:
            node = nodes.get(node_id)
            if not node:
                continue
            
            try:
                # Resolve inputs from connections
                resolved_inputs = self.engine._resolve_node_inputs(node, workflow, context)
                
                # Update node inputs
                original_inputs = node.inputs.copy()
                node.inputs.update(resolved_inputs)
                
                # Execute node
                outputs = node.execute(context)
                
                # Store outputs
                context.node_outputs[node_id] = outputs
                
                # Restore inputs
                node.inputs = original_inputs
                
            except Exception as e:
                logger.error(f"Node {node_id} execution failed: {e}", exc_info=True)
        
        # Call completion callback
        if running.on_tick_complete:
            result = {
                'tick': running.tick_count,
                'triggered_nodes': list(triggered_ids),
                'executed_nodes': execution_order,
                'outputs': {nid: context.node_outputs.get(nid, {}) for nid in execution_order}
            }
            running.on_tick_complete(result)
    
    def _get_downstream_order(
        self, 
        workflow: NodeGraph, 
        start_nodes: Set[NodeID],
        nodes: Dict[NodeID, BaseNode]
    ) -> List[NodeID]:
        """
        Get topologically sorted list of nodes downstream from start_nodes
        
        Args:
            workflow: Workflow definition
            start_nodes: Starting node IDs
            nodes: All node instances
            
        Returns:
            List of node IDs in execution order
        """
        connections = workflow.get('connections', [])
        
        # Build adjacency list (node -> nodes it outputs to)
        adjacency: Dict[NodeID, Set[NodeID]] = {}
        for node_id in nodes.keys():
            adjacency[node_id] = set()
        
        for conn in connections:
            source_id = conn.get('source_node') or conn.get('from')
            target_id = conn.get('target_node') or conn.get('to')
            if source_id in adjacency:
                adjacency[source_id].add(target_id)
        
        # BFS from start nodes to find all downstream nodes
        downstream: Set[NodeID] = set(start_nodes)
        queue = list(start_nodes)
        
        while queue:
            node_id = queue.pop(0)
            for target_id in adjacency.get(node_id, []):
                if target_id not in downstream:
                    downstream.add(target_id)
                    queue.append(target_id)
        
        # Topological sort of downstream nodes
        # Use the engine's existing method but filter to only downstream nodes
        full_order = self.engine.resolve_execution_order(workflow, nodes)
        return [nid for nid in full_order if nid in downstream]
