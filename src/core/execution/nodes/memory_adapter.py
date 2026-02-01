"""
Memory Adapter Node
Gets conversation context from memory manager
"""
from typing import Dict, Any
from ..node_base import BaseNode, ExecutionContext


class MemoryAdapterNode(BaseNode):
    """
    Gets conversation context from memory manager
    
    Inputs:
        user_id: User identifier (can be template variable like "{{user_id}}")
        query: User query string (from InputPromptNode)
    
    Outputs:
        context: ConversationContextDict with messages and memories
    """
    
    def execute(self, context: ExecutionContext) -> Dict[str, Any]:
        """Execute memory adapter node"""
        user_id = self.get_input_value('user_id', context, '')
        query = self.get_input_value('query', context, '')
        
        # Resolve template variables
        if isinstance(user_id, str) and user_id.startswith('{{') and user_id.endswith('}}'):
            var_name = user_id[2:-2].strip()
            user_id = context.variables.get(var_name, '')
        
        if isinstance(query, str) and query.startswith('{{') and query.endswith('}}'):
            var_name = query[2:-2].strip()
            query = context.variables.get(var_name, '')
        
        # Get conversation context from memory manager
        conversation_context = context.container.memory_manager.get_conversation_context(
            user_id=str(user_id),
            user_query=str(query)
        )
        
        return {
            'context': conversation_context
        }
