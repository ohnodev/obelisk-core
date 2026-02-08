"""
Inference Service - FastAPI Server
Standalone service that loads the model and serves inference requests.

Usage:
    python -m src.inference.server
    
    Or with uvicorn:
    uvicorn src.inference.server:app --host 127.0.0.1 --port 7780
"""
import asyncio
import logging
import sys
import os

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware

from .config import InferenceConfig
from .model import InferenceModel
from .queue import InferenceQueue
from .types import InferenceRequest, InferenceResponse, HealthResponse, QueueStatusResponse


def _verify_api_key(request: Request) -> None:
    """
    Verify the API key from the request.
    Accepts either:
      - Authorization: Bearer <key>
      - X-API-Key: <key>
    
    If INFERENCE_API_KEY is not set, auth is disabled (local dev mode).
    Raises HTTPException 401 if key is missing/invalid.
    """
    api_key = InferenceConfig.API_KEY
    if not api_key:
        return  # Auth disabled
    
    # Check Authorization: Bearer <key>
    auth_header = request.headers.get("authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header[7:].strip()
        if token == api_key:
            return
    
    # Check X-API-Key header
    x_api_key = request.headers.get("x-api-key", "")
    if x_api_key == api_key:
        return
    
    raise HTTPException(
        status_code=401,
        detail="Invalid or missing API key. Provide via 'Authorization: Bearer <key>' or 'X-API-Key: <key>' header.",
    )

# Configure logging
log_level = logging.DEBUG if InferenceConfig.DEBUG else logging.INFO
logging.basicConfig(
    level=log_level,
    format="[%(levelname)s] %(name)s: %(message)s",
    stream=sys.stdout,
)
logger = logging.getLogger("inference_service")

# Create FastAPI app
app = FastAPI(
    title="Obelisk Inference Service",
    description="Standalone inference service for Obelisk LLM",
    version="0.1.0",
)

# CORS — controlled via InferenceConfig.CORS_ORIGINS (env: INFERENCE_CORS_ORIGINS).
# Defaults include https://build.theobelisk.ai and localhost dev origins.
# Server-to-server calls (InferenceClient) bypass CORS entirely.
app.add_middleware(
    CORSMiddleware,
    allow_origins=InferenceConfig.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Service state (initialized on startup)
_model: InferenceModel = None
_queue: InferenceQueue = None


@app.on_event("startup")
async def startup():
    """Load model and start queue on startup"""
    global _model, _queue
    
    logger.info("=" * 60)
    logger.info("Obelisk Inference Service starting...")
    logger.info(f"  Model:   {InferenceConfig.MODEL_NAME}")
    logger.info(f"  Host:    {InferenceConfig.HOST}:{InferenceConfig.PORT}")
    logger.info(f"  Queue:   max_size={InferenceConfig.MAX_QUEUE_SIZE}")
    logger.info(f"  CORS:    {InferenceConfig.CORS_ORIGINS}")
    logger.info(f"  Device:  {os.getenv('INFERENCE_DEVICE', 'auto (cuda > cpu)')}")
    logger.info(f"  Auth:    {'API key required' if InferenceConfig.API_KEY else 'DISABLED (no INFERENCE_API_KEY set)'}")
    logger.info(f"  Debug:   {InferenceConfig.DEBUG}")
    logger.info("=" * 60)
    
    # Load model
    _model = InferenceModel()
    success = _model.load()
    
    if not success:
        logger.error("Failed to load model! Service will return errors for all requests.")
    else:
        logger.info(f"Model loaded: {_model.model_name} on {_model.device} (~{_model.estimate_memory()}MB)")
    
    # Start queue
    _queue = InferenceQueue(_model)
    await _queue.start()
    
    logger.info("Inference service ready")


@app.on_event("shutdown")
async def shutdown():
    """Clean up on shutdown"""
    global _queue
    if _queue:
        await _queue.stop()
    logger.info("Inference service stopped")


@app.get("/", response_model=dict)
async def root():
    """Root endpoint"""
    return {
        "service": "Obelisk Inference Service",
        "version": "0.1.0",
        "model": InferenceConfig.MODEL_NAME,
        "status": "running" if (_model and _model.is_loaded) else "model_not_loaded",
    }


@app.get("/health", response_model=HealthResponse)
async def health():
    """Health check with model and queue status"""
    return HealthResponse(
        status="healthy" if (_model and _model.is_loaded) else "degraded",
        model_loaded=_model.is_loaded if _model else False,
        model_name=InferenceConfig.MODEL_NAME,
        device=_model.device if _model else "unknown",
        memory_estimate_mb=_model.estimate_memory() if _model else 0,
        queue_size=_queue.pending_count if _queue else 0,
    )


@app.get("/queue", response_model=QueueStatusResponse)
async def queue_status():
    """Get queue status"""
    return QueueStatusResponse(
        pending_requests=_queue.pending_count if _queue else 0,
        is_processing=_queue.is_processing if _queue else False,
    )


@app.post("/v1/inference", response_model=InferenceResponse)
async def inference(request: InferenceRequest, raw_request: Request):
    """
    Run inference on the model.
    
    Accepts a query + system prompt and returns the generated response.
    Requests are queued and processed one at a time.
    
    Requires API key when INFERENCE_API_KEY is set.
    Send via: Authorization: Bearer <key> or X-API-Key: <key>
    """
    _verify_api_key(raw_request)
    
    if not _model or not _model.is_loaded:
        raise HTTPException(
            status_code=503,
            detail="Model not loaded. Service is starting up or failed to load.",
        )
    
    if not _queue:
        raise HTTPException(
            status_code=503,
            detail="Inference queue not initialized.",
        )
    
    try:
        result = await _queue.submit(request)
    except asyncio.QueueFull:
        raise HTTPException(
            status_code=429,
            detail=f"Inference queue is full ({InferenceConfig.MAX_QUEUE_SIZE} requests pending). Try again later.",
        )
    except asyncio.TimeoutError:
        raise HTTPException(
            status_code=504,
            detail=f"Inference request timed out after {InferenceConfig.REQUEST_TIMEOUT}s.",
        )
    except Exception as e:
        logger.exception("Unexpected error during inference")
        raise HTTPException(
            status_code=500,
            detail=f"Inference failed: {str(e)}",
        )
    
    # Check for generation errors
    if result.get("error"):
        # Still return the response (may have partial content or error message)
        logger.warning(f"Inference completed with error: {result['error']}")
    
    return InferenceResponse(
        response=result.get("response", ""),
        thinking_content=result.get("thinking_content", ""),
        model=result.get("model", InferenceConfig.MODEL_NAME),
        input_tokens=result.get("input_tokens", 0),
        output_tokens=result.get("output_tokens", 0),
        generation_params=result.get("generation_params", {}),
        source=result.get("source", "inference_service"),
        error=result.get("error"),
    )


# Allow running directly: python -m src.inference.server
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "src.inference.server:app",
        host=InferenceConfig.HOST,
        port=InferenceConfig.PORT,
        reload=False,
    )
