"""
Memory Selector Agent
Handles intelligent selection of relevant memories based on user queries
"""
from typing import List, Dict, Any
from ...utils.logger import get_logger
from ...utils.json_parser import extract_json_from_llm_response
from .config import MemoryAgentsConfig

logger = get_logger(__name__)


class MemorySelector:
    """
    Agent responsible for selecting relevant memories from a collection.
    Uses LLM to intelligently match user queries with stored memories.
    """
    
    def __init__(self, llm):
        """
        Initialize the memory selector agent.
        
        Args:
            llm: LLM instance for memory selection (required)
        """
        if not llm:
            raise ValueError("LLM is required for MemorySelector")
        self.llm = llm
    
    def select(self, user_query: str, summaries: List[Dict[str, Any]], top_k: int = 5) -> List[Dict[str, Any]]:
        """
        Select the most relevant memories for a given user query.
        
        Args:
            user_query: Current user query (required)
            summaries: List of summary dictionaries to select from
            top_k: Number of relevant memories to select (default: 5)
            
        Returns:
            List of selected relevant summary dictionaries
            
        Raises:
            ValueError: If LLM returns invalid indices
            RuntimeError: If selection fails critically
        """
        if not summaries:
            return []
        
        # If we have fewer summaries than top_k, return all
        if len(summaries) <= top_k:
            return summaries
        
        try:
            # Format summaries for analysis
            summaries_text = ""
            for i, summary in enumerate(summaries):
                summary_str = f"Memory {i}:\n"
                summary_str += f"  Summary: {summary.get('summary', 'N/A')}\n"
                
                # Handle keyTopics - convert dicts to strings if needed
                topics = summary.get('keyTopics', [])
                topics_strs = []
                for topic in topics:
                    if isinstance(topic, dict):
                        # Extract value from dict (e.g., {"topic": "color"} -> "color")
                        topics_strs.append(str(list(topic.values())[0]) if topic.values() else str(topic))
                    else:
                        topics_strs.append(str(topic))
                summary_str += f"  Topics: {', '.join(topics_strs)}\n"
                
                # Handle importantFacts - convert dicts to strings if needed
                facts = summary.get('importantFacts', [])
                facts_strs = []
                for fact in facts:
                    if isinstance(fact, dict):
                        # Extract value from dict or stringify the whole dict
                        facts_strs.append(str(list(fact.values())[0]) if fact.values() else str(fact))
                    else:
                        facts_strs.append(str(fact))
                summary_str += f"  Facts: {', '.join(facts_strs)}\n"
                
                user_ctx = summary.get('userContext', {})
                if user_ctx:
                    summary_str += f"  Context: {', '.join([f'{k}={v}' for k, v in user_ctx.items()])}\n"
                summaries_text += summary_str + "\n"
            
            # Get prompt from config
            selection_prompt = MemoryAgentsConfig.get_memory_selector_prompt(user_query, summaries_text, top_k)
            
            # Use LLM to select using config parameters
            result = self.llm.generate(
                query=selection_prompt,
                quantum_influence=MemoryAgentsConfig.MEMORY_SELECTOR_QUANTUM_INFLUENCE,
                conversation_context=None,
                max_length=MemoryAgentsConfig.MEMORY_SELECTOR_MAX_LENGTH,
                enable_thinking=MemoryAgentsConfig.MEMORY_SELECTOR_ENABLE_THINKING
            )
            
            selection_text = result.get('response', '').strip()
            
            # Extract JSON using utility (raises ValueError if parsing fails - critical error)
            selection_data = extract_json_from_llm_response(selection_text, context="memory selection")
            
            # Extract and validate indices
            selected_indices = selection_data.get('selected_indices', [])
            
            # Validate indices and select memories
            selected_memories = []
            for idx in selected_indices:
                if isinstance(idx, int) and 0 <= idx < len(summaries):
                    selected_memories.append(summaries[idx])
            
            # If we got valid selections, return them
            if selected_memories:
                logger.debug(f"Selected {len(selected_memories)} relevant memories from {len(summaries)} total")
                return selected_memories
            else:
                # Critical error: LLM returned invalid indices - this should never happen
                raise ValueError(
                    f"Memory selection returned invalid indices: {selected_indices} "
                    f"(expected 0-{len(summaries)-1} for {len(summaries)} memories)"
                )
                
        except ValueError as e:
            # Re-raise ValueError (JSON parsing or invalid indices)
            raise
        except Exception as e:
            # Critical error for any other exception
            logger.error(f"Critical error in memory selection: {e}")
            raise RuntimeError(f"Memory selection failed critically: {e}") from e
