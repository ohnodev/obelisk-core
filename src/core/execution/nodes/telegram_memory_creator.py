"""
Telegram Memory Creator Node
Stores Telegram messages and creates summaries per chat
"""
import time
import weakref
from typing import Dict, Any, Optional, List
from ..node_base import BaseNode, ExecutionContext
from ....utils.logger import get_logger

logger = get_logger(__name__)


class TelegramMemoryCreatorNode(BaseNode):
    """
    Stores Telegram messages and creates summaries per chat.
    
    Unlike regular MemoryCreator which stores Q&A pairs, this stores
    individual messages with metadata (user_id, username, chat_id).
    
    Tracks message count per chat_id and triggers summarization
    when threshold is reached.
    
    Inputs:
        message: Message text (required)
        user_id: Telegram user ID (required)
        username: Telegram username (optional)
        chat_id: Telegram chat/group ID (required)
        storage_instance: StorageInterface instance (required)
        model: ObeliskLLM instance (required for summarization)
    
    Properties:
        summarize_threshold: Number of messages before summarizing (default: 50)
    
    Outputs:
        success: Boolean indicating if message was stored
        message_count: Current message count for this chat
        summary_created: True if a summary was just created
    """
    
    # Class-level cache using WeakKeyDictionary to auto-cleanup when storage is GC'd
    # storage_instance -> chat_id -> count
    _message_counts: weakref.WeakKeyDictionary = weakref.WeakKeyDictionary()
    
    # storage_instance -> chat_id -> [messages]
    _message_buffers: weakref.WeakKeyDictionary = weakref.WeakKeyDictionary()
    
    def __init__(self, node_id: str, node_data: Dict[str, Any]):
        """Initialize telegram memory creator node"""
        super().__init__(node_id, node_data)
        self._summarize_threshold = int(self.metadata.get('summarize_threshold', 50))
    
    def _get_message_count(self, storage_instance, chat_id: str) -> int:
        """Get message count for a chat"""
        if storage_instance not in self._message_counts:
            self._message_counts[storage_instance] = {}
        if chat_id not in self._message_counts[storage_instance]:
            self._message_counts[storage_instance][chat_id] = 0
        return self._message_counts[storage_instance][chat_id]
    
    def _increment_message_count(self, storage_instance, chat_id: str) -> int:
        """Increment and return message count for a chat"""
        if storage_instance not in self._message_counts:
            self._message_counts[storage_instance] = {}
        if chat_id not in self._message_counts[storage_instance]:
            self._message_counts[storage_instance][chat_id] = 0
        self._message_counts[storage_instance][chat_id] += 1
        return self._message_counts[storage_instance][chat_id]
    
    def _get_message_buffer(self, storage_instance, chat_id: str) -> List[Dict]:
        """Get message buffer for a chat"""
        if storage_instance not in self._message_buffers:
            self._message_buffers[storage_instance] = {}
        if chat_id not in self._message_buffers[storage_instance]:
            self._message_buffers[storage_instance][chat_id] = []
        return self._message_buffers[storage_instance][chat_id]
    
    def _add_to_buffer(self, storage_instance, chat_id: str, message_data: Dict):
        """Add message to buffer"""
        buffer = self._get_message_buffer(storage_instance, chat_id)
        buffer.append(message_data)
        # Keep buffer size reasonable (2x threshold)
        max_size = self._summarize_threshold * 2
        if len(buffer) > max_size:
            self._message_buffers[storage_instance][chat_id] = buffer[-max_size:]
    
    def _clear_buffer(self, storage_instance, chat_id: str):
        """Clear message buffer after summarization"""
        if storage_instance in self._message_buffers and chat_id in self._message_buffers[storage_instance]:
            self._message_buffers[storage_instance][chat_id] = []
    
    def _summarize_messages(
        self,
        llm,
        messages: List[Dict],
        chat_id: str
    ) -> Optional[Dict[str, Any]]:
        """
        Summarize chat messages using LLM.
        """
        if not messages:
            return None
        
        try:
            # Format messages for summarization
            conversation_text = ""
            for msg in messages:
                username = msg.get('username') or msg.get('user_id', 'Unknown')
                text = msg.get('message', '')
                timestamp = msg.get('timestamp', '')
                conversation_text += f"[{username}]: {text}\n"
            
            # System prompt for Telegram message summarization
            system_prompt = """You are a memory extraction system for Telegram group chats. Your role is to analyze chat messages and extract structured information as JSON.

You MUST return ONLY valid JSON. No markdown code blocks, no explanations, no text before or after the JSON. Start with { and end with }.

Extract and structure the following information as JSON with these EXACT keys:
- summary: A brief 2-3 sentence overview of what was discussed in this chat segment
- keyTopics: Array of main topics discussed (e.g., ["crypto", "AI", "memes"])
- activeUsers: Array of usernames/user_ids that were most active
- sentiment: Overall sentiment of the conversation ("positive", "neutral", "negative", "mixed")
- importantMessages: Array of particularly important or notable messages (max 5)

Example of correct JSON format:
{
  "summary": "The group discussed upcoming NFT drops and debated AI capabilities. Several users shared memes.",
  "keyTopics": ["NFTs", "artificial intelligence", "memes"],
  "activeUsers": ["user123", "cryptofan", "aidev"],
  "sentiment": "positive",
  "importantMessages": ["Check out the new collection dropping tomorrow", "AI is getting scary good"]
}"""
            
            query = f"Summarize these Telegram messages:\n\n{conversation_text}\n\nReturn ONLY the JSON object, nothing else."
            
            result = llm.generate(
                query=query,
                system_prompt=system_prompt,
                quantum_influence=0.2,
                max_length=800,
                conversation_history=None,
                enable_thinking=False
            )
            
            summary_text = result.get('response', '').strip()
            
            # Extract JSON
            from ....utils.json_parser import extract_json_from_llm_response
            summary_data = extract_json_from_llm_response(summary_text, context="telegram_summary")
            return summary_data
            
        except Exception as e:
            logger.error(f"Error summarizing Telegram messages: {e}")
            return None
    
    def execute(self, context: ExecutionContext) -> Dict[str, Any]:
        """Execute telegram memory creator - stores message and potentially summarizes"""
        message = self.get_input_value('message', context, '')
        user_id = self.get_input_value('user_id', context, '')
        username = self.get_input_value('username', context, '')
        chat_id = self.get_input_value('chat_id', context, '')
        storage_instance = self.get_input_value('storage_instance', context, None)
        llm = self.get_input_value('model', context, None)
        
        # Get threshold from metadata
        summarize_threshold = int(self.metadata.get('summarize_threshold', 50))
        if summarize_threshold < 5:
            summarize_threshold = 5
        
        # Validate required inputs
        if not message:
            logger.warning("[TelegramMemoryCreator] No message provided")
            return {'success': False, 'message_count': 0, 'summary_created': False}
        
        if not chat_id:
            logger.warning("[TelegramMemoryCreator] No chat_id provided")
            return {'success': False, 'message_count': 0, 'summary_created': False}
        
        if storage_instance is None:
            raise ValueError("storage_instance is required for TelegramMemoryCreatorNode")
        
        # Create message data
        message_data = {
            'message': str(message),
            'user_id': str(user_id) if user_id else '',
            'username': str(username) if username else '',
            'chat_id': str(chat_id),
            'timestamp': time.time(),
            'type': 'telegram_message'
        }
        
        # Add to buffer for potential summarization
        self._add_to_buffer(storage_instance, str(chat_id), message_data)
        
        # Save individual message to storage
        try:
            # Use activity log to store message
            storage_instance.create_activity_log(
                activity_type='telegram_message',
                message=f'[{username or user_id}] {message[:100]}...' if len(message) > 100 else f'[{username or user_id}] {message}',
                metadata=message_data
            )
            logger.info(f"[TelegramMemoryCreator] Saved message from {username or user_id} in chat {chat_id}: {message[:50]}...")
        except Exception as e:
            logger.error(f"[TelegramMemoryCreator] Failed to save message: {e}")
            return {'success': False, 'message_count': 0, 'summary_created': False}
        
        # Increment count and check threshold
        message_count = self._increment_message_count(storage_instance, str(chat_id))
        should_summarize = message_count > 0 and message_count % summarize_threshold == 0
        summary_created = False
        
        if should_summarize and llm:
            logger.info(f"[TelegramMemoryCreator] Summarizing {summarize_threshold} messages for chat {chat_id}")
            
            # Get messages to summarize
            buffer = self._get_message_buffer(storage_instance, str(chat_id))
            messages_to_summarize = buffer[-summarize_threshold:]
            
            # Create summary
            summary_data = self._summarize_messages(llm, messages_to_summarize, str(chat_id))
            
            if summary_data:
                # Add metadata
                summary_data['chat_id'] = str(chat_id)
                summary_data['message_count'] = summarize_threshold
                summary_data['timestamp'] = time.time()
                
                # Save summary to storage
                storage_instance.create_activity_log(
                    activity_type='telegram_summary',
                    message=f'Chat summary for {chat_id}: {summary_data.get("summary", "")[:100]}...',
                    metadata=summary_data
                )
                
                summary_created = True
                logger.info(f"[TelegramMemoryCreator] Created summary for chat {chat_id}")
            else:
                logger.warning(f"[TelegramMemoryCreator] Failed to create summary for chat {chat_id}")
        
        return {
            'success': True,
            'message_count': message_count,
            'summary_created': summary_created
        }
