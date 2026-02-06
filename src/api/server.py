"""
FastAPI server for Obelisk Core
"""
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from .routes import router
from .queue import ExecutionQueue
from ..core.bootstrap import get_container
from ..core.config import Config
from ..core.execution.runner import WorkflowRunner
from ..core.execution.engine import ExecutionEngine

app = FastAPI(title="Obelisk Core API", version="0.1.0-alpha")

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, restrict this
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routes
app.include_router(router, prefix="/api/v1")


@app.on_event("startup")
async def startup():
    """Initialize services on startup"""
    # Build container and store in app.state for route access
    app.state.container = get_container(mode=Config.MODE)
    
    # Initialize WorkflowRunner for autonomous workflow execution
    app.state.workflow_runner = WorkflowRunner(app.state.container)
    
    # Initialize ExecutionQueue with engine factory
    def engine_factory():
        return ExecutionEngine(app.state.container)
    
    app.state.execution_queue = ExecutionQueue(
        data_dir="data",
        engine_factory=engine_factory
    )
    
    # Start queue worker
    await app.state.execution_queue.start_worker()


@app.on_event("shutdown")
async def shutdown():
    """Clean up on shutdown"""
    # Stop execution queue worker
    if hasattr(app.state, 'execution_queue'):
        await app.state.execution_queue.stop_worker()
    
    # Stop all running workflows
    if hasattr(app.state, 'workflow_runner'):
        app.state.workflow_runner.stop_all()


@app.get("/")
async def root():
    """Root endpoint"""
    return {
        "service": "Obelisk Core",
        "version": "0.1.0-alpha",
        "mode": Config.MODE,
        "status": "running"
    }


@app.get("/health")
async def health():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "mode": Config.MODE
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=Config.API_HOST, port=Config.API_PORT)
