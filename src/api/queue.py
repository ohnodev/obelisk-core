"""
Execution Queue for Obelisk Core

Simple in-memory queue with JSON file persistence.
Processes workflow executions sequentially to prevent resource contention.
"""
import asyncio
import json
import os
import time
import threading
from dataclasses import dataclass, asdict, field
from enum import Enum
from pathlib import Path
from typing import Dict, Any, Optional, List
from uuid import uuid4


class JobStatus(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


@dataclass
class ExecutionJob:
    """Represents a queued workflow execution job"""
    id: str
    workflow: Dict[str, Any]
    options: Dict[str, Any]
    status: JobStatus
    created_at: float
    started_at: Optional[float] = None
    completed_at: Optional[float] = None
    result: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    position: int = 0  # Position in queue (0 = running or next)
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to JSON-serializable dict"""
        d = asdict(self)
        d['status'] = self.status.value
        return d
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ExecutionJob":
        """Create from dict (for loading from JSON)"""
        data['status'] = JobStatus(data['status'])
        return cls(**data)


class QueueFullError(Exception):
    """Raised when the queue is at capacity"""
    pass


class ExecutionQueue:
    """
    In-memory execution queue with JSON persistence.
    
    Features:
    - Sequential job processing (one at a time)
    - JSON file persistence for restart survival
    - Throttling limits to prevent resource exhaustion
    - Position tracking for queue status
    - Automatic cleanup of old completed jobs
    - Throttling limits to prevent resource exhaustion
    """
    
    PERSISTENCE_FILE = "execution_queue.json"
    MAX_COMPLETED_JOBS = 100  # Keep last N completed jobs
    
    # Throttling limits
    MAX_QUEUE_SIZE = 20       # Maximum jobs waiting in queue
    MAX_JOBS_PER_USER = 3     # Maximum pending/running jobs per user
    
    def __init__(self, data_dir: str = "data", engine_factory=None):
        """
        Initialize the execution queue.
        
        Args:
            data_dir: Directory for storing queue persistence file
            engine_factory: Callable that returns an ExecutionEngine instance
        """
        self.data_dir = Path(data_dir)
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.persistence_path = self.data_dir / self.PERSISTENCE_FILE
        
        self.engine_factory = engine_factory
        
        # In-memory state
        self._queue: List[ExecutionJob] = []  # Pending jobs
        self._jobs: Dict[str, ExecutionJob] = {}  # All jobs by ID
        self._current_job: Optional[ExecutionJob] = None
        self._lock = threading.Lock()
        
        # Worker state
        self._running = False
        self._worker_task: Optional[asyncio.Task] = None
        
        # Load persisted state
        self._load_state()
    
    def _load_state(self):
        """Load queue state from JSON file"""
        if not self.persistence_path.exists():
            return
        
        try:
            with open(self.persistence_path, 'r') as f:
                data = json.load(f)
            
            for job_data in data.get('jobs', []):
                job = ExecutionJob.from_dict(job_data)
                self._jobs[job.id] = job
                
                # Re-queue jobs that were pending or running (restart recovery)
                if job.status in (JobStatus.QUEUED, JobStatus.RUNNING):
                    job.status = JobStatus.QUEUED
                    self._queue.append(job)
            
            # Update positions
            self._update_positions()
            
            print(f"[ExecutionQueue] Loaded {len(self._jobs)} jobs, {len(self._queue)} pending")
            
        except Exception as e:
            print(f"[ExecutionQueue] Failed to load state: {e}")
    
    def _save_state(self):
        """Save queue state to JSON file"""
        try:
            # Only persist recent jobs (cleanup old completed ones)
            # Sort all jobs by created_at descending (newest first) before selection
            # to ensure we keep the most recent completed jobs
            all_jobs_sorted = sorted(
                self._jobs.values(),
                key=lambda j: j.created_at,
                reverse=True
            )
            
            jobs_to_save = []
            completed_count = 0
            
            for job in all_jobs_sorted:
                if job.status in (JobStatus.QUEUED, JobStatus.RUNNING):
                    # Always keep queued and running jobs
                    jobs_to_save.append(job)
                elif job.status in (JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED):
                    # Keep only the most recent completed jobs
                    if completed_count < self.MAX_COMPLETED_JOBS:
                        jobs_to_save.append(job)
                        completed_count += 1
            
            data = {
                'jobs': [job.to_dict() for job in jobs_to_save],
                'saved_at': time.time()
            }
            
            with open(self.persistence_path, 'w') as f:
                json.dump(data, f, indent=2)
                
        except Exception as e:
            print(f"[ExecutionQueue] Failed to save state: {e}")
    
    def _update_positions(self):
        """Update position field for all queued jobs"""
        for i, job in enumerate(self._queue):
            job.position = i
    
    def get_queue_length(self) -> int:
        """Get the current number of jobs in the queue (public accessor)"""
        with self._lock:
            return len(self._queue)
    
    def get_total_jobs(self) -> int:
        """Get the total number of tracked jobs (public accessor)"""
        with self._lock:
            return len(self._jobs)
    
    def enqueue(self, workflow: Dict[str, Any], options: Optional[Dict[str, Any]] = None) -> ExecutionJob:
        """
        Add a workflow execution to the queue.
        
        Args:
            workflow: Workflow graph definition
            options: Execution options
            
        Returns:
            ExecutionJob with job_id and initial status
            
        Raises:
            QueueFullError: If queue is at capacity or user has too many jobs
        """
        with self._lock:
            # Check queue size limit
            if len(self._queue) >= self.MAX_QUEUE_SIZE:
                raise QueueFullError(
                    f"Queue is full ({self.MAX_QUEUE_SIZE} jobs). Please wait and try again."
                )
            
            # Check per-user limit
            user_id = (options or {}).get("user_id") or (options or {}).get("client_id") or "anonymous"
            user_pending_jobs = sum(
                1 for job in self._jobs.values()
                if job.status in (JobStatus.QUEUED, JobStatus.RUNNING)
                and ((job.options.get("user_id") or job.options.get("client_id") or "anonymous") == user_id)
            )
            
            if user_pending_jobs >= self.MAX_JOBS_PER_USER:
                raise QueueFullError(
                    f"You have {user_pending_jobs} pending jobs (max {self.MAX_JOBS_PER_USER}). "
                    f"Please wait for them to complete."
                )
            
            job = ExecutionJob(
                id=str(uuid4()),
                workflow=workflow,
                options=options or {},
                status=JobStatus.QUEUED,
                created_at=time.time(),
                position=len(self._queue)
            )
            
            self._queue.append(job)
            self._jobs[job.id] = job
            self._save_state()
            
            print(f"[ExecutionQueue] Enqueued job {job.id}, position {job.position}, user={user_id}")
            return job
    
    def get_job(self, job_id: str) -> Optional[ExecutionJob]:
        """Get job by ID"""
        return self._jobs.get(job_id)
    
    def get_status(self, job_id: str) -> Optional[Dict[str, Any]]:
        """
        Get job status with queue position.
        
        Returns dict with:
        - job_id, status, position (if queued)
        - created_at, started_at, completed_at
        - result (if completed), error (if failed)
        """
        job = self._jobs.get(job_id)
        if not job:
            return None
        
        return {
            'job_id': job.id,
            'status': job.status.value,
            'position': job.position if job.status == JobStatus.QUEUED else None,
            'queue_length': len(self._queue),
            'created_at': job.created_at,
            'started_at': job.started_at,
            'completed_at': job.completed_at,
            'has_result': job.result is not None,
            'error': job.error
        }
    
    def get_result(self, job_id: str) -> Optional[Dict[str, Any]]:
        """Get job result (only if completed)"""
        job = self._jobs.get(job_id)
        if not job:
            return None
        
        if job.status == JobStatus.COMPLETED:
            return job.result
        elif job.status == JobStatus.FAILED:
            return {'error': job.error}
        else:
            return None
    
    def cancel(self, job_id: str) -> bool:
        """
        Cancel a queued job (cannot cancel running jobs).
        
        Returns True if job was cancelled, False otherwise.
        """
        with self._lock:
            job = self._jobs.get(job_id)
            if not job or job.status != JobStatus.QUEUED:
                return False
            
            job.status = JobStatus.CANCELLED
            job.completed_at = time.time()
            
            # Remove from queue
            self._queue = [j for j in self._queue if j.id != job_id]
            self._update_positions()
            self._save_state()
            
            print(f"[ExecutionQueue] Cancelled job {job_id}")
            return True
    
    def get_queue_info(self) -> Dict[str, Any]:
        """Get overall queue status"""
        return {
            'queue_length': len(self._queue),
            'current_job': self._current_job.id if self._current_job else None,
            'is_processing': self._current_job is not None,
            'total_jobs': len(self._jobs)
        }
    
    async def start_worker(self):
        """Start the background worker that processes jobs"""
        if self._running:
            return
        
        self._running = True
        self._worker_task = asyncio.create_task(self._worker_loop())
        print("[ExecutionQueue] Worker started")
    
    async def stop_worker(self):
        """Stop the background worker"""
        self._running = False
        if self._worker_task:
            self._worker_task.cancel()
            try:
                await self._worker_task
            except asyncio.CancelledError:
                pass
        print("[ExecutionQueue] Worker stopped")
    
    async def _worker_loop(self):
        """Main worker loop - processes jobs sequentially"""
        while self._running:
            job = None
            
            # Get next job
            with self._lock:
                if self._queue:
                    job = self._queue.pop(0)
                    job.status = JobStatus.RUNNING
                    job.started_at = time.time()
                    self._current_job = job
                    self._update_positions()
                    self._save_state()
            
            if job:
                print(f"[ExecutionQueue] Processing job {job.id}")
                try:
                    result = await self._execute_job(job)
                    
                    with self._lock:
                        job.status = JobStatus.COMPLETED
                        job.completed_at = time.time()
                        job.result = result
                        self._current_job = None
                        self._save_state()
                    
                    print(f"[ExecutionQueue] Job {job.id} completed")
                    
                except Exception as e:
                    import traceback
                    error_msg = str(e)
                    traceback.print_exc()
                    
                    with self._lock:
                        job.status = JobStatus.FAILED
                        job.completed_at = time.time()
                        job.error = error_msg
                        self._current_job = None
                        self._save_state()
                    
                    print(f"[ExecutionQueue] Job {job.id} failed: {error_msg}")
            else:
                # No jobs, wait a bit before checking again
                await asyncio.sleep(0.1)
    
    async def _execute_job(self, job: ExecutionJob) -> Dict[str, Any]:
        """Execute a single job - runs the workflow"""
        if not self.engine_factory:
            raise RuntimeError("No engine factory configured")
        
        # Get engine instance
        engine = self.engine_factory()
        
        # Convert frontend workflow format to backend format
        backend_workflow = self._convert_workflow(job.workflow)
        
        # Build context variables from options
        context_variables = {}
        if job.options:
            if "client_id" in job.options:
                context_variables["user_id"] = job.options["client_id"]
            if "user_id" in job.options:
                context_variables["user_id"] = job.options["user_id"]
            if "user_query" in job.options:
                context_variables["user_query"] = job.options["user_query"]
            if "extra_data" in job.options:
                context_variables.update(job.options["extra_data"])
            if "variables" in job.options:
                context_variables.update(job.options["variables"])
        
        # Execute (this is synchronous, but we're in an async context)
        # Run in thread pool to not block the event loop
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            None,
            lambda: engine.execute(backend_workflow, context_variables)
        )
        
        # Convert result to frontend format
        return self._convert_result(result)
    
    def _convert_workflow(self, frontend_workflow: Dict[str, Any]) -> Dict[str, Any]:
        """Convert frontend workflow format to backend format"""
        backend_workflow = {
            "id": frontend_workflow.get("id", "workflow-1"),
            "name": frontend_workflow.get("name", "Obelisk Workflow"),
            "nodes": [],
            "connections": []
        }
        
        for node in frontend_workflow.get("nodes", []):
            backend_node = {
                "id": str(node["id"]),
                "type": node["type"],
                "position": node.get("position", {"x": 0, "y": 0}),
            }
            
            inputs = node.get("inputs", {}).copy()
            metadata = node.get("metadata", {})
            if metadata:
                inputs.update(metadata)
            
            if inputs:
                backend_node["inputs"] = inputs
            
            backend_workflow["nodes"].append(backend_node)
        
        for i, conn in enumerate(frontend_workflow.get("connections", [])):
            backend_conn = {
                "id": f"conn-{i}",
                "source_node": str(conn.get("from") or conn.get("source_node", "")),
                "source_output": conn.get("from_output") or conn.get("source_output", "default"),
                "target_node": str(conn.get("to") or conn.get("target_node", "")),
                "target_input": conn.get("to_input") or conn.get("target_input", "default"),
                "data_type": "string"
            }
            backend_workflow["connections"].append(backend_conn)
        
        return backend_workflow
    
    def _convert_result(self, execution_result: Dict[str, Any]) -> Dict[str, Any]:
        """Convert backend execution result to frontend format"""
        def _serialize_value(value: Any) -> Any:
            if isinstance(value, (str, int, float, bool, type(None))):
                return value
            if isinstance(value, dict):
                return {k: _serialize_value(v) for k, v in value.items()}
            if isinstance(value, (list, tuple)):
                return [_serialize_value(item) for item in value]
            if hasattr(value, '__class__'):
                return {
                    "_type": value.__class__.__name__,
                    "_module": getattr(value.__class__, '__module__', 'unknown'),
                    "_repr": str(value)[:100]
                }
            return str(value)
        
        results = {}
        for node_result in execution_result.get("node_results", []):
            node_id = node_result.get("node_id")
            if node_id and node_result.get("success"):
                outputs = node_result.get("outputs", {})
                serialized_outputs = {k: _serialize_value(v) for k, v in outputs.items()}
                results[str(node_id)] = {"outputs": serialized_outputs}
        
        return {
            'success': execution_result.get('success', False),
            'results': results,
            'execution_order': execution_result.get('execution_order', []),
            'error': execution_result.get('error')
        }
