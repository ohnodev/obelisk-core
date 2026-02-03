"""
Inference Node
Generates LLM response (inference, not sampling)
Simple interface: system_prompt + query -> response
"""
from typing import Dict, Any, Optional
from ...node_base import BaseNode, ExecutionContext
from .obelisk_llm import ObeliskLLM
from src.utils.logger import get_logger

logger = get_logger(__name__)


class InferenceNode(BaseNode):
    """
    Generates LLM response using the model
    
    Simple interface:
    - system_prompt: System prompt from TextNode (required)
    - query: User query string (required)
    - model: ObeliskLLM instance from ModelLoaderNode (required)
    - context: Conversation context from MemorySelectorNode with 'messages' and 'memories' (optional)
    - quantum_influence: Quantum influence value (default: 0.7)
    - max_length: Maximum response length (default: 1024)
    - enable_thinking: Whether to enable thinking mode (default: True)
    - conversation_history: Optional list of previous messages (overrides context.messages if provided)
    
    Outputs:
        query: Original query (for use in memory creation, etc.)
        response: Generated response text
        result: Full LLMGenerationResult dict
    """
    
    def __init__(self, node_id: str, node_data: Dict[str, Any]):
        """Initialize inference node"""
        super().__init__(node_id, node_data)
    
    def execute(self, context: ExecutionContext) -> Dict[str, Any]:
        """Execute inference node"""
        # Resolve inputs
        model = self.get_input_value('model', context)
        system_prompt = self.get_input_value('system_prompt', context, '')
        query = self.get_input_value('query', context, '')
        context_dict = self.get_input_value('context', context, None)  # From MemorySelectorNode
        quantum_influence = self.get_input_value('quantum_influence', context, 0.7)
        max_length = self.get_input_value('max_length', context, 1024)
        enable_thinking = self.get_input_value('enable_thinking', context, True)
        conversation_history = self.get_input_value('conversation_history', context, None)
        
        # Extract messages and memories from context if provided
        if context_dict and isinstance(context_dict, dict):
            # Context from MemorySelectorNode has 'messages' and 'memories'
            context_messages = context_dict.get('messages', [])
            context_memories = context_dict.get('memories', '')
            
            # Merge memories into system prompt
            if context_memories:
                system_prompt = f"{system_prompt}\n\n{context_memories}" if system_prompt else context_memories
            
            # Use context messages as conversation_history if not provided separately
            if conversation_history is None:
                conversation_history = context_messages
        
        # Validate query - must be a non-empty string
        if not isinstance(query, str) or not query.strip():
            raise ValueError("query is required and must be a non-empty string for InferenceNode")
        
        # Model is required - must be provided by ModelLoaderNode
        if model is None:
            raise ValueError("model is required for InferenceNode. Connect a ModelLoaderNode first.")
        
        # System prompt is required - must be provided by TextNode
        if not system_prompt:
            raise ValueError("system_prompt is required for InferenceNode. Connect a TextNode to system_prompt input.")
        
        # Debug logging (query is now validated as non-empty string)
        query_preview = query[:100] if len(query) > 100 else query
        logger.debug(f"InferenceNode {self.node_id}: query={query_preview}, "
                    f"system_prompt_length={len(system_prompt)}")
        
        # Generate response using the model
        result = model.generate(
            query=str(query),
            system_prompt=str(system_prompt),
            quantum_influence=float(quantum_influence),
            max_length=int(max_length),
            conversation_history=conversation_history,
            enable_thinking=bool(enable_thinking)
        )
        
        response_text = result.get('response', '')
        logger.debug(f"InferenceNode {self.node_id}: generated response length={len(response_text)}")
        
        # Prepare outputs
        return {
            'query': str(query),  # Output original query for use in memory creation, etc.
            'response': response_text,
            'result': result
        }
