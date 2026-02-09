"""
Telegram Listener Node
Autonomous node that polls Telegram for new messages
"""
import time
from typing import Dict, Any, Optional, List
import requests

from ..node_base import BaseNode, ExecutionContext, ExecutionMode
from ....utils.logger import get_logger

logger = get_logger(__name__)


class TelegramListenerNode(BaseNode):
    """
    Autonomous node that listens for Telegram messages via long polling.
    
    This node runs continuously and polls the Telegram Bot API for new messages.
    When messages are received, it outputs them for processing by downstream nodes.
    
    Properties (from metadata):
        bot_token: Telegram bot API token (required)
        poll_interval: Seconds between polls (default: 2)
        timeout: Long polling timeout in seconds (default: 30)
        
    Outputs:
        trigger: Boolean - True when new message(s) received
        message: String - The latest message text
        user_id: String - Sender's Telegram user ID (for memory layer)
        username: String - Sender's @username (may be empty)
        chat_id: String - The chat/group ID
        message_id: Number - Telegram message ID
        is_reply_to_bot: Boolean - True if message is a reply to bot's message
        raw_update: Object - Full Telegram update object
    """
    
    # This is a CONTINUOUS node - runs on every tick
    execution_mode = ExecutionMode.CONTINUOUS
    
    # Telegram API base URL
    API_BASE = "https://api.telegram.org/bot"
    
    def __init__(self, node_id: str, node_data: Dict[str, Any]):
        super().__init__(node_id, node_data)
        
        # Get configuration from metadata
        self._bot_token = self.metadata.get('bot_token', '')
        self._poll_interval = float(self.metadata.get('poll_interval', 2.0))
        self._timeout = int(self.metadata.get('timeout', 30))
        
        # Resolve environment variables in bot_token
        self._bot_token = self._resolve_env_var(self._bot_token)
        
        # State
        self._last_update_id: Optional[int] = None
        self._last_poll_time: float = 0.0
        self._message_count: int = 0
        self._bot_info: Optional[Dict] = None
        self._pending_messages: List[Dict] = []  # Queue for messages from multi-message polls
        
        logger.debug(
            f"[TelegramListener {node_id}] Initialized: "
            f"poll_interval={self._poll_interval}s, "
            f"timeout={self._timeout}s"
        )
    
    def _resolve_env_var(self, value: str) -> str:
        """Resolve environment variable template like {{process.env.VAR_NAME}}"""
        import os
        if isinstance(value, str) and value.startswith('{{') and value.endswith('}}'):
            var_name = value[2:-2].strip()
            if var_name.startswith('process.env.'):
                env_var = var_name.replace('process.env.', '')
                resolved = os.getenv(env_var, '')
                if not resolved:
                    logger.warning(f"[TelegramListener] Env var {env_var} not found")
                return resolved
        return value
    
    def _get_bot_info(self) -> Optional[Dict]:
        """Get bot info (username, id) from Telegram API"""
        if self._bot_info:
            return self._bot_info
            
        if not self._bot_token:
            return None
            
        try:
            url = f"{self.API_BASE}{self._bot_token}/getMe"
            response = requests.get(url, timeout=10)
            response.raise_for_status()
            result = response.json()
            
            if result.get('ok'):
                self._bot_info = result.get('result', {})
                logger.info(f"[TelegramListener] Bot info: @{self._bot_info.get('username')}")
                return self._bot_info
        except Exception as e:
            logger.error(f"[TelegramListener] Failed to get bot info: {e}")
        
        return None
    
    def _skip_old_updates(self) -> None:
        """
        Fast-forward past all pending updates so the bot starts fresh.
        
        Calls getUpdates with offset=-1 to fetch only the very latest update,
        then records its update_id so subsequent polls only see new messages.
        """
        if not self._bot_token:
            return
        
        try:
            url = f"{self.API_BASE}{self._bot_token}/getUpdates"
            params = {
                'offset': -1,
                'limit': 1,
                'timeout': 0,
            }
            response = requests.get(url, params=params, timeout=10)
            response.raise_for_status()
            result = response.json()
            
            if result.get('ok'):
                updates = result.get('result', [])
                if updates:
                    self._last_update_id = updates[-1].get('update_id', 0)
                    logger.info(
                        f"[TelegramListener] Skipped old updates, starting after update_id={self._last_update_id}"
                    )
                else:
                    logger.info("[TelegramListener] No pending updates, starting fresh")
            else:
                desc = result.get('description') or str(result)[:300]
                logger.error(
                    f"[TelegramListener] Failed to skip old updates — API returned ok=false "
                    f"(HTTP {response.status_code}): {desc}"
                )
        except Exception as e:
            logger.error(f"[TelegramListener] Failed to skip old updates: {e}")
    
    def _get_updates(self) -> List[Dict]:
        """
        Poll Telegram API for new updates using long polling.
        
        Returns:
            List of update objects
        """
        if not self._bot_token:
            logger.warning("[TelegramListener] No bot_token configured")
            return []
        
        try:
            url = f"{self.API_BASE}{self._bot_token}/getUpdates"
            params = {
                'timeout': self._timeout,
                'allowed_updates': ['message'],  # Only get message updates
            }
            
            # If we have a last update ID, only get newer updates
            if self._last_update_id is not None:
                params['offset'] = self._last_update_id + 1
            
            response = requests.get(url, params=params, timeout=self._timeout + 5)
            response.raise_for_status()
            result = response.json()
            
            if result.get('ok'):
                updates = result.get('result', [])
                
                # Update last_update_id to avoid getting same updates again
                if updates:
                    self._last_update_id = max(u.get('update_id', 0) for u in updates)
                    logger.debug(f"[TelegramListener] Got {len(updates)} updates, last_id={self._last_update_id}")
                
                return updates
            else:
                logger.error(f"[TelegramListener] API error: {result.get('description')}")
                return []
                
        except requests.exceptions.Timeout:
            # Timeout is normal for long polling
            logger.debug("[TelegramListener] Poll timeout (normal)")
            return []
        except requests.exceptions.RequestException as e:
            logger.error(f"[TelegramListener] Request error: {e}")
            return []
        except Exception as e:
            logger.error(f"[TelegramListener] Unexpected error: {e}")
            return []
    
    def _parse_update(self, update: Dict) -> Optional[Dict[str, Any]]:
        """
        Parse a Telegram update into a standardized format.
        
        Args:
            update: Raw Telegram update object
            
        Returns:
            Parsed message data or None if not a valid message
        """
        message = update.get('message')
        if not message:
            return None
        
        # Extract message text (could be text, caption, etc.)
        text = message.get('text') or message.get('caption') or ''
        
        # Extract sender info
        from_user = message.get('from', {})
        user_id = str(from_user.get('id', ''))
        username = from_user.get('username', '')
        first_name = from_user.get('first_name', '')
        
        # Extract chat info
        chat = message.get('chat', {})
        chat_id = str(chat.get('id', ''))
        chat_type = chat.get('type', '')  # 'private', 'group', 'supergroup', 'channel'
        chat_title = chat.get('title', '')
        
        # Check if this is a reply to bot's message
        reply_to = message.get('reply_to_message', {})
        reply_to_from = reply_to.get('from', {})
        bot_info = self._get_bot_info()
        is_reply_to_bot = False
        if bot_info and reply_to_from.get('id') == bot_info.get('id'):
            is_reply_to_bot = True
        
        # Check if bot is mentioned in the message
        bot_username = bot_info.get('username', '') if bot_info else ''
        is_mention = f"@{bot_username}".lower() in text.lower() if bot_username else False
        
        return {
            'message': text,
            'user_id': user_id,
            'username': username,
            'first_name': first_name,
            'chat_id': chat_id,
            'chat_type': chat_type,
            'chat_title': chat_title,
            'message_id': message.get('message_id'),
            'is_reply_to_bot': is_reply_to_bot,
            'is_mention': is_mention,
            'timestamp': message.get('date'),
            'raw_update': update
        }
    
    def execute(self, context: ExecutionContext) -> Dict[str, Any]:
        """
        Initial execution - get bot info and prepare for polling.
        """
        # Get bot info on startup
        bot_info = self._get_bot_info()
        
        if not self._bot_token:
            logger.warning("[TelegramListener] No bot_token - node will not poll")
        elif bot_info:
            logger.info(f"[TelegramListener] Ready to poll as @{bot_info.get('username')}")
        
        # Skip all pending updates so the bot only processes NEW messages
        self._skip_old_updates()
        
        # Initialize polling time
        self._last_poll_time = time.time()
        
        return {
            'trigger': False,
            'message': '',
            'user_id': '',
            'username': '',
            'chat_id': '',
            'message_id': 0,
            'is_reply_to_bot': False,
            'is_mention': False,
            'raw_update': None
        }
    
    def on_tick(self, context: ExecutionContext) -> Optional[Dict[str, Any]]:
        """
        Called on each tick to poll for new messages.
        
        Returns:
            Output dict with message data if new message received, None otherwise
        """
        if not self._bot_token:
            return None
        
        # First, check if we have pending messages from a previous poll
        if self._pending_messages:
            return self._emit_next_message()
        
        # No pending messages - check if we should poll
        current_time = time.time()
        elapsed = current_time - self._last_poll_time
        
        # Check if poll interval has elapsed
        if elapsed < self._poll_interval:
            return None
        
        self._last_poll_time = current_time
        
        # Poll for updates
        updates = self._get_updates()
        
        if not updates:
            return None
        
        # Parse ALL updates and queue them
        for update in updates:
            parsed = self._parse_update(update)
            if parsed and parsed.get('message'):
                self._pending_messages.append(parsed)
        
        # Log how many messages were queued
        if self._pending_messages:
            logger.debug(f"[TelegramListener {self.node_id}] Queued {len(self._pending_messages)} messages for processing")
        
        # Emit the first message if any
        if self._pending_messages:
            return self._emit_next_message()
        
        return None
    
    def _emit_next_message(self) -> Optional[Dict[str, Any]]:
        """
        Pop and emit the next message from the pending queue.
        
        Returns:
            Output dict with message data, or None if queue is empty
        """
        if not self._pending_messages:
            return None
        
        parsed = self._pending_messages.pop(0)
        self._message_count += 1
        
        logger.info(
            f"[TelegramListener {self.node_id}] Message #{self._message_count} "
            f"from @{parsed.get('username') or parsed.get('user_id')} "
            f"in {parsed.get('chat_type')} {parsed.get('chat_id')}: "
            f"{parsed.get('message')[:50]}..."
        )
        
        return {
            'trigger': True,
            'message': parsed.get('message', ''),
            'user_id': parsed.get('user_id', ''),
            'username': parsed.get('username', ''),
            'chat_id': parsed.get('chat_id', ''),
            'message_id': parsed.get('message_id', 0),
            'is_reply_to_bot': parsed.get('is_reply_to_bot', False),
            'is_mention': parsed.get('is_mention', False),
            'raw_update': parsed.get('raw_update')
        }
    
    def get_status(self) -> Dict[str, Any]:
        """Get current listener status"""
        return {
            'bot_token_set': bool(self._bot_token),
            'bot_username': self._bot_info.get('username') if self._bot_info else None,
            'message_count': self._message_count,
            'last_update_id': self._last_update_id,
            'poll_interval': self._poll_interval,
            'timeout': self._timeout
        }
