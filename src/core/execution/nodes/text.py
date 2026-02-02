"""
Text Node
Flexible text input/output node (matches frontend TextNode)
"""
from typing import Dict, Any
from ..node_base import BaseNode, ExecutionContext


class TextNode(BaseNode):
    """
    Text node that can be used for both input and output
    
    Inputs:
        text: Optional text input (if connected)
    
    Outputs:
        text: Text output (from input or property)
    
    Properties:
        text: Text content (used if input not connected)
    """
    
    def execute(self, context: ExecutionContext) -> Dict[str, Any]:
        """Execute text node"""
        # Check if input is connected
        input_text = self.get_input_value('text', context, None)
        
        # If input is connected, use it; otherwise use property
        if input_text is not None:
            text_value = str(input_text)
        else:
            # Use text property from node inputs/metadata
            text_value = str(self.inputs.get('text', ''))
        
        return {
            'text': text_value
        }
