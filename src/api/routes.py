"""
API routes for Obelisk Core
"""
from fastapi import APIRouter, HTTPException, Depends, Request
from pydantic import BaseModel, Field
from typing import Optional, Dict, Any, List, Literal

from ..core.container import ServiceContainer
from ..core.config import Config
from .queue import QueueFullError, ExecutionQueue
from ..core.execution.runner import WorkflowLimitError

router = APIRouter()


# Request/Response models
class ConversationMessage(BaseModel):
    """A single message in conversation history"""
    role: Literal["user", "assistant"] = Field(..., description="Message role: 'user' or 'assistant'")
    content: str = Field(..., description="Message content")


class ConversationContext(BaseModel):
    """Conversation context with messages and memories"""
    messages: List[ConversationMessage] = Field(
        default_factory=list,
        description="List of conversation messages (Qwen3 format)"
    )
    memories: str = Field(
        default="",
        description="Selected memory summaries for system message"
    )
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dict format expected by ObeliskLLM.generate()"""
        return {
            "messages": [{"role": msg.role, "content": msg.content} for msg in self.messages],
            "memories": self.memories
        }


def get_container(request: Request) -> ServiceContainer:
    """Get minimal ServiceContainer from app state (injected by FastAPI)"""
    return request.app.state.container


def get_execution_engine(request: Request):
    """Get ExecutionEngine from app state"""
    from ..core.execution.engine import ExecutionEngine
    container = get_container(request)
    return ExecutionEngine(container)


def get_workflow_runner(request: Request):
    """Get WorkflowRunner from app state"""
    return request.app.state.workflow_runner


def get_execution_queue(request: Request):
    """Get ExecutionQueue from app state"""
    return request.app.state.execution_queue


class GenerateRequest(BaseModel):
    """Request model for LLM generation"""
    prompt: str = Field(..., description="User's query/prompt")
    quantum_influence: float = Field(
        default=0.7,
        ge=0.0,
        le=1.0,
        description="Quantum influence value (0.0-1.0)"
    )
    conversation_context: Optional[ConversationContext] = Field(
        default=None,
        description="Conversation context with messages and memories"
    )
    user_id: Optional[str] = Field(
        default=None,
        description="User identifier for memory management"
    )

class GenerateResponse(BaseModel):
    response: str
    tokens_used: Optional[int] = None
    source: str

class QuantumInfluenceRequest(BaseModel):
    circuit: Optional[str] = None

class QuantumInfluenceResponse(BaseModel):
    influence: float
    random_value: float

class EvolveRequest(BaseModel):
    cycle_id: str
    fine_tune: bool = True

class EvolveResponse(BaseModel):
    status: str
    lora_weights_id: Optional[str] = None
    top_contributors: List[Dict[str, Any]]




# Legacy Endpoints (Deprecated - use /execute with workflows instead)
@router.post("/generate", response_model=GenerateResponse)
async def generate(request: GenerateRequest, container: ServiceContainer = Depends(get_container)):
    """
    Generate response from The Obelisk (DEPRECATED)
    
    This endpoint is deprecated. Use /execute with a chat workflow instead.
    """
    raise HTTPException(
        status_code=410,
        detail="This endpoint is deprecated. Use /execute with a chat workflow instead."
    )

@router.get("/health")
async def health(container: ServiceContainer = Depends(get_container)):
    """Health check"""
    try:
        llm = container.llm
        return {
            "status": "healthy",
            "model_loaded": llm.model is not None,
            "mode": Config.MODE
        }
    except Exception as e:
        return {
            "status": "unhealthy",
            "error": str(e),
            "mode": Config.MODE
        }


# Quantum Endpoints
@router.post("/quantum/influence", response_model=QuantumInfluenceResponse)
async def get_quantum_influence(request: QuantumInfluenceRequest, container: ServiceContainer = Depends(get_container)):
    """Get quantum influence value"""
    try:
        if container.quantum_service is None:
            raise HTTPException(status_code=503, detail="Quantum service not available")
        quantum_service = container.quantum_service
        result = quantum_service.get_quantum_random(num_qubits=2, shots=128)
        return QuantumInfluenceResponse(
            influence=result.get('value', 0.5),
            random_value=result.get('value', 0.5)
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# Evolution Endpoints
@router.post("/evolve", response_model=EvolveResponse)
async def evolve(request: EvolveRequest, container: ServiceContainer = Depends(get_container)):
    """Process evolution cycle"""
    try:
        from ..evolution.processor import process_evolution_cycle
        
        storage = container.storage
        llm = container.llm
        
        result = process_evolution_cycle(
            cycle_id=request.cycle_id,
            storage=storage,
            llm=llm,
            fine_tune_model=request.fine_tune
        )
        
        return EvolveResponse(
            status=result.get('status', 'completed'),
            lora_weights_id=result.get('model_training', {}).get('weight_id') if result.get('model_training') else None,
            top_contributors=result.get('top_contributors', [])
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/evolution/cycle/{cycle_id}")
async def get_cycle_status(cycle_id: str, container: ServiceContainer = Depends(get_container)):
    """Get evolution cycle status"""
    try:
        storage = container.storage
        cycle = storage.get_evolution_cycle(cycle_id)
        if not cycle:
            raise HTTPException(status_code=404, detail="Cycle not found")
        return cycle
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# Memory Endpoints (Deprecated - use workflows instead)
@router.get("/memory/{user_id}")
async def get_memory(user_id: str, container: ServiceContainer = Depends(get_container)):
    """Get conversation context for user (DEPRECATED - use workflows instead)"""
    raise HTTPException(
        status_code=410,
        detail="This endpoint is deprecated. Use /workflow/execute with a memory selector workflow instead."
    )

@router.post("/memory/{user_id}")
async def save_interaction(user_id: str, query: str, response: str, container: ServiceContainer = Depends(get_container)):
    """Save interaction to memory (DEPRECATED - use workflows instead)"""
    raise HTTPException(
        status_code=410,
        detail="This endpoint is deprecated. Use /workflow/execute with a memory creator workflow instead."
    )


# Workflow Execution Endpoints
class WorkflowExecuteRequest(BaseModel):
    """Request model for workflow execution"""
    workflow: Dict[str, Any] = Field(..., description="Workflow graph definition")
    options: Optional[Dict[str, Any]] = Field(
        default_factory=dict,
        description="Execution options (client_id, extra_data, etc.)"
    )


class WorkflowExecuteResponse(BaseModel):
    """Response model for workflow execution"""
    execution_id: Optional[str] = None
    status: Literal["queued", "running", "completed", "error"]
    results: Optional[Dict[str, Dict[str, Any]]] = None
    error: Optional[str] = None
    message: Optional[str] = None
    execution_order: Optional[List[str]] = None  # Order in which nodes were executed (for highlighting)


def _convert_frontend_to_backend_format(frontend_workflow: Dict[str, Any]) -> Dict[str, Any]:
    """
    Convert frontend workflow format to backend NodeGraph format
    
    Frontend format:
    {
        "id": "workflow-1",
        "name": "Obelisk Workflow",
        "nodes": [
            {"id": "1", "type": "text", "position": {"x": 100, "y": 300}, "inputs": {...}, "metadata": {...}}
        ],
        "connections": [
            {"from": "1", "from_output": "text", "to": "2", "to_input": "query"}
        ]
    }
    
    Backend format (NodeGraph):
    {
        "id": "workflow-1",
        "name": "Obelisk Workflow",
        "nodes": [
            {"id": "1", "type": "text", "position": {"x": 100, "y": 300}, "inputs": {...}, "metadata": {...}}
        ],
        "connections": [
            {"id": "conn-1", "source_node": "1", "source_output": "text", "target_node": "2", "target_input": "query", "data_type": "string"}
        ]
    }
    """
    backend_workflow = {
        "id": frontend_workflow.get("id", "workflow-1"),
        "name": frontend_workflow.get("name", "Obelisk Workflow"),
        "nodes": [],
        "connections": []
    }
    
    # Convert nodes (merge inputs and metadata)
    for node in frontend_workflow.get("nodes", []):
        backend_node = {
            "id": str(node["id"]),
            "type": node["type"],
            "position": node.get("position", {"x": 0, "y": 0}),
        }
        
        # Merge inputs and metadata into inputs (backend expects inputs to contain both)
        inputs = node.get("inputs", {}).copy()
        metadata = node.get("metadata", {})
        if metadata:
            inputs.update(metadata)
        
        if inputs:
            backend_node["inputs"] = inputs
        
        backend_workflow["nodes"].append(backend_node)
    
    # Convert connections
    for i, conn in enumerate(frontend_workflow.get("connections", [])):
        backend_conn = {
            "id": f"conn-{i}",
            "source_node": str(conn.get("from") or conn.get("source_node", "")),
            "source_output": conn.get("from_output") or conn.get("source_output", "default"),
            "target_node": str(conn.get("to") or conn.get("target_node", "")),
            "target_input": conn.get("to_input") or conn.get("target_input", "default"),
            "data_type": "string"  # Default, could be inferred from node types
        }
        backend_workflow["connections"].append(backend_conn)
    
    return backend_workflow


def _convert_backend_to_frontend_results(execution_result: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    """
    Convert backend execution results to frontend format
    
    Backend format:
    {
        "graph_id": "workflow-1",
        "success": True,
        "node_results": [
            {"node_id": "1", "success": True, "outputs": {"text": "..."}, ...}
        ],
        "final_outputs": {...}
    }
    
    Frontend format:
    {
        "1": {"outputs": {"text": "..."}},
        "4": {"outputs": {"text": "..."}}
    }
    """
    def _serialize_value(value: Any) -> Any:
        """Convert non-serializable values to strings"""
        # Check if it's a basic serializable type
        if isinstance(value, (str, int, float, bool, type(None))):
            return value
        # Check if it's a dict or list - recursively serialize
        if isinstance(value, dict):
            return {k: _serialize_value(v) for k, v in value.items()}
        if isinstance(value, (list, tuple)):
            return [_serialize_value(item) for item in value]
        # For objects (like ObeliskLLM), convert to a simple representation
        if hasattr(value, '__class__'):
            return {
                "_type": value.__class__.__name__,
                "_module": getattr(value.__class__, '__module__', 'unknown'),
                "_repr": str(value)[:100]  # Truncate long representations
            }
        # Fallback to string
        return str(value)
    
    results = {}
    
    for node_result in execution_result.get("node_results", []):
        node_id = node_result.get("node_id")
        if node_id and node_result.get("success"):
            outputs = node_result.get("outputs", {})
            # Serialize outputs to ensure all values are JSON-serializable
            serialized_outputs = {k: _serialize_value(v) for k, v in outputs.items()}
            results[str(node_id)] = {
                "outputs": serialized_outputs
            }
    
    return results


@router.post("/workflow/execute", response_model=WorkflowExecuteResponse)
async def execute_workflow(
    request: WorkflowExecuteRequest,
    engine = Depends(get_execution_engine)
):
    """
    Execute a workflow graph (Primary endpoint for node-based execution)
    
    Accepts a workflow graph from the frontend, converts it to backend format,
    executes it using the ExecutionEngine, and returns results in frontend format.
    
    All functionality (chat, memory, inference) is accessed through workflows.
    Nodes initialize their own dependencies (model, storage, etc.) as needed.
    """
    try:
        # Convert frontend format to backend format
        backend_workflow = _convert_frontend_to_backend_format(request.workflow)
        
        # Extract context variables from options
        context_variables = {}
        if request.options:
            if "client_id" in request.options:
                context_variables["user_id"] = request.options["client_id"]
            if "user_id" in request.options:
                context_variables["user_id"] = request.options["user_id"]
            if "user_query" in request.options:
                context_variables["user_query"] = request.options["user_query"]
            if "extra_data" in request.options:
                context_variables.update(request.options["extra_data"])
            if "variables" in request.options:
                context_variables.update(request.options["variables"])
        
        # Execute workflow (nodes will initialize their own dependencies)
        execution_result = engine.execute(backend_workflow, context_variables)
        
        # Convert results to frontend format
        # GraphExecutionResult is a TypedDict, access as dict
        if execution_result.get('success', False):
            results = _convert_backend_to_frontend_results(execution_result)
            return WorkflowExecuteResponse(
                execution_id=(request.options or {}).get("execution_id") if request.options else None,
                status="completed",
                results=results,
                message="Workflow executed successfully",
                execution_order=execution_result.get('execution_order', [])
            )
        else:
            return WorkflowExecuteResponse(
                status="error",
                error=execution_result.get('error', 'Unknown error'),
                message="Workflow execution failed"
            )
            
    except Exception as e:
        import traceback
        error_msg = str(e)
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=error_msg)


# Autonomous Workflow Endpoints
class WorkflowRunRequest(BaseModel):
    """Request model for starting continuous workflow execution"""
    workflow: Dict[str, Any] = Field(..., description="Workflow graph definition")
    options: Optional[Dict[str, Any]] = Field(
        default_factory=dict,
        description="Execution options (client_id, extra_data, etc.)"
    )


class WorkflowRunResponse(BaseModel):
    """Response model for workflow run"""
    workflow_id: str
    status: Literal["running", "completed", "error"]
    message: Optional[str] = None
    error: Optional[str] = None


class WorkflowStopRequest(BaseModel):
    """Request model for stopping a workflow"""
    workflow_id: str = Field(..., description="ID of workflow to stop")


class WorkflowStopResponse(BaseModel):
    """Response model for workflow stop"""
    workflow_id: str
    status: Literal["stopped", "not_found", "error"]
    message: Optional[str] = None


class WorkflowStatusResponse(BaseModel):
    """Response model for workflow status"""
    workflow_id: str
    state: Literal["stopped", "running", "paused", "not_found"]
    tick_count: Optional[int] = None
    last_tick_time: Optional[float] = None
    node_count: Optional[int] = None
    latest_results: Optional[Dict[str, Any]] = None
    results_version: Optional[int] = None


class RunningWorkflowsResponse(BaseModel):
    """Response model for listing running workflows"""
    workflows: List[str]
    count: int


@router.post("/workflow/run", response_model=WorkflowRunResponse)
async def run_workflow(
    request: WorkflowRunRequest,
    runner = Depends(get_workflow_runner)
):
    """
    Start continuous execution of a workflow (for autonomous/scheduled workflows)
    
    Unlike /workflow/execute which runs once and returns, this endpoint starts
    a continuous execution loop that runs until explicitly stopped.
    
    Workflows with CONTINUOUS nodes (like SchedulerNode) will keep running,
    triggering connected nodes at their configured intervals.
    
    Rate limits:
    - Max 5 total running workflows
    - Max 2 running workflows per user
    """
    try:
        # Convert frontend format to backend format
        backend_workflow = _convert_frontend_to_backend_format(request.workflow)
        
        # Extract context variables from options
        context_variables = {}
        if request.options:
            if "client_id" in request.options:
                context_variables["user_id"] = request.options["client_id"]
            if "user_id" in request.options:
                context_variables["user_id"] = request.options["user_id"]
            if "user_query" in request.options:
                context_variables["user_query"] = request.options["user_query"]
            if "extra_data" in request.options:
                context_variables.update(request.options["extra_data"])
            if "variables" in request.options:
                context_variables.update(request.options["variables"])
        
        # Start workflow
        workflow_id = runner.start_workflow(backend_workflow, context_variables)
        
        return WorkflowRunResponse(
            workflow_id=workflow_id,
            status="running",
            message=f"Workflow {workflow_id} started"
        )
    
    except WorkflowLimitError as e:
        # Rate limit exceeded - return 429 Too Many Requests
        raise HTTPException(status_code=429, detail=str(e))
    except Exception as e:
        import traceback
        error_msg = str(e)
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=error_msg)


@router.post("/workflow/stop", response_model=WorkflowStopResponse)
async def stop_workflow(
    request: WorkflowStopRequest,
    runner = Depends(get_workflow_runner)
):
    """
    Stop a running workflow
    
    Stops the continuous execution loop for the specified workflow.
    """
    try:
        stopped = runner.stop_workflow(request.workflow_id)
        
        if stopped:
            return WorkflowStopResponse(
                workflow_id=request.workflow_id,
                status="stopped",
                message=f"Workflow {request.workflow_id} stopped"
            )
        else:
            return WorkflowStopResponse(
                workflow_id=request.workflow_id,
                status="not_found",
                message=f"Workflow {request.workflow_id} not found or not running"
            )
        
    except Exception as e:
        import traceback
        error_msg = str(e)
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=error_msg)


@router.get("/workflow/status/{workflow_id}", response_model=WorkflowStatusResponse)
async def get_workflow_status(
    workflow_id: str,
    runner = Depends(get_workflow_runner)
):
    """
    Get status of a workflow
    
    Returns the current state and statistics for a workflow.
    """
    status = runner.get_status(workflow_id)
    
    if status is None:
        return WorkflowStatusResponse(
            workflow_id=workflow_id,
            state="not_found"
        )
    
    return WorkflowStatusResponse(
        workflow_id=workflow_id,
        state=status['state'],
        tick_count=status['tick_count'],
        last_tick_time=status['last_tick_time'],
        node_count=status['node_count'],
        latest_results=status.get('latest_results'),
        results_version=status.get('results_version')
    )


@router.get("/workflow/running", response_model=RunningWorkflowsResponse)
async def list_running_workflows(
    runner = Depends(get_workflow_runner)
):
    """
    List all running workflows
    
    Returns a list of workflow IDs that are currently running.
    """
    workflow_ids = runner.list_running()
    return RunningWorkflowsResponse(
        workflows=workflow_ids,
        count=len(workflow_ids)
    )


@router.post("/workflow/stop-all")
async def stop_all_workflows(
    runner = Depends(get_workflow_runner)
):
    """
    Stop all running workflows
    
    Emergency stop for all workflows.
    """
    runner.stop_all()
    return {"status": "stopped", "message": "All workflows stopped"}


# ============================================================================
# Execution Queue Endpoints
# ============================================================================

class QueueExecuteRequest(BaseModel):
    """Request model for queued workflow execution"""
    workflow: Dict[str, Any] = Field(..., description="Workflow graph definition")
    options: Optional[Dict[str, Any]] = Field(
        default_factory=dict,
        description="Execution options (client_id, extra_data, etc.)"
    )


class QueueExecuteResponse(BaseModel):
    """Response for queued execution"""
    job_id: str
    status: str
    position: int
    queue_length: int
    message: str


class JobStatusResponse(BaseModel):
    """Response for job status check"""
    job_id: str
    status: str
    position: Optional[int] = None
    queue_length: int
    created_at: float
    started_at: Optional[float] = None
    completed_at: Optional[float] = None
    has_result: bool = False
    error: Optional[str] = None


class JobResultResponse(BaseModel):
    """Response for job result"""
    job_id: str
    status: str
    results: Optional[Dict[str, Dict[str, Any]]] = None
    execution_order: Optional[List[str]] = None
    error: Optional[str] = None


class QueueInfoResponse(BaseModel):
    """Response for queue info"""
    queue_length: int
    current_job: Optional[str] = None
    is_processing: bool
    total_jobs: int


@router.post("/queue/execute", response_model=QueueExecuteResponse)
async def queue_execute(
    request: QueueExecuteRequest,
    queue = Depends(get_execution_queue)
):
    """
    Queue a workflow for execution.
    
    Jobs are processed sequentially. Returns immediately with job_id.
    Poll /queue/status/{{job_id}} for progress, /queue/result/{{job_id}} for results.
    
    Rate limits:
    - Max 20 jobs in queue (ExecutionQueue.MAX_QUEUE_SIZE)
    - Max 3 pending jobs per user (ExecutionQueue.MAX_JOBS_PER_USER)
    """
    try:
        job = queue.enqueue(request.workflow, request.options)
        
        return QueueExecuteResponse(
            job_id=job.id,
            status=job.status.value,
            position=job.position,
            queue_length=queue.get_queue_length(),
            message=f"Job queued at position {job.position}"
        )
    except QueueFullError as e:
        # Rate limit exceeded - return 429 Too Many Requests
        raise HTTPException(status_code=429, detail=str(e)) from e
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e)) from e


@router.get("/queue/status/{job_id}", response_model=JobStatusResponse)
async def get_job_status(
    job_id: str,
    queue = Depends(get_execution_queue)
):
    """
    Get status of a queued job.
    
    Returns current status, queue position (if queued), and timing info.
    """
    status = queue.get_status(job_id)
    
    if not status:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
    
    return JobStatusResponse(**status)


@router.get("/queue/result/{job_id}", response_model=JobResultResponse)
async def get_job_result(
    job_id: str,
    queue = Depends(get_execution_queue)
):
    """
    Get result of a completed job.
    
    Only returns results if job is completed or failed.
    """
    job = queue.get_job(job_id)
    
    if not job:
        raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
    
    if job.status.value == "queued" or job.status.value == "running":
        return JobResultResponse(
            job_id=job_id,
            status=job.status.value,
            error="Job not yet completed"
        )
    
    result = queue.get_result(job_id)
    
    if job.status.value == "completed" and result:
        return JobResultResponse(
            job_id=job_id,
            status="completed",
            results=result.get('results'),
            execution_order=result.get('execution_order')
        )
    elif job.status.value == "failed":
        return JobResultResponse(
            job_id=job_id,
            status="failed",
            error=job.error
        )
    else:
        return JobResultResponse(
            job_id=job_id,
            status=job.status.value,
            error="Job was cancelled"
        )


@router.post("/queue/cancel/{job_id}")
async def cancel_job(
    job_id: str,
    queue = Depends(get_execution_queue)
):
    """
    Cancel a queued job (cannot cancel running jobs).
    """
    cancelled = queue.cancel(job_id)
    
    if cancelled:
        return {"status": "cancelled", "job_id": job_id}
    else:
        job = queue.get_job(job_id)
        if not job:
            raise HTTPException(status_code=404, detail=f"Job {job_id} not found")
        else:
            raise HTTPException(
                status_code=400, 
                detail=f"Cannot cancel job in status: {job.status.value}"
            )


@router.get("/queue/info", response_model=QueueInfoResponse)
async def get_queue_info(
    queue = Depends(get_execution_queue)
):
    """
    Get overall queue status.
    
    Returns queue length, current job, and processing state.
    """
    info = queue.get_queue_info()
    return QueueInfoResponse(**info)
