"""
JSON parsing utilities for extracting JSON from LLM responses
Handles markdown code blocks and extracts clean JSON
"""
import json
import re
from typing import Dict, Any, Optional
from .logger import get_logger

logger = get_logger(__name__)


def extract_json_from_llm_response(response: str, context: str = "response") -> Dict[str, Any]:
    """
    Extract JSON from LLM response text
    
    Handles:
    - Markdown code blocks (```json ... ``` or ``` ... ```)
    - Thinking blocks (<think>...</think>)
    - Extra text before/after JSON
    
    Args:
        response: Raw response text from LLM
        context: Context string for error messages (e.g., "summary", "memory selection")
        
    Returns:
        Parsed JSON dictionary
        
    Raises:
        ValueError: If JSON cannot be extracted or parsed (critical error)
    """
    if not response or not response.strip():
        raise ValueError(f"Cannot extract JSON from empty {context} response")
    
    text = response.strip()
    
    # Remove thinking content if present (Qwen3 format)
    text = re.sub(r'<think>.*?</think>', '', text, flags=re.DOTALL | re.IGNORECASE)
    text = text.strip()
    
    # Strip markdown code blocks if present
    text = re.sub(r'^```(?:json)?\s*\n?', '', text, flags=re.MULTILINE | re.IGNORECASE)
    text = re.sub(r'\n?```\s*$', '', text, flags=re.MULTILINE | re.IGNORECASE)
    text = text.strip()
    
    # Strategy 1: Find complete JSON object by matching braces
    json_start = text.find('{')
    if json_start >= 0:
        # Find matching closing brace
        brace_count = 0
        json_end = json_start
        for i in range(json_start, len(text)):
            if text[i] == '{':
                brace_count += 1
            elif text[i] == '}':
                brace_count -= 1
                if brace_count == 0:
                    json_end = i + 1
                    break
        
        if json_end > json_start:
            json_str = text[json_start:json_end]
            try:
                return json.loads(json_str)
            except json.JSONDecodeError as e:
                logger.error(f"Failed to parse JSON from {context} (extracted from braces): {json_str[:200]}")
                raise ValueError(f"Invalid JSON in {context} response: {e}") from e
    
    # Strategy 2: Try parsing the whole cleaned response
    try:
        return json.loads(text)
    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse JSON from {context} (full text): {text[:200]}")
        raise ValueError(f"Invalid JSON in {context} response: {e}") from e
