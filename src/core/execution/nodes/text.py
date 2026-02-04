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
        text: Optional text input (if connected to another node's text output)
        trigger: Optional trigger input (for scheduler connections - ignored for data)
    
    Outputs:
        text: Text output (from input or property)
    
    Properties:
        text: Text content (used if input not connected)
    
    Notes:
        The 'trigger' input is special - it's used by the WorkflowRunner to identify
        this node should be re-executed when a scheduler fires, but the trigger value
        itself is NOT used as data. This allows schedulers to connect to nodes without
        overwriting their text content.
    """
    
    def execute(self, context: ExecutionContext) -> Dict[str, Any]:
        """
        Execute text node
        
        Priority order:
        1. Connected input value (from another node's output, excluding 'trigger' input)
        2. Direct input value (from self.inputs['text'])
        3. Metadata property (from self.metadata['text'] - matches frontend node.properties)
        
        The frontend TextNode stores text in node.properties.text, which serializes
        to metadata.text in the workflow JSON. This is separate from inputs, which
        are for connected values or direct input assignments.
        """
        # 1. Check if 'text' input is connected (resolves from other nodes)
        # IMPORTANT: Skip 'trigger' input - it's only for scheduling, not data
        input_text = self.get_input_value('text', context, None)
        
        # If input_text is a boolean (from trigger), ignore it
        if isinstance(input_text, bool):
            input_text = None
        
        if input_text is not None:
            # Input is connected - use the connected value
            text_value = str(input_text)
        else:
            # 2. Check direct input value (self.inputs['text']), skip if it's a trigger boolean
            if 'text' in self.inputs and not isinstance(self.inputs['text'], bool):
                raw_value = self.inputs['text']
                # Resolve template variables (e.g., "{{user_query}}")
                if isinstance(raw_value, str) and raw_value.startswith('{{') and raw_value.endswith('}}'):
                    var_name = raw_value[2:-2].strip()
                    text_value = str(context.variables.get(var_name, raw_value))
                else:
                    text_value = str(raw_value)
            # 3. Fallback to metadata (matches frontend node.properties.text)
            elif 'text' in self.metadata:
                raw_value = self.metadata['text']
                # Resolve template variables (e.g., "{{user_query}}")
                if isinstance(raw_value, str) and raw_value.startswith('{{') and raw_value.endswith('}}'):
                    var_name = raw_value[2:-2].strip()
                    text_value = str(context.variables.get(var_name, raw_value))
                else:
                    text_value = str(raw_value)
            else:
                # Default empty string
                text_value = ''
        
        return {
            'text': text_value
        }
