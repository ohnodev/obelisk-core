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
    
    def _setup(self, workflow: Dict[str, Any], all_nodes: Dict[str, Any]) -> None:
        """
        Initialize memory adapter - hook into connected inference nodes
        
        Called by engine after all nodes are built to allow memory adapter
        to discover and hook into inference nodes it's connected to.
        
        Args:
            workflow: Workflow definition with nodes and connections
            all_nodes: Dictionary of all node instances (node_id -> node)
        """
        from .inference import InferenceNode
        
        connections = workflow.get('connections', [])
        
        # Find all inference nodes I'm connected to
        for conn in connections:
            source_id = conn.get('source_node') or conn.get('from')
            target_id = conn.get('target_node') or conn.get('to')
            target_input = conn.get('target_input') or conn.get('to_input')
            
            # Check if this is a connection from me to an inference node
            if (source_id == self.node_id and 
                target_id in all_nodes and 
                target_input == 'context'):
                target_node = all_nodes[target_id]
                if isinstance(target_node, InferenceNode):
                    # Hook this memory adapter into the inference node
                    self.hook_into_inference_node(target_node, workflow)
    
    def hook_into_inference_node(self, inference_node, workflow: Dict[str, Any]) -> None:
        """
        Hook this memory adapter into an inference node's lifecycle
        Only hooks afterOutput to save interactions - context is passed via engine connections
        
        Args:
            inference_node: InferenceNode instance to hook into
            workflow: Workflow definition to check connections
        """
        from .inference import InferenceNode
        
        if not isinstance(inference_node, InferenceNode):
            return
        
        # Register afterOutput hook to save interaction to memory
        def after_output_hook(context: ExecutionContext, outputs: Dict[str, Any]) -> None:
            """Save query/response interaction to this adapter's memory"""
            # Get query from inference node's resolved inputs (stored in context)
            # The query comes from the inference node's input, which is already resolved by engine
            query = None
            # Try to get query from the inference node's inputs (if available in context)
            # For now, we'll get it from the outputs or we need to track it differently
            
            # Get the response
            response = outputs.get('response', '')
            
            # Get user_id for this adapter's memory instance
            user_id = self.get_input_value('user_id', context, None)
            if user_id is None or user_id == '':
                # Use adapter's node_id as user_id to ensure unique memory per adapter
                user_id = f"adapter_{self.node_id}"
            elif isinstance(user_id, str) and user_id.startswith('{{') and user_id.endswith('}}'):
                var_name = user_id[2:-2].strip()
                user_id = context.variables.get(var_name, f"adapter_{self.node_id}")
            
            # We need to get the query that was used - it should be in the inference node's context
            # For now, we'll need to track it via a beforeInput hook or get it from the node
            # Actually, we can get it from the inference node's inputs if we store it
            # Let's use a beforeInput hook just to capture the query, but not modify inputs
            if response:
                # Try to get query from inference node's last execution
                # We'll need to track this - for now, use a simple approach
                # The query should be available in the inference node's resolved inputs
                # But we don't have access to that in afterOutput
                # So we need a beforeInput hook just to capture query, not modify
                pass
        
        # We need to capture the query - use beforeInput hook just to track it
        def before_input_hook(context: ExecutionContext) -> None:
            """Capture query for saving to memory later"""
            # Get query from inference node's inputs (will be resolved by engine)
            # We can't modify here, just capture
            # Actually, we need to get it after resolution but before execution
            # Let's use afterInput hook but only to capture query, not modify context
            pass
        
        # Use afterInput hook only to capture the query (not to modify context)
        def after_input_hook(context: ExecutionContext, resolved_inputs: Dict[str, Any]) -> Dict[str, Any]:
            """Capture query for saving to memory - don't modify context (engine handles that)"""
            query = resolved_inputs.get('query', '')
            self._last_query = str(query) if query else None
            # Don't modify resolved_inputs - engine already handles context passing
            return resolved_inputs
        
        # Register hooks - only afterOutput for saving, afterInput just to capture query
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
