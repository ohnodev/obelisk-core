"""
Binary Intent Node
Classifies text as yes/no based on intent criteria
"""
from typing import Dict, Any, Optional
from ..node_base import BaseNode, ExecutionContext
from ....utils.logger import get_logger

logger = get_logger(__name__)


class BinaryIntentNode(BaseNode):
    """
    Classifies input text based on intent criteria and outputs a boolean decision.
    
    If result is True, passes through the original text for further processing.
    If result is False, pass_through is empty (workflow can stop here).
    
    Inputs:
        message: The message to evaluate (required)
        intent_criteria: What to detect/check for (required, can be from widget or input)
        context: Additional context for the decision (optional)
        model: ObeliskLLM instance (required)
    
    Properties:
        intent_criteria: Default criteria text (can be overridden by input)
    
    Outputs:
        result: Boolean true/false
        message: Original message if result is true, empty string if false
        confidence: "high", "medium", or "low"
        reasoning: Brief explanation of the decision
    """
    
    # System prompt template - we control this for reliable JSON output
    SYSTEM_PROMPT = """You are an intent classifier. Your job is to analyze text and determine if it matches the specified criteria.

You MUST respond ONLY with valid JSON in this exact format (no markdown, no extra text):
{
  "result": true,
  "confidence": "high",
  "reasoning": "Brief explanation"
}

Rules:
- "result" must be true or false (boolean, not string)
- "confidence" must be exactly one of: "high", "medium", "low"
- "reasoning" should be 1 brief sentence explaining why

Respond with JSON only. Start with { and end with }."""
    
    def __init__(self, node_id: str, node_data: Dict[str, Any]):
        """Initialize binary intent node"""
        super().__init__(node_id, node_data)
        self._default_criteria = self.metadata.get('intent_criteria', '')
    
    def execute(self, context: ExecutionContext) -> Dict[str, Any]:
        """Execute binary intent classification"""
        message = self.get_input_value('message', context, '')
        intent_criteria_input = self.get_input_value('intent_criteria', context, '')
        additional_context = self.get_input_value('context', context, '')
        llm = self.get_input_value('model', context, None)
        
        # Use input criteria if provided, otherwise use widget/property value
        intent_criteria = intent_criteria_input or self.metadata.get('intent_criteria', '')
        
        # Validate required inputs
        if not message:
            logger.warning("[BinaryIntent] No message provided")
            return {
                'result': False,
                'message': '',
                'confidence': 'low',
                'reasoning': 'No message provided to analyze'
            }
        
        if not intent_criteria:
            logger.warning("[BinaryIntent] No intent criteria provided")
            return {
                'result': False,
                'message': '',
                'confidence': 'low',
                'reasoning': 'No intent criteria specified'
            }
        
        if llm is None:
            raise ValueError("model is required for BinaryIntentNode")
        
        # Build the query
        query_parts = [
            f"CRITERIA TO CHECK:\n{intent_criteria}",
        ]
        
        if additional_context:
            query_parts.append(f"\nADDITIONAL CONTEXT:\n{additional_context}")
        
        query_parts.append(f"\nMESSAGE TO ANALYZE:\n{message}")
        query_parts.append("\nRespond with JSON only:")
        
        query = "\n".join(query_parts)
        
        try:
            # Generate classification
            result = llm.generate(
                query=query,
                system_prompt=self.SYSTEM_PROMPT,
                quantum_influence=0.1,  # Low influence for consistent classification
                max_length=200,  # Short response needed
                conversation_history=None,
                enable_thinking=False  # Fast, direct response
            )
            
            response_text = result.get('response', '').strip()
            
            # Parse JSON response
            from ....utils.json_parser import extract_json_from_llm_response
            parsed = extract_json_from_llm_response(response_text, context="binary_intent")
            
            if parsed:
                # Extract values with defaults
                intent_result = bool(parsed.get('result', False))
                confidence = parsed.get('confidence', 'low')
                reasoning = parsed.get('reasoning', 'No reasoning provided')
                
                # Normalize confidence
                if confidence not in ['high', 'medium', 'low']:
                    confidence = 'medium'
                
                logger.info(f"[BinaryIntent] Result: {intent_result}, Confidence: {confidence}, Reasoning: {reasoning[:50]}...")
                
                return {
                    'result': intent_result,
                    'message': message if intent_result else '',
                    'confidence': confidence,
                    'reasoning': reasoning
                }
            else:
                logger.warning(f"[BinaryIntent] Failed to parse JSON response: {response_text[:100]}")
                return {
                    'result': False,
                    'message': '',
                    'confidence': 'low',
                    'reasoning': 'Failed to parse classification response'
                }
                
        except Exception as e:
            logger.error(f"[BinaryIntent] Error during classification: {e}")
            return {
                'result': False,
                'message': '',
                'confidence': 'low',
                'reasoning': f'Error during classification: {str(e)}'
            }
