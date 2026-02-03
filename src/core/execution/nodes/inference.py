"""
Inference Node
Generates LLM response (inference, not sampling)
"""
from typing import Dict, Any, List, Callable, Optional
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
    
    Lifecycle Hooks:
        - beforeInput: Called before inputs are resolved (allows modifying inputs)
        - afterInput: Called after inputs are resolved (allows modifying resolved inputs)
        - beforeOutput: Called before outputs are returned (allows modifying outputs)
        - afterOutput: Called after outputs are returned (allows post-processing)
    """
    
    def __init__(self, node_id: str, node_data: Dict[str, Any]):
        """Initialize inference node with lifecycle hooks"""
        super().__init__(node_id, node_data)
        # Lifecycle hooks - can be registered by memory adapters or other nodes
        self._before_input_hooks: List[Callable] = []
        self._after_input_hooks: List[Callable] = []
        self._before_output_hooks: List[Callable] = []
        self._after_output_hooks: List[Callable] = []
    
    def register_before_input_hook(self, hook: Callable[[ExecutionContext], None]) -> None:
        """Register a hook to be called before inputs are resolved"""
        self._before_input_hooks.append(hook)
    
    def register_after_input_hook(self, hook: Callable[[ExecutionContext, Dict[str, Any]], Dict[str, Any]]) -> None:
        """Register a hook to be called after inputs are resolved (can modify inputs)"""
        self._after_input_hooks.append(hook)
    
    def register_before_output_hook(self, hook: Callable[[ExecutionContext, Dict[str, Any]], Dict[str, Any]]) -> None:
        """Register a hook to be called before outputs are returned (can modify outputs)"""
        self._before_output_hooks.append(hook)
    
    def register_after_output_hook(self, hook: Callable[[ExecutionContext, Dict[str, Any]], None]) -> None:
        """Register a hook to be called after outputs are returned"""
        self._after_output_hooks.append(hook)
    
    def execute(self, context: ExecutionContext) -> Dict[str, Any]:
        """Execute inference node with lifecycle hooks"""
        from ....utils.logger import get_logger
        logger = get_logger(__name__)
        
        # Hook: beforeInput - called before inputs are resolved
        for hook in self._before_input_hooks:
            hook(context)
        
        # Resolve inputs
        model = self.get_input_value('model', context)
        query = self.get_input_value('query', context, '')
        conversation_context = self.get_input_value('context', context, None)
        quantum_influence = self.get_input_value('quantum_influence', context, 0.7)
        max_length = self.get_input_value('max_length', context, 1024)
        enable_thinking = self.get_input_value('enable_thinking', context, True)
        
        # Prepare resolved inputs dict
        resolved_inputs = {
            'model': model,
            'query': query,
            'context': conversation_context,
            'quantum_influence': quantum_influence,
            'max_length': max_length,
            'enable_thinking': enable_thinking
        }
        
        # Hook: afterInput - allows modifying resolved inputs
        for hook in self._after_input_hooks:
            resolved_inputs = hook(context, resolved_inputs)
        
        # Extract potentially modified inputs
        model = resolved_inputs.get('model', model)
        query = resolved_inputs.get('query', query)
        conversation_context = resolved_inputs.get('context', conversation_context)
        quantum_influence = resolved_inputs.get('quantum_influence', quantum_influence)
        max_length = resolved_inputs.get('max_length', max_length)
        enable_thinking = resolved_inputs.get('enable_thinking', enable_thinking)
        
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
        
        # Prepare outputs
        outputs = {
            'response': response_text,
            'result': result
        }
        
        # Hook: beforeOutput - allows modifying outputs
        for hook in self._before_output_hooks:
            outputs = hook(context, outputs)
        
        # Hook: afterOutput - called after outputs are returned (for post-processing like saving to memory)
        for hook in self._after_output_hooks:
            hook(context, outputs)
        
        return outputs
