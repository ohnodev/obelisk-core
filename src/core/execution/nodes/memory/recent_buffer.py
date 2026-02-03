"""
Recent Conversation Buffer
Manages a sliding window of recent messages for prompt injection
This is NOT memory - it's just the last X conversations to inject into the prompt
"""
from typing import List
from langchain_core.messages import HumanMessage, AIMessage, BaseMessage
from langchain_core.chat_history import InMemoryChatMessageHistory


class RecentConversationBuffer:
    """
    Buffer for recent conversation messages (last k message pairs)
    
    This is used to inject recent conversation context directly into the prompt.
    It's NOT memory - it's just a sliding window of the most recent exchanges.
    
    Memory (summarized long-term storage) is handled separately by ObeliskMemoryManager.
    """
    
    def __init__(self, k: int = 10):
        """
        Initialize recent conversation buffer
        
        Args:
            k: Number of recent message pairs to keep (default: 10)
        """
        self.k = k
        self.chat_history = InMemoryChatMessageHistory()
    
    def add_user_message(self, content: str):
        """Add a user message to the buffer"""
        msg = HumanMessage(content=content)
        self.chat_history.add_message(msg)
        self._trim_to_window()
    
    def add_ai_message(self, content: str):
        """Add an AI message to the buffer"""
        msg = AIMessage(content=content)
        self.chat_history.add_message(msg)
        self._trim_to_window()
    
    def _trim_to_window(self):
        """Trim buffer to keep only the last k message pairs"""
        # Keep last k*2 messages (k pairs of user+assistant)
        if len(self.chat_history.messages) > self.k * 2:
            recent_messages = self.chat_history.messages[-(self.k * 2):]
            self.chat_history.messages = recent_messages
    
    def get_messages(self) -> List[BaseMessage]:
        """
        Get current messages in the buffer window
        
        Returns:
            List of recent messages (last k pairs)
        """
        return self.chat_history.messages
    
    def clear(self):
        """Clear all messages from the buffer"""
        self.chat_history.clear()
