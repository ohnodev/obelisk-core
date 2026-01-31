"""
Type definitions for Obelisk Core

This module provides:
- Protocols for core interfaces (LLM, Memory, Storage, etc.)
- TypedDict for structured data
- Type aliases for common types
- Types for future node-based visual workflow system
"""
from typing import Protocol, TypedDict, TypeAlias, Optional, Dict, Any, List, Union, Literal
from typing_extensions import NotRequired


# ============================================================================
# Type Aliases
# ============================================================================

UserID: TypeAlias = str
CycleID: TypeAlias = str
NodeID: TypeAlias = str
ConnectionID: TypeAlias = str
MessageRole: TypeAlias = Literal["user", "assistant", "system"]


# ============================================================================
# Core Interface Protocols
# ============================================================================

class LLMProtocol(Protocol):
    """Protocol for LLM interface - supports any LLM implementation"""
    
    def generate(
        self,
        query: str,
        quantum_influence: float = 0.7,
        max_length: int = 1024,
        conversation_context: Optional[Dict[str, Any]] = None,
        enable_thinking: bool = True
    ) -> Dict[str, Any]:
        """
        Generate response from LLM
        
        Args:
            query: User's query
            quantum_influence: Quantum random value (0-0.1) to influence creativity
            max_length: Maximum response length
            conversation_context: Dict with 'messages' and 'memories'
            enable_thinking: Whether to enable thinking mode
        
        Returns:
            Dict with 'response', 'thinking_content', and metadata
        """
        ...


class MemoryManagerProtocol(Protocol):
    """Protocol for memory management interface"""
    
    def get_conversation_context(
        self,
        user_id: str,
        user_query: str
    ) -> Dict[str, Any]:
        """
        Get conversation context for a user
        
        Args:
            user_id: User identifier
            user_query: Current user query (required for memory selection)
        
        Returns:
            Dict with 'messages' and 'memories'
        """
        ...
    
    def add_interaction(
        self,
        user_id: UserID,
        query: str,
        response: str,
        cycle_id: Optional[CycleID] = None,
        energy: float = 0.0,
        quantum_seed: float = 0.0,
        reward_score: float = 0.0
    ) -> None:
        """
        Add an interaction to memory
        
        Args:
            user_id: User identifier
            query: User's query
            response: Assistant's response
            cycle_id: Evolution cycle ID (optional)
            energy: Energy value (optional)
            quantum_seed: Quantum seed value (optional)
            reward_score: Reward score (optional)
        """
        ...
    
    def get_buffer(self, user_id: UserID) -> Any:
        """Get conversation buffer for a user"""
        ...


class StorageProtocol(Protocol):
    """Protocol for storage interface"""
    
    def get_interactions(self, cycle_id: CycleID) -> List[Dict[str, Any]]:
        """Get all interactions for an evolution cycle"""
        ...
    
    def save_interaction(
        self,
        user_id: UserID,
        query: str,
        response: str,
        cycle_id: Optional[CycleID] = None,
        energy: float = 0.0,
        quantum_seed: float = 0.0,
        reward_score: float = 0.0
    ) -> str:
        """Save an interaction and return the interaction ID"""
        ...
    
    def get_user_interactions(
        self,
        user_id: UserID,
        limit: Optional[int] = None
    ) -> List[Dict[str, Any]]:
        """Get interactions for a user"""
        ...


class QuantumServiceProtocol(Protocol):
    """Protocol for quantum service interface"""
    
    def get_quantum_influence(self) -> float:
        """Get quantum influence value (0.0-1.0)"""
        ...


# ============================================================================
# Structured Data Types (TypedDict)
# ============================================================================

class ConversationMessage(TypedDict):
    """A single message in a conversation"""
    role: MessageRole
    content: str


class ConversationContextDict(TypedDict):
    """Conversation context structure"""
    messages: List[ConversationMessage]
    memories: str


class LLMGenerationResult(TypedDict):
    """Result from LLM generation"""
    response: str
    thinking_content: NotRequired[str]
    source: str
    tokens_used: NotRequired[int]
    quantum_influence: NotRequired[float]
    error: NotRequired[str]


class InteractionDict(TypedDict):
    """An interaction between user and assistant"""
    user_id: UserID
    query: str
    response: str
    cycle_id: NotRequired[CycleID]
    energy: NotRequired[float]
    quantum_seed: NotRequired[float]
    reward_score: NotRequired[float]
    timestamp: NotRequired[float]


# ============================================================================
# Node-Based System Types (for future visual workflow system)
# ============================================================================

class NodeInput(TypedDict):
    """Input definition for a node"""
    name: str
    type: str  # e.g., "text", "image", "video", "number", "boolean"
    default: NotRequired[Any]
    description: NotRequired[str]


class NodeOutput(TypedDict):
    """Output definition for a node"""
    name: str
    type: str  # e.g., "text", "image", "video", "number", "boolean"
    description: NotRequired[str]


class NodeData(TypedDict):
    """Data for a single node in the graph"""
    id: NodeID
    type: str  # Node type (e.g., "llm_generate", "video_render", "image_process")
    position: Dict[str, float]  # {"x": 0.0, "y": 0.0}
    inputs: NotRequired[Dict[str, Any]]  # Input values
    outputs: NotRequired[Dict[str, Any]]  # Output values (computed)
    metadata: NotRequired[Dict[str, Any]]  # Additional metadata


class ConnectionData(TypedDict):
    """Connection between two nodes"""
    id: ConnectionID
    source_node: NodeID
    source_output: str  # Output name on source node
    target_node: NodeID
    target_input: str  # Input name on target node
    data_type: str  # Type of data flowing through connection


class NodeGraph(TypedDict):
    """Complete node graph/workflow"""
    id: str
    name: str
    nodes: List[NodeData]
    connections: List[ConnectionData]
    metadata: NotRequired[Dict[str, Any]]


class NodeExecutionResult(TypedDict):
    """Result from executing a node"""
    node_id: NodeID
    success: bool
    outputs: Dict[str, Any]
    error: NotRequired[str]
    execution_time: NotRequired[float]


class GraphExecutionResult(TypedDict):
    """Result from executing an entire graph"""
    graph_id: str
    success: bool
    node_results: List[NodeExecutionResult]
    final_outputs: Dict[str, Any]
    error: NotRequired[str]
    total_execution_time: NotRequired[float]


# ============================================================================
# Node Type Definitions (for future extensibility)
# ============================================================================

class NodeTypeDefinition(TypedDict):
    """Definition of a node type (like a class definition)"""
    type: str  # Unique node type identifier
    name: str  # Human-readable name
    category: str  # Category (e.g., "llm", "video", "image", "utility")
    description: str
    inputs: List[NodeInput]
    outputs: List[NodeOutput]
    icon: NotRequired[str]  # Icon identifier or path
    color: NotRequired[str]  # Color for UI


# ============================================================================
# Video Generation Types (for future video node system)
# ============================================================================

class VideoFrame(TypedDict):
    """A single frame in a video"""
    frame_number: int
    timestamp: float
    data: Any  # Frame data (could be image array, path, etc.)
    metadata: NotRequired[Dict[str, Any]]


class VideoGenerationParams(TypedDict):
    """Parameters for video generation"""
    width: int
    height: int
    fps: int
    duration: float  # Duration in seconds
    codec: NotRequired[str]
    bitrate: NotRequired[int]
    format: NotRequired[str]  # e.g., "mp4", "webm"


class VideoNodeData(NodeData):
    """Extended node data for video-specific nodes"""
    video_params: NotRequired[VideoGenerationParams]
    frame_data: NotRequired[List[VideoFrame]]


# ============================================================================
# Evolution Cycle Types
# ============================================================================

class EvolutionCycle(TypedDict):
    """An evolution cycle"""
    cycle_id: CycleID
    start_time: float
    end_time: NotRequired[float]
    interactions: List[InteractionDict]
    best_interaction: NotRequired[InteractionDict]
    total_energy: NotRequired[float]
    metadata: NotRequired[Dict[str, Any]]


# ============================================================================
# Training Types
# ============================================================================

class TrainingDatasetItem(TypedDict):
    """A single item in a training dataset"""
    user: str
    assistant: str
    metadata: NotRequired[Dict[str, Any]]


class TrainingConfig(TypedDict):
    """Configuration for model training"""
    epochs: int
    learning_rate: float
    batch_size: int
    dataset_path: str
    output_path: NotRequired[str]
    metadata: NotRequired[Dict[str, Any]]
