"""
Output Text Node
Final output node that returns the response
"""
from typing import Dict, Any
from ..node_base import BaseNode, ExecutionContext


class OutputTextNode(BaseNode):
    """
    Final output node that returns the response
    
    Inputs:
        response: Generated response text (from SamplerNode)
    
    Outputs:
        text: Final output text
    """
    
    def execute(self, context: ExecutionContext) -> Dict[str, Any]:
        """Execute output text node"""
        response = self.get_input_value('response', context, '')
        
        return {
            'text': str(response)
        }
