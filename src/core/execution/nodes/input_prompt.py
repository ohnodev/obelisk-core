"""
Input Prompt Node
Entry point for user queries
"""
from typing import Dict, Any
from ..node_base import BaseNode, ExecutionContext


class InputPromptNode(BaseNode):
    """
    Input node that provides the user's prompt/query
    
    Inputs:
        prompt: User query string (can be template variable like "{{user_query}}")
    
    Outputs:
        text: The prompt text
    """
    
    def execute(self, context: ExecutionContext) -> Dict[str, Any]:
        """Execute input prompt node"""
        prompt = self.get_input_value('prompt', context, '')
        
        # Resolve template variables
        if isinstance(prompt, str) and prompt.startswith('{{') and prompt.endswith('}}'):
            var_name = prompt[2:-2].strip()
            prompt = context.variables.get(var_name, '')
        
        return {
            'text': str(prompt)
        }
