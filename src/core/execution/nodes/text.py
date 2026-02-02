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
        """
        Execute text node
        
        Priority order:
        1. Connected input value (from another node's output)
        2. Direct input value (from self.inputs['text'])
        3. Metadata property (from self.metadata['text'] - matches frontend node.properties)
        
        The frontend TextNode stores text in node.properties.text, which serializes
        to metadata.text in the workflow JSON. This is separate from inputs, which
        are for connected values or direct input assignments.
        """
        # 1. Check if input is connected (resolves from other nodes)
        input_text = self.get_input_value('text', context, None)
        
        if input_text is not None:
            # Input is connected - use the connected value
            text_value = str(input_text)
        else:
            # 2. Check direct input value (self.inputs['text'])
            if 'text' in self.inputs:
                text_value = str(self.inputs['text'])
            # 3. Fallback to metadata (matches frontend node.properties.text)
            elif 'text' in self.metadata:
                text_value = str(self.metadata['text'])
            else:
                # Default empty string
                text_value = ''
        
        return {
            'text': text_value
        }
