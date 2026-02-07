"""
Request/Response types for the Inference Service
"""
from typing import Dict, Any, Optional, List
from pydantic import BaseModel, Field


class InferenceRequest(BaseModel):
    """Request payload for inference"""
    
    # Required
    query: str = Field(..., description="User query / input text")
    system_prompt: str = Field(..., description="System prompt for the model")
    
    # Optional conversation context
    conversation_history: Optional[List[Dict[str, str]]] = Field(
        default=None,
        description="Previous conversation messages [{'role': 'user'|'assistant', 'content': '...'}]"
    )
    
    # Generation parameters
    enable_thinking: bool = Field(default=True, description="Enable Qwen3 thinking mode")
    max_tokens: int = Field(default=1024, ge=1, le=8192, description="Maximum output tokens")
    temperature: float = Field(default=0.6, ge=0.01, le=2.0, description="Sampling temperature")
    top_p: float = Field(default=0.95, ge=0.01, le=1.0, description="Top-p (nucleus) sampling")
    top_k: int = Field(default=20, ge=1, le=200, description="Top-k sampling")
    repetition_penalty: float = Field(default=1.2, ge=1.0, le=3.0, description="Repetition penalty")


class InferenceResponse(BaseModel):
    """Response payload from inference"""
    
    response: str = Field(..., description="Generated response text")
    thinking_content: str = Field(default="", description="Thinking/reasoning content (if thinking mode enabled)")
    model: str = Field(..., description="Model name used for generation")
    
    # Token usage
    input_tokens: int = Field(default=0, description="Number of input tokens")
    output_tokens: int = Field(default=0, description="Number of output tokens")
    
    # Generation metadata
    generation_params: Dict[str, Any] = Field(
        default_factory=dict,
        description="Parameters used for generation (temperature, top_p, etc.)"
    )
    
    # Status
    source: str = Field(default="inference_service", description="Source of the response")
    error: Optional[str] = Field(default=None, description="Error message if generation failed")


class HealthResponse(BaseModel):
    """Health check response"""
    status: str
    model_loaded: bool
    model_name: str
    device: str
    memory_estimate_mb: int
    queue_size: int


class QueueStatusResponse(BaseModel):
    """Queue status response"""
    pending_requests: int
    is_processing: bool
