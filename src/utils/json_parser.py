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
    - Truncated JSON (from token limit cuts)
    
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
        in_string = False
        escaped = False
        for i in range(json_start, len(text)):
            ch = text[i]
            if escaped:
                escaped = False
                continue
            if in_string:
                if ch == '\\':
                    escaped = True
                elif ch == '"':
                    in_string = False
                continue
            if ch == '"':
                in_string = True
            elif ch == '{':
                brace_count += 1
            elif ch == '}':
                brace_count -= 1
                if brace_count == 0:
                    json_end = i + 1
                    break
        
        if json_end > json_start:
            json_str = text[json_start:json_end]
            
            # Fix common LLM JSON mistakes before parsing
            json_str = _sanitize_json_string(json_str)
            
            try:
                return json.loads(json_str)
            except json.JSONDecodeError as e:
                logger.error(f"Failed to parse JSON from {context} (extracted from braces): {json_str[:200]}")
                raise ValueError(f"Invalid JSON in {context} response: {e}") from e
    
    # Strategy 2: Try parsing the whole cleaned response
    try:
        sanitized = _sanitize_json_string(text)
        return json.loads(sanitized)
    except json.JSONDecodeError:
        pass
    
    # Strategy 3: Try to repair truncated JSON (token limit may have cut off the response)
    repaired = _try_repair_truncated_json(text)
    if repaired is not None:
        logger.warning(
            f"Repaired truncated JSON from {context} — response was likely cut off by token limit. "
            f"Recovered keys: {list(repaired.keys())}"
        )
        return repaired
    
    # All strategies failed
    logger.error(f"Failed to parse JSON from {context} (full text): {text[:200]}")
    raise ValueError(f"Cannot extract valid JSON from {context} response (text was {len(text)} chars)")


def _try_repair_truncated_json(text: str) -> Optional[Dict[str, Any]]:
    """
    Attempt to repair truncated JSON that was cut off by token limits.
    
    When thinking mode uses most of the token budget, the actual JSON response
    can be truncated mid-string, e.g.:
        {"result": true, "confidence": "high", "reasoning": "Message directly addresses the bot by
    
    This function tries to close unterminated strings and missing braces to
    recover as much data as possible.
    
    Returns:
        Parsed dict if repair succeeds, None otherwise
    """
    json_start = text.find('{')
    if json_start < 0:
        return None
    
    fragment = text[json_start:]
    
    # Walk through tracking parser state
    in_string = False
    escaped = False
    brace_depth = 0
    
    for ch in fragment:
        if escaped:
            escaped = False
            continue
        if in_string:
            if ch == '\\':
                escaped = True
            elif ch == '"':
                in_string = False
            continue
        if ch == '"':
            in_string = True
        elif ch == '{':
            brace_depth += 1
        elif ch == '}':
            brace_depth -= 1
            if brace_depth == 0:
                return None  # JSON looks complete — repair won't help
    
    # JSON is truncated (brace_depth > 0). Try multiple repair strategies.
    
    # Attempt 1: Close unterminated string + close all open braces
    repair = fragment
    if in_string:
        repair += '"'
    repair += '}' * brace_depth
    
    try:
        result = json.loads(_sanitize_json_string(repair))
        return result
    except json.JSONDecodeError:
        pass
    
    # Attempt 2: The truncation may have left an incomplete key-value pair.
    # Strip back to the last top-level comma and close the object.
    repair = fragment
    if in_string:
        repair += '"'
    
    # Find the last comma at brace depth 1 (top-level of the object)
    scan_in_string = False
    scan_escaped = False
    scan_depth = 0
    last_top_comma = -1
    for i, ch in enumerate(repair):
        if scan_escaped:
            scan_escaped = False
            continue
        if scan_in_string:
            if ch == '\\':
                scan_escaped = True
            elif ch == '"':
                scan_in_string = False
            continue
        if ch == '"':
            scan_in_string = True
        elif ch == '{':
            scan_depth += 1
        elif ch == '}':
            scan_depth -= 1
        elif ch == ',' and scan_depth == 1:
            last_top_comma = i
    
    if last_top_comma > 0:
        repair = repair[:last_top_comma] + '}' * brace_depth
        try:
            result = json.loads(_sanitize_json_string(repair))
            return result
        except json.JSONDecodeError:
            pass
    
    return None


def _sanitize_json_string(json_str: str) -> str:
    """
    Fix common LLM JSON mistakes before parsing.
    
    Currently fixes:
    - Escaped single quotes \' (invalid in JSON, should be just ')
      LLMs often output "what\\'s" but JSON doesn't escape single quotes.
    """
    # Fix escaped single quotes - LLMs often write \' but JSON doesn't need this
    # Only fix \' that's not preceded by another backslash (i.e., not \\')
    result = re.sub(r"(?<!\\)\\'", "'", json_str)
    
    return result
