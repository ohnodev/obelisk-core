"""
Inference Node
Generates LLM response (inference, not sampling)
Simple interface: system_prompt + query -> response
"""
from typing import Dict, Any, List, Callable, Optional
from ...node_base import BaseNode, ExecutionContext
from .obelisk_llm import ObeliskLLM
from src.utils.logger import get_logger

logger = get_logger(__name__)


class InferenceNode(BaseNode):
    """
    Generates LLM response using the model
    
    Simple interface:
    - system_prompt: System prompt (can include memories, user context, etc.)
    - query: User query string
    - model: ObeliskLLM instance (from ModelLoaderNode)
    - quantum_influence: Quantum influence value (default: 0.7)
    - max_length: Maximum response length (default: 1024)
    - enable_thinking: Whether to enable thinking mode (default: True)
    - conversation_history: Optional list of previous messages
    
    Outputs:
        response: Generated response text
        result: Full LLMGenerationResult dict
    """
    
    def __init__(self, node_id: str, node_data: Dict[str, Any]):
        """Initialize inference node"""
        super().__init__(node_id, node_data)
        # Lifecycle hooks - can be registered by other nodes
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
        # Hook: beforeInput - called before inputs are resolved
        for hook in self._before_input_hooks:
            hook(context)
        
        # Resolve inputs
        model = self.get_input_value('model', context)
        system_prompt = self.get_input_value('system_prompt', context, '')
        query = self.get_input_value('query', context, '')
        quantum_influence = self.get_input_value('quantum_influence', context, 0.7)
        max_length = self.get_input_value('max_length', context, 1024)
        enable_thinking = self.get_input_value('enable_thinking', context, True)
        conversation_history = self.get_input_value('conversation_history', context, None)
        
        # Prepare resolved inputs dict
        resolved_inputs = {
            'model': model,
            'system_prompt': system_prompt,
            'query': query,
            'quantum_influence': quantum_influence,
            'max_length': max_length,
            'enable_thinking': enable_thinking,
            'conversation_history': conversation_history
        }
        
        # Hook: afterInput - allows modifying resolved inputs
        for hook in self._after_input_hooks:
            resolved_inputs = hook(context, resolved_inputs)
        
        # Extract potentially modified inputs
        model = resolved_inputs.get('model', model)
        system_prompt = resolved_inputs.get('system_prompt', system_prompt)
        query = resolved_inputs.get('query', query)
        quantum_influence = resolved_inputs.get('quantum_influence', quantum_influence)
        max_length = resolved_inputs.get('max_length', max_length)
        enable_thinking = resolved_inputs.get('enable_thinking', enable_thinking)
        conversation_history = resolved_inputs.get('conversation_history', conversation_history)
        
        # Debug logging
        logger.debug(f"InferenceNode {self.node_id}: query={query[:100] if query else 'None'}, "
                    f"system_prompt_length={len(system_prompt)}")
        
        # Model is required - must be provided by ModelLoaderNode
        if model is None:
            raise ValueError("model is required for InferenceNode. Connect a ModelLoaderNode first.")
        
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
        outputs = {
            'query': str(query),  # Output original query for use in memory creation, etc.
            'response': response_text,
            'result': result
        }
        
        # Hook: beforeOutput - allows modifying outputs
        for hook in self._before_output_hooks:
            outputs = hook(context, outputs)
        
        # Hook: afterOutput - called after outputs are returned (for post-processing)
        for hook in self._after_output_hooks:
            hook(context, outputs)
        
        return outputs
