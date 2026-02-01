"""
Sampler Node
Generates LLM response
"""
from typing import Dict, Any
from ..node_base import BaseNode, ExecutionContext


class SamplerNode(BaseNode):
    """
    Generates LLM response using the model
    
    Inputs:
        model: ObeliskLLM instance (from ModelLoaderNode or LoRALoaderNode)
        query: User query string (from InputPromptNode)
        context: ConversationContextDict (from MemoryAdapterNode)
        quantum_influence: Quantum influence value (default: 0.7)
        max_length: Maximum response length (default: 1024)
        enable_thinking: Whether to enable thinking mode (default: True)
    
    Outputs:
        response: Generated response text
        result: Full LLMGenerationResult dict
    """
    
    def execute(self, context: ExecutionContext) -> Dict[str, Any]:
        """Execute sampler node"""
        model = self.get_input_value('model', context)
        query = self.get_input_value('query', context, '')
        conversation_context = self.get_input_value('context', context, None)
        quantum_influence = self.get_input_value('quantum_influence', context, 0.7)
        max_length = self.get_input_value('max_length', context, 1024)
        enable_thinking = self.get_input_value('enable_thinking', context, True)
        
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
        
        return {
            'response': result.get('response', ''),
            'result': result
        }
