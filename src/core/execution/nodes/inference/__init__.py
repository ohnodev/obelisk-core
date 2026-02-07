"""
Inference Node Module

Contains InferenceNode and supporting utilities.
ObeliskLLM is NOT imported here to avoid dragging in torch/transformers/peft
at import time. The Docker agent image does not need those heavy deps since
inference is handled by the standalone inference service via InferenceClient.

If you need ObeliskLLM directly (e.g. for local dev with in-process model),
import it explicitly:  from .obelisk_llm import ObeliskLLM
"""
from .thinking_token_utils import split_thinking_tokens
from .node import InferenceNode

__all__ = ['InferenceNode', 'split_thinking_tokens']
