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
                'node_count': len(running.nodes)
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
                    
                    # Find nodes connected to this node's outputs
                    for conn in running.workflow.get('connections', []):
                        source_id = conn.get('source_node') or conn.get('from')
                        if source_id == node_id:
                            target_id = conn.get('target_node') or conn.get('to')
                            triggered_nodes.add(target_id)
        
        # Execute triggered nodes
        if triggered_nodes:
            self._execute_triggered_nodes(running, triggered_nodes)
    
    def _execute_triggered_nodes(
        self, 
        running: RunningWorkflow, 
        triggered_ids: Set[NodeID]
    ) -> None:
        """
        Execute nodes that were triggered
        
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
