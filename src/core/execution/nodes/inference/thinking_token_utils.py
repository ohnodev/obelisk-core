"""
Utility functions for parsing Qwen3 thinking tokens.
Extracted to allow testing without importing the full ObeliskLLM class.
"""
from typing import List, Tuple


def split_thinking_tokens(generated_tokens: List[int]) -> Tuple[List[int], List[int]]:
    """
    Split generated tokens into thinking tokens and content tokens.
    
    Per Qwen3 docs: token 151668 is the closing tag for thinking content (</think>).
    Uses rindex to find the last occurrence of the end token.
    
    Args:
        generated_tokens: List of token IDs from model generation
        
    Returns:
        Tuple of (thinking_tokens, content_tokens)
        - thinking_tokens: Tokens before the </think> tag (exclusive)
        - content_tokens: Tokens after the </think> tag (exclusive)
    """
    end_token = 151668
    
    try:
        if end_token in generated_tokens:
            # Correct reverse index calculation (fixes off-by-one error)
            # Find the last occurrence of the end token
            last = len(generated_tokens) - 1 - generated_tokens[::-1].index(end_token)
            thinking_tokens = generated_tokens[:last]       # before </think>
            content_tokens = generated_tokens[last + 1:]   # after </think>
            return thinking_tokens, content_tokens
        else:
            # No thinking block found, all tokens are content
            return [], generated_tokens
    except ValueError:
        # Token not found, decode everything as content
        return [], generated_tokens
