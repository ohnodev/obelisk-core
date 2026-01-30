"""
Memory Creator Agent
Handles conversation summarization and memory creation
"""
from typing import List, Dict, Any, Optional
from ...utils.logger import get_logger
from ...utils.json_parser import extract_json_from_llm_response
from .config import MemoryAgentsConfig

logger = get_logger(__name__)


class MemoryCreator:
    """
    Agent responsible for creating memories from conversations.
    Summarizes interactions into structured memory objects.
    """
    
    def __init__(self, llm):
        """
        Initialize the memory creator agent.
        
        Args:
            llm: LLM instance for summarization (required)
        """
        if not llm:
            raise ValueError("LLM is required for MemoryCreator")
        self.llm = llm
    
    def summarize(self, interactions: List[Dict[str, Any]], user_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """
        Summarize a list of interactions into a structured memory.
        
        Args:
            interactions: List of interaction dictionaries with 'query' and 'response' keys
            user_id: Optional user ID for logging
            
        Returns:
            Dictionary with keys: summary, keyTopics, userContext, importantFacts
            Returns None if summarization fails
        """
        if not interactions:
            return None
        
        try:
            # Format conversations
            conversation_text = ""
            for interaction in interactions:
                query = interaction.get('query', '')
                response = interaction.get('response', '')
                if query:
                    conversation_text += f"User: {query}\n"
                if response:
                    conversation_text += f"Overseer: {response}\n"
            
            # Get prompt from config
            summary_prompt = MemoryAgentsConfig.get_memory_creator_prompt(conversation_text)
            
            # Generate summary using config parameters
            result = self.llm.generate(
                query=summary_prompt,
                quantum_influence=MemoryAgentsConfig.MEMORY_CREATOR_QUANTUM_INFLUENCE,
                conversation_context=None,
                max_length=MemoryAgentsConfig.MEMORY_CREATOR_MAX_LENGTH,
                enable_thinking=MemoryAgentsConfig.MEMORY_CREATOR_ENABLE_THINKING
            )
            
            summary_text = result.get('response', '').strip()
            
            # Extract JSON using utility (raises ValueError if parsing fails - critical error)
            summary_data = extract_json_from_llm_response(summary_text, context="summary")
            return summary_data
            
        except Exception as e:
            logger.error(f"Error summarizing with LLM: {e}")
            return None
