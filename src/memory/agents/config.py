"""
Configuration for Memory Agents
Contains prompts and model settings for MemoryCreator and MemorySelector
"""
from typing import Dict, Any


class MemoryAgentsConfig:
    """Configuration for memory agents"""
    
    # Model configuration
    # Both agents use the same LLM instance (passed at initialization)
    # Model parameters are set per-agent in their generate() calls
    
    # Memory Creator configuration
    MEMORY_CREATOR_QUANTUM_INFLUENCE = 0.2  # Lower influence for more consistent summaries
    MEMORY_CREATOR_MAX_LENGTH = 800  # Allow enough tokens for complete JSON generation (increased from 500)
    MEMORY_CREATOR_ENABLE_THINKING = False  # Disable thinking mode for faster, more reliable JSON output
    
    # Memory Selector configuration
    MEMORY_SELECTOR_QUANTUM_INFLUENCE = 0.1  # Very low influence for consistent selection
    MEMORY_SELECTOR_MAX_LENGTH = 800  # Enough for JSON response
    MEMORY_SELECTOR_ENABLE_THINKING = False  # Disable thinking mode for faster, simpler selection
    MEMORY_SELECTOR_DEFAULT_TOP_K = 5  # Default number of memories to select
    
    @staticmethod
    def get_memory_creator_prompt(conversation_text: str) -> str:
        """
        Get the prompt for memory creation/summarization.
        
        Args:
            conversation_text: Formatted conversation text to analyze
            
        Returns:
            Complete prompt string for the LLM
        """
        return f"""You are extracting key memories from a conversation. You MUST return ONLY valid JSON. No markdown code blocks, no explanations, no text before or after the JSON. Start with {{ and end with }}.

Conversation to analyze:
{conversation_text}

Extract and structure the following information as JSON with these EXACT keys:
- summary: A brief 1-2 sentence overview of the conversation
- keyTopics: Array of main topics discussed (e.g., ["AI", "quantum computing", "memory systems"])
- userContext: Object containing any user preferences, settings, or context mentioned (e.g., {{"preferred_language": "English", "timezone": "UTC"}})
- importantFacts: Array of factual statements extracted from the conversation (e.g., ["Current year is 2026", "User prefers concise responses"])

Example of correct JSON format:
{{
  "summary": "Discussion about AI memory systems and their implementation",
  "keyTopics": ["artificial intelligence", "memory architecture", "neural networks"],
  "userContext": {{"preferred_format": "technical", "current_year": 2026}},
  "importantFacts": ["Current year is 2026", "Memory systems use JSON for storage", "Neural networks require structured data"]
}}

Now extract the memories from the conversation above. Return ONLY the JSON object, nothing else:"""
    
    @staticmethod
    def get_memory_selector_prompt(user_query: str, summaries_text: str, top_k: int) -> str:
        """
        Get the prompt for memory selection.
        
        Args:
            user_query: Current user query
            summaries_text: Formatted text of available memories
            top_k: Number of memories to select
            
        Returns:
            Complete prompt string for the LLM
        """
        return f"""You are analyzing memories to select the {top_k} most relevant ones for a user query. You MUST return ONLY valid JSON. No markdown code blocks, no explanations, no text before or after the JSON. Start with {{ and end with }}.

User Query: {user_query}

Available Memories:
{summaries_text}

Analyze which memories are most relevant to the user query and return a JSON object with:
- selected_indices: Array of 0-based indices of the {top_k} most relevant memories (e.g., [0, 2, 5])
- reason: Brief explanation of why these memories were selected

Example of correct JSON format:
{{
  "selected_indices": [0, 2, 5],
  "reason": "Memory 0 discusses the main topic, Memory 2 contains relevant context, Memory 5 has related facts"
}}

Return the indices (0-based) of the {top_k} most relevant memories. Return ONLY the JSON object, nothing else:"""
