"""
Recent Buffer Manager
Manages RecentConversationBuffer instances per user_id
"""
from typing import Dict, Optional
from .recent_buffer import RecentConversationBuffer
from src.storage.base import StorageInterface
from src.utils.logger import get_logger

logger = get_logger(__name__)

# LangChain is REQUIRED
try:
    from langchain_core.messages import HumanMessage, AIMessage
except ImportError as e:
    raise ImportError(
        "LangChain is required for memory management. Please install it with: pip install langchain langchain-core"
    ) from e


class RecentBufferManager:
    """
    Manages RecentConversationBuffer instances per user_id
    
    Handles loading recent interactions from storage and maintaining
    in-memory buffers for fast access.
    """
    
    def __init__(self, k: int = 10):
        """
        Initialize buffer manager
        
        Args:
            k: Number of recent message pairs to keep in buffer (default: 10)
        """
        self.k = k
        self.buffers: Dict[str, RecentConversationBuffer] = {}
    
    def get_buffer(
        self,
        user_id: str,
        storage: StorageInterface,
        limit: Optional[int] = None
    ) -> RecentConversationBuffer:
        """
        Get or create recent conversation buffer for a user
        
        Loads only the last k*2 messages (k message pairs) from storage.
        This is just for prompt injection, not memory storage.
        
        Args:
            user_id: User identifier
            storage: StorageInterface instance to load from
            limit: Optional limit override (defaults to k*2)
            
        Returns:
            RecentConversationBuffer instance with last k message pairs
        """
        if user_id not in self.buffers:
            # Load recent messages (last k*2 messages = k message pairs) for buffer
            load_limit = limit if limit is not None else self.k * 2
            interactions = storage.get_user_interactions(user_id, limit=load_limit)
            
            # Create buffer
            buffer = RecentConversationBuffer(k=self.k)
            
            # Convert interactions to LangChain messages (most recent first)
            for interaction in reversed(interactions):  # Reverse to get chronological order
                query = interaction.get('query', '')
                response = interaction.get('response', '')
                if query:
                    buffer.add_user_message(query)
                if response:
                    buffer.add_ai_message(response)
            
            self.buffers[user_id] = buffer
        
        return self.buffers[user_id]
    
    def clear_buffer(self, user_id: str):
        """Clear recent conversation buffer for a user"""
        if user_id in self.buffers:
            self.buffers[user_id].clear()
            del self.buffers[user_id]
    
    def clear_all_buffers(self):
        """Clear all buffers (useful for testing)"""
        for user_id in list(self.buffers.keys()):
            self.clear_buffer(user_id)
