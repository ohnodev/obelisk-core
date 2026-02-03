"""
Telegram Bot Node
Sends messages to Telegram groups/channels via bot API
"""
from typing import Dict, Any, Optional
from ..node_base import BaseNode, ExecutionContext
from src.utils.logger import get_logger

logger = get_logger(__name__)


class TelegramBotNode(BaseNode):
    """
    Sends messages to Telegram groups/channels via bot API
    
    Inputs:
        message: Message text to send (required)
        bot_id: Telegram bot token (optional, can be provided as widget or input)
        group_id: Telegram group/channel ID (optional, can be provided as widget or input)
    
    Outputs:
        success: Boolean indicating if message was sent successfully
        response: Response from Telegram API (if available)
    """
    
    def __init__(self, node_id: str, node_data: Dict[str, Any]):
        """Initialize Telegram bot node"""
        super().__init__(node_id, node_data)
    
    def execute(self, context: ExecutionContext) -> Dict[str, Any]:
        """Execute Telegram bot node - send message to Telegram"""
        # Get message (required, should come from input)
        message = self.get_input_value('message', context, None)
        
        # Get bot_id: try input first, then metadata (widget value)
        bot_id = self.get_input_value('bot_id', context, None)
        if not bot_id:
            bot_id = self.metadata.get('bot_id', '') or self.inputs.get('bot_id', '')
        
        # Get group_id: try input first, then metadata (widget value)
        group_id = self.get_input_value('group_id', context, None)
        if not group_id:
            group_id = self.metadata.get('group_id', '') or self.inputs.get('group_id', '')
        
        # Resolve template variables (including environment variables)
        import os
        
        def resolve_template_var(value: str) -> str:
            """Resolve template variable, including environment variables"""
            if isinstance(value, str) and value.startswith('{{') and value.endswith('}}'):
                var_name = value[2:-2].strip()
                # Check if it's an environment variable (process.env.VAR_NAME)
                if var_name.startswith('process.env.'):
                    env_var = var_name.replace('process.env.', '')
                    return os.getenv(env_var, None)
                else:
                    return context.variables.get(var_name, None)
            return value
        
        message = resolve_template_var(message) if message else None
        bot_id = resolve_template_var(bot_id) if bot_id else None
        group_id = resolve_template_var(group_id) if group_id else None
        
        # Validate inputs
        if not message:
            raise ValueError("message is required for TelegramBotNode")
        
        if not bot_id:
            raise ValueError("bot_id is required for TelegramBotNode")
        
        if not group_id:
            raise ValueError("group_id is required for TelegramBotNode")
        
        try:
            # Import requests for API calls
            import requests
            
            # Telegram Bot API endpoint
            url = f"https://api.telegram.org/bot{bot_id}/sendMessage"
            
            # Prepare payload
            payload = {
                "chat_id": group_id,
                "text": str(message),
                "parse_mode": "HTML"  # Optional: supports HTML formatting
            }
            
            # Send message
            logger.debug(f"[TelegramBot] Sending message to chat_id={group_id}, message_length={len(str(message))}")
            response = requests.post(url, json=payload, timeout=10)
            response.raise_for_status()
            
            result = response.json()
            
            if result.get('ok'):
                logger.info(f"[TelegramBot] Message sent successfully to chat_id={group_id}")
                return {
                    'success': True,
                    'response': result
                }
            else:
                error_msg = result.get('description', 'Unknown error')
                logger.error(f"[TelegramBot] Failed to send message: {error_msg}")
                return {
                    'success': False,
                    'response': result
                }
                
        except requests.exceptions.RequestException as e:
            logger.error(f"[TelegramBot] Request error: {e}")
            return {
                'success': False,
                'response': {'error': str(e)}
            }
        except Exception as e:
            logger.error(f"[TelegramBot] Unexpected error: {e}")
            return {
                'success': False,
                'response': {'error': str(e)}
            }
