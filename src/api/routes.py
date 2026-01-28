"""
API routes for Obelisk Core
"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional, Dict, Any, List
import sys
import os

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))

from config import Config

router = APIRouter()

# Global instances (initialized on first request)
_storage = None
_llm = None
_quantum_service = None
_memory_manager = None

def get_storage():
    """Get storage instance"""
    global _storage
    if _storage is None:
        _storage = Config.get_storage()
    return _storage

def get_llm():
    """Get LLM instance"""
    global _llm
    if _llm is None:
        from ..llm.obelisk_llm import ObeliskLLM
        _llm = ObeliskLLM(storage=get_storage())
    return _llm

def get_quantum_service():
    """Get quantum service instance"""
    global _quantum_service
    if _quantum_service is None:
        from ..quantum.ibm_quantum_service import IBMQuantumService
        _quantum_service = IBMQuantumService(
            api_key=Config.IBM_QUANTUM_API_KEY,
            instance=Config.IBM_QUANTUM_INSTANCE
        )
    return _quantum_service

def get_memory_manager():
    """Get memory manager instance"""
    global _memory_manager
    if _memory_manager is None:
        from ..memory.memory_manager import ObeliskMemoryManager
        _memory_manager = ObeliskMemoryManager(
            storage=get_storage(),
            llm=get_llm(),
            mistral_api_key=Config.MISTRAL_API_KEY,
            agent_id=Config.MISTRAL_AGENT_ID,
            mode=Config.MODE
        )
    return _memory_manager


# Request/Response models
class GenerateRequest(BaseModel):
    prompt: str
    quantum_influence: float = 0.7
    conversation_context: Optional[str] = None
    user_id: Optional[str] = None

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


# LLM Endpoints
@router.post("/generate", response_model=GenerateResponse)
async def generate(request: GenerateRequest):
    """Generate response from The Obelisk"""
    try:
        llm = get_llm()
        memory_manager = get_memory_manager()
        
        # Get conversation context if user_id provided
        conversation_context = request.conversation_context
        if request.user_id and not conversation_context:
            conversation_context = memory_manager.get_conversation_context(request.user_id)
        
        result = llm.generate(
            query=request.prompt,
            quantum_influence=request.quantum_influence,
            conversation_context=conversation_context
        )
        
        # Add to memory if user_id provided (handles storage internally - Option C)
        if request.user_id:
            memory_manager.add_interaction(
                user_id=request.user_id,
                query=request.prompt,
                response=result.get('response', ''),
                cycle_id=None,  # Will auto-detect current cycle if available
                energy=0.0,
                quantum_seed=request.quantum_influence,
                reward_score=0.0
            )
        
        return GenerateResponse(
            response=result.get('response', ''),
            tokens_used=None,  # Could be calculated from model
            source=result.get('source', 'obelisk_llm')
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/health")
async def health():
    """Health check"""
    try:
        llm = get_llm()
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
async def get_quantum_influence(request: QuantumInfluenceRequest):
    """Get quantum influence value"""
    try:
        quantum_service = get_quantum_service()
        result = quantum_service.get_quantum_random(num_qubits=2, shots=128)
        return QuantumInfluenceResponse(
            influence=result.get('value', 0.5),
            random_value=result.get('value', 0.5)
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# Evolution Endpoints
@router.post("/evolve", response_model=EvolveResponse)
async def evolve(request: EvolveRequest):
    """Process evolution cycle"""
    try:
        from ..evolution.processor import process_evolution_cycle
        
        storage = get_storage()
        llm = get_llm()
        
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
async def get_cycle_status(cycle_id: str):
    """Get evolution cycle status"""
    try:
        storage = get_storage()
        cycle = storage.get_evolution_cycle(cycle_id)
        if not cycle:
            raise HTTPException(status_code=404, detail="Cycle not found")
        return cycle
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# Memory Endpoints
@router.get("/memory/{user_id}")
async def get_memory(user_id: str):
    """Get conversation context for user"""
    try:
        memory_manager = get_memory_manager()
        context = memory_manager.get_conversation_context(user_id)
        return {
            "user_id": user_id,
            "context": context
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/memory/{user_id}")
async def save_interaction(user_id: str, query: str, response: str):
    """Save interaction to memory"""
    try:
        memory_manager = get_memory_manager()
        memory_manager.add_interaction(user_id, query, response)
        return {"status": "saved"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
