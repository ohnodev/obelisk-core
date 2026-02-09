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
    If result is False, message is None (downstream nodes won't execute).
    
    Inputs:
        message: The message to evaluate (required)
        intent_criteria: What to detect/check for (required, can be from widget or input)
        context: Additional context for the decision (optional)
        model: ObeliskLLM instance (required)
    
    Properties:
        intent_criteria: Default criteria text (can be overridden by input)
    
    Outputs:
        result: Boolean true/false
        message: Original message if result is true, None if false (Optional[str])
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
        llm = self.get_input_value('model', context, None)
        
        # Use input criteria if provided, otherwise use widget/property value
        intent_criteria = intent_criteria_input or self.metadata.get('intent_criteria', '')
        
        # Validate required inputs
        if not message:
            logger.warning("[BinaryIntent] No message provided")
            return {
                'result': False,
                'message': None,  # Don't fire downstream
                'confidence': 'low',
                'reasoning': 'No message provided to analyze'
            }
        
        if not intent_criteria:
            logger.warning("[BinaryIntent] No intent criteria provided")
            return {
                'result': False,
                'message': None,  # Don't fire downstream
                'confidence': 'low',
                'reasoning': 'No intent criteria specified'
            }
        
        if llm is None:
            raise ValueError("model is required for BinaryIntentNode")
        
        # Build the query — only criteria + message, no extra context.
        # Keeping the prompt minimal reduces token usage and avoids confusing
        # the classifier with unrelated context.
        query = (
            f"CRITERIA TO CHECK:\n{intent_criteria}\n\n"
            f"MESSAGE TO ANALYZE:\n{message}\n\n"
            f"Respond with JSON only:"
        )
        
        try:
            # Generate classification — no thinking, fast direct JSON response.
            # The JSON output is short (~50 tokens) so 200 is plenty without thinking.
            result = llm.generate(
                query=query,
                system_prompt=self.SYSTEM_PROMPT,
                quantum_influence=0.1,  # Low influence for consistent classification
                max_length=200,  # Short response — no thinking overhead
                conversation_history=None,
                enable_thinking=False  # No thinking — fast, direct JSON response
            )
            
            response_text = result.get('response', '').strip()
            
            # Parse JSON response
            from ....utils.json_parser import extract_json_from_llm_response
            parsed = extract_json_from_llm_response(response_text, context="binary_intent")
            
            if parsed:
                # Extract and normalize result to boolean
                raw = parsed.get('result', False)
                if isinstance(raw, bool):
                    intent_result = raw
                elif isinstance(raw, str):
                    intent_result = raw.strip().lower() in ('true', '1', 'yes', 'y')
                elif isinstance(raw, (int, float)):
                    intent_result = raw != 0
                else:
                    intent_result = False
                
                confidence = parsed.get('confidence', 'low')
                reasoning = parsed.get('reasoning', 'No reasoning provided')
                
                # Normalize confidence
                if confidence not in ['high', 'medium', 'low']:
                    confidence = 'medium'
                
                logger.info(f"[BinaryIntent] Result: {intent_result}, Confidence: {confidence}, Reasoning: {reasoning}")
                
                return {
                    'result': intent_result,
                    'message': message if intent_result else None,  # Only output message if intent passes
                    'confidence': confidence,
                    'reasoning': reasoning
                }
            else:
                logger.warning(f"[BinaryIntent] Failed to parse JSON response: {response_text[:100]}")
                return {
                    'result': False,
                    'message': None,  # Don't fire downstream
                    'confidence': 'low',
                    'reasoning': 'Failed to parse classification response'
                }
                
        except Exception as e:
            logger.error(f"[BinaryIntent] Error during classification: {e}")
            return {
                'result': False,
                'message': None,  # Don't fire downstream
                'confidence': 'low',
                'reasoning': f'Error during classification: {str(e)}'
            }
