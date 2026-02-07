"""
Inference Queue
Manages async inference requests with a single-worker queue.
The model can only process one request at a time, so we serialize access.
"""
import asyncio
import logging
import time
from typing import Dict, Any, Optional

from .config import InferenceConfig
from .model import InferenceModel
from .types import InferenceRequest

logger = logging.getLogger("inference_service.queue")


class InferenceQueue:
    """
    Async queue for inference requests.
    
    - Accepts requests and puts them in an asyncio.Queue
    - A single worker processes requests one at a time
    - Callers await their result via an asyncio.Future
    """
    
    def __init__(self, model: InferenceModel):
        self.model = model
        self._queue: asyncio.Queue = asyncio.Queue(maxsize=InferenceConfig.MAX_QUEUE_SIZE)
        self._worker_task: Optional[asyncio.Task] = None
        self._is_processing = False
        self._total_processed = 0
    
    async def start(self):
        """Start the queue worker"""
        if self._worker_task is not None:
            logger.warning("Queue worker already running")
            return
        
        self._worker_task = asyncio.create_task(self._worker())
        logger.info(f"Inference queue started (max_size={InferenceConfig.MAX_QUEUE_SIZE})")
    
    async def stop(self):
        """Stop the queue worker gracefully"""
        if self._worker_task is None:
            return
        
        self._worker_task.cancel()
        try:
            await self._worker_task
        except asyncio.CancelledError:
            pass
        self._worker_task = None
        logger.info(f"Inference queue stopped (total processed: {self._total_processed})")
    
    async def submit(self, request: InferenceRequest, timeout: Optional[float] = None) -> Dict[str, Any]:
        """
        Submit an inference request and wait for the result.
        
        Args:
            request: InferenceRequest to process
            timeout: Max seconds to wait (default: from config)
            
        Returns:
            Inference result dict
            
        Raises:
            asyncio.QueueFull: If queue is at capacity
            asyncio.TimeoutError: If request times out
        """
        if timeout is None:
            timeout = InferenceConfig.REQUEST_TIMEOUT
        
        # Create a future for this request's result
        loop = asyncio.get_event_loop()
        future = loop.create_future()
        
        # Put request + future in queue (raises QueueFull if at capacity)
        try:
            self._queue.put_nowait((request, future))
        except asyncio.QueueFull:
            raise asyncio.QueueFull(
                f"Inference queue is full ({InferenceConfig.MAX_QUEUE_SIZE} requests pending). "
                "Try again later."
            )
        
        logger.debug(f"Request queued (queue_size={self._queue.qsize()})")
        
        # Wait for result with timeout
        try:
            result = await asyncio.wait_for(future, timeout=timeout)
            return result
        except asyncio.TimeoutError:
            logger.warning(f"Request timed out after {timeout}s")
            raise
    
    async def _worker(self):
        """Worker loop - processes one request at a time"""
        logger.info("Queue worker started")
        
        while True:
            try:
                # Wait for next request
                request, future = await self._queue.get()
                
                self._is_processing = True
                start_time = time.time()
                
                try:
                    # Run inference in a thread to not block the event loop
                    result = await asyncio.get_event_loop().run_in_executor(
                        None,
                        self._process_request,
                        request,
                    )
                    
                    elapsed = time.time() - start_time
                    logger.info(
                        f"Request processed in {elapsed:.2f}s "
                        f"(input={result.get('input_tokens', 0)}, "
                        f"output={result.get('output_tokens', 0)} tokens)"
                    )
                    
                    # Deliver result to caller
                    if not future.cancelled():
                        future.set_result(result)
                    
                    self._total_processed += 1
                    
                except Exception as e:
                    logger.exception("Error processing inference request")
                    if not future.cancelled():
                        future.set_result({
                            "response": "",
                            "thinking_content": "",
                            "error": str(e),
                            "source": "error",
                            "model": self.model.model_name,
                            "input_tokens": 0,
                            "output_tokens": 0,
                            "generation_params": {},
                        })
                finally:
                    self._is_processing = False
                    self._queue.task_done()
                    
            except asyncio.CancelledError:
                logger.info("Queue worker cancelled")
                break
            except Exception as e:
                logger.exception(f"Unexpected error in queue worker: {e}")
                await asyncio.sleep(0.1)  # Brief pause before continuing
    
    def _process_request(self, request: InferenceRequest) -> Dict[str, Any]:
        """
        Process a single inference request (runs in thread pool).
        
        Args:
            request: InferenceRequest to process
            
        Returns:
            Generation result dict
        """
        return self.model.generate(
            query=request.query,
            system_prompt=request.system_prompt,
            conversation_history=request.conversation_history,
            enable_thinking=request.enable_thinking,
            max_tokens=request.max_tokens,
            temperature=request.temperature,
            top_p=request.top_p,
            top_k=request.top_k,
            repetition_penalty=request.repetition_penalty,
        )
    
    @property
    def pending_count(self) -> int:
        """Number of requests waiting in queue"""
        return self._queue.qsize()
    
    @property
    def is_processing(self) -> bool:
        """Whether a request is currently being processed"""
        return self._is_processing
    
    @property
    def total_processed(self) -> int:
        """Total number of requests processed since start"""
        return self._total_processed
