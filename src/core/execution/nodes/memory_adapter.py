"""
Memory Adapter Node
Gets conversation context from memory manager and hooks into inference nodes
"""
from typing import Dict, Any, Optional
from ..node_base import BaseNode, ExecutionContext


class MemoryAdapterNode(BaseNode):
    """
    Gets conversation context from memory manager and hooks into inference nodes
    
    Each MemoryAdapterNode has its own memory instance (identified by node_id).
    If the same memory adapter is reused for multiple inference nodes, they share
    the same memory instance.
    
    Inputs:
        user_id: User identifier (can be template variable like "{{user_id}}")
        query: User query string (from InputPromptNode or previous node)
    
    Outputs:
        context: ConversationContextDict with messages and memories
    
    Memory Management:
        - Each adapter node maintains its own memory instance
        - Hooks into connected inference nodes to save interactions
        - Automatically tracks query/response pairs for connected inference nodes
    """
    
    def __init__(self, node_id: str, node_data: Dict[str, Any]):
        """Initialize memory adapter with its own memory instance"""
        super().__init__(node_id, node_data)
        # Track which inference nodes this adapter is connected to
        self._connected_inference_nodes: set = set()
        # Store the last query/response for this adapter's memory
        self._last_query: Optional[str] = None
        self._last_response: Optional[str] = None
    
    def hook_into_inference_node(self, inference_node, workflow: Dict[str, Any]) -> None:
        """
        Hook this memory adapter into an inference node's lifecycle
        
        Args:
            inference_node: InferenceNode instance to hook into
            workflow: Workflow definition to check connections
        """
        from .inference import InferenceNode
        
        if not isinstance(inference_node, InferenceNode):
            return
        
        # Register afterInput hook to inject memory context
        def after_input_hook(context: ExecutionContext, resolved_inputs: Dict[str, Any]) -> Dict[str, Any]:
            """Inject memory context into inference node inputs"""
            # Get current query from resolved inputs
            query = resolved_inputs.get('query', '')
            
            # Get user_id for this adapter's memory instance
            # If not provided, use adapter's node_id to ensure each adapter has its own memory
            user_id = self.get_input_value('user_id', context, None)
            if user_id is None or user_id == '':
                # Use adapter's node_id as user_id to ensure unique memory per adapter
                user_id = f"adapter_{self.node_id}"
            elif isinstance(user_id, str) and user_id.startswith('{{') and user_id.endswith('}}'):
                var_name = user_id[2:-2].strip()
                user_id = context.variables.get(var_name, f"adapter_{self.node_id}")
            
            # Get conversation context from memory manager (this adapter's memory instance)
            conversation_context = context.container.memory_manager.get_conversation_context(
                user_id=str(user_id),
                user_query=str(query)
            )
            
            # Inject context into resolved inputs
            resolved_inputs['context'] = conversation_context
            self._last_query = str(query)
            return resolved_inputs
        
        # Register afterOutput hook to save interaction to memory
        def after_output_hook(context: ExecutionContext, outputs: Dict[str, Any]) -> None:
            """Save query/response interaction to this adapter's memory"""
            response = outputs.get('response', '')
            if self._last_query and response:
                # Get user_id for this adapter's memory instance
                user_id = self.get_input_value('user_id', context, None)
                if user_id is None or user_id == '':
                    # Use adapter's node_id as user_id to ensure unique memory per adapter
                    user_id = f"adapter_{self.node_id}"
                elif isinstance(user_id, str) and user_id.startswith('{{') and user_id.endswith('}}'):
                    var_name = user_id[2:-2].strip()
                    user_id = context.variables.get(var_name, f"adapter_{self.node_id}")
                
                # Save interaction to memory (this adapter's memory instance)
                context.container.memory_manager.add_interaction(
                    user_id=str(user_id),
                    query=self._last_query,
                    response=response
                )
                self._last_response = response
        
        # Register hooks
        inference_node.register_after_input_hook(after_input_hook)
        inference_node.register_after_output_hook(after_output_hook)
        self._connected_inference_nodes.add(inference_node.node_id)
    
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
            'context': conversation_context
        }
