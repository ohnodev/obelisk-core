"""
Inference Node
Generates LLM response (inference, not sampling)
"""
from typing import Dict, Any
from ..node_base import BaseNode, ExecutionContext


class InferenceNode(BaseNode):
    """
    Generates LLM response using the model (inference for LLM use cases)
    
    Inputs:
        model: ObeliskLLM instance (from ModelLoaderNode or LoRALoaderNode)
        query: User query string (from InputPromptNode or previous node output)
        context: ConversationContextDict (from MemoryAdapterNode)
        quantum_influence: Quantum influence value (default: 0.7)
        max_length: Maximum response length (default: 1024)
        enable_thinking: Whether to enable thinking mode (default: True)
    
    Outputs:
        response: Generated response text
        result: Full LLMGenerationResult dict
    """
    
    def execute(self, context: ExecutionContext) -> Dict[str, Any]:
        """Execute inference node"""
        from ....utils.logger import get_logger
        logger = get_logger(__name__)
        
        model = self.get_input_value('model', context)
        query = self.get_input_value('query', context, '')
        conversation_context = self.get_input_value('context', context, None)
        quantum_influence = self.get_input_value('quantum_influence', context, 0.7)
        max_length = self.get_input_value('max_length', context, 1024)
        enable_thinking = self.get_input_value('enable_thinking', context, True)
        
        # Debug logging for chaining
        logger.debug(f"InferenceNode {self.node_id}: query={query[:100] if query else 'None'}, "
                    f"query_type={type(query).__name__}, inputs={self.inputs}")
        
        # Fallback to container's model if not provided
        if model is None:
            model = context.container.llm
        
        # Generate response
        result = model.generate(
            query=str(query),
            quantum_influence=float(quantum_influence),
            max_length=int(max_length),
            conversation_context=conversation_context,
            enable_thinking=bool(enable_thinking)
        )
        
        response_text = result.get('response', '')
        logger.debug(f"InferenceNode {self.node_id}: generated response length={len(response_text)}")
        
        return {
            'response': response_text,
            'result': result
        }
