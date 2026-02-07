"""
Entry point for running the inference service directly.

Usage:
    cd obelisk-core
    python -m src.inference
"""
import uvicorn
from .config import InferenceConfig

if __name__ == "__main__":
    uvicorn.run(
        "src.inference.server:app",
        host=InferenceConfig.HOST,
        port=InferenceConfig.PORT,
        reload=False,
    )
