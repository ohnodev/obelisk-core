"""
Telegram Memory Selector Node
Retrieves relevant context for a Telegram chat
"""
import time
from typing import Dict, Any, Optional, List
from ..node_base import BaseNode, ExecutionContext
from ....utils.logger import get_logger

logger = get_logger(__name__)


class TelegramMemorySelectorNode(BaseNode):
    """
    Retrieves relevant context for a Telegram chat.
    
    Fetches:
    - Recent messages from the specific chat
    - Summaries created for this chat
    - Combines them into usable context for the agent
    
    Inputs:
        message: The incoming message to find context for (optional, for semantic search)
        chat_id: Telegram chat/group ID to filter by (required)
        storage_instance: StorageInterface instance (required)
        model: ObeliskLLM instance (optional, for semantic search)
    
    Properties:
        recent_count: Number of recent messages to include (default: 20)
        include_summaries: Whether to include summaries (default: true)
    
    Outputs:
        context: Combined context (summaries + recent messages)
        recent_messages: Just the recent raw messages
        summaries: Just the summaries
        message: Original message passed through (for chaining to next node)
    """
    
    def __init__(self, node_id: str, node_data: Dict[str, Any]):
        """Initialize telegram memory selector node"""
        super().__init__(node_id, node_data)
        self._recent_count = int(self.metadata.get('recent_count', 20))
        self._include_summaries = self.metadata.get('include_summaries', True)
    
    def _get_recent_messages(
        self,
        storage_instance,
        chat_id: str,
        count: int
    ) -> List[Dict]:
        """Fetch recent messages for a chat from storage"""
        try:
            # Get activity logs filtered by type and chat_id
            logs = storage_instance.get_activity_logs(
                activity_type='telegram_message',
                limit=count * 2  # Get more than needed, we'll filter by chat_id
            )
            
            # Filter by chat_id and take most recent
            chat_messages = []
            for log in logs:
                metadata = log.get('metadata', {})
                if metadata.get('chat_id') == chat_id:
                    chat_messages.append({
                        'message': metadata.get('message', ''),
                        'user_id': metadata.get('user_id', ''),
                        'username': metadata.get('username', ''),
                        'timestamp': metadata.get('timestamp', log.get('timestamp', 0))
                    })
                    if len(chat_messages) >= count:
                        break
            
            # Sort by timestamp (newest last for chronological order)
            chat_messages.sort(key=lambda x: x.get('timestamp', 0))
            
            return chat_messages
            
        except Exception as e:
            logger.error(f"[TelegramMemorySelector] Error fetching messages: {e}")
            return []
    
    def _get_summaries(
        self,
        storage_instance,
        chat_id: str,
        limit: int = 5
    ) -> List[Dict]:
        """Fetch summaries for a chat from storage"""
        try:
            # Get activity logs for summaries
            logs = storage_instance.get_activity_logs(
                activity_type='telegram_summary',
                limit=limit * 2
            )
            
            # Filter by chat_id
            chat_summaries = []
            for log in logs:
                metadata = log.get('metadata', {})
                if metadata.get('chat_id') == chat_id:
                    chat_summaries.append({
                        'summary': metadata.get('summary', ''),
                        'keyTopics': metadata.get('keyTopics', []),
                        'sentiment': metadata.get('sentiment', ''),
                        'timestamp': metadata.get('timestamp', log.get('timestamp', 0))
                    })
                    if len(chat_summaries) >= limit:
                        break
            
            # Sort by timestamp (most recent first)
            chat_summaries.sort(key=lambda x: x.get('timestamp', 0), reverse=True)
            
            return chat_summaries
            
        except Exception as e:
            logger.error(f"[TelegramMemorySelector] Error fetching summaries: {e}")
            return []
    
    def _format_messages(self, messages: List[Dict]) -> str:
        """Format messages into readable text"""
        if not messages:
            return ""
        
        lines = ["=== Recent Messages ==="]
        for msg in messages:
            username = msg.get('username') or msg.get('user_id', 'Unknown')
            text = msg.get('message', '')
            lines.append(f"[{username}]: {text}")
        
        return "\n".join(lines)
    
    def _format_summaries(self, summaries: List[Dict]) -> str:
        """Format summaries into readable text"""
        if not summaries:
            return ""
        
        lines = ["=== Chat Summaries ==="]
        for i, summary in enumerate(summaries, 1):
            lines.append(f"\n--- Summary {i} ---")
            lines.append(summary.get('summary', 'No summary available'))
            topics = summary.get('keyTopics', [])
            if topics:
                lines.append(f"Topics: {', '.join(topics)}")
            sentiment = summary.get('sentiment', '')
            if sentiment:
                lines.append(f"Sentiment: {sentiment}")
        
        return "\n".join(lines)
    
    def execute(self, context: ExecutionContext) -> Dict[str, Any]:
        """Execute telegram memory selector - retrieves context for a chat"""
        message = self.get_input_value('message', context, '')  # Optional
        chat_id = self.get_input_value('chat_id', context, '')
        storage_instance = self.get_input_value('storage_instance', context, None)
        llm = self.get_input_value('model', context, None)  # Optional for semantic search
        
        # Get properties
        recent_count = int(self.metadata.get('recent_count', 20))
        include_summaries = self.metadata.get('include_summaries', True)
        
        # Validate required inputs
        if not chat_id:
            logger.warning("[TelegramMemorySelector] No chat_id provided")
            return {'context': '', 'recent_messages': '', 'summaries': '', 'message': str(message) if message else ''}
        
        if storage_instance is None:
            raise ValueError("storage_instance is required for TelegramMemorySelectorNode")
        
        # Fetch recent messages
        messages = self._get_recent_messages(storage_instance, str(chat_id), recent_count)
        recent_messages_text = self._format_messages(messages)
        
        # Fetch summaries if enabled
        summaries_text = ""
        if include_summaries:
            summaries = self._get_summaries(storage_instance, str(chat_id))
            summaries_text = self._format_summaries(summaries)
        
        # Combine into context
        context_parts = []
        if summaries_text:
            context_parts.append(summaries_text)
        if recent_messages_text:
            context_parts.append(recent_messages_text)
        
        combined_context = "\n\n".join(context_parts) if context_parts else "No chat history available."
        
        logger.info(f"[TelegramMemorySelector] Retrieved {len(messages)} messages and {len(summaries) if include_summaries else 0} summaries for chat {chat_id}")
        if messages:
            logger.debug(f"[TelegramMemorySelector] Sample message: {messages[-1]}")
        logger.debug(f"[TelegramMemorySelector] Context length: {len(combined_context)} chars")
        
        return {
            'context': combined_context,
            'recent_messages': recent_messages_text,
            'summaries': summaries_text,
            'message': str(message) if message else ''
        }
