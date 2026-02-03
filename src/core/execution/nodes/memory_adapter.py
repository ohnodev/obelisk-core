"""
Memory Adapter Node
Gets conversation context from memory manager and outputs it for inference nodes
"""
from typing import Dict, Any
from ..node_base import BaseNode, ExecutionContext


class MemoryAdapterNode(BaseNode):
    """
    Gets conversation context from memory manager and outputs it for inference nodes
    
    Each MemoryAdapterNode has its own memory instance (identified by node_id).
    If the same memory adapter is reused for multiple inference nodes, they share
    the same memory instance.
    
    Inputs:
        user_id: User identifier (can be template variable like "{{user_id}}")
        query: User query string (from InputPromptNode or previous node)
    
    Outputs:
        context: ConversationContextDict with messages and memories
        memory_manager: Reference to the memory manager instance (for saving interactions)
        user_id: User identifier (passed through for saving interactions)
    
    Memory Management:
        - Each adapter node maintains its own memory instance
        - Outputs context for inference nodes to use
        - Inference nodes save interactions using the memory_manager output
    """
    
    def __init__(self, node_id: str, node_data: Dict[str, Any]):
        """Initialize memory adapter with its own memory instance"""
        super().__init__(node_id, node_data)
    
    def execute(self, context: ExecutionContext) -> Dict[str, Any]:
        """Execute memory adapter node"""
        query = self.get_input_value('query', context, '')
        
        # Get user_id for this adapter's memory instance
        # If not provided, use adapter's node_id to ensure each adapter has its own memory
        user_id = self.get_input_value('user_id', context, None)
        if user_id is None or user_id == '':
            # Use adapter's node_id as user_id to ensure unique memory per adapter
            user_id = f"adapter_{self.node_id}"
        elif isinstance(user_id, str) and user_id.startswith('{{') and user_id.endswith('}}'):
            var_name = user_id[2:-2].strip()
            user_id = context.variables.get(var_name, f"adapter_{self.node_id}")
        
        # Resolve template variables for query
        if isinstance(query, str) and query.startswith('{{') and query.endswith('}}'):
            var_name = query[2:-2].strip()
            query = context.variables.get(var_name, '')
        
        # Get conversation context from memory manager (this adapter's memory instance)
        conversation_context = context.container.memory_manager.get_conversation_context(
            user_id=str(user_id),
            user_query=str(query)
        )
        
        return {
            'context': conversation_context,
            'memory_manager': context.container.memory_manager,
            'user_id': str(user_id)
        }
