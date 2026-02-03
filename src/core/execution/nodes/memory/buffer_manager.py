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
        # Always reload from storage to ensure we have the latest interactions
        # This ensures that interactions saved in previous workflow executions are loaded
        load_limit = limit if limit is not None else self.k * 2
        interactions = storage.get_user_interactions(user_id, limit=load_limit)
        
        # DEBUG: Log what we're loading (safe metadata only, no sensitive content)
        logger.debug(f"[BufferManager] Loading {len(interactions)} interactions for user_id={user_id}, limit={load_limit}")
        if interactions:
            first_query_len = len(interactions[0].get('query', ''))
            first_response_len = len(interactions[0].get('response', ''))
            logger.debug(f"[BufferManager] First interaction [index=0]: query_len={first_query_len}, response_len={first_response_len}")
            if len(interactions) > 1:
                last_query_len = len(interactions[-1].get('query', ''))
                last_response_len = len(interactions[-1].get('response', ''))
                logger.debug(f"[BufferManager] Last interaction [index={len(interactions)-1}]: query_len={last_query_len}, response_len={last_response_len}")
        else:
            logger.debug(f"[BufferManager] No interactions found for user_id={user_id}")
        
        # Create or update buffer
        if user_id not in self.buffers:
            buffer = RecentConversationBuffer(k=self.k)
            self.buffers[user_id] = buffer
        else:
            # Clear existing buffer to reload fresh data
            self.buffers[user_id].clear()
            buffer = self.buffers[user_id]
        
        # Convert interactions to LangChain messages in chronological order (oldest→newest)
        # get_user_interactions returns interactions in chronological order (oldest first)
        message_count = 0
        for interaction in interactions:  # Iterate in original order to preserve chronological order
            query = interaction.get('query', '')
            response = interaction.get('response', '')
            if query:
                buffer.add_user_message(query)
                message_count += 1
            if response:
                buffer.add_ai_message(response)
                message_count += 1
        
        logger.debug(f"[BufferManager] Added {message_count} messages to buffer for user_id={user_id}")
        final_messages = buffer.get_messages()
        logger.debug(f"[BufferManager] Buffer now contains {len(final_messages)} messages")
        
        return buffer
    
    def clear_buffer(self, user_id: str):
        """Clear recent conversation buffer for a user"""
        if user_id in self.buffers:
            self.buffers[user_id].clear()
            del self.buffers[user_id]
    
    def clear_all_buffers(self):
        """Clear all buffers (useful for testing)"""
        for user_id in list(self.buffers.keys()):
            self.clear_buffer(user_id)
